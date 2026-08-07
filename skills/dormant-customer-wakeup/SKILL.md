---
name: dormant-customer-wakeup
description: |
  沉睡客户自动筛选与唤醒全流程。自动进入OKKI CRM全部客户列表 →
  筛选最近联系时间>180天的沉睡客户 → 持久化列表并按顺序逐客处理 →
  API批量抓取30次沟通记录（邮件+WhatsApp） → 九层深度背调 →
  结合沟通记录+背调画像做深度分析与唤醒策略 → 英文跟进草稿 → 填入CRM。
  触发：任何涉及"沉睡客户"、"休眠客户"、"dormant customer"、
  "长时间未联系客户"、"客户唤醒"、"分析沉睡客户"的请求。
  跨会话进度追踪，不重复分析已完成客户。
compatibility: browser (required)
---

# OKKI CRM 沉睡客户分析与唤醒全流程

**输入：** 无（自动筛选）  
**输出：** CRM中已填入的跟进邮件（未发送）

---

## 流程总览

```
筛选沉睡客户(>180天) → pageSize=500全量加载 → DOM提取 → 按天数降序 → 只取前10个 → 持久化列表 → 逐客处理 →
  进入详情(此时获取companyId) → API抓30次互动(邮件+WhatsApp) → 九层深度背调 →
  深度分析(沟通+背调) → 唤醒契机发现 → 基于契机撰写草稿 → 确认 → 填入CRM/定时发送
  
10个处理完后提示是否抓取下一批。下次运行时自动跳到下一个未处理客户，不重复分析。
```

流程从阶段二到阶段三自动连续执行（分析→契机→写邮件），中间不问用户。
**唯一需要用户确认的节点是邮件草稿写完后**：是否修改、填入CRM还是定时发送。
**每批最多10个客户**，处理完提示是否抓取下一批。

每步结束必须等待用户明确确认，不自动跳步。

---

## 进度管理机制

### 持久化存储

沉睡客户列表和进度保存在 workspace memory：
- `${workspace_memory}/project/dormant-customers.json`

### 文件结构

```json
{
  "generatedAt": "2026-08-04T14:00:00+08:00",
  "filterDays": 180,
  "total": 5,
  "customers": [
    {
      "index": 1,
      "companyId": "123456",
      "name": "ABC Corp",
      "lastContactDate": "2025-11-15",
      "sleepDays": 262,
      "historicalLTV": 138405.72,
      "priority": "high",
      "status": "completed",
      "processedAt": "2026-08-04T14:30:00+08:00",
      "winbackStage": 1,
      "winbackStatus": "sent"
    },
    {
      "index": 2,
      "companyId": "789012",
      "name": "XYZ Ltd",
      "lastContactDate": "2025-10-20",
      "sleepDays": 288,
      "historicalLTV": 28250,
      "priority": "mid",
      "status": "pending",
      "winbackStage": 0,
      "winbackStatus": "not_started"
    }
  ]
}
```

### LTV 分层优先排序

筛选沉睡客户后，按历史订单金额（LTV）分层，高价值客户优先处理：

| 优先级 | LTV 区间 | 处理策略 |
|--------|----------|----------|
| 🔴 high | > $50,000 | 优先处理，唤醒邮件投入更多个性化 |
| 🟡 mid | $5,000 ~ $50,000 | 正常顺序处理 |
| 🟢 low | < $5,000 或 0 | 最后处理，唤醒邮件保持简洁 |

排序规则：先按 priority（high→mid→low），同优先级内按 sleepDays 降序（沉睡越久越紧急）。

LTV 数据来源：CRM 客户详情页的「历史订单金额」字段，或 AI 客户分析报告中的成交金额。

### 进度规则

1. **首次运行或用户要求刷新** → 执行阶段零，抓取前10个沉睡客户
2. **已有列表且有待处理客户** → 跳过阶段零，直接从阶段一开始
3. **取第一个 `status: "pending"` 的客户** → 进入处理流程
4. **处理完成后** → 将该客户 `status` 更新为 `"completed"`，记录 `processedAt`
5. **10个全部完成** → 提示用户"本批10个已全部完成，是否抓取下一批？"
6. **用户确认抓取下一批** → 重新执行阶段零，新抓10个（跳过已处理过的客户名称）

### 会话开始时检查

先读取 `${workspace_memory}/project/dormant-customers.json`：
- 文件不存在或全部 completed → 执行阶段零
- 存在 pending 客户 → 列出进度摘要，从下一个 pending 开始

---

## 阶段零：筛选沉睡客户

仅在首次运行、列表不存在、全部已处理完成、或用户明确要求刷新时执行。

### 设计原则

- 客户列表可能有很多页（几百条），但一次任务最多处理10个客户
- 阶段零只抓客户名称+沉睡天数，不抓 companyId 等详细信息（到阶段一进入详情页时才获取）
- 按沉睡天数降序排列，最久没联系的优先处理
- 一次只取前10个沉睡客户存入列表，处理完一批再抓下一批

### 0.1 导航到全部客户列表

**⚠️ pageSize 限制：OKKI CRM 的 pageSize 最大为100，传500会弹出"pageSize 不能大于100"提示。必须用 pageSize=100 分页抓取。**

**策略：先通过侧边栏客群筛选缩小范围，再分页抓取。**

#### 步骤A：导航到客户列表

```
browser_navigate → https://crm.xiaoman.cn/crm/customer/list
```

- 用 `browser_info` 查看已有标签，优先复用 CRM 标签页
- 若无可复用标签或权限被拒，`browser_open` 新标签
- 确认页面加载完成（客户列表可见）

#### 步骤B：通过侧边栏客群筛选

页面加载后，在左侧边栏找到客群分类，点击**「超过90天未联系」**客群。这个客群已经预筛选了最近联系时间>90天的客户，大幅缩小范围（约400-500个），其中>180天的就是我们的目标。

- `browser_snapshot` 查看侧边栏结构
- 点击「超过90天未联系」客群
- `browser_wait 3秒` 等待列表加载

> 说明：如果不使用客群筛选，直接在全部客户中翻页查找>180天的沉睡客户效率极低（可能需要翻几十页）。客群筛选是最快的方式。

#### 步骤C：逐页抓取（每页100条）

从第1页开始，逐页导航并执行 DOM 提取脚本，直到抓完所有页面或已找到足够的沉睡客户。

```
browser_navigate → https://crm.xiaoman.cn/crm/customer/list?query={"curPage":1,"pageSize":100}
browser_wait 2秒
browser_console evaluate → (执行0.2脚本)
→ 记录结果
→ 如果有下一页，翻到下一页继续
```

翻页方式：点击列表底部的分页「下一页」按钮，或直接改 URL 中的 curPage 参数。

> pageSize=100 已验证有效，不会触发任何提示。每页加载后等待2秒确保 DOM 渲染完成。

### 0.2 DOM 读取客户名称 + 最近联系时间

**⚠️ 关键发现（2026-08-07 测试验证）：**
1. **DOM 结构**：OKKI CRM 使用 `div` 虚拟列表，客户名称是 `a[href*="company_id"]` 链接，不是标准 table
2. **日期格式不统一**：较新记录显示"X天前"，较旧记录显示绝对日期"YYYY-MM-DD"，脚本必须兼容两种格式
3. **选择器优先级**：用 `a[href*="company_id"]` 定位客户名称 → 向上遍历到行容器 → 在同行找日期元素

`browser_console evaluate` 运行：

```javascript
(() => {
  const TODAY = new Date();  // 计算用
  // 将 YYYY-MM-DD 转换为距今天数
  const dateToDays = (dateStr) => {
    const m = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    const d = new Date(parseInt(m[1]), parseInt(m[2])-1, parseInt(m[3]));
    return Math.floor((TODAY - d) / 86400000);
  };

  let results = [];

  // 方案1（推荐）：通过 company_id 链接定位客户名 → 向上遍历找行容器 → 同行找日期
  const nameLinks = document.querySelectorAll('a[href*="company_id"]');
  nameLinks.forEach(link => {
    const name = link.textContent.trim();
    if (!name || name.length < 2) return;
    // 向上遍历找到行容器
    let row = link.closest('tr') || link.closest('[class*="row"]') || link.closest('[class*="item"]') || link.parentElement?.parentElement;
    if (!row) return;
    const rowText = row.innerText || row.textContent || '';
    // 尝试匹配"X天前"格式
    const daysMatch = rowText.match(/(\d+)天前/);
    if (daysMatch) {
      results.push({ name, days: parseInt(daysMatch[1]), date: '' });
      return;
    }
    // 尝试匹配 YYYY-MM-DD 格式
    const dateMatch = rowText.match(/(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
      const days = dateToDays(dateMatch[1]);
      if (days !== null) results.push({ name, days, date: dateMatch[1] });
      return;
    }
    // 行内未找到日期，尝试在兄弟元素中查找
    let sibling = row.nextElementSibling;
    let attempts = 0;
    while (sibling && attempts < 3) {
      const sibText = sibling.innerText || sibling.textContent || '';
      const dMatch = sibText.match(/(\d+)天前/);
      if (dMatch) { results.push({ name, days: parseInt(dMatch[1]), date: '' }); return; }
      const dateM = sibText.match(/(\d{4}-\d{2}-\d{2})/);
      if (dateM) { const d = dateToDays(dateM[1]); if (d !== null) { results.push({ name, days: d, date: dateM[1] }); return; } }
      sibling = sibling.nextElementSibling;
      attempts++;
    }
  });

  // 方案2：标准表格行（兼容旧版 DOM）
  if (results.length === 0) {
    const rows = document.querySelectorAll('table tbody tr, .el-table__body tr');
    rows.forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length < 6) return;
      const name = cells[1]?.textContent?.trim() || '';
      const timeText = cells[5]?.textContent?.trim() || '';
      const daysMatch = timeText.match(/(\d+)天前/);
      if (name && daysMatch) {
        results.push({ name, days: parseInt(daysMatch[1]), date: '' });
        return;
      }
      const dateMatch = timeText.match(/(\d{4}-\d{2}-\d{2})/);
      if (name && dateMatch) {
        const days = dateToDays(dateMatch[1]);
        if (days !== null) results.push({ name, days, date: dateMatch[1] });
      }
    });
  }

  // 方案3：从所有文本行中提取（兜底）
  if (results.length === 0) {
    const allText = document.body.innerText;
    const lines = allText.split('\n');
    lines.forEach(line => {
      // 匹配"X天前"
      const daysMatch = line.match(/(\d+)天前/);
      if (daysMatch) {
        const nameMatch = line.match(/^([^\d]+)/);
        if (nameMatch) {
          const name = nameMatch[1].trim();
          if (name && name.length > 2 && name !== '公司名称') {
            results.push({ name, days: parseInt(daysMatch[1]), date: '' });
          }
        }
        return;
      }
      // 匹配 YYYY-MM-DD
      const dateMatch = line.match(/(\d{4}-\d{2}-\d{2})/);
      if (dateMatch) {
        const nameMatch = line.match(/^([^\d]+)/);
        if (nameMatch) {
          const name = nameMatch[1].trim();
          const days = dateToDays(dateMatch[1]);
          if (name && name.length > 2 && days !== null && name !== '公司名称') {
            results.push({ name, days, date: dateMatch[1] });
          }
        }
      }
    });
  }

  // 去重（同名称只保留沉睡天数最多的）
  const seen = new Map();
  results.forEach(r => {
    if (!seen.has(r.name) || seen.get(r.name).days < r.days) {
      seen.set(r.name, r);
    }
  });
  results = Array.from(seen.values());

  // 过滤沉睡 >180天，按天数降序
  const dormant = results
    .filter(r => r.days > 180)
    .sort((a, b) => b.days - a.days);

  return JSON.stringify({
    totalCustomers: results.length,
    dormantCount: dormant.length,
    top10: dormant.slice(0, 10),
    top10Names: dormant.slice(0, 10).map(c => `${c.name} (${c.days}天${c.date ? ', ' + c.date : ''})`)
  });
})()
```

> **⚠️ 已验证的坑（2026-08-07 测试）：**
> 
> | 坑 | 错误做法 | 正确做法 |
> |----|----------|----------|
> | pageSize>100 | URL 传 pageSize=500 | **pageSize 最大100**，传500会弹出"pageSize 不能大于100"提示 |
> | 日期格式 | 只匹配"X天前" | **末页旧记录显示 YYYY-MM-DD 绝对日期**，必须兼容两种格式 |
> | DOM 结构 | 用 table tr 选择器 | **OKKI CRM 使用 div 虚拟列表**，客户名是 `a[href*="company_id"]` 链接 |
> | 选择器优先级 | 先找行再找名 | **先通过 `a[href*="company_id"]` 定位名称**，再向上遍历找行容器和日期 |
> 
> 如果3层方案都返回0条，用 `browser_snapshot` 查看实际 DOM 结构后调整选择器。

### 0.3 保存列表（只取前10个）

将筛选结果写入 `${workspace_memory}/project/dormant-customers.json`：

```json
{
  "generatedAt": "2026-08-07T16:55:00+08:00",
  "filterDays": 180,
  "batchSize": 10,
  "total": 10,
  "customers": [
    {
      "index": 1,
      "companyId": "",
      "name": "最沉睡的客户名",
      "sleepDays": 365,
      "status": "pending"
    }
  ]
}
```

> companyId 留空，进入详情页时从 URL 获取。

### 0.4 输出筛选结果

```markdown
## 沉睡客户筛选结果

> 筛选条件：最近联系时间 > 180天 | 共 {dormantCount} 个沉睡客户 | 本批取前10个

| 序号 | 客户名称 | 沉睡天数 |
|------|----------|----------|
| 1 | XXX | 365天 |
| 2 | YYY | 300天 |
| ... | ... | ... |

（还有 {dormantCount-10} 个沉睡客户待后续批次处理）

现在开始分析第 1 个？
```

确认后进入阶段一。

### 0.5 批次管理

- 每批最多10个客户
- 10个全部处理完后（status 均为 completed）→ 提示用户"本批10个已全部完成，是否抓取下一批？"
- 用户确认 → 重新执行阶段零抓取下一批10个（跳过已处理的可通过名称去重）
- 用户拒绝 → 保存当前进度，下次继续

---

## 阶段一：进入当前客户 + 批量抓取沟通记录（邮件+WhatsApp）

### 1.1 进入客户详情

从 `dormant-customers.json` 取第一个 `status: "pending"` 的客户。

**方式A — 在筛选结果列表中直接点击客户名（推荐）：**
- 如果筛选结果列表仍在页面上，直接点击该客户名称链接
- `browser_wait 2秒` → 进入详情页
- URL 含 `company_id` 即成功

**方式B — 通过URL直接跳转：**
```
browser_navigate → https://crm.xiaoman.cn/crm/customer/detail?company_id={companyId}
```

### 1.2 统一API批量抓取（邮件+WhatsApp，最近30条，分批+延迟）

**关键认知：OKKI CRM 按年份折叠历史动态。trailList API 必须带时间参数才能跨年查询。**

策略：从当前年份开始 → 不够30条 → 展开上一年 → 继续抓 → 直到凑满30条或没有更多。

**⚠️ 反自动化对抗策略（必读）：**

OKKI CRM 有反自动化检测，短时间内大量 API 调用会触发拦截（404/封禁）。必须采用以下措施：

| 措施 | 做法 | 原理 |
|------|------|------|
| **随机延迟** | 每次 fetch 之间加 500-1500ms 随机延迟 | 模拟人类操作节奏 |
| **分批抓取** | 30 条拆成 3 批（每批 10 条），批间停 3-5 秒 | 降低瞬时并发 |
| **减少详情调用** | 列表全部抓取，但详情（正文）只抓前 15 条 | 够分析用，降低 API 总量 |
| **单次脚本超时** | 单次 browser_console 脚本运行不超过 60 秒 | 避免长时间连接被检测 |

**步骤A：先展开折叠的年份分组**

1. `browser_snapshot` 查看客户详情页的动态列表
2. 找到被折叠的年份分组（如 "2025年 (58)"），点击展开
3. 逐层展开直到最近30条的年份区间全部可见
4. `browser_wait 2秒`

**步骤B：第一批 — 抓取列表元数据（1次脚本，带延迟）**

先只抓 trailList 列表（不调详情），拿到全部 30 条的元数据：

```javascript
(async () => {
  const uid = document.cookie.match(/userId=(\d+)/)?.[1];
  const cid = window.location.href.match(/company_id=(\d+)/)?.[1];
  if (!uid || !cid) return JSON.stringify({error: 'auth_failed', uid, cid});

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  const now = new Date();
  const periods = [];
  for (let i = 0; i < 6; i++) {
    const end = new Date(now.getFullYear(), now.getMonth() - i * 6 + 1, 0, 23, 59, 59);
    const start = new Date(now.getFullYear(), now.getMonth() - (i + 1) * 6 + 1, 0, 23, 59, 59);
    start.setMonth(start.getMonth() + 1, 1);
    start.setHours(0, 0, 0, 0);
    periods.push({
      begin: start.toISOString().replace('T', ' ').substring(0, 19),
      end: end.toISOString().replace('T', ' ').substring(0, 19)
    });
  }

  // 只抓列表元数据，不调详情，每次请求间加随机延迟
  let allItems = [];
  for (const p of periods) {
    if (allItems.length >= 30) break;
    for (let page = 1; page <= 2; page++) {
      const url = `/api/customerRead/trailList?company_id=${cid}&curPage=${page}&pageSize=50&stat_info=0&begin_time=${encodeURIComponent(p.begin)}&end_time=${encodeURIComponent(p.end)}&adjust_email_dynamic=0`;
      const r = await fetch(url, {credentials:'include'});
      const d = await r.json();
      const list = d.data?.list || d.data || [];
      allItems = allItems.concat(list);
      await sleep(rand(500, 1200));  // 随机延迟
      if (list.length < 50 || allItems.length >= 50) break;  // 多抓一些再过滤
    }
    if (allItems.length < 50) await sleep(rand(800, 1500));  // 批间延迟
  }

  // 过滤掉非实质沟通：系统消息、订单变更、已读回执、自动回复等
  // 只要真正的沟通记录：邮件（发出+收到，排除已读回执和自动回复）+ WhatsApp
  const isRealCommunication = (item) => {
    // WhatsApp（module=15）保留
    if (item.module === 15) return true;
    // 邮件（module=2）需进一步过滤
    if (item.module === 2) {
      const subject = (item.subject || '').trim();
      // 排除已读回执
      if (/^Read:/i.test(subject)) return false;
      // 排除撤回邮件
      if (/^Recall:/i.test(subject)) return false;
      // 排除自动回复（主题含 auto-reply / out of office / automatic 等）
      if (/auto.?repl|out.?of.?office|automatic|自动回复|不在办公室/i.test(subject)) return false;
      return true;
    }
    // 其他类型（module 非 2 和 15）全部排除
    // 包括：订单状态变更(type=806)、销售订单、跟进记录、商机变更、同步记录等
    return false;
  };

  const filtered = allItems.filter(isRealCommunication).slice(0, 30);

  // 返回元数据摘要（不含正文）
  return JSON.stringify({
    rawTotal: allItems.length,
    filteredTotal: filtered.length,
    removedCount: allItems.length - filtered.length,
    items: filtered.map(item => ({
      date: item.gmtCreate,
      module: item.module,
      type: item.type,
      subject: item.subject || '',
      from: item.fromAddr || '',
      to: item.toAddr || '',
      mailId: item.data?.mail_id || item.refer_id || '',
      contactId: item.data?.user_contact_id || item.refer_id || '',
      summary: (item.summary || '').substring(0, 200)
    }))
  });
})()
```

**步骤C：第二批 — 分批抓详情正文（拆成3批，每批10条，批间停3-5秒）**

将上一步拿到的 30 条 items 分成 3 批，每批 10 条分别调详情 API。每次 browser_console 只处理一批：

```javascript
(async () => {
  const uid = document.cookie.match(/userId=(\d+)/)?.[1];
  if (!uid) return JSON.stringify({error: 'auth_failed'});

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  // ITEMS_JSON 由调用方替换为当前批次的10条数据
  const batch = ITEMS_JSON;

  const results = [];
  for (const item of batch) {
    try {
      if (item.module === 2) {
        // 邮件详情
        const r = await fetch(
          `/api/mailRead/info?mail_id=${item.mailId}&user_id=${uid}&skip_view_privilege=1`,
          {credentials:'include'}
        );
        const d = await r.json();
        results.push({
          date: item.date,
          type: item.type === 201 ? '邮件发送' : (item.type === 202 ? '邮件收到' : '邮件'),
          channel: '邮件',
          from: item.from,
          to: item.to,
          subject: item.subject,
          body: d.data?.content || d.data?.body || '',
          readReceipt: !!(item.subject && /^Read:/.test(item.subject))
        });
      } else if (item.module === 15) {
        // WhatsApp 详情
        const r = await fetch(
          `/api/customerContactRead/messageList?user_contact_id=${item.contactId}&scene=drawer&curPage=1&pageSize=50`,
          {credentials:'include'}
        );
        const d = await r.json();
        const msgs = d.data?.list || d.data || [];
        const txt = msgs.map(m => {
          const dir = m.send_type === 2 ? '客户' : '我方';
          return `[${dir} ${m.send_time}] ${m.body || m.content || ''}`;
        }).join('\n');
        results.push({
          date: item.date,
          type: 'WhatsApp',
          channel: 'WhatsApp',
          messageCount: msgs.length,
          body: txt,
          readReceipt: false
        });
      } else {
        results.push({
          date: item.date,
          type: '其他',
          channel: '系统',
          subject: item.subject,
          body: item.summary || '',
          readReceipt: false
        });
      }
      await sleep(rand(500, 1500));  // 每条之间随机延迟
    } catch(e) {
      results.push({date: item.date, type: '抓取失败', error: e.message, subject: item.subject});
      await sleep(rand(800, 2000));  // 失败后多等一会
    }
  }
  return JSON.stringify({batchSize: batch.length, results});
})()
```

**步骤D：批间等待**

- 第1批执行完 → `browser_wait 3秒`（或 browser_console 运行一个 3-5 秒的 sleep）
- 第2批执行完 → `browser_wait 4秒`
- 第3批执行完 → 合并全部结果

**合并逻辑（agent 侧执行）：**
- 将 3 批的 results 数合并
- 统计：emailCount / whatsappCount / readReceiptCount / otherCount / failCount
- 保存到 `{客户名}_interactions.json`

**若中途被拦截（404/超时）：**
- 已抓到的批次保存，不丢
- 告知用户"第 N 批被拦截，已保存前 N*10 条数据"
- 建议用户等待 5-10 分钟后再继续抓取剩余批次

**API 说明：**

| 互动类型 | module | 详情 API |
|----------|--------|----------|
| 邮件 | 2 | `/api/mailRead/info?mail_id={mail_id}&user_id={uid}&skip_view_privilege=1` |
| WhatsApp | 15 | `/api/customerContactRead/messageList?user_contact_id={contact_id}&scene=drawer&curPage=1&pageSize=50` |
| 其他 | 其他 | 从 trailList 条目的 summary/data 字段直接获取 |

**trailList 正确参数：**
```
/api/customerRead/trailList?company_id={cid}
  &curPage=1           ← 是 curPage，不是 pageNum
  &pageSize=50
  &begin_time=2025-01-01+00:00:00   ← 必须带时间范围
  &end_time=2025-12-31+23:59:59
  &stat_info=0
  &adjust_email_dynamic=0
```

**⚠️ 已验证的坑（不要重犯）：**

| 坑 | 错误做法 | 正确做法 |
|----|----------|----------|
| trailList 参数名 | `pageNum` | **`curPage`**（已验证） |
| 跨年查询 | 不带 `begin_time`/`end_time` | 按半年一段分段查询，必须带时间参数 |
| 年份折叠导致漏数据 | 只查当前可见区间 | 先展开折叠年份 → 按时间段分段查询 → 凑满30条 |
| 只抓到邮件 | 加 `type=mail` 过滤 | 不加 type，按 `module` 字段分流 |
| WhatsApp 方向反 | `send_type === 1` 当客户 | **send_type: 1=我方, 2=客户**（已验证） |
| WhatsApp 详情API | 调 `trailDetail` 或 `talkRead` | 只能调 `customerContactRead/messageList` |
| WhatsApp 附件 | `body` 返回 `[object Object]` | 忽略附件，只取 `m.body` 文本内容 |
| **反自动化拦截** | 一次性 30 条详情全抓 | 分 3 批每批 10 条，批间停 3-5 秒，每条间 500-1500ms 随机延迟 |
| **列表与详情分两步** | 列表+详情混在一个脚本 | 先只抓列表元数据，再分批调详情，降低单次脚本 API 调用数 |
| **非实质动态混入** | 不过滤系统消息 | 过滤掉 module≠2 且≠15 的条目，以及已读回执/撤回/自动回复 |

**⚠️ 动态过滤规则（列表抓取后必须执行）：**

trailList 返回的条目中混有大量非实质沟通，必须过滤掉，只保留真正的沟通记录：

| 保留 | 判断条件 |
|------|----------|
| ✅ 邮件发出 | module=2 且 type=201，主题不含 Read:/Recall:/auto-reply |
| ✅ 邮件收到 | module=2 且 type=202，主题不含 Read:/Recall:/auto-reply |
| ✅ WhatsApp | module=15 |

| 排除 | 判断条件 |
|------|----------|
| ❌ 已读回执 | 主题以 `Read:` 开头 |
| ❌ 撤回邮件 | 主题以 `Recall:` 开头 |
| ❌ 自动回复 | 主题含 auto-reply/out of office/automatic/自动回复 |
| ❌ 订单状态变更 | module 为其他值且 type=806 |
| ❌ 销售订单 | module 为其他值且 summary 含"订单" |
| ❌ 跟进记录 | module 为其他值且 summary 含"跟进" |
| ❌ 商机变更/同步 | module 为其他值且非邮件非 WhatsApp |

**若API失败（cookie过期/接口变更），回退方案：**
- 在客户详情页 → 历史动态 → 全部 → 点开第一条互动 → 重新探测API

### 1.3 保存结果

```
write → {客户名}_interactions.json
```

返回摘要：总互动数、邮件数、WhatsApp数、已读回执数、其他类型数、最新互动日期、联系人列表。

---

## 阶段一·五：九层深度背调

在抓取完沟通记录后、分析之前执行。目的是从外部公开信息源构建客户画像，与 CRM 沟通记录交叉验证，让后续分析和唤醒邮件有事实支撑。

**输入：** 客户名称 + 官网域名（从 CRM 客户详情页获取）  
**输出：** 背调报告 + 综合评分 + 风险评级，保存为 `{客户名}_background.html`

### 第 0 层：合规前置核查（一票否决）

启动背调前先查制裁名单，命中红线直接终止。

- 查询来源：美国 Consolidated Screening List (CSL)、OFAC 制裁名单、联合国制裁名单
- 搜索方式：`web_search` 搜索 `{公司名} OFAC` / `{公司名} sanctioned` / `{公司名} CSL`
- **命中红线** → 立即终止背调，告知用户"客户命中制裁名单，不可继续跟进"，将 `status` 标记为 `blocked`
- **未命中** → 继续第 1-8 层

### 第 1-8 层：多维数据抓取（并行）

对客户名称和官网域名同时发起多路搜索，建立信息矩阵：

| 层 | 维度 | 数据源 | 搜索方式 |
|----|------|--------|----------|
| 1 | 决策人 LinkedIn | LinkedIn | `web_search "{公司名}" CEO OR "Purchasing Manager" OR "Procurement" site:linkedin.com` |
| 2 | 社媒活跃度 | Facebook/Instagram | `web_search "{公司名}" site:facebook.com OR site:instagram.com`，判断是否活跃还是僵尸号 |
| 3 | 域名注册 | WHOIS | `web_search "{域名} whois"`，查注册时间、过期时间、隐私保护 |
| 4 | 工商注册 | 本地工商系统 | `web_search "{公司名} registration" OR "{公司名} trade license" OR "{公司名} TIN"` |
| 5 | 官网内容 | 客户官网 | `web_fetch` 官网首页和 About 页面，提取业务范围、员工规模、产品线 |
| 6 | 负面舆情 | Google | `web_search "{公司名} scam" OR "{公司名} review" OR "{公司名} complaint" OR "{公司名} fraud"` |
| 7 | 关联公司 | 公开信息 | `web_search "{公司名}" subsidiary OR affiliate OR "parent company"` |
| 8 | 行业声誉 | 行业网站 | `web_search "{公司名}" industry news OR exhibition OR trade show` |

### 第 9 层：行业与产品匹配度

评估客户主营与我们机械产品（耐磨件/水泥配件/矿山设备）的匹配程度：

- 客户是终端用户、经销商、还是中间商？
- 采购需求与我们的产品线是否对口？
- 是否存在"空壳公司"特征（无实质业务、无员工、无数字足迹）？

### 交叉验证与评分

将所有线索交叉验证，构建证据链：

**事实 vs 推断分级：**
- **确认事实**：有明确来源佐证（官网、WHOIS、工商注册）→ 直接陈述
- **逻辑推断**：无直接证据但可合理推导 → 标注置信度（如"邮箱与 LinkedIn 身份推断置信度 80%"）
- **无数据**：查不到就标注"透明度低"或"未找到公开信息"，**绝不脑补**

**综合评分（1-10 分）+ 风险评级：**

| 评级 | 分数 | 含义 | 处置建议 |
|------|------|------|----------|
| 🟢 绿 | 7-10 | 可信、匹配度高 | 正常推进唤醒 |
| 🟡 橙 | 4-6 | 部分信息缺失、匹配度存疑 | 唤醒邮件中谨慎试探，要求确认资质 |
| 🔴 红 | 1-3 | 高风险、空壳特征或制裁风险 | 建议放弃或人工复核关键证件 |

### 输出格式

```markdown
## {客户名} 深度背调报告

> 背调时间：{时间} | 数据源：LinkedIn/WHOIS/Google/官网/工商注册

### 一、合规核查
- 制裁名单：✅ 未命中 / ❌ 命中（详情）
- 核查来源：CSL / OFAC / UN

### 二、公司基本信息
| 维度 | 信息 | 来源 | 置信度 |
|------|------|------|--------|
| 注册名 | ... | 工商注册 | 100% |
| 注册时间 | ... | WHOIS/工商 | ... |
| 员工规模 | ... | LinkedIn/官网 | ... |
| 主营业务 | ... | 官网 | ... |
| 官网域名 | ... | WHOIS | ... |

### 三、决策人与联系人
| 姓名 | 头衔 | LinkedIn | 邮箱 | 电话 | 置信度 |
|------|------|---------|------|------|--------|

### 四、行业匹配度
- 主营方向：...
- 与我方产品匹配度：高/中/低
- 采购类型：终端用户/经销商/中间商
- 空壳风险：是/否

### 五、舆情与风险
- 负面信息：有/无（详情）
- 关联公司风险：有/无
- 数字足迹：丰富/有限/几乎为零

### 六、综合评分
- **评分：{X}/10**
- **风险评级：🟢绿/🟡橙/🔴红**
- **处置建议：...**
```

保存背调报告：
```
write → {客户名}_background.html
```

**背调报告输出后告知用户背调结果摘要，然后自动进入阶段二。**

### 背调六条铁律

1. **数据驱动，严禁捏造** — 拿不到就标注"透明度低"，绝不脑补
2. **事实与推断严格分级** — 确认事实直接陈述，推断必须标注置信度
3. **优先权威信源** — 官方注册机构 > WHOIS > 二手转述
4. **主动发现风险** — 隐患藏在关联公司、历史诉讼、零数字足迹里
5. **精益运营** — 每条结论都能追溯到证据链的一环
6. **命中制裁红线立即终止** — 不可逾越，不做变通
7. **禁止跳过任何一层** — 九层穿透是一个整体，每一层都有独立价值。背调不是可选项的堆叠，而是逐层递进的事实拼图。跳过 WHOIS 或工商注册看似省时间，但正是这些基础信息在交叉验证中起到锚定作用。邮件正文已经到手，工作该做扎实——宁可慢一步出完整报告，不可快一秒交半成品。

### 与 CRM 沟通记录的交叉验证

背调完成后，将背调发现与 CRM 沟通记录交叉比对：

| 交叉点 | 验证内容 |
|--------|----------|
| 联系人 | CRM 中的联系人 vs LinkedIn 上的决策人是否一致 |
| 公司规模 | 官网/LinkedIn 员工数 vs 邮件签名中的公司信息 |
| 主营业务 | 官网描述 vs 询盘产品是否匹配 |
| 邮箱域名 | WHOIS 域名注册时间 vs 首次沟通时间 |
| 负面信号 | 舆情中的投诉 vs 沟通中的摩擦点 |

交叉验证结果作为阶段二分析的输入。

---

## 阶段二：沉睡客户深度分析（沟通记录 + 背调画像）

基于沟通记录和背调报告综合生成分析，直接发在对话中。

### 报告模板

```markdown
## {客户名} 沉睡客户深度分析报告

> 数据：OKKI CRM {N}条互动记录（{邮件数}封邮件 + {WhatsApp数}条WhatsApp + {其他}） | 背调评分：{X}/10 {风险标签} | 跟进人：{姓名} | 沉睡天数：{X}天

### 一、沟通时间线
（ASCII时间轴，标注与最后一次实质沟通的距离）

### 二、客户画像（沟通记录 + 背调交叉验证）
| 维度 | CRM 记录 | 背调发现 | 交叉验证 |
|------|----------|----------|----------|
| 阶段 | 询盘/样品/谈判/成交/流失 | — | — |
| 渠道 | 阿里国际站/官网/展会 | 社媒活跃度/官网 | 是否一致 |
| 联系人 | CRM 联系人 | LinkedIn 决策人 | 是否同一人 |
| 决策模式 | 单人/团队/需审批 | LinkedIn 组织架构 | 互相印证 |
| 公司规模 | 邮件签名/客户口述 | LinkedIn/官网员工数 | 是否一致 |
| 主营业务 | 询盘产品线 | 官网/工商注册 | 匹配度 |
| 沉睡前关系热度 | 热/温/冷 | — | — |
| 沉睡可能原因 | 价格/竞品/项目搁置/对接人离职 | 负面舆情/高管变动 | 交叉印证 |

### 三、背调核心发现
- 制裁核查结果：✅ 未命中 / ❌ 命中
- 行业匹配度：高/中/低（依据）
- 空壳风险：是/否（依据）
- 负面信号：有/无（详情）
- 背调评分：{X}/10，风险评级 {标签}

### 四、沉睡原因诊断
- 最后一次沟通的内容和结果
- 客户为何不再回复？（结合邮件内容 + 背调发现推断）
- 客户当前状态推测（背调中的近期动态佐证）

### 五、唤醒可行性评估（结合背调调整）
| 维度 | 评分(1-5) | 说明 |
|------|-----------|------|
| 历史关系基础 | ... | 基于沟通记录 |
| 需求匹配度 | ... | 基于背调行业匹配 |
| 联系人有效性 | ... | CRM 联系人 vs LinkedIn 交叉验证 |
| 时机合适度 | ... | 背调近期动态 + 行业时机 |
| **综合唤醒概率** | ... | 沟通 + 背调综合判断 |

### 六、关键发现与断点

### 七、唤醒行动建议
| 优先级 | 动作 | 预期效果 |
|--------|------|----------|
| 🔴立即 | ... | ... |
| 🟡48h | ... | ... |
| 🟢1-2周 | ... | ... |

### 八、跟进邮件策略
- **切入角度**：如何自然重启对话（避免"好久不见"式尴尬）
- **价值主张**：带去什么新信息/新价值（基于背调发现定制）
- **主推话题**：...
- **语气**：专业温暖、不过度热情
- **行动请求**：低门槛，对方只需回几个词
- **背调信息运用**：哪些背调发现可以自然融入邮件（如"看到贵司近期在XX领域的布局"）
```

**分析报告直接输出后，不等待确认，自动进入阶段二·五（唤醒契机发现）。**

在深度分析完成后、撰写邮件前执行。沉睡客户长时间未联系，重新发邮件需要一个自然的理由——不能凭空冒出来一封邮件。这一步找到那个"契机"。

**原理：** 你已经深度了解了客户背景（背调），也看过了沟通记录（分析），现在需要一个"发信理由"——一个让对方不会觉得突兀的时机节点。

### 契机类型与搜索方式

| 契机类型 | 说明 | 搜索方式 |
|----------|------|----------|
| **对方国家节日** | 国庆日、宗教节日、新年等 | `web_search "{国家名} national holiday {当前月份}"` 或 `web_search "{国家名} public holidays 2026"` |
| **行业展会/峰会** | 客户所在行业的近期展会 | `web_search "{行业关键词} exhibition OR expo OR trade show {当前年月}"` |
| **我方公司变动** | 新产品发布、新方案、产能扩张、认证获取 | 从公司内部信息获取，或询问用户 |
| **对方公司变动** | 官网改版、新产品线、高管变动、融资、扩张 | 背调阶段已获取，或 `web_search "{公司名}" news {当前年月}` |
| **季节性需求** | 采购旺季、设备维护季、年度预算周期 | 基于行业经验判断（如水泥厂年度检修季） |
| **行业动态/政策** | 关税变化、环保新规、行业标准更新 | `web_search "{行业关键词}" regulation OR policy OR tariff {当前年月}` |
| **纪念日** | 首次合作周年、上次报价周年 | 从 CRM 沟通记录中提取首次沟通日期 |

### 执行步骤

1. **提取客户国家**：从 CRM 客户详情或背调报告中获取客户所在国家
2. **搜索未来 30 天内的契机**：
   - `web_search "{国家名} public holidays {当前年月} next month"`
   - `web_search "{行业关键词} exhibition OR expo {当前年月}"`
   - `web_search "{公司名}" news recent`
   - 检查 CRM 中首次沟通日期是否临近周年
3. **筛选最合适的契机**：
   - 相关性：与客户行业/业务相关度
   - 时间窗口：距今 3-30 天内最佳（太近来不及准备，太远失去紧迫感）
   - 自然度：是否能自然地融入邮件开头，不显牵强

### 输出格式

```markdown
## 唤醒契机分析

> 客户国家：{国家} | 分析时间：{时间} | 时间窗口：未来30天

### 候选契机

| 契机 | 日期 | 距今天数 | 相关性 | 自然度 | 推荐度 |
|------|------|----------|--------|--------|--------|
| {国家}国庆日 | 2026-09-23 | 49天 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| {行业}国际展会 | 2026-08-15 | 10天 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 首次合作3周年 | 2026-08-05 | 0天 | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ |
| 对方公司新品发布 | 2026-08-10 | 5天 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |

### 推荐契机

**{选中的契机}** — {日期}（距今{N}天）

**理由：** {为什么这个契机最合适}

**邮件融入方式：**
- 自然提及角度：{如何自然地在邮件中提到这个契机}
- 避免显得刻意：{注意事项}

### 定时发送建议

- **最佳发送时间**：{契机日期前1-2天}，即 {具体日期}
- **发送时段**：{客户时区}上午 9:00-10:00（对方刚开始工作、收件箱未满）
- **定时方式**：
  - 如果用户需要定时发送 → 用 `cron` 工具设置定时任务，在指定时间提醒用户发送
  - 如果契机就在1-2天内 → 直接生成草稿，用户确认后立即发送
  - 如果契机较远（>7天）→ 生成草稿保存，设置 cron 提醒，到契机前1-2天再确认发送
```

**契机确认后不等待，自动进入阶段三撰写邮件草稿。**

### 契机匹配规则

- **如果背调评级为红** → 不寻找契机，直接建议放弃或人工复核，不发送唤醒邮件
- **如果背调评级为橙** → 只使用低风险契机（节日问候、行业资讯），避免涉及商业意图
- **如果背调评级为绿** → 全部契机类型均可使用，优先选择相关性最高的

### 无合适契机时的处理

如果30天内找不到自然契机：
1. 扩大搜索范围到60天
2. 如仍无 → 使用"通用价值切入"（新产品信息/行业报告），不强制绑定时间节点
3. 如实告知用户"未找到自然契机，建议使用通用价值切入方式"

---

## 阶段三：唤醒邮件草稿（基于契机撰写）

用户确认后，撰写英文跟进邮件。

### 沉睡客户邮件特别要求

- **避免**："Long time no talk" / "Just checking in" / "Following up" 等空洞表述
- **必须**：带去新价值 —— 新产品、新方案、市场动态、行业洞察等
- **必须**：自然融入背调发现（如"看到贵司官网近期新增了XX产品线"或"注意到贵司在LinkedIn上发布了XX岗位"），但不可显得像在监视，语气要自然
- **起手方式示例**：
  - "I came across something that reminded me of our conversation about..."
  - "We recently launched [X] that addresses [pain point] you mentioned..."
  - "I noticed [company] has been expanding into [area from background check]..."
  - "With [industry event/trend], I thought this might be relevant to your team..."
- 150–250词，3–5段
- 低门槛行动请求（对方只需回几个词）
- 专业、温暖、不施压
- **风险适配**：背调评级为橙/红的客户，邮件措辞更谨慎，避免暴露商业意图

### 输出格式

```markdown
## 唤醒邮件草稿

**收件人:** {name} <{email}>
**抄送:** {others}
**主题:** {subject}
**契机:** {选中的契机} — {契机日期}
**建议发送时间:** {契机前1-2天的具体日期和时段}

---

{正文}

---

**草稿说明：**
| 要素 | 设计意图 |
|------|----------|
| 切入角度 | ...（基于契机） |
| 价值点 | ...（基于背调发现） |
| 主体内容 | ...（结合沟通记录上下文） |
| 结尾CTA | ... |
| 契机融入 | 契机如何自然出现在邮件中 |
```

**输出后必须问：** *"对邮件草稿有任何修改建议吗？还是需要我帮你填入CRM草稿箱，或定时发送？"

### 发送方式选择

用户确认草稿后，提供三种选择：

| 选项 | 说明 |
|------|------|
| **立即填入CRM** | 按阶段四流程填入CRM草稿箱，用户检查后手动发送 |
| **定时发送** | 用 `cron` 工具设置定时任务，在契机前1-2天提醒用户发送草稿 |
| **手动粘贴** | 把草稿文本发给用户，用户自行粘贴到邮件客户端 |

### 多阶段唤醒序列

借鉴 B2C winback 框架，B2B 唤醒同样需要递进式跟进，避免一封邮件无回复就放弃：

| 阶段 | 时机 | 目标 | 策略 |
|------|------|------|------|
| **Stage 1 — 重连** | 立即 | 价值切入，不带压力 | 带新信息/新方案/行业洞察，低门槛 CTA |
| **Stage 2 — 激励** | Stage 1 后 5-7 天无回复 | 加大吸引力 | 提供专属方案（如限量优惠、免费样品、定制方案） |
| **Stage 3 — 最后通牒** | Stage 2 后 7-10 天无回复 | 制造紧迫感 | "可能是最后联系机会" + 极简 CTA（只需回复 Yes/No） |
| **Sunset** | Stage 3 后 14 天无回复 | 停止骚扰 | 标记 `sunset`，不再主动发送，列入观察池 |

每次发送后更新 `dormant-customers.json` 中的 `winbackStage` 和 `winbackStatus`：
- `winbackStage`：0=未开始, 1=第一封已发, 2=第二封已发, 3=第三封已发, -1=sunset
- `winbackStatus`：not_started / sent / replied / no_reply / sunset

> **跨会话提醒**：下次运行时，如果某客户 winbackStage > 0 且 winbackStatus 为 no_reply/sent，检查是否到了下一阶段的时间窗口，提示用户"该发第二封了"。

用户确认草稿且选择"你填入"后：

### 4.1 填入草稿

1. 复用客户详情页标签
2. 点击最新一条邮件主题 → `browser_wait 2秒` → 右侧抽屉打开
3. 点击「回复」→ `browser_wait 2秒`
4. `browser_console evaluate` 填入正文：

```javascript
const body = `{邮件正文，\n表示换行}`;
const el = document.querySelector('textarea, [contenteditable="true"], .ql-editor');
if (el) {
  el.tagName === 'TEXTAREA' ? (el.value = body) : (el.textContent = body);
  el.dispatchEvent(new Event('input', {bubbles: true}));
}
```

5. `browser_screenshot` 截图确认
6. 告知用户：**"草稿已填入，请检查后手动发送。"**

> 如果用户选择自己手动填写，把草稿文本发给用户即可。

### 4.2 更新进度

更新 `${workspace_memory}/project/dormant-customers.json`：
- 将当前客户 `status` 改为 `"completed"`
- 更新 `winbackStage`（1=第一封已发, 2/3=后续阶段）
- 更新 `winbackStatus`（sent / replied / no_reply）
- 记录 `processedAt` 时间戳

### 4.3 下一步提示

```markdown
✅ 当前客户已完成。进度：{completed}/{total}

下一个待处理客户：**{nextName}**（最近联系：{date}）

继续处理下一个吗？
```

---

## 禁止做法

- ❌ 未抓取真实沟通内容就分析
- ❌ 逐封点击展开（API批量抓取才是正确方式）
- ❌ 跳过用户确认节点
- ❌ 点CRM发送按钮
- ❌ 用 `web_fetch` 访问OKKI（SPA，不生效）
- ❌ 对同一按钮反复 snapshot 确认（页面结构稳定）
- ❌ 重复分析已标记 `completed` 的客户
- ❌ 在列表仍有效时重新筛选（除非用户明确要求刷新）
- ❌ 只抓邮件忽略 WhatsApp（trailList 不加 type=mail 参数）

---

## 异常处理

| 情况 | 处理 |
|------|------|
| 筛选结果为0 | 告知用户当前无沉睡客户，确认筛选条件是否正确 |
| 列表中找不到该客户 | 通过 companyId URL 直接跳转。仍失败→标记为 `skipped`，记录原因 |
| API返回空/cookie过期 | 告知用户需重新登录CRM |
| 互动不足30条 | 有多少读多少，如实说明 |
| 全是已读回执/系统消息 | 如实告知，建议WhatsApp联系 |
| WhatsApp详情API失败 | 从 trailList 条目的 summary/data 字段提取可见信息，标注"详情API受限" |
| 页面结构与预期不同 | 截图告知，请求手动介入 |
| 联系人已离职（邮件退信） | 报告中标注，建议寻找新联系人 |
| workspace memory 写入失败 | 回退到当前工作目录写 JSON，告知用户 |
| **触发反自动化拦截**（404/封禁/超时） | 已抓数据保存，告知用户"第 N 批被拦截"，等待 5-10 分钟后继续。下次自动从断点续抓 |
| **单批全部失败** | 告知用户 CRM 可能限制访问，建议等待 10-15 分钟或换时段重试 |

---

## 沉睡分级与淘汰机制

### 沉睡深度分级

| 级别 | 沉睡天数 | 状态 | 处理策略 |
|------|----------|------|----------|
| **浅沉睡** | 180-270天 | 可唤醒 | 正常3阶段序列 |
| **中沉睡** | 271-365天 | 需诊断 | 分析沉睡原因后决定是否值得投入 |
| **深沉睡** | >365天 | 接近流失 | 仅发1封"最后确认"邮件，无回复则 sunset |

### Sunset 淘汰规则

当满足以下任一条件，标记客户为 `sunset`，不再主动发送唤醒邮件：

1. 3阶段唤醒序列全部完成且无回复
2. 沉睡超过365天且 Stage 1 无回复
3. 邮件多次退信（联系人已离职且无新联系人）
4. 用户手动标记"放弃"

sunset 客户保留在列表中（不删除，保留历史记录），但不再生成唤醒建议。如客户后续主动联系，自动从 sunset 恢复为 active。

---

## 唤醒效果指标

用于衡量唤醒活动的整体效果，每次全部处理完后输出一次：

| 指标 | 计算方式 | 参考值 |
|------|----------|--------|
| 唤醒回复率 | replied 数 / sent 数 | 5-8% 正常，>15% 优秀 |
| ROI | 回复客户历史LTV之和 / 投入时间成本 | >4:1 合格 |
| Sunset 率 | sunset 数 / 总数 | <30% 健康 |
| 平均转化周期 | 从 Stage 1 发出到收到回复的平均天数 | <10天 优秀 |

---

## 运行日志

每次执行完整流程时，必须记录详细运行日志，用于追踪各环节耗时、问题和优化方向。

### 日志文件

- 保存路径：`${workspace_memory}/project/dormant-run-log.json`
- **追加模式**：每次运行追加一条记录，保留全部历史，不覆盖
- 日志目的：记录运行中遇到的问题和解决方式，提取经验优化 skill
- **中断保护**：每个阶段完成后立即写入日志（不是全部完成后才写），确保任务中断时已完成的阶段记录不丢失

### 日志结构

```json
{
  "logs": [
    {
      "runId": "2026-08-06-001",
      "runDate": "2026-08-06T09:00:00+08:00",
      "customerName": "Thwainy Industries",
      "companyId": "37947572696189",
      "stages": [
        {
          "stage": "阶段零-筛选",
          "startedAt": "2026-08-06T09:00:00+08:00",
          "completedAt": "2026-08-06T09:01:30+08:00",
          "durationSec": 90,
          "status": "success",
          "result": "2个沉睡客户",
          "issues": []
        },
        {
          "stage": "阶段一-抓取互动",
          "startedAt": "2026-08-06T09:02:00+08:00",
          "completedAt": "2026-08-06T09:08:00+08:00",
          "durationSec": 360,
          "status": "success",
          "result": "30条邮件，0条WhatsApp",
          "issues": ["步骤B原始61条→过滤后30条", "反自动化策略有效，3批零失败"]
        }
      ],
      "totalDurationSec": 450,
      "overallStatus": "interrupted",
      "interruptedAt": "阶段一·五-深度背调",
      "interruptReason": "用户暂停执行",
      "lessonsLearned": []
    }
  ]
}
```

### 记录规则

1. **每个阶段开始时记录 `startedAt`，结束时记录 `completedAt` 和 `durationSec`**
2. **`status` 取值**：success / partial / failed / skipped / interrupted
3. **`issues` 记录该阶段遇到的问题、异常、解决方案**
4. **`lessonsLearned` 在全部流程结束后总结**，提炼可优化的方向
5. **部分完成也要记录** — 如实记录原因
6. **追加写入** — 每次运行追加一条，不覆盖历史
7. **逐阶段写入** — 每个阶段完成后立即 read→追加→write 日志文件，不要等全部完成才写。这样即使任务在某个阶段中断（用户暂停、浏览器崩溃、反自动化拦截），已完成的阶段日志仍然保存在文件中
8. **中断时补记** — 如果任务中断，将中断阶段标记为 `interrupted`，记录 `interruptedAt`（中断发生在哪个阶段）和 `interruptReason`（中断原因），`overallStatus` 设为 `interrupted`

### 写入时机（关键）

```
阶段零完成 → read日志 → 追加阶段零记录 → write日志
阶段一完成 → read日志 → 追加阶段一记录 → write日志
阶段一·五完成 → read日志 → 追加阶段一·五记录 → write日志
阶段二完成 → read日志 → 追加阶段二记录 → write日志
阶段二·五完成 → read日志 → 追加阶段二·五记录 → write日志
阶段三完成 → read日志 → 追加阶段三记录 → write日志
全部完成 → read日志 → 追加 overallStatus + lessonsLearned → write日志
```

**如果中断**：中断时立即 read日志 → 将中断阶段标记为 interrupted → write日志

### 每次运行结束时的输出

流程全部结束后（无论成功还是中途停止），读取本日志文件，向用户输出运行摘要：

```markdown
## 本次运行日志

> 客户：{客户名} | 总耗时：{N}分钟 | 状态：{success/partial/failed}

| 阶段 | 耗时 | 状态 | 问题 |
|------|------|------|------|
| 阶段零-筛选 | 90秒 | ✅ | 无 |
| 阶段一-抓取 | 360秒 | ✅ | 反自动化策略有效 |
| 阶段一·五-背调 | 120秒 | ⚠️ | 跳过5层 |
| 阶段二-分析 | 60秒 | ✅ | 基于不完整背调 |
| 阶段二·五-契机 | 30秒 | ✅ | 沙特国庆9/23 |
| 阶段三-邮件 | 45秒 | ✅ | 已输出草稿 |

**经验总结：**
1. {lesson 1}
2. {lesson 2}
```
