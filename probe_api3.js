(() => {
  function syncGet(url) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, false);
    xhr.withCredentials = true;
    xhr.send();
    try { return JSON.parse(xhr.responseText); } catch(e) { return {error: xhr.status, text: xhr.responseText.substring(0, 200)}; }
  }
  function syncPost(url, body) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', url, false);
    xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    xhr.withCredentials = true;
    xhr.send(body);
    try { return JSON.parse(xhr.responseText); } catch(e) { return {error: xhr.status, text: xhr.responseText.substring(0, 200)}; }
  }

  // 补取主API的 totalItem
  var body = 'keyword=&canReuse=0&high_light_flag=1&swarm_id=1&show_all=0&curPage=2&pageSize=100&show_field_key=company.private.list.field&sort_scene=search&layout_flag=1&user_num[0]=1&user_num[1]=2';
  var main = syncPost('/api/customerV3Read/companyList', body);
  var totalItem = main.data && main.data.totalItem;

  var apis = [
    '/api/customerRead/list?curPage=2&pageSize=100',
    '/api/customerRead/companyList?curPage=2&pageSize=100',
    '/api/customerV3Read/list?curPage=2&pageSize=100'
  ];

  var results = {};
  for (var i = 0; i < apis.length; i++) {
    try {
      var d = syncGet(apis[i]);
      if (d && d.code !== undefined && d.code !== 0 && d.code !== 200) {
        results[apis[i]] = { status: 'non-ok', code: d.code, msg: (d.msg || '').substring(0, 100) };
        continue;
      }
      var list = (d && d.data && d.data.list) || (d && d.data) || [];
      var first = list[0];
      results[apis[i]] = {
        status: 'ok',
        totalItem: (d.data && d.data.totalItem) || null,
        listLength: Array.isArray(list) ? list.length : 'n/a',
        firstKeys: first ? Object.keys(first).slice(0, 30) : [],
        firstPreview: first ? JSON.stringify(first).substring(0, 400) : null
      };
    } catch(e) {
      results[apis[i]] = {status: 'error', error: e.message};
    }
  }

  return JSON.stringify({
    mainApiTotalItem: totalItem,
    mainApiTopKeys: main ? Object.keys(main) : [],
    altApis: results
  }, null, 2);
})()
