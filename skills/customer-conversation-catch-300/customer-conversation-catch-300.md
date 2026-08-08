---
name: customer-conversation-catch-300
description: |
  OKKI CRM客户历史沟通记录批量抓取。在浏览器内分批抓取：
  邮件最多30封（分3批，每批10封，批间3-9秒） + WhatsApp最多300条（每页100条，翻3页，页间2-5秒）。
  含防封反自动化节流、噪音过滤、WhatsApp去重、邮件去重、图片消息解析。
  触发：任何需要"抓取客户沟通记录"、"读取邮件"、"读取WhatsApp"、
  "抓取沟通历史"、"批量提取邮件内容"的请求。
  前提：浏览器已登录OKKI CRM。
compatibility: browser (required)
---

# 客户沟通记录抓取（邮件30 + WhatsApp 300）

**输入：** 客户名称或 company_id  
**输出：** `{客户名}_communications.json`

---

## ⛔ 执行铁律

1. **禁止用bash/node/python替代浏览器操作** — 所有脚本必须在 `browser_console evaluate` 中执行
2. **禁止跳过 browser_wait** — 批间3-9秒、页间2-5秒必须严格执行
3. **禁止跳过分批** — 邮件必须3批×10封，不得一次性抓完
4. **脚本报错时允许探测修复** — 但必须在返回结果中说明改了什么、为什么改
5. **脚本文件备份** — `scripts/` 目录下有外置脚本备份，SKILL.md内联脚本是权威版本

---

## 步骤1：搜索客户

如果已有 `company_id` 跳过此步。

```javascript
var xhr = new XMLHttpRequest();
xhr.open('POST', '/api/customerV3Read/companyList', false);
xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
xhr.send('keyword={客户名}&canReuse=0&high_light_flag=1&swarm_id=1&show_all=0&curPage=1&pageSize=5&show_field_key=company.private.list.field&sort_scene=search&layout_flag=1&user_num[0]=1&user_num[1]=2');
JSON.parse(xhr.responseText);
```

搜索关键词模糊匹配，拆分关键词重试。

---

## 步骤2：导航到客户详情页

```
browser_navigate → https://crm.xiaoman.cn/crm/customer/personal?company_id={cid}
browser_wait 3秒
```

---

## 步骤3：抓取trailList列表（同步XHR）

```javascript
var cid = '{cid}';
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
  var end, start;
  if (i === 0) {
    // Bug修复：i=0时end不能是"本月第0天"（=上月最后一天），否则本月记录全部漏掉
    // 第一个时间段的end改为now（当前时刻），覆盖本月所有记录
    end = now;
    start = new Date(now.getFullYear(), now.getMonth() - 6, 1, 0, 0, 0, 0);
  } else {
    end = new Date(now.getFullYear(), now.getMonth() - i * 6, 0, 23, 59, 59);
    start = new Date(now.getFullYear(), now.getMonth() - (i + 1) * 6, 0, 23, 59, 59);
    start.setMonth(start.getMonth() + 1, 1);
    start.setHours(0, 0, 0, 0);
  }
  // 用本地时间格式，不用toISOString（UTC格式被API忽略）
  periods.push({
    begin: start.getFullYear() + '-' + String(start.getMonth()+1).padStart(2,'0') + '-' + String(start.getDate()).padStart(2,'0') + ' 00:00:00',
    end: end.getFullYear() + '-' + String(end.getMonth()+1).padStart(2,'0') + '-' + String(end.getDate()).padStart(2,'0') + ' 23:59:59'
  });
}

var allItems = [];
for (var p = 0; p < periods.length && allItems.length < 50; p++) {
  // stat_info=0 才能让list按时间返回记录；stat_info=1时list始终返回最新6条（时间过滤只作用于统计）
  // 自动翻页：每个时间段最多翻4页（pageSize=50）
  for (var pg = 1; pg <= 4; pg++) {
    var url = '/api/customerRead/trailList?company_id=' + cid + '&curPage=' + pg + '&pageSize=50&stat_info=0&begin_time=' + encodeURIComponent(periods[p].begin) + '&end_time=' + encodeURIComponent(periods[p].end) + '&adjust_email_dynamic=0';
    var d = syncGet(url);
    var lst = (d.data && d.data.list) || d.data || [];
    if (lst.length === 0) break;
    allItems = allItems.concat(lst);
    if (lst.length < 50) break;
    if (allItems.length >= 50) break;
  }
}

function isReal(item) {
  if (item.module === 15) return true;
  if (item.module === 2) {
    // subject可能在顶层或data内，兼容两种路径
    var s = (item.subject || (item.data && item.data.subject) || '').trim();
    if (/^Read:/i.test(s)) return false;
    if (/^Recall:/i.test(s)) return false;
    if (/auto.?repl|out.?of.?office|automatic/i.test(s)) return false;
    return true;
  }
  return false;
}
var filtered = allItems.filter(isReal);

var seenContacts = {};
var seenMailIds = {};
var deduped = [];
for (var f = 0; f < filtered.length; f++) {
  var item = filtered[f];
  if (item.module === 15) {
    var cId = (item.data && item.data.user_contact_id) || item.refer_id || '';
    if (seenContacts[cId]) continue;
    seenContacts[cId] = true;
  } else if (item.module === 2) {
    // mail_id可能在data内，兼容refer_id和id
    var mid = (item.data && item.data.mail_id) || item.refer_id || item.id || '';
    if (seenMailIds[mid]) continue;
    seenMailIds[mid] = true;
  }
  deduped.push(item);
}

JSON.stringify({totalItems: deduped.length, items: deduped.slice(0, 30), cid: cid, periodsDebug: periods, rawCount: allItems.length});
```

保存返回的 `items` 数组。

---

## 步骤4：邮件详情分批抓取（3批×10封，批间3-9秒）

从 items 中筛出 `module === 2` 的邮件，按10封一批分组。

**第1批（第1-10封）：**

```javascript
var uid = document.cookie.match(/userId=(\d+)/)[1];
var items = {第1批的items，module=2的前10条};
function syncGet(url) {
  var xhr = new XMLHttpRequest();
  xhr.open('GET', url, false);
  xhr.withCredentials = true;
  xhr.send();
  try { return JSON.parse(xhr.responseText); } catch(e) { return {error: xhr.status}; }
}
var results = [];
for (var j = 0; j < items.length; j++) {
  try {
    var mid = (items[j].data && items[j].data.mail_id) || items[j].refer_id || '';
    var d = syncGet('/api/mailRead/info?mail_id=' + mid + '&user_id=' + uid + '&skip_view_privilege=1');
    // gmtCreate兼容created_at，subject兼容data.subject，type兼容data.type
    var date = items[j].gmtCreate || (items[j].data && items[j].data.created_at) || '';
    var subj = items[j].subject || (items[j].data && items[j].data.subject) || '';
    var tp = items[j].type || (items[j].data && items[j].data.type) || 0;
    results.push({date: date, type: tp === 201 ? '邮件发送' : (tp === 202 ? '邮件收到' : '邮件'), channel: '邮件', subject: subj, body: (d.data && (d.data.content || d.data.body)) || ''});
  } catch(e) {
    results.push({type: '抓取失败', error: e.message, subject: items[j].subject || (items[j].data && items[j].data.subject) || ''});
  }
}
JSON.stringify({batch: 1, count: results.length, results: results});
```

**执行后 `browser_wait 5秒`（3-9秒随机）。**

**第2批：** 同上脚本，items替换为第11-20条。执行后 `browser_wait 5秒`。

**第3批：** 同上脚本，items替换为第21-30条。最后一批不等待。

（邮件不足10封→1批完成。不足20封→2批完成。）

---

## 步骤5：WhatsApp分页抓取（3页×100条，页间2-5秒）

从 items 中筛出 `module === 15`，取 `user_contact_id`。

**第1页：**

```javascript
var contactId = '{user_contact_id}';
var pageNum = 1;
function syncGet(url) {
  var xhr = new XMLHttpRequest();
  xhr.open('GET', url, false);
  xhr.withCredentials = true;
  xhr.send();
  try { return JSON.parse(xhr.responseText); } catch(e) { return {error: xhr.status}; }
}
var d = syncGet('/api/customerContactRead/messageList?user_contact_id=' + contactId + '&scene=drawer&curPage=' + pageNum + '&pageSize=100');
var msgs = (d.data && d.data.list) || d.data || [];
var parsed = msgs.map(function(m) {
  var dir = m.send_type === 2 ? '客户' : '我方';
  var t = m.send_time || '';
  var body = '';
  if (typeof m.body === 'string') body = m.body;
  else if (typeof m.content === 'string') body = m.content;
  else if (m.body && typeof m.body === 'object') {
    body = '[图片: ' + (m.body.url || m.body.link || JSON.stringify(m.body).substring(0,100)) + ']' + (m.body.caption ? ' ' + m.body.caption : '');
  }
  return '[' + dir + ' ' + t + '] ' + body;
});
JSON.stringify({page: pageNum, count: msgs.length, hasMore: msgs.length === 100, msgs: parsed, contactId: contactId});
```

**如果 count=100 且 hasMore=true → `browser_wait 3秒`（2-5秒随机）→ 执行第2页（pageNum=2）。**

**第2页：** 同上，pageNum=2。如果满100 → 等待 → 第3页。

**第3页：** 同上，pageNum=3。达到300条上限停止。

**如果任一页 count<100，消息已抓完，不需要继续翻页。**

---

## 步骤6：合并保存

```
write → {客户名}_communications.json
```

返回摘要：邮件数量、WhatsApp会话数及消息数、最新日期、联系人。

---

## 防封节流参数（严格遵守）

| 类型 | 分批方式 | 批间延迟 |
|------|----------|----------|
| 邮件详情 | 3批×10封 | 3-9秒随机 |
| WhatsApp | 3页×100条 | 2-5秒随机 |
| trailList | 6个时间段 | 无 |

---

## 关键规则（全部已验证）

| 规则 | 说明 |
|------|------|
| 同步XHR | browser_console不等待async，必须同步 |
| 搜索API | POST /api/customerV3Read/companyList，form-urlencoded |
| **stat_info=0** | trailList用stat_info=0才能让list按时间返回记录；stat_info=1时list始终返回最新6条 |
| **本地时间格式** | begin_time/end_time用本地时间（YYYY-MM-DD HH:mm:ss），不用toISOString（UTC格式被API忽略） |
| **自动翻页** | 每个时间段内curPage=1..4，pageSize=50，不足50条停止翻页 |
| 按半年分段 | 穿透年份折叠，6个时间段 |
| 噪音过滤 | 排除Read:/Recall:/Auto Reply，module非2/15全排除 |
| WhatsApp去重 | 同一user_contact_id只抓一次 |
| 邮件去重 | 同一mail_id只保留一条 |
| WhatsApp翻页 | curPage=1,2,3，pageSize=100，最多300条 |
| WhatsApp图片消息 | body是对象时提取url+caption |
| 邮件上限30条 | slice(0,30) |
| 字段路径兼容 | subject/gmtCreate/type可能在item顶层也可能在item.data内，取值时兼容 |

---

## 异常处理

| 情况 | 处理 |
|------|------|
| 搜索不到客户 | 拆分关键词重试 |
| cookie过期 | 提示重新登录CRM |
| trailList返回空 | 尝试stat_info=0 |
| 脚本报错 | 允许探测修复，但必须告知改了什么 |
| 记录不足30条 | 有多少抓多少 |
| browser_wait被跳过 | 必须严格执行，不可省略 |
