(async () => {
  console.log('Script started');
  const uid = document.cookie.match(/userId=(\d+)/)?.[1];
  const cid = window.location.href.match(/company_id=(\d+)/)?.[1];
  console.log('UID:', uid, 'CID:', cid);
  if (!uid || !cid) return JSON.stringify({error: 'auth_failed', uid, cid});

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
      console.log('Fetching trailList for period:', p.begin, 'to', p.end, 'page:', page);
      const url = `/api/customerRead/trailList?company_id=${cid}&curPage=${page}&pageSize=50&stat_info=0&begin_time=${encodeURIComponent(p.begin)}&end_time=${encodeURIComponent(p.end)}&adjust_email_dynamic=0`;
      const r = await fetch(url, {credentials:'include'});
      const d = await r.json();
      const list = d.data?.list || d.data || [];
      console.log('Got', list.length, 'items');
      allItems = allItems.concat(list);
      await sleep(rand(500, 1200));
      if (list.length < 50 || allItems.length >= 50) break;
    }
    if (allItems.length < 50) await sleep(rand(800, 1500));
  }

  const isReal = (item) => {
    if (item.module === 15) return true;
    if (item.module === 2) {
      const s = (item.subject || '').trim();
      if (/^Read:/i.test(s)) return false;
      if (/^Recall:/i.test(s)) return false;
      if (/auto.?repl|out.?of.?office|automatic|自动回复|不在办公室/i.test(s)) return false;
      return true;
    }
    return false;
  };

  const filtered = allItems.filter(isReal).slice(0, 30);
  console.log('Filtered items:', filtered.length);

  const batchSize = 10;
  const allResults = [];

  for (let i = 0; i < filtered.length; i += batchSize) {
    const batch = filtered.slice(i, i + batchSize);
    console.log('Processing batch', (i / batchSize) + 1);

    for (const item of batch) {
      try {
        if (item.module === 2) {
          const mailId = item.data?.mail_id || item.refer_id || '';
          const r = await fetch(`/api/mailRead/info?mail_id=${mailId}&user_id=${uid}&skip_view_privilege=1`, {credentials:'include'});
          const d = await r.json();
          allResults.push({
            date: item.gmtCreate,
            type: item.type === 201 ? '邮件发送' : (item.type === 202 ? '邮件收到' : '邮件'),
            channel: '邮件',
            from: item.fromAddr || '',
            to: item.toAddr || '',
            subject: item.subject || '',
            body: d.data?.content || d.data?.body || '',
            mailId: mailId
          });
        } else if (item.module === 15) {
          const contactId = item.data?.user_contact_id || item.refer_id || '';
          const r = await fetch(`/api/customerContactRead/messageList?user_contact_id=${contactId}&scene=drawer&curPage=1&pageSize=50`, {credentials:'include'});
          const d = await r.json();
          const msgs = d.data?.list || d.data || [];
          const txt = msgs.map(m => {
            const dir = m.send_type === 2 ? '客户' : '我方';
            return `[${dir} ${m.send_time}] ${m.body || m.content || ''}`;
          }).join('\n');
          allResults.push({
            date: item.gmtCreate,
            type: 'WhatsApp',
            channel: 'WhatsApp',
            messageCount: msgs.length,
            body: txt,
            contactId: contactId
          });
        }
        await sleep(rand(500, 1500));
      } catch(e) {
        console.error('Error fetching item:', e);
        allResults.push({date: item.gmtCreate, type: '抓取失败', error: e.message, subject: item.subject || ''});
        await sleep(rand(800, 2000));
      }
    }

    if (i + batchSize < filtered.length) {
      await sleep(rand(3000, 5000));
    }
  }

  const finalResult = JSON.stringify({
    rawTotal: allItems.length,
    filteredTotal: filtered.length,
    fetchedTotal: allResults.length,
    emailCount: allResults.filter(r => r.channel === '邮件').length,
    whatsappCount: allResults.filter(r => r.channel === 'WhatsApp').length,
    failCount: allResults.filter(r => r.type === '抓取失败').length,
    results: allResults
  });
  console.log('Script finished');
  return finalResult;
})()