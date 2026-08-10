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
  if (!res.ok) { const t = await res.text(); throw new Error(`PUT ${path} that bai: ${res.status} ${t}`); }
  return res.json();
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
function monthLabel(d) { return `Tháng ${d.getMonth() + 1}/${d.getFullYear()}`; }
function fmtDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

let STATE = {
  transactions: [], categories: [], budgets: { overall_monthly: null, by_category: {} },
  subscriptions: [], notifications: [],
  currentMonthDate: new Date(), filterCategory: '', sort: 'date_desc',
  categoryChart: null, trendChart: null
};

async function loadAll() {
  const [tx, cats, budgets, subs, notifs] = await Promise.all([
    ghGetFile('data/transactions.json'),
    ghGetFile('data/categories.json'),
    ghGetFile('data/budgets.json').catch(() => ({ data: { overall_monthly: null, by_category: {} }, sha: null })),
    ghGetFile('data/subscriptions.json').catch(() => ({ data: [], sha: null })),
    ghGetFile('data/notifications_log.json').catch(() => ({ data: [], sha: null }))
  ]);
  STATE.transactions = tx.data;
  STATE.categories = cats.data;
  STATE.budgets = budgets.data;
  STATE.subscriptions = subs.data;
  STATE.notifications = notifs.data;

  const filterSel = $('#filter-category');
  filterSel.innerHTML = '<option value="">Tất cả danh mục</option>';
  STATE.categories.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c; opt.textContent = c;
    filterSel.appendChild(opt);
  });
}

function txInMonth(t, monthKey) { return monthKeyFromDate(parseTxDate(t.thoi_gian_giao_dich)) === monthKey; }

// ---------- TAB NAVIGATION ----------
function switchTab(pageId) {
  $$('.page').forEach(p => p.classList.toggle('active', p.id === pageId));
  $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.page === pageId));
}
$$('.tab-btn').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.page)));

function updateMonthLabels() {
  $$('.month-label').forEach(el => { el.textContent = monthLabel(STATE.currentMonthDate); });
}
$$('.prev-month-btn').forEach(b => b.addEventListener('click', () => {
  STATE.currentMonthDate = new Date(STATE.currentMonthDate.getFullYear(), STATE.currentMonthDate.getMonth() - 1, 1);
  renderAll();
}));
$$('.next-month-btn').forEach(b => b.addEventListener('click', () => {
  STATE.currentMonthDate = new Date(STATE.currentMonthDate.getFullYear(), STATE.currentMonthDate.getMonth() + 1, 1);
  renderAll();
}));

// ---------- RENDER ----------
function renderAll() {
  const monthKey = monthKeyFromDate(STATE.currentMonthDate);
  updateMonthLabels();

  const unlabeled = STATE.transactions.filter(t => !t.labeled);
  const banner = $('#unlabeled-banner');
  if (unlabeled.length > 0) {
    banner.style.display = 'flex';
    banner.textContent = `⚠️ ${unlabeled.length} giao dịch chưa gắn nhãn — bấm để xử lý`;
    banner.onclick = () => openLabelModal(unlabeled[0]);
  } else {
    banner.style.display = 'none';
  }

  renderSummary(monthKey);
  renderSubsSummary();
  renderCategoryChart(monthKey);
  renderTrendChart();
  renderTxList(monthKey);
  renderNotifications();
}

function renderSummary(monthKey) {
  const monthTx = STATE.transactions.filter(t => txInMonth(t, monthKey));
  const chi = monthTx.reduce((s, t) => s + Number(t.so_tien || 0), 0);
  $('#summary-chi').textContent = fmtMoney(chi);

  const budget = STATE.budgets.overall_monthly;
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

function renderSubsSummary() {
  const section = $('#subs-summary-section');
  const card = $('#subs-summary-card');
  if (!STATE.subscriptions || STATE.subscriptions.length === 0) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  const total = STATE.subscriptions.reduce((s, x) => s + Number(x.amount || 0), 0);
  card.innerHTML = STATE.subscriptions.map(s => `
    <div class="cat-row">
      <div class="cat-left"><span>${iconFor(s.category)} ${s.name}</span></div>
      <div class="cat-amount">${fmtMoney(s.amount)}</div>
    </div>
  `).join('') + `<div class="cat-row" style="border-top:1px solid var(--border); margin-top:4px; padding-top:10px;"><strong>Tổng cố định</strong><strong>${fmtMoney(total)}</strong></div>
  <div style="font-size:11px; color:var(--muted); margin-top:8px;">Đây là danh sách tham khảo, không tự cộng vào chi tiêu thực tế (khoản thực tế vẫn tính khi giao dịch email thật về).</div>`;
}

function renderCategoryChart(monthKey) {
  const monthTx = STATE.transactions.filter(t => txInMonth(t, monthKey));
  const byCat = {};
  monthTx.forEach(t => {
    const c = t.category || 'Chưa phân loại';
    byCat[c] = (byCat[c] || 0) + Number(t.so_tien || 0);
  });
  const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);

  const canvas = $('#category-chart');
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

  const list = $('#category-breakdown');
  list.innerHTML = entries.length === 0 ? '<div class="empty-state">Chưa có chi tiêu tháng này</div>' : '';
  entries.forEach(([cat, amt], i) => {
    const row = document.createElement('div');
    row.className = 'cat-row';
    const catBudget = STATE.budgets.by_category?.[cat];
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
  const totals = months.map(m => STATE.transactions.filter(t => txInMonth(t, m.key)).reduce((s, t) => s + Number(t.so_tien || 0), 0));
  const canvas = $('#trend-chart');
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

function renderTxList(monthKey) {
  let list = STATE.transactions.filter(t => txInMonth(t, monthKey));
  if (STATE.filterCategory) list = list.filter(t => t.category === STATE.filterCategory);
  const sortFns = {
    date_desc: (a, b) => parseTxDate(b.thoi_gian_giao_dich) - parseTxDate(a.thoi_gian_giao_dich),
    date_asc: (a, b) => parseTxDate(a.thoi_gian_giao_dich) - parseTxDate(b.thoi_gian_giao_dich),
    amount_desc: (a, b) => Number(b.so_tien || 0) - Number(a.so_tien || 0),
    amount_asc: (a, b) => Number(a.so_tien || 0) - Number(b.so_tien || 0)
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
        </div>
      </div>
      <div class="tx-side">
        <div class="tx-amount amount-out">-${fmtMoney(t.so_tien)}</div>
        <div class="tx-cat">${t.category || 'Bấm để gắn nhãn'}</div>
      </div>`;
    item.addEventListener('click', () => openLabelModal(t));
    container.appendChild(item);
  });
}

function renderNotifications() {
  const list = STATE.notifications || [];
  const container = $('#notif-list');
  const empty = $('#notif-empty');
  container.innerHTML = '';
  empty.style.display = list.length === 0 ? 'block' : 'none';
  list.forEach(n => {
    const item = document.createElement('div');
    item.className = 'notif-item';
    item.innerHTML = `<div class="notif-title">🔔 ${n.title}</div><div class="notif-body">${n.body}</div><div class="notif-time">${fmtDateTime(n.sent_at)}</div>`;
    container.appendChild(item);
  });
  const unreadCount = STATE.transactions.filter(t => !t.labeled).length;
  const badge = $('#notif-badge');
  if (unreadCount > 0) { badge.style.display = 'inline-block'; badge.textContent = unreadCount; }
  else { badge.style.display = 'none'; }
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
  modal.dataset.txId = tx.id;
  modal.style.display = 'flex';
}

async function saveLabel() {
  const modal = $('#label-modal');
  const txId = modal.dataset.txId;
  const cat = modal.dataset.selectedCat;
  const note = $('#label-note').value;
  if (!cat) { alert('Chọn 1 danh mục'); return; }
  $('#save-label-btn').disabled = true;
  try {
    const fresh = await ghGetFile('data/transactions.json');
    const idx = fresh.data.findIndex(t => t.id === txId);
    if (idx >= 0) { fresh.data[idx].category = cat; fresh.data[idx].note = note; fresh.data[idx].labeled = true; }
    await ghPutFile('data/transactions.json', fresh.data, fresh.sha, `label: ${txId}`);
    STATE.transactions = fresh.data;
    modal.style.display = 'none';
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
    const fresh = await ghGetFile('data/transactions.json');
    const newList = fresh.data.filter(t => t.id !== txId);
    await ghPutFile('data/transactions.json', newList, fresh.sha, `delete: ${txId}`);
    STATE.transactions = newList;
    modal.style.display = 'none';
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
  const fresh = await ghGetFile('data/push_subscriptions.json');
  if (!fresh.data.some(s => s.endpoint === subJson.endpoint)) {
    fresh.data.push(subJson);
    await ghPutFile('data/push_subscriptions.json', fresh.data, fresh.sha, 'add push subscription');
  }
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
function renderBudgetInputs() {
  $('#budget-overall-input').value = STATE.budgets.overall_monthly || '';
  const wrap = $('#budget-by-category');
  wrap.innerHTML = '';
  STATE.categories.filter(c => c !== 'Thu nhập').forEach(cat => {
    const row = document.createElement('div');
    row.className = 'budget-row';
    row.innerHTML = `<span>${iconFor(cat)} ${cat}</span><input type="number" data-cat="${cat}" placeholder="0" value="${STATE.budgets.by_category?.[cat] || ''}">`;
    wrap.appendChild(row);
  });
}
async function saveBudgets() {
  const overall = parseFloat($('#budget-overall-input').value) || null;
  const byCat = {};
  $$('#budget-by-category input').forEach(inp => { const v = parseFloat(inp.value); if (v > 0) byCat[inp.dataset.cat] = v; });
  const newBudgets = { overall_monthly: overall, by_category: byCat };
  $('#save-budget-btn').disabled = true;
  try {
    const fresh = await ghGetFile('data/budgets.json').catch(() => ({ data: null, sha: null }));
    await ghPutFile('data/budgets.json', newBudgets, fresh.sha, 'update budgets');
    STATE.budgets = newBudgets;
    renderAll();
    alert('Đã lưu ngân sách');
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
    const fresh = await ghGetFile('data/categories.json');
    fresh.data.push(name);
    await ghPutFile('data/categories.json', fresh.data, fresh.sha, `add category: ${name}`);
    STATE.categories = fresh.data;
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
    const fresh = await ghGetFile('data/categories.json');
    const newList = fresh.data.filter(c => c !== cat);
    await ghPutFile('data/categories.json', newList, fresh.sha, `remove category: ${cat}`);
    STATE.categories = newList;
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
    row.innerHTML = `
      <div><div class="sub-name">${iconFor(s.category)} ${s.name}</div><div class="sub-meta">${s.category}</div></div>
      <div style="display:flex; align-items:center;"><span class="sub-amount">${fmtMoney(s.amount)}</span><button class="sub-remove" data-id="${s.id}">✕</button></div>`;
    row.querySelector('.sub-remove').addEventListener('click', () => removeSubscription(s.id));
    wrap.appendChild(row);
  });
}
async function addSubscription() {
  const name = $('#sub-name-input').value.trim();
  const amount = parseFloat($('#sub-amount-input').value);
  const category = $('#sub-category-input').value;
  if (!name || !amount) { alert('Nhập đủ tên và số tiền'); return; }
  $('#add-sub-btn').disabled = true;
  try {
    const fresh = await ghGetFile('data/subscriptions.json').catch(() => ({ data: [], sha: null }));
    fresh.data.push({ id: 'sub_' + Date.now(), name, amount, category });
    await ghPutFile('data/subscriptions.json', fresh.data, fresh.sha, `add subscription: ${name}`);
    STATE.subscriptions = fresh.data;
    $('#sub-name-input').value = ''; $('#sub-amount-input').value = '';
    renderSubsList();
    renderSubsSummary();
  } catch (e) { alert('Thêm thất bại: ' + e.message); }
  finally { $('#add-sub-btn').disabled = false; }
}
async function removeSubscription(id) {
  if (!confirm('Xoá khoản cố định này?')) return;
  try {
    const fresh = await ghGetFile('data/subscriptions.json');
    const newList = fresh.data.filter(s => s.id !== id);
    await ghPutFile('data/subscriptions.json', newList, fresh.sha, `remove subscription: ${id}`);
    STATE.subscriptions = newList;
    renderSubsList();
    renderSubsSummary();
  } catch (e) { alert('Xoá thất bại: ' + e.message); }
}
$('#add-sub-btn').addEventListener('click', addSubscription);

// ---------- INIT ----------
async function init() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  if (!getToken()) {
    $('#token-modal').style.display = 'flex';
    $('#save-token-btn').addEventListener('click', () => {
      const t = $('#token-input').value.trim();
      if (!t) return;
      setToken(t);
      $('#token-modal').style.display = 'none';
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
  } catch (e) {
    alert('Lỗi tải dữ liệu: ' + e.message + '\nKiểm tra lại token trong Cài đặt.');
  }
}

$('#save-label-btn').addEventListener('click', saveLabel);
$('#delete-tx-btn').addEventListener('click', deleteTx);
$('#close-label-btn').addEventListener('click', () => { $('#label-modal').style.display = 'none'; });
$('#enable-push-btn').addEventListener('click', enablePush);
$('#refresh-btn').addEventListener('click', boot);
$('#filter-category').addEventListener('change', (e) => { STATE.filterCategory = e.target.value; renderTxList(monthKeyFromDate(STATE.currentMonthDate)); });
$('#sort-select').addEventListener('change', (e) => { STATE.sort = e.target.value; renderTxList(monthKeyFromDate(STATE.currentMonthDate)); });

init();
