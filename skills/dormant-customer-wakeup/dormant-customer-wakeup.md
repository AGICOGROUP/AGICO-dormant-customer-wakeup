---
name: dormant-customer-wakeup
description: |
  沉睡客户自动筛选与唤醒全流程。自动进入OKKI CRM全部客户列表 →
  筛选最近联系时间大于180天的沉睡客户 → 持久化列表并按顺序逐客处理 →
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

## 阶段零：脚本化极速筛选沉睡客户

仅在首次运行、列表不存在、全部已处理完成、或用户明确要求刷新时执行。

### 设计原则

- **脚本驱动，非 AI 分析**：全部筛选逻辑在 `browser_console` 脚本中完成，不逐行 AI 判断
- **不翻页盲目抓取**：当前页有符合条件的客户就记录，无则点「下一页」继续
- **两条硬筛选条件（不可更改）**：
  1. 最近联系时间 > 180天
  2. 客户标签不含「无需盘活」
- **有几个符合条件的就提取几个**，不限制只取10个
- companyId 留空，进入详情页时从 URL 获取

### 0.1 导航到全部客户列表

**⚠️ pageSize 限制：OKKI CRM 的 pageSize 最大为100，传500会弹出"pageSize 不能大于100"提示。**

```
browser_navigate → https://crm.xiaoman.cn/crm/customer/list?query={"curPage":1,"pageSize":100}
browser_wait 3秒
```

- 用 `browser_info` 查看已有标签，优先复用 CRM 标签页
- 若无可复用标签或权限被拒，`browser_open` 新标签
- 直接在全部客户列表上筛选，不进入「超过90天未联系」客群（省去侧边栏点击时间）

> ~~取消客群筛选步骤：通过侧边栏进入「超过90天未联系」客群需额外2分钟，不如直接在全部客户列表翻页筛选效率高。脚本的两条硬筛选条件（>180天 + 标签不含「无需盘活」）已能精准过滤。~~

### 0.2 页面 DOM 结构参考

| 元素 | 选择器 | 说明 |
|------|--------|------|
| 数据行 | `div.row-item.row-item-level-1` | 不含 `row-item__title` |
| 客户名 | `a[href*="company_id"]` | 第3列 `data-cci="2"` |
| 客户标签 | `.tag__overflow-item:not(.tag__overflow-item-rest) span` | 第4列 `data-cci="3"` |
| 最近联系时间 | `div.cell[data-cci="6"] .cell-inner` | 文本含"X天前"或"YYYY-MM-DD" |
| 下一页按钮 | `li.okki-pagination-next` | 到末页 class 含 `okki-pagination-disabled` |

### 0.3 极速筛选脚本（核心）

`browser_console evaluate` 运行以下脚本，**一次执行完成当前页的筛选**：

```javascript
(() => {
  const TODAY = new Date();
  const dateToDays = (dateStr) => {
    const m = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    const d = new Date(parseInt(m[1]), parseInt(m[2])-1, parseInt(m[3]));
    return Math.floor((TODAY - d) / 86400000);
  };

  const rows = document.querySelectorAll('div.row-item.row-item-level-1');
  const qualified = [];
  const skipped = { noName: 0, under180: 0, noRevive: 0 };

  rows.forEach(row => {
    // 1. 提取客户名 + companyId
    const link = row.querySelector('a[href*="company_id"]');
    if (!link) { skipped.noName++; return; }
    const name = link.textContent.trim();
    if (!name || name.length < 2) { skipped.noName++; return; }
    const href = link.getAttribute('href') || '';
    const cid = (href.match(/company_id=(\d+)/) || [])[1] || '';

    // 2. 提取客户标签
    const tagSpans = row.querySelectorAll('.tag__overflow-item:not(.tag__overflow-item-rest) span');
    const tags = Array.from(tagSpans).map(s => s.textContent.trim());
    const hasNoRevive = tags.some(t => t.includes('无需盘活'));

    // 3. 提取最近联系时间
    const timeCell = row.querySelector('div.cell[data-cci="6"] .cell-inner') || row.querySelector('div.cell[data-cci="6"]');
    const timeText = timeCell ? timeCell.textContent.trim() : '';
    let days = null;
    const daysMatch = timeText.match(/(\d+)天前/);
    if (daysMatch) {
      days = parseInt(daysMatch[1]);
    } else {
      const dateMatch = timeText.match(/(\d{4}-\d{2}-\d{2})/);
      if (dateMatch) days = dateToDays(dateMatch[1]);
    }

    // 4. 硬筛选条件1：最近联系 > 180天
    if (days === null || days <= 180) { skipped.under180++; return; }

    // 5. 硬筛选条件2：标签不含「无需盘活」
    if (hasNoRevive) { skipped.noRevive++; return; }

    qualified.push({ name, companyId: cid, sleepDays: days, tags, lastContactText: timeText });
  });

  // 检查是否有下一页
  const nextBtn = document.querySelector('li.okki-pagination-next');
  const hasNext = nextBtn && !nextBtn.classList.contains('okki-pagination-disabled');

  return JSON.stringify({
    pageRows: rows.length,
    qualifiedCount: qualified.length,
    qualified: qualified,
    skipped: skipped,
    hasNextPage: hasNext
  });
})()
```

### 0.4 翻页逻辑

脚本返回后根据 `hasNextPage` 和 `qualifiedCount` 决定下一步：

| 条件 | 动作 |
|------|------|
| `hasNextPage=true` 且 `qualifiedCount=0` | 点击 `li.okki-pagination-next` → `browser_wait 2秒` → 重新执行0.3脚本 |
| `hasNextPage=true` 且 `qualifiedCount>0` | 记录当前页合格客户 → 继续翻页找更多（点击下一页 → 0.3脚本） |
| `hasNextPage=true` 且当前页客户已全部记录 | 继续翻页找更多 |
| `hasNextPage=false` | 到末页，合并所有页的合格客户，进入0.5保存 |

> 翻页方式：`browser_click` 点击 `li.okki-pagination-next` → `browser_wait 2秒` → 重新执行0.3脚本

### 0.5 保存列表

将所有页的合格客户合并，写入 `${workspace_memory}/project/dormant-customers.json`：

```json
{
  "generatedAt": "2026-08-07T18:00:00+08:00",
  "filterDays": 180,
  "excludeTags": ["无需盘活"],
  "total": N,
  "customers": [
    {
      "index": 1,
      "companyId": "123456",
      "name": "ABC Corp",
      "sleepDays": 365,
      "lastContactText": "365天前",
      "tags": ["7天内新询盘"],
      "status": "pending"
    }
  ]
}
```

### 0.6 输出筛选结果 + 进入第一个客户

```markdown
## 沉睡客户筛选结果

> 筛选条件：最近联系>180天 且 标签不含「无需盘活」| 共 {N} 个合格客户

| 序号 | 客户名称 | 沉睡天数 | 标签 |
|------|----------|----------|------|
| 1 | XXX | 365天 | 标签1, 标签2 |
| ... | ... | ... | ... |

现在进入第 1 个客户详情页开始抓取沟通记录。
```

**取第一个 `status: "pending"` 的客户，点击客户名链接进入详情页。** 不等待确认，直接进入阶段一。

### 0.7 批次管理

- 每批所有合格客户处理完后 → 提示用户"本批已全部完成，是否抓取下一批？"
- 用户确认 → 重新执行阶段零抓取下一批（跳过已处理的可通过名称去重）
- 用户拒绝 → 保存当前进度，下次继续

### 0.8 DOM 结构变更兜底

如果0.3脚本返回 `pageRows=0`，说明 DOM 结构已变更。执行以下探测脚本：

```javascript
(() => {
  const links = document.querySelectorAll('a[href*="company_id"]');
  return JSON.stringify({
    linkCount: links.length,
    sample: links[0] ? {
      text: links[0].textContent.trim(),
      href: links[0].getAttribute('href'),
      classes: links[0].className,
      ancestorClasses: (() => {
        let el = links[0], chain = [];
        for (let i=0; i<5; i++) { el = el.parentElement; if(!el) break; chain.push({tag: el.tagName, classes: el.className}); }
        return chain;
      })()
    } : null
  });
})()
```

根据探测结果调整选择器，重新执行0.3脚本。

---

## 阶段一：进入客户详情 + 抓取沟通记录正文（一个脚本完成）

### 1.1 进入客户详情

从 `dormant-customers.json` 取第一个 `status: "pending"` 的客户。

```
browser_navigate → https://crm.xiaoman.cn/crm/customer/personal?company_id={companyId}
```

> **⚠️ 详情页 URL 是 `/personal?company_id=`，不是 `/detail?company_id=`（后者会 404）。**

### 1.2 调用 customer-conversation-catch-300 skill 抓取沟通记录

**进入详情页后，调用 `customer-conversation-catch-300` skill 执行沟通记录抓取。**

> 该 skill 使用同步XHR + 分次evaluate架构，自带反自动化分批策略：
> - 邮件：分3批每批10封，批间 browser_wait 3-9秒
> - WhatsApp：分3页每页100条，页间 browser_wait 2-5秒
>
> 详见 `customer-conversation-catch-300` skill 文档。

调用方式：使用 Skill 工具读取 `customer-conversation-catch-300` 的 SKILL.md，按其步骤执行：
1. （如已有 companyId 跳过搜索）
2. 导航到客户详情页（已在1.1完成）
3. 执行 trailList 元数据抓取（步骤3）
4. 邮件详情分批抓取（步骤4，3批×10封）
5. WhatsApp 详情分页抓取（步骤5，3页×100条）
6. 合并结果并保存

### 1.3 结果处理

catch-300 返回的 JSON 结构：

| 字段 | 说明 |
|------|------|
| rawTotal | trailList 返回的原始条目数（含系统消息） |
| filteredTotal | 过滤后的实质沟通条目数 |
| emailCount | 邮件正文数量 |
| whatsappCount | WhatsApp 联系人数量 |
| whatsappTotalMessages | WhatsApp 消息总条数 |
| failCount | 抓取失败数 |
| results | 完整结果数组，每条含 date/type/channel/subject/body |

**若 filteredTotal = 0**：该客户无实质沟通记录，将 `status` 标记为 `skipped`，`skipReason` 记录"沟通记录=0"，直接跳到下一个客户，不进入后续阶段。
**若 filteredTotal < 30**：有几条抓几条，不补造。
**若 failCount > 0**：已抓到的保存，失败的标注原因，不阻塞后续流程。

### 1.4 保存结果

```
write → {客户名}_communications.json
```

返回摘要：总互动数、邮件数（发出/收到）、WhatsApp会话数及消息数、失败数、最新互动日期。

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

评估客户主营与**我方产品线**的匹配程度（根据你所在公司的实际产品判断）：

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

### 4.1 找到客户最后一封回信 + 写入邮件草稿（脚本化）

**⚠️ 流程铁律：找到客户最后一份回信 → 点击快速回复 → 脚本写入正文 → 等待用户手动点"发送"**

#### 步骤1：找到客户最后一封回信

在客户详情页的邮件列表中，需要找到**客户发来的最后一封邮件**（不是我方发出的最后一封）。这是回复的锚点。

`browser_console evaluate` 运行以下脚本，它会自动找到最后一封"收到邮件"并点击选中：

```javascript
(() => {
  // 找所有邮件项，按 DOM 顺序（最新在上）
  var items = document.querySelectorAll('div.component-dynamic-item-email');
  var found = null;
  for (var i = 0; i < items.length; i++) {
    var text = items[i].innerText || '';
    // 判断是否为客户回信（含"收到邮件"标识）
    if (text.includes('收到邮件')) {
      found = items[i];
      // 点击选中这封邮件
      items[i].click();
      break;
    }
  }
  
  if (!found) {
    return JSON.stringify({error: 'no_incoming_mail', totalItems: items.length});
  }
  
  return JSON.stringify({
    success: true,
    selectedIndex: i,
    preview: found.innerText.substring(0, 200)
  });
})()
```

> `browser_wait 2秒` 等待邮件详情加载

#### 步骤2：点击"快速回复"展开编辑器

`browser_console evaluate` 点击快速回复触发器：

```javascript
(() => {
  var trigger = document.querySelector('div.mail-detail-quick-reply div.expand-trigger');
  if (!trigger) return JSON.stringify({error: 'no_quick_reply_trigger'});
  trigger.click();
  return JSON.stringify({success: true});
})()
```

> `browser_wait 2秒` 等待编辑器展开

#### 步骤3：脚本写入邮件正文

将阶段三生成的邮件正文写入编辑器。`browser_console evaluate` 运行：

```javascript
(() => {
  // MAIL_BODY 替换为实际邮件正文（\n 表示换行）
  var body = MAIL_BODY;
  
  var textarea = document.querySelector('div.mail-detail-quick-reply textarea.okki-input');
  if (!textarea) return JSON.stringify({error: 'no_textarea_found'});
  
  // 写入正文
  var nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  nativeInputValueSetter.call(textarea, body);
  
  // 触发 input 事件让框架感知变化（启用发送按钮）
  textarea.dispatchEvent(new Event('input', {bubbles: true}));
  textarea.dispatchEvent(new Event('change', {bubbles: true}));
  
  // 检查发送按钮是否已启用
  var sendBtn = document.querySelector('button#report-stat-quick-reply-btn-confirm');
  var sendEnabled = sendBtn && !sendBtn.disabled;
  
  return JSON.stringify({
    success: true,
    bodyLength: body.length,
    sendButtonEnabled: sendEnabled
  });
})()
```

> **MAIL_BODY 替换规则**：将阶段三生成的邮件正文（纯文本，换行用 `\n`）作为字符串赋值给 `body` 变量。例如：`var body = "Dear Renata,\n\nAs Mexico approaches its Independence Day...";`

#### 步骤4：截图确认 + 等待用户手动发送

```
browser_screenshot
```

告知用户：**"邮件草稿已写入快速回复框，请检查内容后手动点击发送。"**

> **⚠️ 禁止自动点发送按钮。** 发送邮件是不可逆操作，必须由用户手动确认。

### 4.2 DOM 结构参考

| 元素 | 选择器 | 说明 |
|------|--------|------|
| 邮件列表项 | `div.component-dynamic-item-email` | 按时间倒序排列 |
| 当前选中邮件 | `div.component-dynamic-item-email.active` | 带 `.active` 类 |
| 客户回信标识 | 文本含"收到邮件" | 我方发出标识为"发送邮件" |
| 快速回复触发 | `div.mail-detail-quick-reply div.expand-trigger` | 点击展开编辑器 |
| 回复编辑器 | `div.mail-detail-quick-reply textarea.okki-input` | placeholder="快速回复" |
| 发送按钮 | `button#report-stat-quick-reply-btn-confirm` | 无内容时 disabled |

### 4.3 更新进度

更新 `${workspace_memory}/project/dormant-customers.json`：
- 将当前客户 `status` 改为 `"completed"`
- 更新 `winbackStage`（1=第一封已发, 2/3=后续阶段）
- 更新 `winbackStatus`（sent / replied / no_reply）
- 记录 `processedAt` 时间戳

### 4.4 下一步提示

```markdown
✅ 当前客户已完成。进度：{completed}/{total}

下一个待处理客户：**{nextName}**（最近联系：{date}）

继续处理下一个吗？
```

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
