(() => {
  const TODAY = new Date();
  const dateToDays = (dateStr) => {
    const m = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    const d = new Date(parseInt(m[1]), parseInt(m[2])-1, parseInt(m[3]));
    return Math.floor((TODAY - d) / 86400000);
  };

  const rows = document.querySelectorAll('div.row-item.row-item-level-1');
  const qualified = [];
  let under180 = 0, noRevive = 0, noName = 0;

  rows.forEach(row => {
    const link = row.querySelector('a[href*="company_id"]');
    if (!link) { noName++; return; }
    const name = link.textContent.trim();
    if (!name || name.length < 2) { noName++; return; }
    const href = link.getAttribute('href') || '';
    const cid = (href.match(/company_id=(\d+)/) || [])[1] || '';

    const tagSpans = row.querySelectorAll('.tag__overflow-item:not(.tag__overflow-item-rest) span');
    const tags = Array.from(tagSpans).map(s => s.textContent.trim());
    const hasNoRevive = tags.some(t => t.includes('无需盘活'));

    const timeCell = row.querySelector('div.cell[data-cci="6"] .cell-inner') || row.querySelector('div.cell[data-cci="6"]');
    const timeText = timeCell ? timeCell.textContent.trim() : '';
    let days = null;
    const daysMatch = timeText.match(/(\d+)天前/);
    if (daysMatch) {
      days = parseInt(daysMatch[1]);
    } else {
      const dateMatch = timeText.match(/(\d{4}-\d{2}-\d{2})/);
      if (dateMatch) days = dateToDays(dateMatch[1]);
    }

    if (days === null || days <= 180) { under180++; return; }
    if (hasNoRevive) { noRevive++; return; }

    qualified.push({ name, companyId: cid, sleepDays: days, tags, lastContactText: timeText });
  });

  const nextBtn = document.querySelector('li.okki-pagination-next');
  const hasNext = nextBtn && !nextBtn.classList.contains('okki-pagination-disabled');

  return JSON.stringify({
    pageRows: rows.length,
    qualifiedCount: qualified.length,
    qualified: qualified,
    under180: under180,
    noRevive: noRevive,
    noName: noName,
    hasNextPage: hasNext
  });
})()
