(async () => {
  const uid = document.cookie.match(/userId=(\d+)/)?.[1];
  const cid = window.location.href.match(/company_id=(\d+)/)?.[1];
  if (!uid || !cid) return {error: 'auth_failed', uid, cid};

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  const now = new Date();
  const periods = [];
  for (let i = 0; i < 6; i++) {
    const end = new Date(now.getFullYear(), now.getMonth() - i * 6 + 1, 0, 23, 59, 59);
    const start = new Date(now.getFullYear(), now.getMonth() - (i + 1) * 6 + 1, 0, 23, 59, 59);
    start.setMonth(start.getMonth() + 1, 1);
    start.setHours(0, 0, 0, 0);
    periods.push({
      begin: start.toISOString().replace('T', ' ').substring(0, 19),
      end: end.toISOString().replace('T', ' ').substring(0, 19)
    });
  }

  let allItems = [];
  for (const p of periods) {
    if (allItems.length >= 30) break;
    for (let page = 1; page <= 2; page++) {
      const url = `/api/customerRead/trailList?company_id=${cid}&curPage=${page}&pageSize=50&stat_info=0&begin_time=${encodeURIComponent(p.begin)}&end_time=${encodeURIComponent(p.end)}&adjust_email_dynamic=0`;
      const r = await fetch(url, {credentials:'include'});
      const d = await r.json();
      const list = d.data?.list || d.data || [];
      allItems = allItems.concat(list);
      await sleep(rand(500, 1200));
      if (list.length < 50 || allItems.length >= 30) break;
    }
    if (allItems.length < 30) await sleep(rand(800, 1500));
  }

  const isRealCommunication = (item) => {
    if (item.module === 15) return true;
    if (item.module === 2) {
      const subject = (item.subject || '').trim();
      if (/^Read:/i.test(subject)) return false;
      if (/^Recall:/i.test(subject)) return false;
      if (/auto.?repl|out.?of.?office|automatic|自动回复|不在办公室/i.test(subject)) return false;
      return true;
    }
    return false;
  };

  const filtered = allItems.filter(isRealCommunication).slice(0, 30);

  return {
    rawTotal: allItems.length,
    filteredTotal: filtered.length,
    removedCount: allItems.length - filtered.length,
    items: filtered.map(item => ({
      date: item.gmtCreate,
      module: item.module,
      type: item.type,
      subject: item.subject || '',
      from: item.fromAddr || '',
      to: item.toAddr || '',
      mailId: item.data?.mail_id || item.refer_id || '',
      contactId: item.data?.user_contact_id || item.refer_id || '',
      summary: (item.summary || '').substring(0, 200)
    }))
  };
})()