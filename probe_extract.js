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
  var list = (d.data && d.data.list) || [];

  // 1) 检查 field_list 里有没有"联系/跟进/最近"相关字段
  var fieldList = d.data && d.data.field_list;
  var fieldNames = [];
  try {
    var fl = fieldList;
    function walk(v, path) {
      if (!v) return;
      if (Array.isArray(v)) { v.forEach(function(x){ walk(x, path); }); return; }
      if (typeof v === 'object') {
        var name = v.field_name || v.field_key || v.key || v.name || '';
        if (typeof name === 'string' && /time|contact|follow|trail|last/i.test(name)) {
          fieldNames.push({path: path, name: name, label: v.field_label || v.label || v.title || ''});
        }
        Object.keys(v).forEach(function(k){ walk(v[k], path + '.' + k); });
      }
    }
    walk(fl, 'field_list');
  } catch(e) { fieldNames = [{error: e.message}]; }

  // 2) 提取100条：公司名 + 标签 + 时间字段
  var rows = list.map(function(it) {
    var tags = [];
    try {
      var tagArr = typeof it.cus_tag_info === 'string' ? JSON.parse(it.cus_tag_info) : it.cus_tag_info;
      if (Array.isArray(tagArr)) tags = tagArr.map(function(t){ return t.info_label; });
    } catch(e) {}
    return {
      name: it.name,
      serial_id: it.serial_id,
      tags: tags.join('、'),
      last_trail_id: it.last_trail_id,
      customer_contact_count: it.customer_contact_count,
      order_time: it.order_time,
      trail_status_name: it.trail_status_name,
      last_owner: it.last_owner
    };
  });

  // 3) 统计
  var tagCount = rows.filter(function(r){ return r.tags; }).length;
  var orderTimeCount = rows.filter(function(r){ return r.order_time; }).length;
  var contactCount = rows.filter(function(r){ return r.customer_contact_count > 0; }).length;

  return JSON.stringify({
    totalItem: d.data.totalItem,
    listLength: rows.length,
    fieldListTimeLikeFields: fieldNames,
    rows: rows,
    stats: {withTags: tagCount, withOrderTime: orderTimeCount, withContactCount: contactCount}
  });
})()
