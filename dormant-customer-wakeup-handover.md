# dormant-customer-wakeup 智能体交接文档

> 生成时间：2026-08-07 | 对话跨度：2026-08-04 ~ 2026-08-07

---

## 一、项目概述

### 目标
构建一个专门的沉睡客户唤醒智能体，自动从 OKKI CRM 筛选超过180天未联系的客户，逐客进行深度分析并生成唤醒邮件。

### 最终产物
- **Skill 名称**：`dormant-customer-wakeup`
- **安装位置**：Agent 级 + Account 级（全局共享）
- **文件路径**：
  - Agent: `C:\Users\Administrator\.accio\accounts\1778946028_971001\agents\MID-43946028U1785823-C710AA-4826-A91959\agent-core\skills\dormant-customer-wakeup\SKILL.md`
  - Account: `C:\Users\Administrator\.accio\accounts\1778946028_971001\skills\dormant-customer-wakeup\SKILL.md`
  - 项目备份: `D:\AGICO-dormant-customer-wakeup\SKILL.md`（待 git 初始化）

---

## 二、完整工作流程（六阶段）

```
阶段零：筛选沉睡客户（>180天）
  ├─ 浏览器进入 CRM 全部客户列表（pageSize=500 一次全加载）
  ├─ DOM 读取客户名称 + 最近联系时间（3层兜底选择器）
  ├─ 过滤 >180天 → 按天数降序 → 只取前10个
  └─ 保存到 dormant-customers.json → 提示用户开始
         ↓
阶段一：抓取最近30条实质沟通记录
  ├─ 步骤B：trailList 抓列表元数据（curPage + 时间窗口分段 + 随机延迟）
  │   └─ 过滤掉已读回执/撤回/自动回复/订单变更/系统消息
  ├─ 步骤C：分3批×10条调详情正文（批间停3-5秒，条间500-1500ms随机延迟）
  │   ├─ module=2 → mailRead/info（邮件正文）
  │   └─ module=15 → customerContactRead/messageList（WhatsApp消息）
  └─ 保存到 {客户名}_interactions.json
         ↓ 逐阶段写日志
阶段一·五：九层深度背调（禁止跳层）
  ├─ 第0层：合规核查（OFAC/CSL/UN制裁名单）→ 命中红线终止
  ├─ 第1层：LinkedIn 决策人
  ├─ 第2层：社媒活跃度（Facebook/Instagram）
  ├─ 第3层：WHOIS 域名注册
  ├─ 第4层：工商注册（Trade License/TIN）
  ├─ 第5层：官网内容抓取（About/Products/Team）
  ├─ 第6层：负面舆情（scam/review/complaint）
  ├─ 第7层：关联公司（subsidiary/affiliate/parent）
  ├─ 第8层：行业声誉（展会/新闻）
  ├─ 第9层：行业与产品匹配度
  ├─ 交叉验证：CRM沟通记录 vs 背调发现
  └─ 综合评分(1-10) + 风险评级(绿/橙/红)
         ↓ 逐阶段写日志
阶段二：深度分析（沟通记录 + 背调画像）
  ├─ 沟通时间线
  ├─ 客户画像（CRM记录 vs 背调交叉验证表）
  ├─ 沉睡原因诊断
  ├─ 唤醒可行性评估
  └─ 行动建议
         ↓ 自动连续（不问用户）
阶段二·五：唤醒契机发现
  ├─ 搜索7类契机（节日/展会/公司变动/季节需求/行业政策/合作周年）
  ├─ 筛选最合适的（相关性+时间窗口+自然度）
  ├─ 风险适配（红不找/橙低风险/绿全部）
  └─ 定时发送建议（契机前1-2天 + 客户时区）
         ↓ 自动连续
阶段三：唤醒邮件草稿（基于契机撰写）
  ├─ 融入背调发现 + 沟通上下文 + 契机
  ├─ 风险适配措辞
  └─ 输出草稿 → ✋ 第一个用户确认点
         ↓ 逐阶段写日志
阶段四：填入CRM / 定时发送 + 更新进度
  ├─ 立即填入CRM（浏览器 console 填入回复框）
  ├─ 定时发送（cron 工具，契机前1-2天提醒）
  ├─ 手动粘贴（文本发给用户）
  ├─ 更新 dormant-customers.json（completed + winbackStage）
  └─ 提示下一个待处理客户 → 循环（每批最多10个）
```

---

## 三、技术方案（已验证）

### 3.1 trailList API（互动列表）

```
/api/customerRead/trailList?company_id={cid}
  &curPage=1                    ← 是 curPage，不是 pageNum
  &pageSize=50
  &begin_time=2025-01-01+00:00:00   ← 必须带时间范围
  &end_time=2025-12-31+23:59:59
  &stat_info=0
  &adjust_email_dynamic=0
```

**关键参数**：
- `curPage`（不是 `pageNum`）
- `begin_time`/`end_time`（按半年分段查询，穿透年份折叠）
- 不加 `type=mail`（包含邮件+WhatsApp全部类型）
- 不加 `scene=drawer`（会限制返回条数）

### 3.2 邮件详情 API

```
/api/mailRead/info?mail_id={mail_id}&user_id={uid}&skip_view_privilege=1
```

- `mail_id` 从 trailList 返回的 `item.data.mail_id` 获取
- 已验证稳定，多次成功

### 3.3 WhatsApp 消息 API

```
/api/customerContactRead/messageList?user_contact_id={contact_id}&scene=drawer&curPage=1&pageSize=50
```

- `user_contact_id` 从 trailList 返回的 `item.data.user_contact_id` 获取
- `send_type`: **1=我方发出, 2=客户发来**（已验证，注意不要标反）
- 附件返回 `[object Object]`，忽略，只取 `m.body` 文本

### 3.4 module 分流规则

| module | 类型 | 详情API |
|--------|------|---------|
| 2 | 邮件 | `/api/mailRead/info` |
| 15 | WhatsApp | `/api/customerContactRead/messageList` |
| 其他 | 系统消息 | 从 `item.summary`/`item.data` 直接获取，不调API |

### 3.5 动态过滤规则

trailList 返回的条目中混有大量非实质沟通，必须过滤：

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
| ❌ 订单状态变更 | type=806 |
| ❌ 销售订单/跟进记录/商机变更 | module 非 2/15 |

### 3.6 反自动化对抗策略

| 措施 | 做法 |
|------|------|
| 随机延迟 | 每次 fetch 间 500-1500ms 随机等待 |
| 分批抓取 | 列表元数据先一次性抓完 → 详情正文拆3批（每批10条）→ 批间停3-5秒 |
| 列表与详情分离 | 不再一个脚本调30次详情API，拆成"先列表→再分批详情"两步 |
| 断点续抓 | 被拦截后已抓数据保存，下次从断点继续 |
| 失败后多等 | 单条失败后等800-2000ms，整批失败等5-10分钟 |

### 3.7 详情页 URL

```
正确：https://crm.xiaoman.cn/crm/customer/personal?company_id={cid}
错误：https://crm.xiaoman.cn/crm/customer/detail?company_id={cid}  ← 会 404
```

---

## 四、批次管理

- 每批最多10个客户（按沉睡天数降序）
- 阶段零只存 `{name, sleepDays, status}`，companyId 到详情页才获取
- 10个处理完 → 提示是否抓下一批
- 跨会话进度追踪，不重复分析已完成客户

---

## 五、进度管理

### 持久化文件
- `${workspace_memory}/project/dormant-customers.json` — 沉睡客户列表+进度
- `${workspace_memory}/project/dormant-run-log.json` — 运行日志（追加模式）

### dormant-customers.json 结构

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
      "name": "客户名",
      "sleepDays": 365,
      "status": "pending",  // pending / completed / skipped / blocked
      "winbackStage": 0,    // 0=未开始, 1-3=阶段, -1=sunset
      "winbackStatus": "not_started"  // not_started/sent/replied/no_reply/sunset
    }
  ]
}
```

### 运行日志机制

- **追加模式**：保留全部历史
- **逐阶段写入**：每个阶段完成后立即 read→追加→write
- **中断保护**：中断时标记 `interrupted` + 记录中断位置和原因
- **字段**：startedAt/completedAt/durationSec/status/issues/lessonsLearned

---

## 六、借鉴的官方技能

从 `customer-winback-automator`（B2C电商赢回）借鉴4个概念：

| 概念 | 应用 |
|------|------|
| LTV 分层排序 | high(>$50K)→mid→low，高价值优先 |
| 多阶段唤醒序列 | Stage1重连→Stage2激励(5-7天)→Stage3最后通牒(7-10天)→Sunset(14天) |
| Sunset 淘汰机制 | >365天或3阶段无回复→停止骚扰 |
| 效果指标 | 唤醒回复率5-8%正常/>15%优秀，ROI>4:1 |

---

## 七、已验证的坑（8个关键教训）

| 坑 | 错误做法 | 正确做法 |
|----|----------|----------|
| trailList 参数名 | `pageNum` | `curPage` |
| 跨年查询 | 不带时间参数 | 按半年分段 + `begin_time`/`end_time` |
| WhatsApp 方向 | `send_type===1` 当客户 | `send_type: 1=我方, 2=客户` |
| WhatsApp 详情API | 调 `trailDetail` 或 `talkRead` | 只能调 `customerContactRead/messageList` |
| 详情页 URL | `/detail?company_id=` | `/personal?company_id=` |
| **pageSize 上限** | URL 传 `pageSize=500` | **pageSize 最大100**，传500弹出"pageSize 不能大于100"提示。改用 pageSize=100 分页 + 侧边栏「超过90天未联系」客群筛选 |
| **日期格式不统一** | 只匹配"X天前" | **末页旧记录显示 YYYY-MM-DD 绝对日期**，脚本必须兼容两种格式并用 Date 计算天数 |
| **DOM 结构** | 用 `table tr` 标准表格选择器 | **OKKI CRM 使用 div 虚拟列表**，客户名是 `a[href*="company_id"]` 链接，先定位链接再向上遍历找行容器和日期 |

---

## 八、背调七条铁律

1. 数据驱动，严禁捏造
2. 事实与推断严格分级
3. 优先权威信源
4. 主动发现风险
5. 精益运营
6. 命中制裁红线立即终止
7. **禁止跳过任何一层** — 九层穿透是一个整体，邮件正文已经到手，工作该做扎实

---

## 九、用户偏好（从本次对话中提炼）

- **工作流介入模式**：全自动执行至最终产出（邮件草稿），仅在关键确认环节人工介入
- **自动化稳定性偏好**：加入随机延迟、分批处理及断点续传机制以规避反自动化拦截
- **工具选型原则**：直接调用浏览器 API 而非依赖功能受限的第三方插件
- **数据处理逻辑**：严格过滤非实质沟通记录；跨年份用时间窗口分段查询
- **背调合规要求**：强制完成九层穿透，禁止跳层
- **过程监控偏好**：结构化日志记录各阶段耗时、状态及问题

---

## 十、未完成事项

| 事项 | 状态 | 说明 |
|------|------|------|
| 阶段零完整测试 | ✅ 已完成 | 2026-08-07 测试通过。pageSize=500→改100；日期格式兼容；DOM选择器修复。10个沉睡客户已提取 |
| 阶段一~四完整测试 | ⚠️ 部分完成 | Thwainy 抓取成功，但背调跳层，邮件未填入CRM |
| Account级SKILL.md同步 | ✅ 已完成 | 2026-08-07 三处同步（Agent/Account/项目目录） |
| D:\AGICO-dormant-customer-wakeup git初始化 | ✅ 已完成 | 2026-08-07 初始提交 a51a9fe |
| MS Carbon Zambia 完整处理 | ❌ 未完成 | 发现折叠问题后被打断 |
| 运行日志实际验证 | ✅ 已完成 | 2026-08-07 阶段零日志已写入 dormant-run-log.json |

---

## 十一、相关文件索引

| 文件 | 路径 | 用途 |
|------|------|------|
| SKILL.md（Agent级） | `.../agent-core/skills/dormant-customer-wakeup/SKILL.md` | 主技能文件（最新） |
| SKILL.md（Account级） | `.../1778946028_971001/skills/dormant-customer-wakeup/SKILL.md` | 全局共享副本（待同步） |
| dormant-customers.json | `${workspace_memory}/project/dormant-customers.json` | 沉睡客户列表+进度 |
| dormant-run-log.json | `${workspace_memory}/project/dormant-run-log.json` | 运行日志 |
| Thwainy_trailList_meta.json | 工作目录 | Thwainy 30条元数据 |
| Thwainy_batch1/2/3.json | 工作目录 | Thwainy 3批邮件正文 |
| 原始skill（customer-analysis-editemail） | `.../skills/customer-analysis-editemail/SKILL.md` | 原始单客户分析技能（已恢复，未改动） |
