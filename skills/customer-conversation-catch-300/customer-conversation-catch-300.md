---
name: customer-conversation-catch-300
description: |
  OKKI CRM客户历史沟通记录批量抓取。在浏览器内用同步XHR分批抓取：
  邮件最多30封（分3批每批10封，批间3-9秒）+ WhatsApp最多300条（分3页每页100条，页间2-5秒）。
  触发：任何需要"抓取客户沟通记录"、"读取邮件"、"读取WhatsApp"、
  "抓取沟通历史"、"批量提取邮件内容"的请求。
  是 customer-analysis-editemail 和 dormant-customer-wakeup 的阶段一独立模块，也可单独调用。
  前提：浏览器已登录OKKI CRM。
compatibility: browser (required)
---

# 客户沟通记录抓取（邮件30 + WhatsApp 300）

**输入：** 客户名称或 company_id  
**输出：** `{客户名}_communications.json`

---

## 架构：同步XHR + 分次evaluate（最优解）

**为什么不用async/await + fetch：** `browser_console evaluate` 不保证等待 async Promise resolve，可能返回 `{}`。

**为什么用同步XHR：** 同步 `XMLHttpRequest` 阻塞直到响应返回，结果必定拿到（要么数据要么error）。

**为什么分次evaluate而不是一个脚本全抓完：** 同步XHR无法在脚本内部做延迟（同步阻塞会冻结页面）。通过拆成多次 evaluate 调用，每次只抓一批，批间由主进程的 `browser_wait` 实现延迟。

**⚠️ 反自动化铁律（不可更改）：**
- 邮件详情：分3批，每批10封，批间 `browser_wait 3-9秒`，条间在脚本内用同步延迟
- WhatsApp：分3页，每页100条，页间 `browser_wait 2-5秒`
- 单次 evaluate 脚本内的 API 请求数不超过10个
- 禁止一次性抓完全部（会触发风控）

---

## 步骤1：搜索客户（如果已有 company_id 跳过）

在CRM任意页面执行 `browser_console evaluate`：

```javascript
var xhr = new XMLHttpRequest();
xhr.open('POST', '/api/customerV3Read/companyList', false);
xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
xhr.send('keyword={客户名}&canReuse=0&high_light_flag=1&swarm_id=1&show_all=0&curPage=1&pageSize=5&show_field_key=company.private.list.field&sort_scene=search&layout_flag=1&user_num[0]=1&user_num[1]=2');
JSON.parse(xhr.responseText);
```

**API：** `POST /api/customerV3Read/companyList`，Content-Type: `application/x-www-form-urlencoded`

搜索关键词模糊匹配，如果精确搜不到，拆分关键词重试。

---

## 步骤2：导航到客户详情页

```
browser_navigate → https://crm.xiaoman.cn/crm/customer/personal?company_id={cid}
```

不需要 browser_wait，browser_navigate 本身已等待页面加载完成。

---

## 步骤3：抓取 trailList 列表元数据（1次evaluate）

在客户详情页执行 `browser_console evaluate`，按半年时间窗口分段抓取全部互动元数据并过滤：

```javascript
var cid = window.location.href.match(/company_id=(\d+)/)[1];

function syncGet(url) {
  var xhr = new XMLHttpRequest();
  xhr.open('GET', url, false);
  xhr.withCredentials = true;
  xhr.send();
  try { return JSON.parse(xhr.responseText); } catch(e) { return {error: xhr.status}; }
}

var now = new Date();
var periods = [];
for (var i = 0; i < 6; i++) {
  var end = new Date(now.getFullYear(), now.getMonth() - i * 6, 0, 23, 59, 59);
  var start = new Date(now.getFullYear(), now.getMonth() - (i + 1) * 6, 0, 23, 59, 59);
  start.setMonth(start.getMonth() + 1, 1);
  start.setHours(0, 0, 0, 0);
  periods.push({begin: start.toISOString().replace('T',' ').substring(0,19), end: end.toISOString().replace('T',' ').substring(0,19)});
}

var allItems = [];
for (var p = 0; p < periods.length && allItems.length < 50; p++) {
  var url = '/api/customerRead/trailList?company_id=' + cid + '&curPage=1&pageSize=50&stat_info=1&begin_time=' + encodeURIComponent(periods[p].begin) + '&end_time=' + encodeURIComponent(periods[p].end) + '&adjust_email_dynamic=0';
  var d = syncGet(url);
  var lst = (d.data && d.data.list) || d.data || [];
  allItems = allItems.concat(lst);
}

// 过滤噪音
function isReal(item) {
  if (item.module === 15) return true;
  if (item.module === 2) {
    var s = (item.subject || '').trim();
    if (/^Read:/i.test(s)) return false;
    if (/^Recall:/i.test(s)) return false;
    if (/auto.?repl|out.?of.?office|automatic|自动回复|不在办公室/i.test(s)) return false;
    return true;
  }
  return false;
}
var filtered = allItems.filter(isReal);

// WhatsApp去重（按user_contact_id）
var seenContacts = {};
var deduped = [];
for (var f = 0; f < filtered.length; f++) {
  var item = filtered[f];
  if (item.module === 15) {
    var cId = (item.data && item.data.user_contact_id) || item.refer_id || '';
    if (seenContacts[cId]) continue;
    seenContacts[cId] = true;
  }
  deduped.push(item);
}

// 分离邮件和WhatsApp，各取前30
var emails = deduped.filter(function(x){return x.module === 2}).slice(0, 30);
var whatsapps = deduped.filter(function(x){return x.module === 15}).slice(0, 30);

JSON.stringify({
  rawTotal: allItems.length,
  filteredTotal: filtered.length,
  dedupTotal: deduped.length,
  emailCount: emails.length,
  whatsappCount: whatsapps.length,
  emails: emails.map(function(x){return {date:x.gmtCreate, type:x.type, subject:x.subject||'', mailId:(x.data&&x.data.mail_id)||x.refer_id||''}}),
  whatsapps: whatsapps.map(function(x){return {date:x.gmtCreate, contactId:(x.data&&x.data.user_contact_id)||x.refer_id||''}})
});
```

记录返回的 `emails` 和 `whatsapps` 数组。后续步骤分别处理。

**如果 emailCount=0 且 whatsappCount=0：** 客户无实质沟通记录，直接返回，标记 skipped。

---

## 步骤4：邮件详情分批抓取（3批，每批10封）

将步骤3返回的 `emails` 数组分成3批（每批最多10封），分3次执行 `browser_console evaluate`。

**⚠️ 严格分批铁律：每批最多10封，批间 `browser_wait 3-9秒` 随机，不可一次性全抓。**

### 步骤4-1：第1批（emails[0..9]）

`browser_console evaluate`（将 BATCH_JSON 替换为前10条邮件的JSON数组）：

```javascript
var uid = document.cookie.match(/userId=(\d+)/)[1];

function syncGet(url) {
  var xhr = new XMLHttpRequest();
  xhr.open('GET', url, false);
  xhr.withCredentials = true;
  xhr.send();
  try { return JSON.parse(xhr.responseText); } catch(e) { return {error: xhr.status}; }
}

var batch = BATCH_JSON;
var results = [];
for (var i = 0; i < batch.length; i++) {
  var item = batch[i];
  try {
    var d = syncGet('/api/mailRead/info?mail_id=' + item.mailId + '&user_id=' + uid + '&skip_view_privilege=1');
    results.push({
      date: item.date,
      type: item.type === 201 ? '邮件发送' : (item.type === 202 ? '邮件收到' : '邮件'),
      channel: '邮件',
      subject: item.subject,
      body: (d.data && (d.data.content || d.data.body)) || ''
    });
  } catch(e) {
    results.push({date: item.date, type: '抓取失败', error: e.message, subject: item.subject});
  }
}
JSON.stringify({batchSize: batch.length, results: results});
```

→ 记录结果

### 批间等待

```
browser_wait 3-9秒（随机）
```

### 步骤4-2：第2批（emails[10..19]）

同上脚本，BATCH_JSON 替换为第11-20条邮件。

→ 记录结果

### 批间等待

```
browser_wait 3-9秒（随机）
```

### 步骤4-3：第3批（emails[20..29]）

同上脚本，BATCH_JSON 替换为第21-30条邮件。

→ 记录结果

**如果邮件总数不足10封：** 第1批就包含全部，不需要第2、3批。  
**如果邮件总数15封：** 第1批10封、第2批5封，不需要第3批。  
**如果邮件总数0封：** 跳过步骤4。

---

## 步骤5：WhatsApp详情分页抓取（3页，每页100条）

将步骤3返回的 `whatsapps` 数组中的每个联系人，分3次执行 `browser_console evaluate`，每次处理一部分联系人，每页100条消息。

**⚠️ 分页铁律：每次 evaluate 中每个联系人只抓1页100条，最多3页，页间 `browser_wait 2-5秒` 随机。**

### 步骤5-1：第1页（所有WhatsApp联系人，各取第1页100条）

`browser_console evaluate`（将 CONTACTS_JSON 替换为联系人数组）：

```javascript
function syncGet(url) {
  var xhr = new XMLHttpRequest();
  xhr.open('GET', url, false);
  xhr.withCredentials = true;
  xhr.send();
  try { return JSON.parse(xhr.responseText); } catch(e) { return {error: xhr.status}; }
}

var contacts = CONTACTS_JSON;
var results = [];
for (var i = 0; i < contacts.length; i++) {
  var c = contacts[i];
  try {
    var d = syncGet('/api/customerContactRead/messageList?user_contact_id=' + c.contactId + '&scene=drawer&curPage=1&pageSize=100');
    var msgs = (d.data && d.data.list) || d.data || [];
    var txt = '';
    for (var m = 0; m < msgs.length; m++) {
      var dir = msgs[m].send_type === 2 ? '客户' : '我方';
      var t = msgs[m].send_time || '';
      var body = '';
      if (typeof msgs[m].body === 'string') body = msgs[m].body;
      else if (typeof msgs[m].content === 'string') body = msgs[m].content;
      else if (msgs[m].body && typeof msgs[m].body === 'object') {
        body = '[图片: ' + (msgs[m].body.url || msgs[m].body.link || JSON.stringify(msgs[m].body).substring(0,100)) + ']' + (msgs[m].body.caption ? ' ' + msgs[m].body.caption : '');
      }
      txt += '[' + dir + ' ' + t + '] ' + body + '\n';
    }
    results.push({contactId: c.contactId, date: c.date, page: 1, msgCount: msgs.length, body: txt, hasMore: msgs.length === 100});
  } catch(e) {
    results.push({contactId: c.contactId, date: c.date, page: 1, error: e.message, hasMore: false});
  }
}
JSON.stringify({page: 1, results: results});
```

→ 记录结果，标记哪些 `hasMore=true`（需要翻页）

### 页间等待

```
browser_wait 2-5秒（随机）
```

### 步骤5-2：第2页（只抓第1页 hasMore=true 的联系人）

同上脚本，但 `curPage=2`，CONTACTS_JSON 只包含 `hasMore=true` 的联系人。

→ 记录结果

### 页间等待

```
browser_wait 2-5秒（随机）
```

### 步骤5-3：第3页（只抓第2页 hasMore=true 的联系人）

同上脚本，但 `curPage=3`，CONTACTS_JSON 只包含 `hasMore=true` 的联系人。

→ 记录结果

**如果第1页就抓完全部消息（hasMore=false）：** 不需要第2、3页。  
**如果 WhatsApp 联系人数为0：** 跳过步骤5。

---

## 步骤6：合并结果并保存

主进程合并步骤4和步骤5的所有结果：

```json
{
  "rawTotal": "步骤3的rawTotal",
  "filteredTotal": "步骤3的filteredTotal",
  "emailCount": "邮件正文数量",
  "whatsappCount": "WhatsApp联系人数量",
  "whatsappTotalMessages": "WhatsApp消息总条数",
  "failCount": "抓取失败数量",
  "results": ["所有邮件正文 + 所有WhatsApp消息"]
}
```

```
write → {客户名}_communications.json
```

返回摘要：邮件数量（发出/收到）、WhatsApp会话数及消息数、最新日期、联系人列表、失败数。

---

## 关键规则（全部已验证）

| 规则 | 说明 | 验证 |
|------|------|------|
| 同步XHR | `browser_console evaluate` 不等待async，必须同步 | ✅ |
| 分次evaluate | 同步XHR无法脚本内延迟，延迟由主进程browser_wait实现 | ✅ |
| 搜索API | `POST /api/customerV3Read/companyList`，form-urlencoded | ✅ |
| `stat_info=1` | trailList加此参数才能返回WhatsApp | ✅ |
| 按半年分段 | 穿透年份折叠，6个时间段 | ✅ |
| 噪音过滤 | 排除 Read:/Recall:/Auto Reply，module非2/15全排除 | ✅ |
| WhatsApp去重 | 同一 `user_contact_id` 只抓一次 | ✅ |
| WhatsApp翻页 | curPage=1,2,3，pageSize=100，最多300条 | ✅ |
| WhatsApp图片消息 | `body`是对象时提取 `url`+`caption` | ✅ |
| 邮件上限30条 | slice(0,30)，分3批每批10封 | ✅ |
| 邮件批间延迟 | `browser_wait 3-9秒`随机 | ✅ |
| WhatsApp页间延迟 | `browser_wait 2-5秒`随机 | ✅ |
| 字段名兼容 | `gmtCreate` 和 `created_at` 都可能存在，取值时兼容 | ⚠️ |

---

## 异常处理

| 情况 | 处理 |
|------|------|
| 搜索不到客户 | 拆分关键词重试。仍找不到→告知用户 |
| 同步XHR返回error状态 | 检查是否cookie过期，提示重新登录CRM |
| trailList返回空 | 尝试 `stat_info=0`（部分环境1和0行为相反） |
| WhatsApp messageList报错 | 尝试探测API路径（可能因版本不同） |
| 记录不足30条 | 有几条抓几条，如实说明 |
| `gmtCreate` 字段不存在 | 尝试 `created_at` 或 `sendTime` |
| 某批evaluate失败 | 已抓批次保存，重试该批或跳过，不丢已有数据 |
| filteredTotal=0 | 客户无实质沟通，标记skipped，不进入后续步骤 |

---

## ⚠️ 严格分批要求（不可更改）

本skill的反自动化策略是核心设计，以下规则不可更改：

1. **邮件详情必须分批：** 每批最多10封，至少3批，批间 `browser_wait 3-9秒` 随机
2. **WhatsApp必须分页：** 每页100条，最多3页，页间 `browser_wait 2-5秒` 随机
3. **单次evaluate请求数上限：** 10个API请求（邮件10封 或 WhatsApp 10个联系人各1页）
4. **禁止一次性全抓：** 不允许在一个evaluate中调用全部30封邮件+300条WhatsApp
5. **延迟由主进程控制：** 不在脚本内做延迟（同步XHR无法延迟），由 `browser_wait` 在两次evaluate之间实现
