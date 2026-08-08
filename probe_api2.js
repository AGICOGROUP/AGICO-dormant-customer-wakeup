(() => {
  function syncPost(url, body) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', url, false);
    xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    xhr.withCredentials = true;
    xhr.send(body);
    try { return JSON.parse(xhr.responseText); } catch(e) { return {error: xhr.status, text: xhr.responseText.substring(0, 300)}; }
  }
  var body = 'keyword=&canReuse=0&high_light_flag=1&swarm_id=1&show_all=0&curPage=2&pageSize=100&show_field_key=company.private.list.field&sort_scene=search&layout_flag=1&user_num[0]=1&user_num[1]=2';
  var d = syncPost('/api/customerV3Read/companyList', body);
  var list = (d.data && d.data.list) || d.data || [];

  // 1) 定位 totalCount：遍历 d 和 d.data 的所有键
  var dataKeys = d ? Object.keys(d) : [];
  var dataDataKeys = (d && d.data && typeof d.data === 'object') ? Object.keys(d.data) : [];

  // 2) 扫描所有100条里所有字段名中出现 time/follow/trail/contact 的字段及样本值
  var fieldSample = {};
  var timeFieldCandidates = [];
  list.forEach(function(it, idx) {
    Object.keys(it).forEach(function(k) {
      if (/time|follow|trail|contact|last/i.test(k)) {
        if (!fieldSample[k]) fieldSample[k] = {count: 0, sample: null};
        fieldSample[k].count++;
        if (!fieldSample[k].sample && idx < 5) {
          var v = it[k];
          fieldSample[k].sample = typeof v === 'string' ? v.substring(0, 150) : JSON.stringify(v).substring(0, 150);
        }
      }
    });
  });
  timeFieldCandidates = Object.keys(fieldSample).sort();

  // 3) 有多少条 last_trail 非空
  var lastTrailNonEmpty = list.filter(function(it){ return it.last_trail && it.last_trail !== '[]' && it.last_trail.length; }).length;
  var lastTrailSamples = list.filter(function(it){ return it.last_trail && it.last_trail !== '[]' && it.last_trail.length; }).slice(0, 2).map(function(it){
    return {name: it.name, last_trail: (typeof it.last_trail === 'string' ? it.last_trail : JSON.stringify(it.last_trail)).substring(0, 300)};
  });

  // 4) 总条数：取第一个有值的位置
  var totalCount = (d.data && d.data.totalCount) || d.total || (d.data && d.data.total) || (d.result && d.result.totalCount) || null;

  return JSON.stringify({
    topLevelKeys: dataKeys,
    dataKeys: dataDataKeys,
    totalCountRaw: totalCount,
    listLength: list.length,
    timeRelatedFields: timeFieldCandidates,
    timeFieldSample: fieldSample,
    lastTrailNonEmptyCount: lastTrailNonEmpty,
    lastTrailSamples: lastTrailSamples
  }, null, 2);
})()
