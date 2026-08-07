(async () => {
  const cid = window.location.href.match(/company_id=(\d+)/)?.[1];
  const url = `/api/customerRead/trailList?company_id=${cid}&curPage=1&pageSize=50&stat_info=0&adjust_email_dynamic=0`;
  try {
    const r = await fetch(url, {credentials:'include'});
    const d = await r.json();
    return d;
  } catch (e) {
    return { error: e.message };
  }
})()