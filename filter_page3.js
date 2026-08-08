(() => {
  function syncPost(url, body) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', url, false);
    xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    xhr.withCredentials = true;
    xhr.send(body);
    try { return JSON.parse(xhr.responseText); } catch(e) { return {error: xhr.status}; }
  }

  var body = 'keyword=&canReuse=0&high_light_flag=1&swarm_id=1&show_all=0&curPage=3&pageSize=100&show_field_key=company.private.list.field&sort_scene=search&layout_flag=1&user_num[0]=1&user_num[1]=2';
  var d = syncPost('/api/customerV3Read/companyList', body);
  var list = (d.data && d.data.list) || d.data || [];

  // 计算距今天数
  function daysSince(dateStr) {
    if (!dateStr) return null;
    var m = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    var d = new Date(parseInt(m[1]), parseInt(m[2])-1, parseInt(m[3]));
    return Math.floor((new Date() - d) / 86400000);
  }

  var qualified = [];
  var under180 = 0, noRevive = 0;

  list.forEach(function(item) {
    var name = item.name || '';
    var companyId = String(item.company_id || '');
    var orderTime = item.order_time || '';
    var days = daysSince(orderTime);

    // 提取标签
    var tags = [];
    if (item.cus_tag_info && Array.isArray(item.cus_tag_info)) {
      tags = item.cus_tag_info.map(function(t) { return t.info_label || ''; }).filter(function(t) { return t; });
    }
    var hasNoRevive = tags.some(function(t) { return t.indexOf('无需盘活') !== -1; });

    if (days === null || days <= 180) { under180++; return; }
    if (hasNoRevive) { noRevive++; return; }

    qualified.push({
      name: name,
      companyId: companyId,
      sleepDays: days,
      orderTime: orderTime,
      tags: tags
    });
  });

  return JSON.stringify({
    page: 3,
    totalItems: list.length,
    qualifiedCount: qualified.length,
    under180: under180,
    noRevive: noRevive,
    qualified: qualified
  });
})()
