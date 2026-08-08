(() => {
  function syncPost(url, body) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', url, false);
    xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    xhr.withCredentials = true;
    xhr.send(body);
    try { return JSON.parse(xhr.responseText); } catch(e) { return {error: xhr.status, text: xhr.responseText.substring(0, 500)}; }
  }

  // 尝试已知的搜索API，不传keyword获取全部
  var body = 'keyword=&canReuse=0&high_light_flag=1&swarm_id=1&show_all=0&curPage=2&pageSize=100&show_field_key=company.private.list.field&sort_scene=search&layout_flag=1&user_num[0]=1&user_num[1]=2';
  var d = syncPost('/api/customerV3Read/companyList', body);

  // 分析返回结构
  var list = (d.data && d.data.list) || d.data || [];
  var first = list[0];

  // 提取第一条的所有字段名
  var keys = first ? Object.keys(first) : [];

  // 提取第一条的完整内容预览
  var firstPreview = {};
  if (first) {
    keys.forEach(function(k) {
      var v = first[k];
      if (typeof v === 'string') {
        firstPreview[k] = v.substring(0, 200);
      } else if (typeof v === 'object' && v !== null) {
        firstPreview[k] = JSON.stringify(v).substring(0, 200);
      } else {
        firstPreview[k] = v;
      }
    });
  }

  return JSON.stringify({
    apiPath: '/api/customerV3Read/companyList',
    totalCount: (d.data && d.data.totalCount) || d.total || 'unknown',
    listLength: list.length,
    firstItemKeys: keys,
    firstItemPreview: firstPreview
  }, null, 2);
})()
