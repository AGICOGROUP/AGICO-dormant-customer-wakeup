var uid = document.cookie.match(/userId=(\d+)/)[1];

function syncGet(url) {
  var xhr = new XMLHttpRequest();
  xhr.open('GET', url, false);
  xhr.withCredentials = true;
  xhr.send();
  try { return JSON.parse(xhr.responseText); } catch(e) { return {error: xhr.status}; }
}

var batch = [
  {date: '', type: 201, subject: '', mailId: '72587278526334'},
  {date: '', type: 201, subject: '', mailId: '71960383566641'},
  {date: '', type: 202, subject: '', mailId: '71891620224107'},
  {date: '', type: 201, subject: '', mailId: '71675851620950'}
];
var results = [];
for (var i = 0; i < batch.length; i++) {
  var item = batch[i];
  try {
    var d = syncGet('/api/mailRead/info?mail_id=' + item.mailId + '&user_id=' + uid + '&skip_view_privilege=1');
    results.push({date: item.date, type: item.type === 201 ? '邮件发送' : (item.type === 202 ? '邮件收到' : '邮件'), channel: '邮件', subject: item.subject, body: (d.data && (d.data.content || d.data.body)) || ''});
  } catch(e) {
    results.push({date: item.date, type: '抓取失败', error: e.message, subject: item.subject});
  }
}
JSON.stringify({batchSize: batch.length, results: results});
