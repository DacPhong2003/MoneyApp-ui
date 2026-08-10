const GH_OWNER = 'DacPhong2003';
const DATA_REPO = 'MoneyApp';
const BRANCH = 'main';
const VAPID_PUBLIC_KEY = 'BAgPDNc7vCbUcO5yebFZGvyO6d6UKIp4gHpCtjmte1PsvY19aJXHjQ0iC6HCNy_wDK5lA7GPscU9xJ6VC-iPxY4';

const $ = (sel) => document.querySelector(sel);

function b64EncodeUnicode(str) {
  return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (m, p1) => String.fromCharCode('0x' + p1)));
}
function b64DecodeUnicode(str) {
  return decodeURIComponent(atob(str).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
}

function getToken() {
  return localStorage.getItem('gh_token') || '';
}
function setToken(t) {
  localStorage.setItem('gh_token', t);
}

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
  const body = {
    message,
    content: b64EncodeUnicode(JSON.stringify(dataObj, null, 2)),
    branch: BRANCH
  };
  if (sha) body.sha = sha;
  const res = await fetch(`https://api.github.com/repos/${GH_OWNER}/${DATA_REPO}/contents/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `token ${getToken()}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`PUT ${path} that bai: ${res.status} ${t}`);
  }
  return res.json();
}

function fmtMoney(n) {
  return Number(n || 0).toLocaleString('vi-VN') + 'đ';
}

function monthKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

let STATE = { transactions: [], txSha: null, categories: [] };

async function loadAll() {
  const [tx, cats] = await Promise.all([
    ghGetFile('data/transactions.json'),
    ghGetFile('data/categories.json')
  ]);
  STATE.transactions = tx.data;
  STATE.txSha = tx.sha;
  STATE.categories = cats.data;
}

function render() {
  const unlabeled = STATE.transactions.filter(t => !t.labeled);
  const banner = $('#unlabeled-banner');
  if (unlabeled.length > 0) {
    banner.style.display = 'block';
    banner.textContent = `${unlabeled.length} giao dich chua gan nhan - bam de xu ly`;
  } else {
    banner.style.display = 'none';
  }

  const now = new Date();
  const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const thisMonthTx = STATE.transactions.filter(t => monthKey(t.thoi_gian_giao_dich) === curMonth);
  const chi = thisMonthTx.filter(t => t.chieu !== 'thu').reduce((s, t) => s + Number(t.so_tien || 0), 0);
  const thu = thisMonthTx.filter(t => t.chieu === 'thu').reduce((s, t) => s + Number(t.so_tien || 0), 0);
  $('#summary-chi').textContent = fmtMoney(chi);
  $('#summary-thu').textContent = fmtMoney(thu);
  $('#summary-month').textContent = curMonth;

  const byCat = {};
  thisMonthTx.filter(t => t.chieu !== 'thu').forEach(t => {
    const c = t.category || 'Chua phan loai';
    byCat[c] = (byCat[c] || 0) + Number(t.so_tien || 0);
  });
  const catList = $('#category-breakdown');
  catList.innerHTML = '';
  Object.entries(byCat).sort((a, b) => b[1] - a[1]).forEach(([cat, amt]) => {
    const row = document.createElement('div');
    row.className = 'cat-row';
    row.innerHTML = `<span>${cat}</span><span>${fmtMoney(amt)}</span>`;
    catList.appendChild(row);
  });

  const list = $('#tx-list');
  list.innerHTML = '';
  const sorted = [...STATE.transactions].sort((a, b) => new Date(b.thoi_gian_giao_dich) - new Date(a.thoi_gian_giao_dich));
  sorted.forEach(t => {
    const item = document.createElement('div');
    item.className = 'tx-item' + (t.labeled ? '' : ' tx-unlabeled');
    item.innerHTML = `
      <div class="tx-main">
        <div class="tx-partner">${t.doi_tac || 'Khong ro'}</div>
        <div class="tx-note">${t.noi_dung || ''}</div>
      </div>
      <div class="tx-side">
        <div class="tx-amount ${t.chieu === 'thu' ? 'amount-in' : 'amount-out'}">${t.chieu === 'thu' ? '+' : '-'}${fmtMoney(t.so_tien)}</div>
        <div class="tx-cat">${t.category || 'Bam de gan nhan'}</div>
      </div>
    `;
    item.addEventListener('click', () => openLabelModal(t));
    list.appendChild(item);
  });
}

function openLabelModal(tx) {
  const modal = $('#label-modal');
  const chips = $('#category-chips');
  chips.innerHTML = '';
  STATE.categories.forEach(cat => {
    const chip = document.createElement('button');
    chip.className = 'chip' + (tx.category === cat ? ' chip-selected' : '');
    chip.textContent = cat;
    chip.addEventListener('click', () => {
      document.querySelectorAll('.chip').forEach(c => c.classList.remove('chip-selected'));
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
  if (!cat) { alert('Chon 1 danh muc'); return; }

  $('#save-label-btn').disabled = true;
  try {
    const fresh = await ghGetFile('data/transactions.json');
    const idx = fresh.data.findIndex(t => t.id === txId);
    if (idx >= 0) {
      fresh.data[idx].category = cat;
      fresh.data[idx].note = note;
      fresh.data[idx].labeled = true;
    }
    await ghPutFile('data/transactions.json', fresh.data, fresh.sha, `label: ${txId}`);
    STATE.transactions = fresh.data;
    modal.style.display = 'none';
    render();
  } catch (e) {
    alert('Luu that bai: ' + e.message);
  } finally {
    $('#save-label-btn').disabled = false;
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    alert('Trinh duyet khong ho tro push. Tren iPhone: phai add app ra Home Screen truoc, mo tu icon do, khong mo qua Safari thuong.');
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { alert('Ban chua cho phep thong bao'); return; }

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });
  }
  const subJson = sub.toJSON();

  const fresh = await ghGetFile('data/push_subscriptions.json');
  const exists = fresh.data.some(s => s.endpoint === subJson.endpoint);
  if (!exists) {
    fresh.data.push(subJson);
    await ghPutFile('data/push_subscriptions.json', fresh.data, fresh.sha, 'add push subscription');
  }
  $('#push-status').textContent = 'Da bat thong bao tren thiet bi nay';
}

async function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

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
    render();
  } catch (e) {
    alert('Loi tai du lieu: ' + e.message + '\nKiem tra lai token trong Cai dat.');
  }
}

$('#save-label-btn').addEventListener('click', saveLabel);
$('#close-label-btn').addEventListener('click', () => { $('#label-modal').style.display = 'none'; });
$('#enable-push-btn').addEventListener('click', enablePush);
$('#refresh-btn').addEventListener('click', boot);
$('#settings-btn').addEventListener('click', () => {
  $('#token-input').value = getToken();
  $('#token-modal').style.display = 'flex';
});

init();
