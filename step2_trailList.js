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
