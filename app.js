const GH_OWNER = 'DacPhong2003';
const DATA_REPO = 'MoneyApp';
const BRANCH = 'main';
const VAPID_PUBLIC_KEY = 'BAgPDNc7vCbUcO5yebFZGvyO6d6UKIp4gHpCtjmte1PsvY19aJXHjQ0iC6HCNy_wDK5lA7GPscU9xJ6VC-iPxY4';

const CATEGORY_ICONS = {
  'Ăn uống': '🍜', 'Di chuyển': '🚗', 'Mua sắm': '🛍️', 'Hoá đơn & Tiện ích': '💡',
  'Giải trí': '🎬', 'Sức khoẻ': '💊', 'Giáo dục': '📚', 'Chuyển khoản cá nhân': '🔄',
  'Thu nhập': '💰', 'Khác': '📦'
};
const CHART_COLORS = ['#6dd5a4', '#5b8cff', '#ffb454', '#ff6b6b', '#c792ea', '#4fd1c5', '#f6ad55', '#68d391', '#a0aec0', '#fc8181'];

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

let _savedScrollY = 0;
function lockBodyScroll() {
  _savedScrollY = window.scrollY || window.pageYOffset || 0;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${_savedScrollY}px`;
  document.body.style.width = '100%';
}
function unlockBodyScroll() {
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.width = '';
  window.scrollTo(0, _savedScrollY);
}
function openModal(el) { lockBodyScroll(); el.style.display = 'flex'; }
function closeModal(el) { el.style.display = 'none'; unlockBodyScroll(); }

function b64EncodeUnicode(str) {
  return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (m, p1) => String.fromCharCode('0x' + p1)));
}
function b64DecodeUnicode(str) {
  return decodeURIComponent(atob(str).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
}
function getToken() { return localStorage.getItem('gh_token') || ''; }
function setToken(t) { localStorage.setItem('gh_token', t); }
function iconFor(cat) { return CATEGORY_ICONS[cat] || '📦'; }

async function ghGetFile(path) {
  const res = await fetch(`https://api.github.com/repos/${GH_OWNER}/${DATA_REPO}/contents/${path}?ref=${BRANCH}`, {
    headers: { Authorization: `token ${getToken()}`, Accept: 'application/vnd.github+json' }
  });
  if (!res.ok) throw new Error(`GET ${path} that bai: ${res.status}`);
  const json = await res.json();
  const content = b64DecodeUnicode(json.content.replace(/\n/g, ''));
  return { data: JSON.parse(content), sha: json.sha };
}
async function ghPutFile(path, dataObj, sha, message) {
  const body = { message, content: b64EncodeUnicode(JSON.stringify(dataObj, null, 2)), branch: BRANCH };
  if (sha) body.sha = sha;
  const res = await fetch(`https://api.github.com/repos/${GH_OWNER}/${DATA_REPO}/contents/${path}`, {
    method: 'PUT',
    headers: { Authorization: `token ${getToken()}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 409) { const e = new Error('conflict'); e.isConflict = true; throw e; }
  if (!res.ok) { const t = await res.text(); throw new Error(`PUT ${path} that bai: ${res.status} ${t}`); }
  return res.json();
}

// Doc file moi nhat, ap dung mutateFn(data) -> data moi, roi ghi len GitHub.
// Neu bi 409 (file da bi doi boi tien trinh khac, vd bot quet Gmail chay ngam)
// thi tu dong doc lai ban moi nhat va thu lai, toi da maxRetries lan.
async function ghUpdateJson(path, mutateFn, message, maxRetries = 8) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      // Doi tang dan (exponential, toi da 4s) truoc khi thu lai. Bot
      // notify.yml co the mat 20-60s de khoi dong runner + commit lai
      // sau khi minh vua ghi, nen can cua so thu lai du dai (toi da
      // ~20s cho toan bo maxRetries=8 lan) thay vi chi vai giay.
      const delay = Math.min(4000, 300 * Math.pow(2, attempt - 1));
      await new Promise((r) => setTimeout(r, delay));
    }
    const fresh = await ghGetFile(path).catch(() => ({ data: null, sha: null }));
    const newData = mutateFn(fresh.data);
    try {
      await ghPutFile(path, newData, fresh.sha, message);
      return newData;
    } catch (e) {
      if (e.isConflict && attempt < maxRetries) continue;
      throw e;
    }
  }
}

function fmtMoney(n) { return Number(n || 0).toLocaleString('vi-VN') + 'đ'; }
function parseTxDate(iso) {
  if (/^\d{2}-\d{2}-\d{4}/.test(iso)) {
    const [dPart, tPart] = iso.split(' ');
    const [d, m, y] = dPart.split('-');
    return new Date(`${y}-${m}-${d}T${tPart || '00:00:00'}`);
  }
  return new Date(iso);
}
function monthKeyFromDate(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function isThu(t) { return t.chieu === 'thu'; }
function isChi(t) { return !isThu(t); }
function toDateInputValue(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function txInRange(t, startStr, endStr) {
  const d = parseTxDate(t.thoi_gian_giao_dich);
  if (isNaN(d.getTime())) return false;
  if (startStr) { const start = new Date(startStr + 'T00:00:00'); if (d < start) return false; }
  if (endStr) { const end = new Date(endStr + 'T23:59:59'); if (d > end) return false; }
  return true;
}
function updateTxModeUI() {
  const isCustom = STATE.txViewMode === 'custom';
  $('#tx-month-nav').style.display = isCustom ? 'none' : 'flex';
  $('#tx-date-range-bar').style.display = isCustom ? 'flex' : 'none';
}
function monthLabel(d) { return `Tháng ${d.getMonth() + 1}/${d.getFullYear()}`; }
function monthLabelFromKey(monthKey) { const [y, m] = monthKey.split('-').map(Number); return `Tháng ${m}/${y}`; }
function getBudgetForMonth(monthKey) {
  const perMonth = (STATE.budgets.by_month || {})[monthKey];
  const overall = (perMonth && perMonth.overall !== undefined && perMonth.overall !== null) ? perMonth.overall : STATE.budgets.overall_monthly;
  const byCategory = { ...(STATE.budgets.by_category || {}), ...((perMonth && perMonth.by_category) || {}) };
  return { overall, by_category: byCategory };
}
function getCategoryBudget(cat, monthKey) {
  return getBudgetForMonth(monthKey).by_category[cat];
}
function fmtTxTime(raw) {
  const d = parseTxDate(raw);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function fmtDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

let STATE = {
  transactions: [], categories: [], budgets: { overall_monthly: null, by_category: {} },
  subscriptions: [], wallets: [], txCustomStart: null, txCustomEnd: null,
  ovViewMode: 'month', ovPeriodDate: new Date(), ovCustomStart: null, ovCustomEnd: null,
  catViewMode: 'month', catPeriodDate: new Date(), catCustomStart: null, catCustomEnd: null,
  filterCategory: '', sort: 'date_desc',
  txViewMode: 'month', txPeriodDate: new Date(),
  categoryChart: null, trendChart: null
};

function getWeekRange(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay(); // 0 = CN, 1 = T2 ... 6 = T7
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const start = new Date(d);
  start.setDate(d.getDate() + diffToMonday);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}
function fmtShortDate(d) { return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`; }
function weekLabel(date) {
  const { start, end } = getWeekRange(date);
  return `Tuần ${fmtShortDate(start)} - ${fmtShortDate(end)}`;
}
function txInWeek(t, refDate) {
  const { start, end } = getWeekRange(refDate);
  const d = parseTxDate(t.thoi_gian_giao_dich);
  return d >= start && d <= end;
}

async function loadAll() {
  const [tx, cats, budgets, subs, wallets] = await Promise.all([
    ghGetFile('data/transactions.json'),
    ghGetFile('data/categories.json'),
    ghGetFile('data/budgets.json').catch(() => ({ data: { overall_monthly: null, by_category: {} }, sha: null })),
    ghGetFile('data/subscriptions.json').catch(() => ({ data: [], sha: null })),
    ghGetFile('data/wallets.json').catch(() => ({ data: [], sha: null }))
  ]);
  STATE.transactions = tx.data;
  STATE.categories = cats.data;
  STATE.budgets = budgets.data;
  STATE.subscriptions = subs.data;
  STATE.wallets = wallets.data;

  const filterSel = $('#filter-category');
  filterSel.innerHTML = '<option value="">Tất cả danh mục</option>';
  STATE.categories.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c; opt.textContent = c;
    filterSel.appendChild(opt);
  });
}

function txInMonth(t, monthKey) { return monthKeyFromDate(parseTxDate(t.thoi_gian_giao_dich)) === monthKey; }
function getOverviewTx() {
  if (STATE.ovViewMode === 'week') {
    return STATE.transactions.filter(t => txInWeek(t, STATE.ovPeriodDate));
  } else if (STATE.ovViewMode === 'custom') {
    return STATE.transactions.filter(t => txInRange(t, STATE.ovCustomStart, STATE.ovCustomEnd));
  }
  return STATE.transactions.filter(t => txInMonth(t, monthKeyFromDate(STATE.ovPeriodDate)));
}
function updateOvModeUI() {
  const isCustom = STATE.ovViewMode === 'custom';
  $('#ov-month-nav').style.display = isCustom ? 'none' : 'flex';
  $('#ov-date-range-bar').style.display = isCustom ? 'flex' : 'none';
}
function getCategoryPageTx() {
  if (STATE.catViewMode === 'week') {
    return STATE.transactions.filter(t => txInWeek(t, STATE.catPeriodDate));
  } else if (STATE.catViewMode === 'custom') {
    return STATE.transactions.filter(t => txInRange(t, STATE.catCustomStart, STATE.catCustomEnd));
  }
  return STATE.transactions.filter(t => txInMonth(t, monthKeyFromDate(STATE.catPeriodDate)));
}
function updateCatModeUI() {
  const isCustom = STATE.catViewMode === 'custom';
  $('#cat-month-nav').style.display = isCustom ? 'none' : 'flex';
  $('#cat-date-range-bar').style.display = isCustom ? 'flex' : 'none';
}
function catRelevantMonthKey() {
  if (STATE.catViewMode === 'month') return monthKeyFromDate(STATE.catPeriodDate);
  return monthKeyFromDate(new Date());
}

// ---------- TAB NAVIGATION ----------
function switchTab(pageId) {
  $$('.page').forEach(p => p.classList.toggle('active', p.id === pageId));
  $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.page === pageId));
}
$$('.tab-btn').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.page)));

// ---------- OVERVIEW: dieu huong theo thang / tuan / khoang ngay ----------
function updateOverviewLabel() {
  if (STATE.ovViewMode === 'custom') return;
  $('#ov-month-label').textContent = STATE.ovViewMode === 'week' ? weekLabel(STATE.ovPeriodDate) : monthLabel(STATE.ovPeriodDate);
}
$('#ov-prev-btn').addEventListener('click', () => {
  if (STATE.ovViewMode === 'week') {
    STATE.ovPeriodDate = new Date(STATE.ovPeriodDate.getFullYear(), STATE.ovPeriodDate.getMonth(), STATE.ovPeriodDate.getDate() - 7);
  } else {
    STATE.ovPeriodDate = new Date(STATE.ovPeriodDate.getFullYear(), STATE.ovPeriodDate.getMonth() - 1, 1);
  }
  renderOverview();
});
$('#ov-next-btn').addEventListener('click', () => {
  if (STATE.ovViewMode === 'week') {
    STATE.ovPeriodDate = new Date(STATE.ovPeriodDate.getFullYear(), STATE.ovPeriodDate.getMonth(), STATE.ovPeriodDate.getDate() + 7);
  } else {
    STATE.ovPeriodDate = new Date(STATE.ovPeriodDate.getFullYear(), STATE.ovPeriodDate.getMonth() + 1, 1);
  }
  renderOverview();
});
$$('#page-overview .view-toggle-btn').forEach(btn => btn.addEventListener('click', () => {
  STATE.ovViewMode = btn.dataset.mode;
  $$('#page-overview .view-toggle-btn').forEach(b => b.classList.toggle('active', b === btn));
  updateOvModeUI();
  if (STATE.ovViewMode === 'custom' && !STATE.ovCustomStart && !STATE.ovCustomEnd) {
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    STATE.ovCustomStart = toDateInputValue(firstOfMonth);
    STATE.ovCustomEnd = toDateInputValue(now);
    $('#ov-date-start').value = STATE.ovCustomStart;
    $('#ov-date-end').value = STATE.ovCustomEnd;
  }
  renderOverview();
}));
$('#ov-date-start').addEventListener('change', (e) => {
  STATE.ovCustomStart = e.target.value;
  renderOverview();
});
$('#ov-date-end').addEventListener('change', (e) => {
  STATE.ovCustomEnd = e.target.value;
  renderOverview();
});
function renderOverview() {
  updateOverviewLabel();
  const isMonth = STATE.ovViewMode === 'month';
  $('#subs-summary-section').style.display = isMonth && STATE.subscriptions.length > 0 ? 'block' : 'none';
  $('#ov-budget-card').style.display = isMonth ? 'block' : 'none';
  const tx = getOverviewTx();
  safeRender('summary', () => renderSummary(tx));
  if (isMonth) safeRender('subs-summary', () => renderSubsSummary(monthKeyFromDate(STATE.ovPeriodDate)));
  safeRender('category-chart', () => renderCategoryChart(tx));
  safeRender('trend-chart', () => renderTrendChart());
}

// ---------- GIAO DICH: dieu huong theo thang HOAC theo tuan ----------
function updateTxPeriodLabel() {
  if (STATE.txViewMode === 'custom') return;
  $('#tx-period-label').textContent = STATE.txViewMode === 'week' ? weekLabel(STATE.txPeriodDate) : monthLabel(STATE.txPeriodDate);
}
$('#tx-prev-btn').addEventListener('click', () => {
  if (STATE.txViewMode === 'week') {
    STATE.txPeriodDate = new Date(STATE.txPeriodDate.getFullYear(), STATE.txPeriodDate.getMonth(), STATE.txPeriodDate.getDate() - 7);
  } else {
    STATE.txPeriodDate = new Date(STATE.txPeriodDate.getFullYear(), STATE.txPeriodDate.getMonth() - 1, 1);
  }
  updateTxPeriodLabel();
  safeRender('tx-list', () => renderTxList());
});
$('#tx-next-btn').addEventListener('click', () => {
  if (STATE.txViewMode === 'week') {
    STATE.txPeriodDate = new Date(STATE.txPeriodDate.getFullYear(), STATE.txPeriodDate.getMonth(), STATE.txPeriodDate.getDate() + 7);
  } else {
    STATE.txPeriodDate = new Date(STATE.txPeriodDate.getFullYear(), STATE.txPeriodDate.getMonth() + 1, 1);
  }
  updateTxPeriodLabel();
  safeRender('tx-list', () => renderTxList());
});
$$('#page-transactions .view-toggle-btn').forEach(btn => btn.addEventListener('click', () => {
  STATE.txViewMode = btn.dataset.mode;
  $$('#page-transactions .view-toggle-btn').forEach(b => b.classList.toggle('active', b === btn));
  updateTxModeUI();
  if (STATE.txViewMode === 'custom' && !STATE.txCustomStart && !STATE.txCustomEnd) {
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    STATE.txCustomStart = toDateInputValue(firstOfMonth);
    STATE.txCustomEnd = toDateInputValue(now);
    $('#tx-date-start').value = STATE.txCustomStart;
    $('#tx-date-end').value = STATE.txCustomEnd;
  }
  updateTxPeriodLabel();
  safeRender('tx-list', () => renderTxList());
}));
$('#tx-date-start').addEventListener('change', (e) => {
  STATE.txCustomStart = e.target.value;
  safeRender('tx-list', () => renderTxList());
});
$('#tx-date-end').addEventListener('change', (e) => {
  STATE.txCustomEnd = e.target.value;
  safeRender('tx-list', () => renderTxList());
});

// ---------- PHAN LOAI: dieu huong theo thang / tuan / khoang ngay ----------
function updateCatPeriodLabel() {
  if (STATE.catViewMode === 'custom') return;
  $('#cat-period-label').textContent = STATE.catViewMode === 'week' ? weekLabel(STATE.catPeriodDate) : monthLabel(STATE.catPeriodDate);
}
$('#cat-prev-btn').addEventListener('click', () => {
  if (STATE.catViewMode === 'week') {
    STATE.catPeriodDate = new Date(STATE.catPeriodDate.getFullYear(), STATE.catPeriodDate.getMonth(), STATE.catPeriodDate.getDate() - 7);
  } else {
    STATE.catPeriodDate = new Date(STATE.catPeriodDate.getFullYear(), STATE.catPeriodDate.getMonth() - 1, 1);
  }
  updateCatPeriodLabel();
  safeRender('category-list-page', () => renderCategoryListPage());
});
$('#cat-next-btn').addEventListener('click', () => {
  if (STATE.catViewMode === 'week') {
    STATE.catPeriodDate = new Date(STATE.catPeriodDate.getFullYear(), STATE.catPeriodDate.getMonth(), STATE.catPeriodDate.getDate() + 7);
  } else {
    STATE.catPeriodDate = new Date(STATE.catPeriodDate.getFullYear(), STATE.catPeriodDate.getMonth() + 1, 1);
  }
  updateCatPeriodLabel();
  safeRender('category-list-page', () => renderCategoryListPage());
});
$$('#page-categories .view-toggle-btn').forEach(btn => btn.addEventListener('click', () => {
  STATE.catViewMode = btn.dataset.mode;
  $$('#page-categories .view-toggle-btn').forEach(b => b.classList.toggle('active', b === btn));
  updateCatModeUI();
  if (STATE.catViewMode === 'custom' && !STATE.catCustomStart && !STATE.catCustomEnd) {
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    STATE.catCustomStart = toDateInputValue(firstOfMonth);
    STATE.catCustomEnd = toDateInputValue(now);
    $('#cat-date-start').value = STATE.catCustomStart;
    $('#cat-date-end').value = STATE.catCustomEnd;
  }
  updateCatPeriodLabel();
  safeRender('category-list-page', () => renderCategoryListPage());
}));
$('#cat-date-start').addEventListener('change', (e) => {
  STATE.catCustomStart = e.target.value;
  safeRender('category-list-page', () => renderCategoryListPage());
});
$('#cat-date-end').addEventListener('change', (e) => {
  STATE.catCustomEnd = e.target.value;
  safeRender('category-list-page', () => renderCategoryListPage());
});

// ---------- RENDER ----------
function safeRender(name, fn) {
  try { fn(); } catch (e) { console.error(`Loi render ${name}:`, e); }
}

function renderAll() {
  const unlabeled = STATE.transactions.filter(t => !t.labeled);
  const banner = $('#unlabeled-banner');
  if (unlabeled.length > 0) {
    banner.style.display = 'flex';
    banner.textContent = `⚠️ ${unlabeled.length} giao dịch chưa gắn nhãn — bấm để xử lý`;
    banner.onclick = () => openLabelModal(unlabeled[0]);
  } else {
    banner.style.display = 'none';
  }

  safeRender('overview', () => renderOverview());
  updateTxPeriodLabel();
  safeRender('tx-list', () => renderTxList());
  updateCatPeriodLabel();
  safeRender('category-list-page', () => renderCategoryListPage());
}

function isWalletPaid(walletId, monthKey) {
  return STATE.transactions.some(t => t.wallet_id === walletId && t.wallet_month === monthKey);
}

function renderWalletsSection(monthKey) {
  const section = $('#cat-wallets-section');
  const card = $('#cat-wallets-card');
  const wallets = (STATE.wallets || []).filter(w => w.month === monthKey);
  if (wallets.length === 0) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  let total = 0;
  card.innerHTML = wallets.map(w => {
    total += Number(w.amount || 0);
    const paid = isWalletPaid(w.id, monthKey);
    const statusIcon = paid ? '<span style="color:var(--accent); font-weight:800;">✓</span>' : '<span style="color:var(--danger); font-weight:800;">✗</span>';
    return `
    <div class="cat-row">
      <div class="cat-left"><span>💳 ${w.name}</span></div>
      <div style="display:flex; align-items:center; gap:10px;">
        <span class="cat-amount">${fmtMoney(w.amount)}</span>
        <span style="width:16px; text-align:center;">${statusIcon}</span>
      </div>
    </div>`;
  }).join('') + `<div class="cat-row" style="border-top:1px solid var(--border); margin-top:4px; padding-top:10px;"><strong>Tổng</strong><strong>${fmtMoney(total)}</strong></div>`;
}

function renderCategoryListPage() {
  const isMonthMode = STATE.catViewMode === 'month';
  if (isMonthMode) {
    const mk = catRelevantMonthKey();
    renderSubsSummary(mk, '#cat-subs-section', '#cat-subs-card');
    renderWalletsSection(mk);
  } else {
    $('#cat-subs-section').style.display = 'none';
    $('#cat-wallets-section').style.display = 'none';
  }
  const tx = getCategoryPageTx();
  const totals = {};
  STATE.categories.forEach(c => { totals[c] = 0; });
  let uncategorized = 0;
  tx.filter(isChi).forEach(t => {
    const c = t.category;
    if (c && totals.hasOwnProperty(c)) totals[c] += Number(t.so_tien || 0);
    else if (c) totals[c] = (totals[c] || 0) + Number(t.so_tien || 0);
    else uncategorized += Number(t.so_tien || 0);
  });
  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);

  const statGrid = $('#cat-stat-cards');
  if (isMonthMode) {
    const mk = catRelevantMonthKey();
    statGrid.style.display = 'grid';
    const categorySpentTotal = entries.reduce((s, [, amt]) => s + amt, 0) + uncategorized;
    const categoryBudgetTotal = Object.values(getBudgetForMonth(mk).by_category || {}).reduce((s, v) => s + Number(v || 0), 0);
    const subsPaidTotal = STATE.subscriptions.reduce((s, sub) => s + (isSubPaidInMonth(sub.id, mk) ? subEffectiveAmount(sub, mk) : 0), 0);
    const subsAllTotal = STATE.subscriptions.reduce((s, sub) => s + subEffectiveAmount(sub, mk), 0);
    const walletsThisMonth = (STATE.wallets || []).filter(w => w.month === mk);
    const walletsPaidTotal = walletsThisMonth.reduce((s, w) => s + (isWalletPaid(w.id, mk) ? Number(w.amount || 0) : 0), 0);
    const walletsAllTotal = walletsThisMonth.reduce((s, w) => s + Number(w.amount || 0), 0);

    const tongChi = categorySpentTotal + subsPaidTotal + walletsPaidTotal;
    const tongNganSach = categoryBudgetTotal + subsAllTotal + walletsAllTotal;
    const conLai = tongNganSach - tongChi;
    const daTieuPct = tongNganSach > 0 ? Math.round((tongChi / tongNganSach) * 100) : 0;

    $('#stat-tong-chi').textContent = fmtMoney(tongChi);
    $('#stat-tong-ns').textContent = fmtMoney(tongNganSach);
    $('#stat-con-lai').textContent = fmtMoney(conLai);
    $('#stat-con-lai').style.color = conLai < 0 ? 'var(--danger)' : 'var(--accent)';
    $('#stat-da-tieu-pct').textContent = daTieuPct + '%';
    $('#stat-da-tieu-pct').style.color = daTieuPct > 100 ? 'var(--danger)' : (daTieuPct >= 80 ? 'var(--warn)' : 'var(--accent)');

    $('#stat-chiphi-total').textContent = fmtMoney(subsAllTotal + walletsAllTotal);
    $('#stat-chiphi-paid').textContent = fmtMoney(subsPaidTotal + walletsPaidTotal);
  } else {
    statGrid.style.display = 'none';
  }

  const card = $('#cat-list-card');
  const mkForBudget = isMonthMode ? catRelevantMonthKey() : null;
  let html = '';
  if (isMonthMode) {
    html += `
    <div class="cat-row cat-row-head" style="font-size:10.5px; color:var(--muted); font-weight:700;">
      <div class="cat-left">Danh mục</div>
      <div style="text-align:right; min-width:140px;">Đã chi / Ngân sách / %</div>
    </div>`;
  }
  if (entries.every(([, amt]) => amt === 0) && uncategorized === 0) {
    html += '<div class="empty-state">Chưa có giao dịch trong khoảng thời gian này</div>';
  } else {
    entries.forEach(([cat, amt]) => {
      let statsLine = '';
      if (isMonthMode) {
        const budget = getCategoryBudget(cat, mkForBudget);
        if (budget && budget > 0) {
          const pct = Math.round((amt / budget) * 100);
          let pctColor = 'var(--accent)';
          if (pct > 100) pctColor = 'var(--danger)';
          else if (pct >= 80) pctColor = 'var(--warn)';
          statsLine = `<div style="font-size:11px; color:var(--muted); margin-top:2px;">NS: ${fmtMoney(budget)} · <span style="color:${pctColor}; font-weight:700;">${pct}%</span></div>`;
        } else {
          statsLine = `<div style="font-size:11px; color:var(--muted); margin-top:2px;">NS: —</div>`;
        }
      }
      html += `
      <div class="cat-row">
        <div class="cat-left"><span>${iconFor(cat)} ${cat}</span></div>
        <div style="text-align:right;">
          <div class="cat-amount">${fmtMoney(amt)}</div>
          ${statsLine}
        </div>
      </div>`;
    });
    if (uncategorized > 0) {
      html += `
      <div class="cat-row">
        <div class="cat-left"><span>📦 Chưa phân loại</span></div>
        <div class="cat-amount">${fmtMoney(uncategorized)}</div>
      </div>`;
    }
  }
  card.innerHTML = html;
}

function renderSummary(tx) {
  const chi = tx.filter(isChi).reduce((s, t) => s + Number(t.so_tien || 0), 0);
  const thu = tx.filter(isThu).reduce((s, t) => s + Number(t.so_tien || 0), 0);
  $('#ov-summary-chi').textContent = fmtMoney(chi);
  $('#ov-summary-thu').textContent = fmtMoney(thu);

  if (STATE.ovViewMode !== 'month') return;

  const budget = getBudgetForMonth(monthKeyFromDate(STATE.ovPeriodDate)).overall;
  const wrap = $('#budget-bar-wrap');
  const fill = $('#budget-bar-fill');
  const text = $('#budget-text');
  if (budget && budget > 0) {
    wrap.style.display = 'block';
    const pct = Math.min(100, (chi / budget) * 100);
    fill.style.width = pct + '%';
    fill.classList.remove('warn', 'over');
    if (chi > budget) { fill.classList.add('over'); text.textContent = `Đã vượt ngân sách ${fmtMoney(chi - budget)}`; }
    else if (pct >= 80) { fill.classList.add('warn'); text.textContent = `Còn lại ${fmtMoney(budget - chi)} (${pct.toFixed(0)}%)`; }
    else { text.textContent = `Còn lại ${fmtMoney(budget - chi)} trong ngân sách ${fmtMoney(budget)}`; }
  } else {
    wrap.style.display = 'none';
    text.textContent = '';
  }
}

function subEffectiveAmount(sub, monthKey) {
  const ov = sub.overrides || {};
  return (ov[monthKey] !== undefined && ov[monthKey] !== null) ? ov[monthKey] : Number(sub.default_amount || sub.amount || 0);
}

function isSubPaidInMonth(subId, monthKey) {
  return STATE.transactions.some(t => t.subscription_id === subId && t.subscription_month === monthKey);
}

function renderSubsSummary(monthKey, sectionSel = '#subs-summary-section', cardSel = '#subs-summary-card') {
  const section = $(sectionSel);
  const card = $(cardSel);
  if (!STATE.subscriptions || STATE.subscriptions.length === 0) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  monthKey = monthKey || monthKeyFromDate(STATE.ovPeriodDate);
  let total = 0;
  card.innerHTML = STATE.subscriptions.map(s => {
    const amt = subEffectiveAmount(s, monthKey);
    total += amt;
    const isOverridden = s.overrides && s.overrides[monthKey] !== undefined;
    const paid = isSubPaidInMonth(s.id, monthKey);
    const statusIcon = paid ? '<span style="color:var(--accent); font-weight:800;">✓</span>' : '<span style="color:var(--danger); font-weight:800;">✗</span>';
    return `
    <div class="cat-row">
      <div class="cat-left"><span>${iconFor(s.category)} ${s.name}${isOverridden ? ' <span style="color:var(--accent-2); font-size:10px;">(đã sửa)</span>' : ''}</span></div>
      <div style="display:flex; align-items:center; gap:10px;">
        <span class="cat-amount sub-effective-amount" data-id="${s.id}" style="cursor:pointer; text-decoration:underline dotted;">${fmtMoney(amt)}</span>
        <span style="width:16px; text-align:center;">${statusIcon}</span>
      </div>
    </div>`;
  }).join('') + `<div class="cat-row" style="border-top:1px solid var(--border); margin-top:4px; padding-top:10px;"><strong>Tổng dự kiến</strong><strong>${fmtMoney(total)}</strong></div>
  <div style="font-size:11px; color:var(--muted); margin-top:8px;">Số dự kiến, không tự cộng vào chi tiêu thực tế (khoản thực tế vẫn tính khi giao dịch email thật về).</div>`;

  $$(`${cardSel} .sub-effective-amount`).forEach(el => {
    el.addEventListener('click', () => openSubEditModal(el.dataset.id, monthKey));
  });
}

function openSubEditModal(subId, monthKey) {
  const sub = STATE.subscriptions.find(s => s.id === subId);
  if (!sub) return;
  const modal = $('#sub-edit-modal');
  modal.dataset.subId = subId;
  modal.dataset.monthKey = monthKey;
  $('#sub-edit-title').textContent = `${sub.name} — ${monthLabelFromKey(monthKey)}`;
  $('#sub-edit-amount-input').value = subEffectiveAmount(sub, monthKey);
  openModal(modal);
}

async function saveSubEdit() {
  const modal = $('#sub-edit-modal');
  const subId = modal.dataset.subId;
  const monthKey = modal.dataset.monthKey;
  const amount = parseFloat($('#sub-edit-amount-input').value);
  if (!amount || amount <= 0) { alert('Nhập số tiền hợp lệ'); return; }
  $('#sub-edit-save-btn').disabled = true;
  try {
    const newData = await ghUpdateJson('data/subscriptions.json', (data) => {
      const list = data || [];
      const idx = list.findIndex(s => s.id === subId);
      if (idx >= 0) {
        if (monthKey === '__default__') {
          list[idx].default_amount = amount;
        } else {
          if (!list[idx].overrides) list[idx].overrides = {};
          list[idx].overrides[monthKey] = amount;
        }
      }
      return list;
    }, `update subscription ${subId} (${monthKey})`);
    STATE.subscriptions = newData;
    closeModal(modal);
    renderSubsSummary(monthKeyFromDate(STATE.ovPeriodDate));
    safeRender('category-list-page', () => renderCategoryListPage());
    renderSubsList();
  } catch (e) { alert('Lưu thất bại: ' + e.message); }
  finally { $('#sub-edit-save-btn').disabled = false; }
}
$('#sub-edit-save-btn').addEventListener('click', saveSubEdit);
$('#sub-edit-close-btn').addEventListener('click', () => { closeModal($('#sub-edit-modal')); });

function renderCategoryChart(tx) {
  const monthTx = tx.filter(isChi);
  const byCat = {};
  monthTx.forEach(t => {
    const c = t.category || 'Chưa phân loại';
    byCat[c] = (byCat[c] || 0) + Number(t.so_tien || 0);
  });
  const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);

  const canvas = $('#category-chart');
  const chartAvailable = typeof Chart !== 'undefined';
  if (!chartAvailable) {
    canvas.style.display = 'none';
  } else {
    if (STATE.categoryChart) STATE.categoryChart.destroy();
    if (entries.length === 0) {
      canvas.style.display = 'none';
    } else {
      canvas.style.display = 'block';
      STATE.categoryChart = new Chart(canvas, {
        type: 'doughnut',
        data: { labels: entries.map(e => e[0]), datasets: [{ data: entries.map(e => e[1]), backgroundColor: entries.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]), borderWidth: 0 }] },
        options: { plugins: { legend: { display: false } }, cutout: '65%' }
      });
    }
  }

  const list = $('#category-breakdown');
  list.innerHTML = entries.length === 0 ? '<div class="empty-state">Chưa có chi tiêu tháng này</div>' : '';
  entries.forEach(([cat, amt], i) => {
    const row = document.createElement('div');
    row.className = 'cat-row';
    const catBudget = STATE.ovViewMode === 'month' ? getCategoryBudget(cat, monthKeyFromDate(STATE.ovPeriodDate)) : null;
    const budgetMini = catBudget ? `<div class="cat-budget-mini">${fmtMoney(amt)} / ${fmtMoney(catBudget)}${amt > catBudget ? ' ⚠️' : ''}</div>` : '';
    row.innerHTML = `
      <div class="cat-left"><span class="cat-dot" style="background:${CHART_COLORS[i % CHART_COLORS.length]}"></span><span>${iconFor(cat)} ${cat}</span></div>
      <div style="text-align:right;"><div class="cat-amount">${fmtMoney(amt)}</div>${budgetMini}</div>`;
    list.appendChild(row);
  });
}

function renderTrendChart() {
  const months = [];
  const base = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
    months.push({ key: monthKeyFromDate(d), label: `T${d.getMonth() + 1}` });
  }
  const totals = months.map(m => STATE.transactions.filter(t => txInMonth(t, m.key) && isChi(t)).reduce((s, t) => s + Number(t.so_tien || 0), 0));
  const canvas = $('#trend-chart');
  if (typeof Chart === 'undefined') return;
  if (STATE.trendChart) STATE.trendChart.destroy();
  STATE.trendChart = new Chart(canvas, {
    type: 'bar',
    data: { labels: months.map(m => m.label), datasets: [{ data: totals, backgroundColor: '#5b8cff', borderRadius: 6 }] },
    options: { plugins: { legend: { display: false } }, scales: {
      y: { ticks: { color: '#8b93b8', callback: (v) => (v >= 1000000 ? (v / 1000000) + 'tr' : v) }, grid: { color: '#2a3358' } },
      x: { ticks: { color: '#8b93b8' }, grid: { display: false } }
    } }
  });
}

function renderTxList() {
  let list;
  if (STATE.txViewMode === 'week') {
    list = STATE.transactions.filter(t => txInWeek(t, STATE.txPeriodDate));
  } else if (STATE.txViewMode === 'custom') {
    list = STATE.transactions.filter(t => txInRange(t, STATE.txCustomStart, STATE.txCustomEnd));
  } else {
    list = STATE.transactions.filter(t => txInMonth(t, monthKeyFromDate(STATE.txPeriodDate)));
  }
  if (STATE.filterCategory) list = list.filter(t => t.category === STATE.filterCategory);

  const sumChi = list.filter(isChi).reduce((s, t) => s + Number(t.so_tien || 0), 0);
  const sumThu = list.filter(isThu).reduce((s, t) => s + Number(t.so_tien || 0), 0);
  $('#tx-summary-chi').textContent = fmtMoney(sumChi);
  $('#tx-summary-thu').textContent = fmtMoney(sumThu);

  const sortFns = {
    date_desc: (a, b) => parseTxDate(b.thoi_gian_giao_dich) - parseTxDate(a.thoi_gian_giao_dich),
    date_asc: (a, b) => parseTxDate(a.thoi_gian_giao_dich) - parseTxDate(b.thoi_gian_giao_dich),
    amount_desc: (a, b) => Number(b.so_tien || 0) - Number(a.so_tien || 0),
    amount_asc: (a, b) => Number(a.so_tien || 0) - Number(b.so_tien || 0),
    category_asc: (a, b) => (a.category || 'zzz').localeCompare(b.category || 'zzz', 'vi')
  };
  list = [...list].sort(sortFns[STATE.sort]);

  const container = $('#tx-list');
  const empty = $('#tx-empty');
  container.innerHTML = '';
  empty.style.display = list.length === 0 ? 'block' : 'none';

  list.forEach(t => {
    const item = document.createElement('div');
    item.className = 'tx-item' + (t.labeled ? '' : ' tx-unlabeled');
    item.innerHTML = `
      <div class="tx-left">
        <div class="tx-emoji">${iconFor(t.category)}</div>
        <div class="tx-main">
          <div class="tx-partner">${t.doi_tac || 'Không rõ'}</div>
          <div class="tx-note">${t.note || t.noi_dung || ''}</div>
          <div class="tx-time">${fmtTxTime(t.thoi_gian_giao_dich)}</div>
        </div>
      </div>
      <div class="tx-side">
        <div class="tx-amount ${isThu(t) ? 'amount-in' : 'amount-out'}">${isThu(t) ? '+' : '-'}${fmtMoney(t.so_tien)}</div>
        <div class="tx-cat">${t.category || 'Bấm để gắn nhãn'}</div>
      </div>`;
    item.addEventListener('click', () => openLabelModal(t));
    container.appendChild(item);
  });
}

// ---------- LABEL / EDIT / DELETE TRANSACTION ----------
function openLabelModal(tx) {
  const modal = $('#label-modal');
  const chips = $('#category-chips');
  chips.innerHTML = '';
  STATE.categories.forEach(cat => {
    const chip = document.createElement('button');
    chip.className = 'chip' + (tx.category === cat ? ' chip-selected' : '');
    chip.textContent = `${iconFor(cat)} ${cat}`;
    chip.addEventListener('click', () => {
      $$('#category-chips .chip').forEach(c => c.classList.remove('chip-selected'));
      chip.classList.add('chip-selected');
      modal.dataset.selectedCat = cat;
    });
    chips.appendChild(chip);
  });
  modal.dataset.selectedCat = tx.category || '';
  $('#label-note').value = tx.note || '';
  $('#label-amount').textContent = fmtMoney(tx.so_tien);
  $('#label-partner').textContent = tx.doi_tac || '';
  $('#label-time').textContent = fmtTxTime(tx.thoi_gian_giao_dich);
  modal.dataset.txId = tx.id;

  const subSel = $('#label-subscription-select');
  subSel.innerHTML = '<option value="">Không</option>';
  (STATE.subscriptions || []).forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id; opt.textContent = `${iconFor(s.category)} ${s.name}`;
    subSel.appendChild(opt);
  });
  subSel.value = tx.subscription_id || '';

  const subMonthInput = $('#label-subscription-month');
  const subMonthLabel = $('#label-sub-month-label');
  const showMonth = !!subSel.value;
  subMonthLabel.style.display = showMonth ? 'block' : 'none';
  subMonthInput.style.display = showMonth ? 'block' : 'none';
  subMonthInput.value = tx.subscription_month || monthKeyFromDate(parseTxDate(tx.thoi_gian_giao_dich));

  const walletSel = $('#label-wallet-select');
  walletSel.innerHTML = '<option value="">Không</option>';
  (STATE.wallets || []).forEach(w => {
    const opt = document.createElement('option');
    opt.value = w.id; opt.textContent = w.month ? `💳 ${w.name} (${monthLabelFromKey(w.month)})` : `💳 ${w.name}`;
    walletSel.appendChild(opt);
  });
  walletSel.value = tx.wallet_id || '';

  const walletMonthInput = $('#label-wallet-month');
  const walletMonthLabel = $('#label-wallet-month-label');
  const showWalletMonth = !!walletSel.value;
  walletMonthLabel.style.display = showWalletMonth ? 'block' : 'none';
  walletMonthInput.style.display = showWalletMonth ? 'block' : 'none';
  if (showWalletMonth) {
    const w = STATE.wallets.find(x => x.id === walletSel.value);
    walletMonthInput.value = tx.wallet_month || (w && w.month) || monthKeyFromDate(parseTxDate(tx.thoi_gian_giao_dich));
  }

  openModal(modal);
}
$('#label-subscription-select').addEventListener('change', (e) => {
  const show = !!e.target.value;
  $('#label-sub-month-label').style.display = show ? 'block' : 'none';
  $('#label-subscription-month').style.display = show ? 'block' : 'none';
  if (show && !$('#label-subscription-month').value) {
    $('#label-subscription-month').value = monthKeyFromDate(new Date());
  }
});
$('#label-wallet-select').addEventListener('change', (e) => {
  const show = !!e.target.value;
  $('#label-wallet-month-label').style.display = show ? 'block' : 'none';
  $('#label-wallet-month').style.display = show ? 'block' : 'none';
  if (show) {
    const w = STATE.wallets.find(x => x.id === e.target.value);
    $('#label-wallet-month').value = (w && w.month) || monthKeyFromDate(new Date());
  }
});

async function saveLabel() {
  const modal = $('#label-modal');
  const txId = modal.dataset.txId;
  const cat = modal.dataset.selectedCat;
  const note = $('#label-note').value;
  const subscriptionId = $('#label-subscription-select').value || null;
  const subscriptionMonth = subscriptionId ? ($('#label-subscription-month').value || null) : null;
  const walletId = $('#label-wallet-select').value || null;
  const walletMonth = walletId ? ($('#label-wallet-month').value || null) : null;
  if (!cat) { alert('Chọn 1 danh mục'); return; }
  $('#save-label-btn').disabled = true;
  try {
    const newData = await ghUpdateJson('data/transactions.json', (data) => {
      const list = data || [];
      const idx = list.findIndex(t => t.id === txId);
      if (idx >= 0) {
        list[idx].category = cat; list[idx].note = note; list[idx].labeled = true;
        list[idx].subscription_id = subscriptionId; list[idx].subscription_month = subscriptionMonth;
        list[idx].wallet_id = walletId; list[idx].wallet_month = walletMonth;
      }
      return list;
    }, `label: ${txId}`);
    STATE.transactions = newData;
    closeModal(modal);
    renderAll();
  } catch (e) { alert('Lưu thất bại: ' + e.message); }
  finally { $('#save-label-btn').disabled = false; }
}

async function deleteTx() {
  const modal = $('#label-modal');
  const txId = modal.dataset.txId;
  if (!confirm('Xoá giao dịch này? Không thể hoàn tác.')) return;
  $('#delete-tx-btn').disabled = true;
  try {
    const newData = await ghUpdateJson('data/transactions.json', (data) => (data || []).filter(t => t.id !== txId), `delete: ${txId}`);
    STATE.transactions = newData;
    closeModal(modal);
    renderAll();
  } catch (e) { alert('Xoá thất bại: ' + e.message); }
  finally { $('#delete-tx-btn').disabled = false; }
}

// ---------- PUSH ----------
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}
async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    alert('Trình duyệt không hỗ trợ push. Trên iPhone: phải Add to Home Screen trước, mở từ icon đó.');
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { alert('Bạn chưa cho phép thông báo'); return; }
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) });
  const subJson = sub.toJSON();
  await ghUpdateJson('data/push_subscriptions.json', (data) => {
    const list = data || [];
    if (!list.some(s => s.endpoint === subJson.endpoint)) list.push(subJson);
    return list;
  }, 'add push subscription');
  $('#push-status').textContent = 'Đã bật thông báo trên thiết bị này';
}

// ---------- SETTINGS: TOKEN ----------
$('#settings-save-token-btn').addEventListener('click', () => {
  const t = $('#settings-token-input').value.trim();
  if (!t) return;
  setToken(t);
  boot();
});

// ---------- SETTINGS: BUDGET ----------
function recomputeBudgetOverallDisplay() {
  let sum = 0;
  $$('#budget-by-category input').forEach(inp => { const v = parseFloat(inp.value); if (v > 0) sum += v; });
  $('#budget-overall-display').textContent = fmtMoney(sum);
  return sum;
}
function renderBudgetInputs() {
  const monthInput = $('#budget-month-input');
  if (!monthInput.value) monthInput.value = monthKeyFromDate(new Date());
  const monthKey = monthInput.value;
  const b = getBudgetForMonth(monthKey);
  const wrap = $('#budget-by-category');
  wrap.innerHTML = '';
  STATE.categories.filter(c => c !== 'Thu nhập').forEach(cat => {
    const row = document.createElement('div');
    row.className = 'budget-row';
    row.innerHTML = `<span>${iconFor(cat)} ${cat}</span><input type="number" data-cat="${cat}" placeholder="0" value="${b.by_category?.[cat] || ''}">`;
    wrap.appendChild(row);
  });
  $$('#budget-by-category input').forEach(inp => inp.addEventListener('input', recomputeBudgetOverallDisplay));
  recomputeBudgetOverallDisplay();
  renderBudgetMonthsList();
}
function renderBudgetMonthsList() {
  const wrap = $('#budget-months-list');
  const byMonth = STATE.budgets.by_month || {};
  const months = Object.keys(byMonth).sort((a, b) => b.localeCompare(a));
  if (months.length === 0) {
    wrap.innerHTML = '<div class="empty-state" style="padding:8px 0;">Chưa có tháng nào được set riêng.</div>';
    return;
  }
  const currentMonth = $('#budget-month-input').value;
  wrap.innerHTML = months.map(mk => {
    const overall = byMonth[mk].overall;
    return `
    <div class="sub-item"${mk === currentMonth ? ' style="border-color:var(--accent);"' : ''}>
      <div><div class="sub-name">${monthLabelFromKey(mk)}</div><div class="sub-meta">${overall ? fmtMoney(overall) : 'Chưa set tổng'}</div></div>
      <button class="budget-month-edit-btn" data-month="${mk}" style="background:var(--card-2); border:1px solid var(--border); color:var(--text); border-radius:9px; padding:6px 12px; font-size:12px;">Sửa</button>
    </div>`;
  }).join('');
  $$('.budget-month-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $('#budget-month-input').value = btn.dataset.month;
      renderBudgetInputs();
      btn.closest('.settings-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}
$('#budget-month-input').addEventListener('change', () => renderBudgetInputs());
async function saveBudgets() {
  const monthKey = $('#budget-month-input').value || monthKeyFromDate(new Date());
  const overall = recomputeBudgetOverallDisplay() || null;
  const byCat = {};
  $$('#budget-by-category input').forEach(inp => { const v = parseFloat(inp.value); if (v > 0) byCat[inp.dataset.cat] = v; });
  $('#save-budget-btn').disabled = true;
  try {
    const newBudgets = await ghUpdateJson('data/budgets.json', (data) => {
      const b = data || { overall_monthly: null, by_category: {}, by_month: {} };
      if (!b.by_month) b.by_month = {};
      b.by_month[monthKey] = { overall, by_category: byCat };
      return b;
    }, `update budgets (${monthKey})`);
    STATE.budgets = newBudgets;
    renderAll();
    renderBudgetMonthsList();
    alert(`Đã lưu ngân sách cho ${monthLabelFromKey(monthKey)}`);
  } catch (e) { alert('Lưu ngân sách thất bại: ' + e.message); }
  finally { $('#save-budget-btn').disabled = false; }
}
$('#save-budget-btn').addEventListener('click', saveBudgets);

// ---------- SETTINGS: CATEGORIES ----------
function renderCategoryTags() {
  const wrap = $('#category-tags');
  wrap.innerHTML = '';
  STATE.categories.forEach(cat => {
    const tag = document.createElement('span');
    tag.className = 'cat-tag';
    tag.innerHTML = `${iconFor(cat)} ${cat} <button data-cat="${cat}">✕</button>`;
    tag.querySelector('button').addEventListener('click', () => removeCategory(cat));
    wrap.appendChild(tag);
  });
  const subCatSel = $('#sub-category-input');
  subCatSel.innerHTML = '';
  STATE.categories.forEach(c => {
    const opt = document.createElement('option'); opt.value = c; opt.textContent = c;
    subCatSel.appendChild(opt);
  });
}
async function addCategory() {
  const input = $('#new-category-input');
  const name = input.value.trim();
  if (!name) return;
  if (STATE.categories.includes(name)) { alert('Danh mục đã tồn tại'); return; }
  $('#add-category-btn').disabled = true;
  try {
    const newData = await ghUpdateJson('data/categories.json', (data) => {
      const list = data || [];
      if (!list.includes(name)) list.push(name);
      return list;
    }, `add category: ${name}`);
    STATE.categories = newData;
    input.value = '';
    renderCategoryTags();
    renderBudgetInputs();
    const filterSel = $('#filter-category');
    const opt = document.createElement('option'); opt.value = name; opt.textContent = name;
    filterSel.appendChild(opt);
  } catch (e) { alert('Thêm danh mục thất bại: ' + e.message); }
  finally { $('#add-category-btn').disabled = false; }
}
async function removeCategory(cat) {
  if (!confirm(`Xoá danh mục "${cat}"? Các giao dịch đã gắn nhãn này vẫn giữ nguyên tên cũ.`)) return;
  try {
    const newData = await ghUpdateJson('data/categories.json', (data) => (data || []).filter(c => c !== cat), `remove category: ${cat}`);
    STATE.categories = newData;
    renderCategoryTags();
    renderBudgetInputs();
  } catch (e) { alert('Xoá thất bại: ' + e.message); }
}
$('#add-category-btn').addEventListener('click', addCategory);

// ---------- SETTINGS: SUBSCRIPTIONS ----------
function renderSubsList() {
  const wrap = $('#subs-list');
  wrap.innerHTML = '';
  if (!STATE.subscriptions || STATE.subscriptions.length === 0) {
    wrap.innerHTML = '<div class="empty-state" style="padding:8px 0;">Chưa có khoản cố định nào.</div>';
    return;
  }
  STATE.subscriptions.forEach(s => {
    const row = document.createElement('div');
    row.className = 'sub-item';
    const dueDayText = s.due_day ? ` · Hạn nộp: ngày ${s.due_day}` : '';
    row.innerHTML = `
      <div><div class="sub-name">${iconFor(s.category)} ${s.name}</div><div class="sub-meta">${s.category} · mặc định${dueDayText}</div></div>
      <div style="display:flex; align-items:center;"><span class="sub-amount sub-default-amount" data-id="${s.id}" style="cursor:pointer; text-decoration:underline dotted;">${fmtMoney(s.default_amount ?? s.amount)}</span><button class="sub-edit-full" data-id="${s.id}" style="background:none; border:none; color:var(--muted); font-size:16px; padding:0 6px;">✏️</button><button class="sub-remove" data-id="${s.id}">✕</button></div>`;
    row.querySelector('.sub-remove').addEventListener('click', () => removeSubscription(s.id));
    row.querySelector('.sub-default-amount').addEventListener('click', () => openSubDefaultEditModal(s.id));
    row.querySelector('.sub-edit-full').addEventListener('click', () => openSubFullEditModal(s.id));
    wrap.appendChild(row);
  });
}

function openSubDefaultEditModal(subId) {
  const sub = STATE.subscriptions.find(s => s.id === subId);
  if (!sub) return;
  const modal = $('#sub-edit-modal');
  modal.dataset.subId = subId;
  modal.dataset.monthKey = '__default__';
  $('#sub-edit-title').textContent = `${sub.name} — số tiền mặc định`;
  $('#sub-edit-amount-input').value = sub.default_amount ?? sub.amount ?? '';
  openModal(modal);
}

function openSubFullEditModal(subId) {
  const sub = STATE.subscriptions.find(s => s.id === subId);
  if (!sub) return;
  const modal = $('#sub-full-edit-modal');
  modal.dataset.subId = subId;
  $('#sub-full-edit-name-input').value = sub.name || '';
  $('#sub-full-edit-amount-input').value = sub.default_amount ?? sub.amount ?? '';
  $('#sub-full-edit-due-day-input').value = sub.due_day ?? '';
  const catSel = $('#sub-full-edit-category-input');
  catSel.innerHTML = '';
  STATE.categories.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c; opt.textContent = c;
    if (c === sub.category) opt.selected = true;
    catSel.appendChild(opt);
  });
  openModal(modal);
}

async function saveSubFullEdit() {
  const modal = $('#sub-full-edit-modal');
  const subId = modal.dataset.subId;
  const name = $('#sub-full-edit-name-input').value.trim();
  const amount = parseFloat($('#sub-full-edit-amount-input').value);
  const category = $('#sub-full-edit-category-input').value;
  const dueDayRaw = $('#sub-full-edit-due-day-input').value;
  const dueDay = dueDayRaw ? Math.min(31, Math.max(1, parseInt(dueDayRaw, 10))) : null;
  if (!name || !amount) { alert('Nhập đủ tên và số tiền'); return; }
  $('#sub-full-edit-save-btn').disabled = true;
  try {
    const newData = await ghUpdateJson('data/subscriptions.json', (data) => {
      const list = data || [];
      const idx = list.findIndex(s => s.id === subId);
      if (idx >= 0) {
        list[idx].name = name;
        list[idx].category = category;
        list[idx].default_amount = amount;
        list[idx].due_day = dueDay;
      }
      return list;
    }, `edit subscription: ${subId}`);
    STATE.subscriptions = newData;
    closeModal(modal);
    renderSubsList();
    renderSubsSummary(monthKeyFromDate(STATE.ovPeriodDate));
    safeRender('category-list-page', () => renderCategoryListPage());
  } catch (e) { alert('Lưu thất bại: ' + e.message); }
  finally { $('#sub-full-edit-save-btn').disabled = false; }
}
$('#sub-full-edit-save-btn').addEventListener('click', saveSubFullEdit);
$('#sub-full-edit-close-btn').addEventListener('click', () => { closeModal($('#sub-full-edit-modal')); });
async function addSubscription() {
  const name = $('#sub-name-input').value.trim();
  const amount = parseFloat($('#sub-amount-input').value);
  const category = $('#sub-category-input').value;
  const dueDayRaw = $('#sub-due-day-input').value;
  const dueDay = dueDayRaw ? Math.min(31, Math.max(1, parseInt(dueDayRaw, 10))) : null;
  if (!name || !amount) { alert('Nhập đủ tên và số tiền'); return; }
  $('#add-sub-btn').disabled = true;
  try {
    const newData = await ghUpdateJson('data/subscriptions.json', (data) => {
      const list = data || [];
      list.push({ id: 'sub_' + Date.now(), name, default_amount: amount, category, due_day: dueDay, overrides: {} });
      return list;
    }, `add subscription: ${name}`);
    STATE.subscriptions = newData;
    $('#sub-name-input').value = ''; $('#sub-amount-input').value = ''; $('#sub-due-day-input').value = '';
    renderSubsList();
    renderSubsSummary(monthKeyFromDate(STATE.ovPeriodDate));
    safeRender('category-list-page', () => renderCategoryListPage());
  } catch (e) { alert('Thêm thất bại: ' + e.message); }
  finally { $('#add-sub-btn').disabled = false; }
}
async function removeSubscription(id) {
  if (!confirm('Xoá khoản cố định này?')) return;
  try {
    const newData = await ghUpdateJson('data/subscriptions.json', (data) => (data || []).filter(s => s.id !== id), `remove subscription: ${id}`);
    STATE.subscriptions = newData;
    renderSubsList();
    renderSubsSummary(monthKeyFromDate(STATE.ovPeriodDate));
    safeRender('category-list-page', () => renderCategoryListPage());
  } catch (e) { alert('Xoá thất bại: ' + e.message); }
}
$('#add-sub-btn').addEventListener('click', addSubscription);

// ---------- VI CO DINH ----------
function renderWalletsList() {
  const wrap = $('#wallets-list');
  wrap.innerHTML = '';
  if (!STATE.wallets || STATE.wallets.length === 0) {
    wrap.innerHTML = '<div class="empty-state" style="padding:8px 0;">Chưa có phí không cố định nào.</div>';
    return;
  }
  [...STATE.wallets].sort((a, b) => (b.month || '').localeCompare(a.month || '')).forEach(w => {
    const row = document.createElement('div');
    row.className = 'sub-item';
    row.innerHTML = `
      <div><div class="sub-name">💳 ${w.name}</div><div class="sub-meta">${w.month ? monthLabelFromKey(w.month) : 'Chưa chọn tháng'}</div></div>
      <div style="display:flex; align-items:center;"><span class="sub-amount">${fmtMoney(w.amount)}</span><button class="wallet-edit-btn" data-id="${w.id}" style="background:none; border:none; color:var(--muted); font-size:16px; padding:0 6px;">✏️</button><button class="sub-remove" data-id="${w.id}">✕</button></div>`;
    row.querySelector('.sub-remove').addEventListener('click', () => removeWallet(w.id));
    row.querySelector('.wallet-edit-btn').addEventListener('click', () => openWalletEditModal(w.id));
    wrap.appendChild(row);
  });
}

async function addWallet() {
  const name = $('#wallet-name-input').value.trim();
  const amount = parseFloat($('#wallet-amount-input').value);
  const month = $('#wallet-month-input').value || null;
  if (!name || !amount) { alert('Nhập đủ tên và số tiền'); return; }
  $('#add-wallet-btn').disabled = true;
  try {
    const newData = await ghUpdateJson('data/wallets.json', (data) => {
      const list = data || [];
      list.push({ id: 'wallet_' + Date.now(), name, amount, month });
      return list;
    }, `add wallet: ${name}`);
    STATE.wallets = newData;
    $('#wallet-name-input').value = ''; $('#wallet-amount-input').value = ''; $('#wallet-month-input').value = '';
    renderWalletsList();
    safeRender('category-list-page', () => renderCategoryListPage());
  } catch (e) { alert('Thêm thất bại: ' + e.message); }
  finally { $('#add-wallet-btn').disabled = false; }
}
$('#add-wallet-btn').addEventListener('click', addWallet);

function openWalletEditModal(walletId) {
  const w = STATE.wallets.find(x => x.id === walletId);
  if (!w) return;
  const modal = $('#wallet-edit-modal');
  modal.dataset.walletId = walletId;
  $('#wallet-edit-name-input').value = w.name || '';
  $('#wallet-edit-amount-input').value = w.amount ?? '';
  $('#wallet-edit-month-input').value = w.month || '';
  openModal(modal);
}

async function saveWalletEdit() {
  const modal = $('#wallet-edit-modal');
  const walletId = modal.dataset.walletId;
  const name = $('#wallet-edit-name-input').value.trim();
  const amount = parseFloat($('#wallet-edit-amount-input').value);
  const month = $('#wallet-edit-month-input').value || null;
  if (!name || !amount) { alert('Nhập đủ tên và số tiền'); return; }
  $('#wallet-edit-save-btn').disabled = true;
  try {
    const newData = await ghUpdateJson('data/wallets.json', (data) => {
      const list = data || [];
      const idx = list.findIndex(w => w.id === walletId);
      if (idx >= 0) { list[idx].name = name; list[idx].amount = amount; list[idx].month = month; }
      return list;
    }, `edit wallet: ${walletId}`);
    STATE.wallets = newData;
    closeModal(modal);
    renderWalletsList();
    safeRender('category-list-page', () => renderCategoryListPage());
  } catch (e) { alert('Lưu thất bại: ' + e.message); }
  finally { $('#wallet-edit-save-btn').disabled = false; }
}
$('#wallet-edit-save-btn').addEventListener('click', saveWalletEdit);
$('#wallet-edit-close-btn').addEventListener('click', () => { closeModal($('#wallet-edit-modal')); });

async function removeWallet(id) {
  if (!confirm('Xoá phí không cố định này?')) return;
  try {
    const newData = await ghUpdateJson('data/wallets.json', (data) => (data || []).filter(w => w.id !== id), `remove wallet: ${id}`);
    STATE.wallets = newData;
    renderWalletsList();
    safeRender('category-list-page', () => renderCategoryListPage());
  } catch (e) { alert('Xoá thất bại: ' + e.message); }
}

// ---------- INIT ----------
async function init() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  if (!getToken()) {
    openModal($('#token-modal'));
    $('#save-token-btn').addEventListener('click', () => {
      const t = $('#token-input').value.trim();
      if (!t) return;
      setToken(t);
      closeModal($('#token-modal'));
      boot();
    });
    return;
  }
  boot();
}
async function boot() {
  try {
    await loadAll();
    renderAll();
    renderBudgetInputs();
    renderCategoryTags();
    renderSubsList();
    renderWalletsList();
  } catch (e) {
    alert('Lỗi tải dữ liệu: ' + e.message + '\nKiểm tra lại token trong Cài đặt.');
  }
}

$('#save-label-btn').addEventListener('click', saveLabel);
$('#delete-tx-btn').addEventListener('click', deleteTx);
$('#close-label-btn').addEventListener('click', () => { closeModal($('#label-modal')); });
$('#enable-push-btn').addEventListener('click', enablePush);
$('#refresh-btn').addEventListener('click', boot);
$('#filter-category').addEventListener('change', (e) => { STATE.filterCategory = e.target.value; renderTxList(); });
$('#sort-select').addEventListener('change', (e) => { STATE.sort = e.target.value; renderTxList(); });

init();
