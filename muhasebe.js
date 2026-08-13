(function () {
  // --- Supabase Config ---
  const SUPABASE_URL = 'https://ujlqrxqpdupzjpqgmoms.supabase.co/rest/v1/';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVqbHFyeHFwZHVwempwcWdtb21zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0MTUxNjcsImV4cCI6MjEwMDk5MTE2N30.ry_7rA4apirfjsaTnRvk8D6mSxdS5vrVHVEpozOnhOU';

  let supabase = null;
  let useSupabase = false;
  if (SUPABASE_URL && !SUPABASE_URL.includes('YOUR_SUPABASE_URL') && SUPABASE_ANON_KEY && !SUPABASE_ANON_KEY.includes('YOUR_SUPABASE_ANON_KEY') && window.supabase) {
    const cleanUrl = SUPABASE_URL.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '').trim();
    supabase = window.supabase.createClient(cleanUrl, SUPABASE_ANON_KEY);
    useSupabase = true;
  }

  const STORAGE_KEY_ACCOUNTING = 'mimari-muhasebe-kayitlari';
  const STORAGE_KEY_CARI_ACCOUNTS = 'mimari-cari-hesaplar';
  const STORAGE_KEY_CARI_TRANSACTIONS = 'mimari-cari-hareketler';
  const STORAGE_KEY_INVOICES = 'mimari-faturalar';
  const STORAGE_KEY_EXCHANGE_DIFF = 'mimari-kur-farki-kayitlari';
  const STORAGE_KEY_PURCHASE = 'mimari-satinalma-talepleri';
  const STORAGE_KEY_PURCHASE_LOGS = 'mimari-satinalma-islem-gecmisi';

  let currentUser = null;
  let accountingRecords = [];
  let cariAccounts = [];
  let cariTransactions = [];
  let invoices = [];
  let exchangeDiffRecords = [];
  let purchaseRequests = [];
  let purchaseLogs = [];
  let totalBudget = 500000.00;
  let activeReviewRequestId = null;
  let currentFaturaSubpage = '';
  let attachedContractFile = null;

  // TCMB default rates
  let liveRates = {
    USD: { buying: 34.2500, selling: 34.3500 },
    EUR: { buying: 37.5200, selling: 37.6400 },
    GBP: { buying: 43.8500, selling: 43.9900 }
  };

  const $ = (id) => document.getElementById(id);
  const toast = $('toast');

  function showToast(msg, isErr) {
    toast.textContent = msg;
    toast.className = 'toast show' + (isErr ? ' err' : '');
    setTimeout(() => toast.className = 'toast', 2200);
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}.${m}.${y}`;
  }

  function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function toTitleCase(str) {
    return str.split(' ').map(word => {
      if (!word) return '';
      let first = word.charAt(0);
      if (first === 'i' || first === 'İ') first = 'İ';
      else if (first === 'ı' || first === 'I') first = 'I';
      else first = first.toUpperCase();

      let rest = word.slice(1).replace(/I/g, 'ı').replace(/İ/g, 'i').toLowerCase();
      return first + rest;
    }).join(' ');
  }

  function todayISO() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }

  function storageAvailable() {
    try {
      return typeof window !== 'undefined' && (
        (!!window.storage && typeof window.storage.get === 'function' && typeof window.storage.set === 'function')
        || (!!window.localStorage && typeof window.localStorage.getItem === 'function')
      );
    } catch (e) {
      return false;
    }
  }

  async function getStorageItem(key) {
    try {
      if (window.storage && typeof window.storage.get === 'function') {
        const res = await window.storage.get(key, true);
        return res && res.value ? res.value : null;
      }
      if (window.localStorage) {
        return window.localStorage.getItem(key);
      }
    } catch (e) {
      console.warn("Storage read error:", e);
    }
    return null;
  }

  async function setStorageItem(key, value) {
    try {
      if (window.storage && typeof window.storage.set === 'function') {
        return await window.storage.set(key, value, true);
      }
      if (window.localStorage) {
        window.localStorage.setItem(key, value);
        return true;
      }
    } catch (e) {
      console.warn("Storage write error:", e);
    }
    return false;
  }

  // --- Session Validator ---
  function checkSession() {
    const stored = sessionStorage.getItem('mimari-session');
    if (stored) {
      try {
        const u = JSON.parse(stored);
        const isAccountant = u && (u.role === 'MUHASEBE' || u.role === 'MUHASEBECİ' || u.role === 'admin' || u.role === 'YÖNETİM');
        if (isAccountant) {
          currentUser = u;
          $('lblCurrentMuhasebeUser').textContent = `${currentUser.username} (${currentUser.role})`;
          return;
        }
      } catch (e) { }
    }
    // Redirect to login page if no valid session
    window.location.href = 'index.html';
  }

  function handleLogout() {
    sessionStorage.removeItem('mimari-session');
    window.location.href = 'index.html';
  }

  window.downloadDraftFileCustom = async function (e, url, originalName) {
    e.preventDefault();
    e.stopPropagation();
    let customName = originalName.replace(/\.[^/.]+$/, "");
    customName = toTitleCase(customName) + ' Belge';
    customName = customName.replace(/[\\/:*?"<>|]/g, '_');

    showToast('Dosya indiriliyor...');
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP error ' + res.status);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = customName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      showToast('Dosya indirildi.');
    } catch (err) {
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.download = customName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  async function uploadProjectFile(fileObj) {
    if (!fileObj.fileRaw) return fileObj.data;
    try {
      const fileExt = fileObj.name.split('.').pop();
      const cleanName = fileObj.name.replace(/[^a-zA-Z0-9]/g, '_');
      const path = `${Date.now()}_${cleanName}.${fileExt}`;
      const { data, error } = await supabase.storage
        .from('drawings')
        .upload(path, fileObj.fileRaw, { cacheControl: '3600', upsert: true });
      if (error) throw error;
      const { data: urlData } = supabase.storage.from('drawings').getPublicUrl(path);
      return urlData.publicUrl;
    } catch (e) {
      console.error("Supabase File Upload Error:", e);
      throw new Error("Dosya yüklenemedi: " + e.message);
    }
  }

  // ---- TABS ----
  function switchMuhasebeTab(name) {
    document.querySelectorAll('[data-muhasebe-tab]').forEach(t => {
      t.classList.toggle('active', t.getAttribute('data-muhasebe-tab') === name);
    });
    $('panel-contracts').classList.toggle('hidden', name !== 'contracts');
    $('panel-drivers').classList.toggle('hidden', name !== 'drivers');
    $('panel-customers').classList.toggle('hidden', name !== 'customers');
    $('panel-cari').classList.toggle('hidden', name !== 'cari');
    $('panel-fatura').classList.toggle('hidden', name !== 'fatura');
    $('panel-doviz').classList.toggle('hidden', name !== 'doviz');
    $('panel-satinalma').classList.toggle('hidden', name !== 'satinalma');
    if (name === 'cari') {
      switchCariSubtab('cari-dashboard');
      loadCariData();
    } else if (name === 'fatura') {
      loadFaturaData();
    } else if (name === 'doviz') {
      loadDovizData();
    } else if (name === 'satinalma') {
      loadSatinalmaData();
    }
  }

  // ---- CARİ LOGIC ----
  function switchCariSubtab(name) {
    document.querySelectorAll('[data-cari-subtab]').forEach(t => {
      t.classList.toggle('active', t.getAttribute('data-cari-subtab') === name);
    });
    $('subpanel-cari-dashboard').classList.toggle('hidden', name !== 'cari-dashboard');
    $('subpanel-cari-kartlar').classList.toggle('hidden', name !== 'cari-kartlar');
    $('subpanel-cari-hareketler').classList.toggle('hidden', name !== 'cari-hareketler');
    $('subpanel-cari-islemler').classList.toggle('hidden', name !== 'cari-islemler');

    if (name === 'cari-dashboard') {
      renderCariDashboard();
    } else if (name === 'cari-kartlar') {
      renderCariList();
    } else if (name === 'cari-hareketler') {
      populateCariDropdowns();
      filterCariLedger();
    } else if (name === 'cari-islemler') {
      populateCariDropdowns();
      const today = todayISO();
      $('inpTahsilatDate').value = today;
      $('inpOdemeDate').value = today;
    }
  }

  async function loadCariData() {
    if (useSupabase) {
      try {
        const { data: accounts, error: err1 } = await supabase.from('cari_accounts').select('*').order('code', { ascending: true });
        const { data: txs, error: err2 } = await supabase.from('cari_transactions').select('*').order('date', { ascending: true });
        if (err1 || err2) throw (err1 || err2);

        cariAccounts = accounts || [];
        cariTransactions = txs || [];
        $('muhasebeStorageWarning').textContent = '🟢 Supabase veritabanı aktif ve bağlandı. Muhasebe ve Cari kayıtlarınız bulutta güvenle saklanıyor.';
      } catch (e) {
        console.warn("Supabase Cari tables fallback.", e);
        await loadCariDataFromLocalStorage();
      }
    } else {
      await loadCariDataFromLocalStorage();
    }
    renderCariDashboard();
  }

  async function loadCariDataFromLocalStorage() {
    try {
      const val1 = await getStorageItem(STORAGE_KEY_CARI_ACCOUNTS);
      const val2 = await getStorageItem(STORAGE_KEY_CARI_TRANSACTIONS);
      cariAccounts = val1 ? JSON.parse(val1) : [];
      cariTransactions = val2 ? JSON.parse(val2) : [];
    } catch (e) {
      cariAccounts = [];
      cariTransactions = [];
    }
  }

  async function saveCariAccountsState() {
    try {
      await setStorageItem(STORAGE_KEY_CARI_ACCOUNTS, JSON.stringify(cariAccounts));
    } catch (e) { }
  }

  async function saveCariTransactionsState() {
    try {
      await setStorageItem(STORAGE_KEY_CARI_TRANSACTIONS, JSON.stringify(cariTransactions));
    } catch (e) { }
  }

  function suggestNextCariCode(type) {
    const prefix = type === 'MÜŞTERİ' ? 'M' : 'T';
    let maxNum = 0;
    cariAccounts.forEach(c => {
      const regex = new RegExp(`^${prefix}-(\\d{5})$`);
      const match = regex.exec(c.code);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    });
    return `${prefix}-${String(maxNum + 1).padStart(5, '0')}`;
  }

  function calculateCariBalance(cariId) {
    let balance = 0;
    cariTransactions.filter(t => t.cari_id === cariId).forEach(t => {
      const amt = parseFloat(t.amount || 0);
      if (t.type === 'BORÇ' || t.type === 'ÖDEME') {
        balance += amt;
      } else if (t.type === 'ALACAK' || t.type === 'TAHSİLAT') {
        balance -= amt;
      }
    });
    return balance;
  }

  function renderCariList() {
    const tbody = $('cariListTable');
    if (!tbody) return;

    const q = ($('inpCariSearch').value || '').trim().toLowerCase();
    const filtered = cariAccounts.filter(c => {
      if (!q) return true;
      return (c.name || '').toLowerCase().includes(q) ||
             (c.code || '').toLowerCase().includes(q) ||
             (c.tax_no || '').includes(q) ||
             (c.phone || '').includes(q);
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:30px; color:var(--ink-soft);">Aradığınız kriterlere uygun cari hesap bulunamadı.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(c => {
      const bal = calculateCariBalance(c.id);
      const balStr = bal.toFixed(2) + ' TL';
      const balColor = bal > 0 ? 'var(--success)' : (bal < 0 ? 'var(--accent-dark)' : 'var(--ink)');
      
      const typeBadge = c.type === 'MÜŞTERİ' 
        ? `<span class="badge-status musteri">Müşteri</span>` 
        : (c.type === 'TEDARİKÇİ' ? `<span class="badge-status tedarikci">Tedarikçi</span>` : `<span class="badge-status her-ikisi">Müşteri/Tedarikçi</span>`);
      
      const statusBadge = c.status === 'AKTİF' 
        ? `<span class="badge-status aktif">Aktif</span>` 
        : `<span class="badge-status pasif">Pasif</span>`;

      return `<tr>
        <td style="font-family:monospace; font-weight:bold;">${esc(c.code)}</td>
        <td style="font-weight:700;">${esc(c.name)}</td>
        <td>${typeBadge}</td>
        <td>${esc(c.phone || '—')}</td>
        <td>${esc(c.tax_no || '—')}</td>
        <td style="text-align:right; font-weight:bold; color:${balColor};">${balStr}</td>
        <td>${statusBadge}</td>
        <td style="text-align:center;">
          <button class="btn-submit" style="padding:4px 8px; font-size:11px; margin:0; width:auto; height:auto;" onclick="selectCariForLedger('${c.id}')">Ekstre 📊</button>
          <button class="personnel-del" style="float:none; margin-left:6px;" onclick="deleteCariCard('${c.id}')">✕</button>
        </td>
      </tr>`;
    }).join('');
  }

  async function deleteCariCard(id) {
    if (!confirm('Bu cari hesabı ve tüm hareket geçmişini silmek istediğinize emin misiniz?')) return;
    if (useSupabase) {
      try {
        await supabase.from('cari_transactions').delete().eq('cari_id', id);
        await supabase.from('cari_accounts').delete().eq('id', id);
      } catch (e) { }
    }
    cariAccounts = cariAccounts.filter(c => c.id !== id);
    cariTransactions = cariTransactions.filter(t => t.cari_id !== id);
    await saveCariAccountsState();
    await saveCariTransactionsState();
    showToast('Cari hesap silindi.');
    renderCariList();
    renderCariDashboard();
  }

  function populateCariDropdowns() {
    const list = cariAccounts.filter(c => c.status === 'AKTİF');
    const options = list.map(c => `<option value="${c.id}">${esc(c.code)} - ${esc(c.name)}</option>`).join('');
    const emptyOpt = '<option value="">— Cari Seçin —</option>';
    
    $('selCariFilter').innerHTML = emptyOpt + options;
    $('selCariTahsilat').innerHTML = emptyOpt + options;
    $('selCariOdeme').innerHTML = emptyOpt + options;
  }

  function filterCariLedger() {
    const cariId = $('selCariFilter').value;
    const body = $('ekstreLedgerBody');
    if (!body) return;

    if (!cariId) {
      $('ekstreTitleName').textContent = 'Lütfen Cari Seçin';
      $('ekstreTitleDetails').textContent = 'Kod: — · VKN: — · Tel: —';
      $('ekstreDateRange').textContent = 'Tarih Aralığı: —';
      body.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:30px; color:var(--ink-soft);">Lütfen hareketlerini görmek istediğiniz cari hesabı seçin.</td></tr>`;
      $('lblEkstreOpeningBalance').textContent = '0.00 TL';
      $('lblEkstrePeriodDebt').textContent = '0.00 TL';
      $('lblEkstrePeriodCredit').textContent = '0.00 TL';
      $('lblEkstreTotalBalance').textContent = '0.00 TL';
      return;
    }

    const cari = cariAccounts.find(c => c.id === cariId);
    if (!cari) return;

    $('ekstreTitleName').textContent = cari.name;
    $('ekstreTitleDetails').textContent = `Kod: ${cari.code} · VKN: ${cari.tax_no || '—'} · Tel: ${cari.phone || '—'} · Yetkili: ${cari.authorized || '—'}`;

    const startDateVal = $('inpCariFilterStart').value;
    const endDateVal = $('inpCariFilterEnd').value;

    let dateRangeStr = 'Tüm Hareketler';
    if (startDateVal && endDateVal) {
      dateRangeStr = `${fmtDate(startDateVal)} - ${fmtDate(endDateVal)}`;
    } else if (startDateVal) {
      dateRangeStr = `${fmtDate(startDateVal)} sonrasındaki hareketler`;
    } else if (endDateVal) {
      dateRangeStr = `${fmtDate(endDateVal)} öncesindeki hareketler`;
    }
    $('ekstreDateRange').textContent = dateRangeStr;

    const txs = cariTransactions.filter(t => t.cari_id === cariId).sort((a, b) => a.date.localeCompare(b.date));

    let openingBalance = 0;
    let periodDebt = 0;
    let periodCredit = 0;
    let runningBalance = 0;

    const filteredTxs = [];

    txs.forEach(t => {
      const amt = parseFloat(t.amount || 0);
      const isBeforeStart = startDateVal && t.date < startDateVal;
      const isAfterEnd = endDateVal && t.date > endDateVal;

      if (isBeforeStart) {
        if (t.type === 'BORÇ' || t.type === 'ÖDEME') openingBalance += amt;
        else if (t.type === 'ALACAK' || t.type === 'TAHSİLAT') openingBalance -= amt;
      } else if (!isAfterEnd) {
        filteredTxs.push(t);
      }
    });

    runningBalance = openingBalance;
    $('lblEkstreOpeningBalance').textContent = openingBalance.toFixed(2) + ' TL';

    if (filteredTxs.length === 0) {
      body.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:20px; color:var(--ink-soft);">Belirtilen tarih aralığında hareket bulunmamaktadır.</td></tr>`;
    } else {
      body.innerHTML = filteredTxs.map(t => {
        const amt = parseFloat(t.amount || 0);
        let borc = '—';
        let alacak = '—';
        
        if (t.type === 'BORÇ' || t.type === 'ÖDEME') {
          borc = amt.toFixed(2) + ' TL';
          runningBalance += amt;
          periodDebt += amt;
        } else {
          alacak = amt.toFixed(2) + ' TL';
          runningBalance -= amt;
          periodCredit += amt;
        }

        return `<tr>
          <td>${fmtDate(t.date)}</td>
          <td style="font-weight:bold;">${esc(t.type)}</td>
          <td>${esc(t.ref_no || '—')}</td>
          <td>${esc(t.notes || '—')}</td>
          <td style="text-align:right; color:var(--accent-dark);">${borc}</td>
          <td style="text-align:right; color:#2ecc71;">${alacak}</td>
          <td style="text-align:right; font-weight:bold; color:${runningBalance > 0 ? 'var(--success)' : (runningBalance < 0 ? 'var(--accent-dark)' : 'var(--ink)')};">${runningBalance.toFixed(2)} TL</td>
          <td style="text-align:center;" class="no-print">
            <button class="personnel-del" style="float:none;" onclick="deleteCariTransaction('${t.id}')">✕</button>
          </td>
        </tr>`;
      }).join('');
    }

    $('lblEkstrePeriodDebt').textContent = periodDebt.toFixed(2) + ' TL';
    $('lblEkstrePeriodCredit').textContent = periodCredit.toFixed(2) + ' TL';
    $('lblEkstreTotalBalance').textContent = runningBalance.toFixed(2) + ' TL';
  }

  async function deleteCariTransaction(id) {
    if (!confirm('Bu finansal işlemi silmek istediğinize emin misiniz? Bakiye yeniden hesaplanacaktır.')) return;
    if (useSupabase) {
      try {
        await supabase.from('cari_transactions').delete().eq('id', id);
      } catch (e) { }
    }
    cariTransactions = cariTransactions.filter(t => t.id !== id);
    await saveCariTransactionsState();
    showToast('İşlem silindi.');
    filterCariLedger();
    renderCariDashboard();
  }

  function renderCariDashboard() {
    const grid = $('cariStatsGrid');
    if (!grid) return;

    const totalCaris = cariAccounts.length;
    const customers = cariAccounts.filter(c => c.type === 'MÜŞTERİ' || c.type === 'HER_İKİSİ').length;
    const suppliers = cariAccounts.filter(c => c.type === 'TEDARİKÇİ' || c.type === 'HER_İKİSİ').length;

    let totalReceivables = 0; 
    let totalDebt = 0;        

    const cariBalances = cariAccounts.map(c => {
      const bal = calculateCariBalance(c.id);
      if (bal > 0) totalReceivables += bal;
      else if (bal < 0) totalDebt += Math.abs(bal);
      return { id: c.id, name: c.name, balance: bal };
    });

    grid.innerHTML = `
      <div class="stat-card">
        <h4>Toplam Cari Kart</h4>
        <div class="val">${totalCaris}</div>
      </div>
      <div class="stat-card">
        <h4>Toplam Müşteri</h4>
        <div class="val" style="color:var(--success);">${customers}</div>
      </div>
      <div class="stat-card">
        <h4>Toplam Tedarikçi</h4>
        <div class="val" style="color:var(--accent-dark);">${suppliers}</div>
      </div>
      <div class="stat-card">
        <h4>Toplam Alacağımız (Müşteri)</h4>
        <div class="val" style="color:var(--success);">${totalReceivables.toFixed(2)} TL</div>
      </div>
      <div class="stat-card">
        <h4>Toplam Borcumuz (Tedarikçi)</h4>
        <div class="val" style="color:var(--accent-dark);">${totalDebt.toFixed(2)} TL</div>
      </div>
    `;

    const creditors = [...cariBalances].filter(c => c.balance > 0).sort((a, b) => b.balance - a.balance).slice(0, 5);
    const debtors = [...cariBalances].filter(c => c.balance < 0).sort((a, b) => a.balance - b.balance).slice(0, 5);

    $('tblTopCreditors').innerHTML = creditors.length === 0
      ? `<tr><td style="color:var(--ink-soft); text-align:center; padding:10px;">Alacak kaydı bulunmuyor.</td></tr>`
      : creditors.map(c => `<tr><td style="padding:6px 4px; font-weight:700;">${esc(c.name)}</td><td style="padding:6px 4px; text-align:right; font-weight:bold; color:var(--success);">${c.balance.toFixed(2)} TL</td></tr>`).join('');

    $('tblTopDebtors').innerHTML = debtors.length === 0
      ? `<tr><td style="color:var(--ink-soft); text-align:center; padding:10px;">Borç kaydı bulunmuyor.</td></tr>`
      : debtors.map(c => `<tr><td style="padding:6px 4px; font-weight:700;">${esc(c.name)}</td><td style="padding:6px 4px; text-align:right; font-weight:bold; color:var(--accent-dark);">${Math.abs(c.balance).toFixed(2)} TL</td></tr>`).join('');
  }

  window.selectCariForLedger = function(id) {
    switchCariSubtab('cari-hareketler');
    $('selCariFilter').value = id;
    filterCariLedger();
  };

  window.deleteCariTransaction = deleteCariTransaction;
  window.deleteCariCard = deleteCariCard;

  // ---- MUHASEBE PORTAL DOCS ----
  async function loadAccountingRecords() {
    if (useSupabase) {
      try {
        const { data, error } = await supabase.from('accounting_records').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        accountingRecords = (data || []).map(r => ({
          id: r.id,
          createdAt: r.created_at,
          type: r.type,
          data: typeof r.data === 'string' ? JSON.parse(r.data) : r.data,
          uploadedBy: r.uploaded_by
        }));
        $('muhasebeStorageWarning').textContent = '🟢 Supabase veritabanı aktif ve bağlandı. Muhasebe kayıtlarınız bulutta güvenle saklanıyor.';
        $('muhasebeStorageWarning').classList.remove('hidden');
      } catch (e) {
        console.warn("accounting_records table fallback. Using localStorage.", e);
        await loadAccountingFromLocalStorage();
      }
    } else {
      $('muhasebeStorageWarning').textContent = 'ℹ Bilgiler bu tarayıcıya (Local Storage) kaydediliyor.';
      $('muhasebeStorageWarning').classList.remove('hidden');
      await loadAccountingFromLocalStorage();
    }
    renderAccounting();
  }

  async function loadAccountingFromLocalStorage() {
    try {
      const val = await getStorageItem(STORAGE_KEY_ACCOUNTING);
      accountingRecords = val ? JSON.parse(val) : [];
    } catch (e) {
      accountingRecords = [];
    }
  }

  async function saveAccountingRecord(record) {
    if (useSupabase) {
      try {
        const { error } = await supabase.from('accounting_records').insert({
          id: record.id,
          type: record.type,
          data: record.data,
          uploaded_by: record.uploadedBy,
          created_at: record.createdAt
        });
        if (!error) return true;
      } catch (e) {
        console.error(e);
      }
    }
    accountingRecords.push(record);
    await saveAccountingToLocalStorage();
    return true;
  }

  async function saveAccountingToLocalStorage() {
    try {
      await setStorageItem(STORAGE_KEY_ACCOUNTING, JSON.stringify(accountingRecords));
    } catch (e) {
      console.error(e);
    }
  }

  async function deleteAccountingRecord(id) {
    if (!confirm('Bu kaydı silmek istediğinize emin misiniz?')) return;
    let ok = false;
    if (useSupabase) {
      try {
        const { error } = await supabase.from('accounting_records').delete().eq('id', id);
        if (!error) ok = true;
      } catch (e) {
        console.error(e);
      }
    }
    accountingRecords = accountingRecords.filter(r => r.id !== id);
    await saveAccountingToLocalStorage();
    ok = true;

    if (ok) {
      showToast('Kayıt silindi.');
      renderAccounting();
    } else {
      showToast('Kayıt silinirken hata oluştu.', true);
    }
  }

  function renderAccounting() {
    const listContracts = $('contractsListTable');
    const listDrivers = $('driversListTable');
    const listCustomers = $('customersListTable');

    if (!listContracts || !listDrivers || !listCustomers) return;

    const contracts = accountingRecords.filter(r => r.type === 'contract');
    const drivers = accountingRecords.filter(r => r.type === 'driver');
    const customers = accountingRecords.filter(r => r.type === 'customer');

    if (contracts.length === 0) {
      listContracts.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--ink-soft); padding:30px;">Kayıtlı sözleşme bulunmamaktadır.</td></tr>`;
    } else {
      listContracts.innerHTML = contracts.map(c => {
        const dateStr = c.createdAt ? new Date(c.createdAt).toLocaleDateString('tr-TR') : '—';
        return `<tr>
          <td style="font-weight: bold;">${esc(c.data.title)}</td>
          <td>
            <a href="${c.data.fileUrl}" style="color:#1a73e8; font-weight:700; text-decoration:none;" onclick="downloadDraftFileCustom(event, '${esc(c.data.fileUrl)}', '${esc(c.data.fileName)}')">
              📁 ${esc(c.data.fileName)} (${formatBytes(c.data.fileSize)})
            </a>
          </td>
          <td>${esc(c.uploadedBy)}</td>
          <td>${dateStr}</td>
          <td style="text-align:center;">
            <button class="personnel-del" style="float:none;" onclick="deleteAccountingRecord('${c.id}')" title="Kayıt Sil">✕</button>
          </td>
        </tr>`;
      }).join('');
    }

    if (drivers.length === 0) {
      listDrivers.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--ink-soft); padding:30px;">Kayıtlı şoför bulunmamaktadır.</td></tr>`;
    } else {
      listDrivers.innerHTML = drivers.map(d => {
        return `<tr>
          <td style="font-weight: bold;">${esc(d.data.name)}</td>
          <td>${esc(d.data.phone)}</td>
          <td>${esc(d.data.plate)}</td>
          <td style="text-align:center;">
            <button class="personnel-del" style="float:none;" onclick="deleteAccountingRecord('${d.id}')" title="Kayıt Sil">✕</button>
          </td>
        </tr>`;
      }).join('');
    }

    if (customers.length === 0) {
      listCustomers.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--ink-soft); padding:30px;">Kayıtlı müşteri bulunmamaktadır.</td></tr>`;
    } else {
      listCustomers.innerHTML = customers.map(c => {
        return `<tr>
          <td style="font-weight: bold;">${esc(c.data.name)}</td>
          <td>${esc(c.data.phone)}</td>
          <td>${esc(c.data.address)}</td>
          <td style="text-align:center;">
            <button class="personnel-del" style="float:none;" onclick="deleteAccountingRecord('${c.id}')" title="Kayıt Sil">✕</button>
          </td>
        </tr>`;
      }).join('');
    }
  }

  async function handleAddContract() {
    const title = $('inpContractTitle').value.trim();
    if (!title) {
      showToast('Lütfen sözleşme başlığı girin.', true);
      return;
    }
    if (!attachedContractFile) {
      showToast('Lütfen bir sözleşme dosyası seçin.', true);
      return;
    }

    const btn = $('btnUploadContract');
    btn.disabled = true;
    btn.textContent = 'Kaydediliyor...';

    try {
      let fileUrl = null;
      if (attachedContractFile.fileRaw) {
        fileUrl = await uploadProjectFile(attachedContractFile);
      } else {
        fileUrl = attachedContractFile.data;
      }

      const record = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        type: 'contract',
        data: {
          title: title,
          fileName: attachedContractFile.name,
          fileSize: attachedContractFile.size,
          fileUrl: fileUrl
        },
        uploadedBy: currentUser ? (currentUser.personnelName || currentUser.username) : 'Anonim',
        createdAt: new Date().toISOString()
      };

      await saveAccountingRecord(record);
      await loadAccountingRecords();

      $('inpContractTitle').value = '';
      $('inpContractFile').value = '';
      attachedContractFile = null;
      $('contractFileStatus').textContent = '';
      $('btnRemoveContractFile').classList.add('hidden');
      showToast('Sözleşme başarıyla kaydedildi.');
    } catch (e) {
      console.error(e);
      showToast('Hata: ' + e.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sözleşmeyi Kaydet';
    }
  }

  async function handleAddDriver() {
    const name = $('inpDriverName').value.trim();
    const phone = $('inpDriverPhone').value.trim();
    const plate = $('inpDriverPlate').value.trim();

    if (!name || !phone || !plate) {
      showToast('Lütfen şoför bilgilerini eksiksiz doldurun.', true);
      return;
    }

    const record = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      type: 'driver',
      data: { name, phone, plate },
      uploadedBy: currentUser ? (currentUser.personnelName || currentUser.username) : 'Anonim',
      createdAt: new Date().toISOString()
    };

    await saveAccountingRecord(record);
    await loadAccountingRecords();

    $('inpDriverName').value = '';
    $('inpDriverPhone').value = '';
    $('inpDriverPlate').value = '';
    showToast('Şoför başarıyla kaydedildi.');
  }

  async function handleAddCustomer() {
    const name = $('inpCustomerNameAcc').value.trim();
    const phone = $('inpCustomerPhoneAcc').value.trim();
    const address = $('inpCustomerAddressAcc').value.trim();

    if (!name || !phone || !address) {
      showToast('Lütfen müşteri bilgilerini eksiksiz doldurun.', true);
      return;
    }

    const record = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      type: 'customer',
      data: { name, phone, address },
      uploadedBy: currentUser ? (currentUser.personnelName || currentUser.username) : 'Anonim',
      createdAt: new Date().toISOString()
    };

    await saveAccountingRecord(record);
    await loadAccountingRecords();

    $('inpCustomerNameAcc').value = '';
    $('inpCustomerPhoneAcc').value = '';
    $('inpCustomerAddressAcc').value = '';
    showToast('Müşteri başarıyla kaydedildi.');
  }

  window.deleteAccountingRecord = deleteAccountingRecord;

  // ---- FATURA LOGIC ----
  function initAccordion() {
    document.querySelectorAll('[data-fatura-acc]').forEach(btn => {
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);
      
      newBtn.addEventListener('click', () => {
        const group = newBtn.getAttribute('data-fatura-acc');
        const content = $('acc-content-' + group);
        const arrow = newBtn.querySelector('.acc-arrow');
        
        if (content.classList.contains('hidden')) {
          content.classList.remove('hidden');
          setTimeout(() => {
            content.classList.add('open');
            arrow.classList.add('rotated');
          }, 10);
        } else {
          content.classList.remove('open');
          arrow.classList.remove('rotated');
          setTimeout(() => {
            content.classList.add('hidden');
          }, 300);
        }
      });
    });

    document.querySelectorAll('[data-fatura-sub]').forEach(link => {
      const newLink = link.cloneNode(true);
      link.parentNode.replaceChild(newLink, link);
      
      newLink.addEventListener('click', (e) => {
        e.preventDefault();
        const sub = newLink.getAttribute('data-fatura-sub');
        switchFaturaSubpage(sub);
      });
    });
  }

  function switchFaturaSubpage(sub) {
    currentFaturaSubpage = sub;
    
    document.querySelectorAll('[data-fatura-sub]').forEach(l => {
      l.classList.toggle('text-white', l.getAttribute('data-fatura-sub') === sub);
      l.classList.toggle('bg-slate-800', l.getAttribute('data-fatura-sub') === sub);
      l.classList.toggle('text-slate-300', l.getAttribute('data-fatura-sub') !== sub);
    });

    let title = 'Fatura Listesi';
    let desc = '';
    let isSales = true;
    
    const subTitles = {
      'kesilen': ['Kesilen Satış Faturaları', 'Müşterilere kesilen onaylı satış faturaları listesi.', true],
      'bekleyen': ['Bekleyen Satış Faturaları', 'Onay veya tahsilat bekleyen faturalar.', true],
      'iptal': ['İptal Edilen Faturalar', 'İptal edilmiş satış faturaları.', true],
      'malzeme': ['Malzeme Alış Faturaları', 'Tedarikçilerden alınan malzeme faturaları.', false],
      'hizmet': ['Hizmet Alış Faturaları', 'Alınan danışmanlık, bakım vb. hizmet faturaları.', false],
      'nakliye': ['Nakliye Alış Faturaları', 'Lojistik ve sevkiyat gider faturaları.', false],
      'elektrik': ['Elektrik Alış Faturaları', 'İşletme elektrik tüketim faturaları.', false],
      'su': ['Su Alış Faturaları', 'İşletme su faturaları.', false],
      'dogalgaz': ['Doğalgaz Alış Faturaları', 'Isınma ve doğalgaz tüketim faturaları.', false]
    };

    if (subTitles[sub]) {
      title = subTitles[sub][0];
      desc = subTitles[sub][1];
      isSales = subTitles[sub][2];
    }

    $('faturaPageTitle').textContent = title;
    $('faturaPageDesc').textContent = desc;

    $('btnShowAddInvoiceForm').classList.remove('hidden');
    $('blockAddInvoiceForm').classList.add('hidden');

    const list = cariAccounts.filter(c => c.status === 'AKTİF');
    const filteredCaris = list.filter(c => {
      if (isSales) {
        return c.type === 'MÜŞTERİ' || c.type === 'HER_İKİSİ';
      } else {
        return c.type === 'TEDARİKÇİ' || c.type === 'HER_İKİSİ';
      }
    });

    $('selFaturaCari').innerHTML = '<option value="">— Cari Seçin —</option>' + 
      filteredCaris.map(c => `<option value="${c.id}">${esc(c.code)} - ${esc(c.name)}</option>`).join('');

    renderInvoices();
  }

  async function loadFaturaData() {
    if (cariAccounts.length === 0) {
      await loadCariData();
    }
    
    if (useSupabase) {
      try {
        const { data, error } = await supabase.from('invoices').select('*').order('date', { ascending: false });
        if (error) throw error;
        invoices = (data || []).map(i => ({
          id: i.id,
          cariId: i.cari_id,
          category: i.category,
          date: i.date,
          amount: parseFloat(i.amount || 0),
          invoiceNo: i.invoice_no,
          notes: i.notes,
          createdAt: i.created_at
        }));
      } catch (e) {
        console.warn("Supabase Invoices table fallback.", e);
        await loadFaturaFromLocalStorage();
      }
    } else {
      await loadFaturaFromLocalStorage();
    }

    initAccordion();
    if (!currentFaturaSubpage) {
      switchFaturaSubpage('kesilen');
      const satisContent = $('acc-content-satis');
      satisContent.classList.remove('hidden');
      satisContent.classList.add('open');
      document.querySelector('[data-fatura-acc="satis"] .acc-arrow').classList.add('rotated');
    } else {
      renderInvoices();
    }
  }

  async function loadFaturaFromLocalStorage() {
    try {
      const val = await getStorageItem(STORAGE_KEY_INVOICES);
      invoices = val ? JSON.parse(val) : [];
    } catch (e) {
      invoices = [];
    }
  }

  async function saveInvoice(inv) {
    if (useSupabase) {
      try {
        const { error } = await supabase.from('invoices').insert({
          id: inv.id,
          cari_id: inv.cariId,
          category: inv.category,
          date: inv.date,
          amount: inv.amount,
          invoice_no: inv.invoiceNo,
          notes: inv.notes,
          created_at: inv.createdAt
        });
        if (!error) return true;
      } catch (e) { }
    }
    invoices.push(inv);
    await saveFaturaToLocalStorage();
    return true;
  }

  async function saveFaturaToLocalStorage() {
    try {
      await setStorageItem(STORAGE_KEY_INVOICES, JSON.stringify(invoices));
    } catch (e) { }
  }

  function renderInvoices() {
    const tbody = $('tblInvoicesBody');
    if (!tbody) return;

    const list = invoices.filter(i => i.category === currentFaturaSubpage);
    
    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-slate-400">Bu kategoride kayıtlı fatura bulunmamaktadır.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(i => {
      const cari = cariAccounts.find(c => c.id === i.cariId);
      const cariName = cari ? cari.name : 'Belirtilmemiş Cari';
      const statusText = currentFaturaSubpage === 'kesilen' ? 'Ödendi' : (currentFaturaSubpage === 'bekleyen' ? 'Açık Fatura' : (currentFaturaSubpage === 'iptal' ? 'İptal' : 'Kayıtlı'));
      const statusColor = currentFaturaSubpage === 'kesilen' ? 'bg-emerald-100 text-emerald-800' : (currentFaturaSubpage === 'bekleyen' ? 'bg-amber-100 text-amber-800' : (currentFaturaSubpage === 'iptal' ? 'bg-rose-100 text-rose-800' : 'bg-blue-100 text-blue-800'));

      return `<tr class="hover:bg-slate-50 transition-colors">
        <td class="p-3 font-medium text-slate-900">${fmtDate(i.date)}</td>
        <td class="p-3 font-mono font-bold text-slate-700">${esc(i.invoiceNo)}</td>
        <td class="p-3 text-slate-700 font-semibold">${esc(cariName)}</td>
        <td class="p-3 text-slate-500">${esc(i.notes || '—')}</td>
        <td class="p-3 text-right font-bold text-slate-900">${i.amount.toFixed(2)} TL</td>
        <td class="p-3"><span class="px-2 py-1 text-xs font-semibold rounded ${statusColor}">${statusText}</span></td>
        <td class="p-3 text-center">
          <button class="bg-rose-50 hover:bg-rose-100 text-rose-600 p-2 rounded transition-colors text-xs font-bold" onclick="deleteInvoice('${i.id}')">Sil</button>
        </td>
      </tr>`;
    }).join('');
  }

  async function deleteInvoice(id) {
    if (!confirm('Bu faturayı kalıcı olarak silmek istediğinize emin misiniz?')) return;
    
    if (useSupabase) {
      try {
        await supabase.from('invoices').delete().eq('id', id);
      } catch (e) { }
    }

    invoices = invoices.filter(i => i.id !== id);
    await saveFaturaToLocalStorage();
    showToast('Fatura silindi.');
    renderInvoices();
  }

  window.deleteInvoice = deleteInvoice;

  // ---- DÖVİZ LOGIC ----
  async function fetchTcmbRates() {
    const btn = $('btnUpdateTcmbRates');
    btn.disabled = true;
    btn.textContent = 'Güncelleniyor...';
    
    const proxyUrl = 'https://api.allorigins.win/raw?url=https://www.tcmb.gov.tr/kurlar/today.xml';
    try {
      const res = await fetch(proxyUrl);
      if (!res.ok) throw new Error('CORS Proxy HTTP error ' + res.status);
      const xmlText = await res.text();
      
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, "text/xml");
      const currencies = xmlDoc.getElementsByTagName("Currency");
      
      let foundCount = 0;
      for (let i = 0; i < currencies.length; i++) {
        const item = currencies[i];
        const code = item.getAttribute("CurrencyCode");
        
        if (code === "USD" || code === "EUR" || code === "GBP") {
          const buying = parseFloat(item.getElementsByTagName("ForexBuying")[0]?.textContent || 0);
          const selling = parseFloat(item.getElementsByTagName("ForexSelling")[0]?.textContent || 0);
          if (buying > 0 && selling > 0) {
            liveRates[code] = { buying, selling };
            foundCount++;
          }
        }
      }
      
      if (foundCount > 0) {
        showToast('TCMB döviz kurları başarıyla güncellendi.');
      } else {
        throw new Error('Döviz kurları XML içinde bulunamadı.');
      }
    } catch (err) {
      console.warn("TCMB rates fetch failed:", err);
      showToast('Kurlar TCMB\'den çekilemedi, sistem kurları varsayılan değerlerde tutuldu.', true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Kurları Güncelle ↻';
      renderRatesUI();
      updateCalculatorCurrentRate();
    }
  }

  function renderRatesUI() {
    $('valDovizUsdBuying').textContent = liveRates.USD.buying.toFixed(4) + ' TL';
    $('valDovizUsdSelling').textContent = liveRates.USD.selling.toFixed(4) + ' TL';
    $('valDovizEurBuying').textContent = liveRates.EUR.buying.toFixed(4) + ' TL';
    $('valDovizEurSelling').textContent = liveRates.EUR.selling.toFixed(4) + ' TL';
    $('valDovizGbpBuying').textContent = liveRates.GBP.buying.toFixed(4) + ' TL';
    $('valDovizGbpSelling').textContent = liveRates.GBP.selling.toFixed(4) + ' TL';
  }

  function updateCalculatorCurrentRate() {
    const currency = $('selDovizCurrency').value;
    if (liveRates[currency]) {
      $('inpDovizRateCurrent').value = liveRates[currency].buying.toFixed(4);
    }
    calculateExchangeDiff();
  }

  function calculateExchangeDiff() {
    const cariId = $('selDovizCari').value;
    const amount = parseFloat($('inpDovizAmount').value || 0);
    const invoiceRate = parseFloat($('inpDovizRateInvoice').value || 0);
    const currentRate = parseFloat($('inpDovizRateCurrent').value || 0);

    const valInvoiceTL = amount * invoiceRate;
    const valCurrentTL = amount * currentRate;
    const diffTL = valCurrentTL - valInvoiceTL;

    $('lblValDovizInvoiceTL').textContent = valInvoiceTL.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' TL';
    $('lblValDovizCurrentTL').textContent = valCurrentTL.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' TL';
    
    const diffEl = $('lblValDovizDiffTL');
    const badge = $('lblValDovizStatusBadge');
    
    const prefix = diffTL >= 0 ? '+' : '';
    diffEl.textContent = prefix + diffTL.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' TL';
    
    if (amount === 0 || invoiceRate === 0 || currentRate === 0) {
      diffEl.style.color = 'var(--ink)';
      badge.style.display = 'none';
      return;
    }

    const cari = cariAccounts.find(c => c.id === cariId);
    const isSupplier = cari && cari.type === 'TEDARİKÇİ';

    let isGain = diffTL >= 0;
    if (isSupplier) {
      isGain = diffTL <= 0;
    }

    if (diffTL === 0) {
      diffEl.style.color = 'var(--ink)';
      badge.textContent = 'Kur Farkı Yok';
      badge.className = 'badge-status';
      badge.style.display = 'block';
      badge.style.background = '#f1f3f5';
      badge.style.color = '#495057';
    } else if (isGain) {
      diffEl.style.color = '#2e7d32';
      badge.textContent = 'Kur Farkı Geliri (Kâr)';
      badge.className = 'doviz-gain';
      badge.style.display = 'block';
    } else {
      diffEl.style.color = '#c62828';
      badge.textContent = 'Kur Farkı Gideri (Zarar)';
      badge.className = 'doviz-loss';
      badge.style.display = 'block';
    }
  }

  async function loadDovizData() {
    if (cariAccounts.length === 0) {
      await loadCariData();
    }
    
    const list = cariAccounts.filter(c => c.status === 'AKTİF');
    $('selDovizCari').innerHTML = '<option value="">— Cari Seçin —</option>' + 
      list.map(c => `<option value="${c.id}">${esc(c.code)} - ${esc(c.name)}</option>`).join('');

    if (useSupabase) {
      try {
        const { data, error } = await supabase.from('exchange_diff_records').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        exchangeDiffRecords = (data || []).map(r => ({
          id: r.id,
          cariId: r.cari_id,
          currency: r.currency,
          amount: parseFloat(r.amount || 0),
          rateInvoice: parseFloat(r.rate_invoice || 0),
          rateCurrent: parseFloat(r.rate_current || 0),
          diffAmount: parseFloat(r.diff_amount || 0),
          notes: r.notes,
          createdAt: r.created_at
        }));
      } catch (e) {
        console.warn("Supabase exchange table fallback.", e);
        await loadDovizFromLocalStorage();
      }
    } else {
      await loadDovizFromLocalStorage();
    }

    await fetchTcmbRates();
    renderExchangeDiffHistory();
  }

  async function loadDovizFromLocalStorage() {
    try {
      const val = await getStorageItem(STORAGE_KEY_EXCHANGE_DIFF);
      exchangeDiffRecords = val ? JSON.parse(val) : [];
    } catch (e) {
      exchangeDiffRecords = [];
    }
  }

  async function saveExchangeDiffRecord(record) {
    if (useSupabase) {
      try {
        const { error } = await supabase.from('exchange_diff_records').insert({
          id: record.id,
          cari_id: record.cariId,
          currency: record.currency,
          amount: record.amount,
          rate_invoice: record.rateInvoice,
          rate_current: record.rateCurrent,
          diff_amount: record.diffAmount,
          notes: record.notes,
          created_at: record.createdAt
        });
        if (!error) return true;
      } catch (e) { }
    }
    exchangeDiffRecords.push(record);
    await saveDovizToLocalStorage();
    return true;
  }

  async function saveDovizToLocalStorage() {
    try {
      await setStorageItem(STORAGE_KEY_EXCHANGE_DIFF, JSON.stringify(exchangeDiffRecords));
    } catch (e) { }
  }

  function renderExchangeDiffHistory() {
    const tbody = $('tblExchangeDiffHistory');
    if (!tbody) return;

    if (exchangeDiffRecords.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:var(--ink-soft);">Kayıtlı kur farkı hareketi bulunmamaktadır.</td></tr>`;
      return;
    }

    tbody.innerHTML = exchangeDiffRecords.map(r => {
      const cari = cariAccounts.find(c => c.id === r.cariId);
      const name = cari ? cari.name : 'Belirtilmemiş Cari';
      const diffColor = r.diffAmount > 0 ? 'var(--success)' : (r.diffAmount < 0 ? 'var(--accent-dark)' : 'var(--ink)');
      const prefix = r.diffAmount >= 0 ? '+' : '';

      return `<tr>
        <td style="font-weight:700;">${esc(name)}</td>
        <td style="font-family:'JetBrains Mono',monospace;">${r.amount.toFixed(2)} ${esc(r.currency)}</td>
        <td style="text-align:right; font-family:'JetBrains Mono',monospace;">${r.rateInvoice.toFixed(4)}</td>
        <td style="text-align:right; font-family:'JetBrains Mono',monospace;">${r.rateCurrent.toFixed(4)}</td>
        <td style="text-align:right; font-weight:bold; color:${diffColor}; font-family:'JetBrains Mono',monospace;">${prefix}${r.diffAmount.toFixed(2)} TL</td>
        <td>${esc(r.notes || '—')}</td>
        <td style="text-align:center;">
          <button class="personnel-del" style="float:none;" onclick="deleteExchangeDiffRecord('${r.id}')">✕</button>
        </td>
      </tr>`;
    }).join('');
  }

  async function deleteExchangeDiffRecord(id) {
    if (!confirm('Bu kur farkı kaydını silmek istediğinize emin misiniz?')) return;
    
    if (useSupabase) {
      try {
        await supabase.from('exchange_diff_records').delete().eq('id', id);
      } catch (e) { }
    }

    exchangeDiffRecords = exchangeDiffRecords.filter(r => r.id !== id);
    await saveDovizToLocalStorage();
    showToast('Kayıt silindi.');
    renderExchangeDiffHistory();
  }

  window.deleteExchangeDiffRecord = deleteExchangeDiffRecord;

  // ---- SATIN ALMA FINANS LOGIC ----
  function switchSatinalmaSubtab(sub) {
    document.querySelectorAll('[data-satinalma-subtab]').forEach(t => {
      t.classList.toggle('active', t.getAttribute('data-satinalma-subtab') === sub);
    });
    $('subpanel-satinalma-dashboard').classList.toggle('hidden', sub !== 'dashboard');
    $('subpanel-satinalma-talepler').classList.toggle('hidden', sub !== 'talepler');
    $('subpanel-satinalma-yeni-talep').classList.toggle('hidden', sub !== 'yeni-talep');
    
    if (sub === 'dashboard' || sub === 'talepler') {
      renderSatinalmaLists();
    }
  }

  async function loadSatinalmaData() {
    if (useSupabase) {
      try {
        const { data: reqs, error: e1 } = await supabase.from('purchase_requests').select('*').order('created_at', { ascending: false });
        const { data: logs, error: e2 } = await supabase.from('purchase_logs').select('*').order('created_at', { ascending: false });
        
        if (e1) throw e1;
        purchaseRequests = (reqs || []).map(r => ({
          id: r.id,
          reqNo: r.req_no,
          date: r.date,
          dept: r.dept,
          product: r.product,
          qty: parseInt(r.qty || 1),
          unitPrice: parseFloat(r.unit_price || 0),
          totalPrice: parseFloat(r.total_price || 0),
          notes: r.notes,
          status: r.status,
          paymentPlan: r.payment_plan ? (typeof r.payment_plan === 'string' ? JSON.parse(r.payment_plan) : r.payment_plan) : null,
          createdAt: r.created_at
        }));

        purchaseLogs = (logs || []).map(l => ({
          id: l.id,
          date: l.date,
          user: l.username,
          action: l.action
        }));
      } catch (err) {
        console.warn("Supabase Purchase tables fallback.", err);
        await loadSatinalmaFromLocalStorage();
      }
    } else {
      await loadSatinalmaFromLocalStorage();
    }

    if (purchaseRequests.length === 0) {
      purchaseRequests = [
        {
          id: 'req-1',
          reqNo: 'REQ-1001',
          date: todayISO(),
          dept: 'FABRİKA',
          product: 'H14 Pro Metal Profil 200 Adet',
          qty: 200,
          unitPrice: 150.00,
          totalPrice: 30000.00,
          notes: 'Üretim bandı güçlendirme projesi için yedek parça siparişi.',
          status: 'Talep Oluşturuldu',
          paymentPlan: null,
          createdAt: new Date().toISOString()
        },
        {
          id: 'req-2',
          reqNo: 'REQ-1002',
          date: todayISO(),
          dept: 'OFİS',
          product: 'Ofis Büro Koltuğu (Ergonomik)',
          qty: 5,
          unitPrice: 2400.00,
          totalPrice: 12000.00,
          notes: 'Yeni katılan mühendisler için çalışma alanı sandalye alımı.',
          status: 'Muhasebe İncelemesinde',
          paymentPlan: null,
          createdAt: new Date().toISOString()
        }
      ];
      await savePurchaseRequestsState();
      
      purchaseLogs = [
        { id: 'log-1', date: new Date().toISOString(), user: 'Sistem', action: 'Sistem başlatıldı. Varsayılan bütçe 500,000.00 TL tanımlandı.' }
      ];
      await savePurchaseLogsState();
    }

    renderSatinalmaLists();

    document.querySelectorAll('[data-satinalma-subtab]').forEach(t => {
      const newT = t.cloneNode(true);
      t.parentNode.replaceChild(newT, t);
      newT.addEventListener('click', () => switchSatinalmaSubtab(newT.getAttribute('data-satinalma-subtab')));
    });
  }

  async function loadSatinalmaFromLocalStorage() {
    try {
      const valReq = await getStorageItem(STORAGE_KEY_PURCHASE);
      purchaseRequests = valReq ? JSON.parse(valReq) : [];
      const valLogs = await getStorageItem(STORAGE_KEY_PURCHASE_LOGS);
      purchaseLogs = valLogs ? JSON.parse(valLogs) : [];
    } catch (e) {
      purchaseRequests = [];
      purchaseLogs = [];
    }
  }

  async function savePurchaseRequestsState() {
    try {
      await setStorageItem(STORAGE_KEY_PURCHASE, JSON.stringify(purchaseRequests));
    } catch (e) { }
  }

  async function savePurchaseLogsState() {
    try {
      await setStorageItem(STORAGE_KEY_PURCHASE_LOGS, JSON.stringify(purchaseLogs));
    } catch (e) { }
  }

  async function logPurchaseAction(actionText) {
    const user = (currentUser && currentUser.username) || 'Muhasebe Kullanıcısı';
    const log = {
      id: Date.now().toString(36),
      date: new Date().toISOString(),
      user,
      action: actionText
    };
    purchaseLogs.unshift(log);
    await savePurchaseLogsState();
  }

  function renderSatinalmaLists() {
    let approvedBudget = 0;
    purchaseRequests.forEach(r => {
      if (['Bütçe Onaylandı', 'Ödeme Planı Hazır', 'Satın Alma Tamamlandı'].includes(r.status)) {
        approvedBudget += r.totalPrice;
      }
    });
    const remainingBudget = totalBudget - approvedBudget;

    const grid = $('satinalmaStatsGrid');
    if (grid) {
      grid.innerHTML = `
        <div class="stat-card">
          <h4>Toplam Dönem Bütçesi</h4>
          <div class="val" style="color:var(--ink);">${totalBudget.toLocaleString('tr-TR')} TL</div>
        </div>
        <div class="stat-card">
          <h4>Onaylanan Harcamalar</h4>
          <div class="val" style="color:var(--accent-dark);">${approvedBudget.toLocaleString('tr-TR')} TL</div>
        </div>
        <div class="stat-card">
          <h4>Kalan Finansman Bütçesi</h4>
          <div class="val" style="color:${remainingBudget >= 0 ? 'var(--success)' : 'var(--danger)'};">${remainingBudget.toLocaleString('tr-TR')} TL</div>
        </div>
      `;
    }

    const pendingBody = $('tblPendingApprovalsBody');
    const pendingList = purchaseRequests.filter(r => ['Talep Oluşturuldu', 'Muhasebe İncelemesinde'].includes(r.status));
    
    if (pendingBody) {
      if (pendingList.length === 0) {
        pendingBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--ink-soft);">Finans onayı bekleyen aktif talep bulunmamaktadır.</td></tr>`;
      } else {
        pendingBody.innerHTML = pendingList.map(r => {
          return `<tr>
            <td style="font-weight:bold; font-family:'JetBrains Mono',monospace;">${esc(r.reqNo)}</td>
            <td>${fmtDate(r.date)}</td>
            <td style="font-weight:700;">${esc(r.dept)}</td>
            <td>${esc(r.product)}</td>
            <td style="text-align:right; font-weight:700;">${r.totalPrice.toFixed(2)} TL</td>
            <td><span class="status-talep-olusturuldu">${esc(r.status)}</span></td>
            <td style="text-align:center;">
              <button class="btn-submit" style="width:auto; height:auto; padding:5px 10px; margin:0;" onclick="startReviewRequest('${r.id}')">İncele</button>
            </td>
          </tr>`;
        }).join('');
      }
    }

    const fullBody = $('tblSatinalmaTaleplerBody');
    if (fullBody) {
      if (purchaseRequests.length === 0) {
        fullBody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:20px; color:var(--ink-soft);">Talep bulunmamaktadır.</td></tr>`;
      } else {
        fullBody.innerHTML = purchaseRequests.map(r => {
          let badgeClass = 'status-talep-olusturuldu';
          if (r.status === 'Muhasebe İncelemesinde') badgeClass = 'status-incelemede';
          else if (r.status === 'Bütçe Onaylandı') badgeClass = 'status-butce-onaylandi';
          else if (r.status === 'Bütçe Yetersiz') badgeClass = 'status-butce-yetersiz';
          else if (r.status === 'Ödeme Planı Hazır') badgeClass = 'status-plan-hazir';
          else if (r.status === 'Satın Alma Tamamlandı') badgeClass = 'status-tamamlandi';
          else if (r.status === 'Reddedildi') badgeClass = 'status-reddedildi';

          return `<tr>
            <td style="font-weight:bold; font-family:'JetBrains Mono',monospace;">${esc(r.reqNo)}</td>
            <td>${fmtDate(r.date)}</td>
            <td style="font-weight:700;">${esc(r.dept)}</td>
            <td>${esc(r.product)}</td>
            <td style="text-align:right;">${r.qty}</td>
            <td style="text-align:right;">${r.unitPrice.toFixed(2)}</td>
            <td style="text-align:right; font-weight:700;">${r.totalPrice.toFixed(2)} TL</td>
            <td><span class="${badgeClass}">${esc(r.status)}</span></td>
            <td style="text-align:center;">
              <button class="btn-submit" style="width:auto; height:auto; padding:5px 10px; margin:0; background:var(--accent);" onclick="startReviewRequest('${r.id}')">İncele</button>
            </td>
          </tr>`;
        }).join('');
      }
    }

    const logsBody = $('tblSatinalmaLogs');
    if (logsBody) {
      logsBody.innerHTML = purchaseLogs.map(l => {
        return `<tr>
          <td style="font-size:11px; color:var(--ink-soft); white-space:nowrap; padding:6px 10px;">${new Date(l.date).toLocaleString('tr-TR')}</td>
          <td style="font-weight:bold; font-size:12px; padding:6px 10px;">${esc(l.user)}</td>
          <td style="font-size:12px; padding:6px 10px;">${esc(l.action)}</td>
        </tr>`;
      }).join('');
    }
  }

  function startReviewRequest(id) {
    const r = purchaseRequests.find(req => req.id === id);
    if (!r) return;

    activeReviewRequestId = id;
    switchSatinalmaSubtab('talepler');

    $('lblReviewReqNo').textContent = r.reqNo;
    $('lblReviewProduct').textContent = r.product;
    $('lblReviewDept').textContent = r.dept;
    $('lblReviewTotal').textContent = r.totalPrice.toLocaleString('tr-TR', { minimumFractionDigits: 2 }) + ' TL';
    $('lblReviewNotes').textContent = r.notes || 'Açıklama belirtilmemiş.';

    let approvedBudget = 0;
    purchaseRequests.forEach(req => {
      if (req.id !== id && ['Bütçe Onaylandı', 'Ödeme Planı Hazır', 'Satın Alma Tamamlandı'].includes(req.status)) {
        approvedBudget += req.totalPrice;
      }
    });
    const remaining = totalBudget - approvedBudget;
    const fits = r.totalPrice <= remaining;

    const bBadge = $('lblReviewBudgetStatus');
    if (fits) {
      bBadge.textContent = `BÜTÇE UYGUN: Dönem bakiyesi yeterlidir (Bakiye: ${remaining.toLocaleString('tr-TR')} TL)`;
      bBadge.className = 'doviz-gain';
    } else {
      bBadge.textContent = `LİMİT AŞIMI: Talep tutarı mevcut bütçeyi aşıyor (Bakiye: ${remaining.toLocaleString('tr-TR')} TL)`;
      bBadge.className = 'doviz-loss';
    }

    $('blockReviewRequest').classList.remove('hidden');
    $('blockPaymentPlanForm').classList.add('hidden');
    
    $('inpPlanPayDate').value = todayISO();
    $('inpPlanDueDate').value = todayISO();
  }

  window.startReviewRequest = startReviewRequest;

  // Bind Actions & Event Listeners
  $('btnMuhasebeLogout').addEventListener('click', handleLogout);
  $('btnUploadContract').addEventListener('click', handleAddContract);
  $('btnAddDriver').addEventListener('click', handleAddDriver);
  $('btnAddCustomer').addEventListener('click', handleAddCustomer);

  document.querySelectorAll('[data-muhasebe-tab]').forEach(t => {
    t.addEventListener('click', () => switchMuhasebeTab(t.getAttribute('data-muhasebe-tab')));
  });

  $('inpContractFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) {
      attachedContractFile = null;
      $('contractFileStatus').textContent = '';
      $('btnRemoveContractFile').classList.add('hidden');
      return;
    }

    const currentLimit = 50 * 1024 * 1024;
    if (file.size > currentLimit) {
      showToast('Dosya boyutu 50MB\'tan küçük olmalıdır.', true);
      $('inpContractFile').value = '';
      attachedContractFile = null;
      $('contractFileStatus').textContent = '';
      $('btnRemoveContractFile').classList.add('hidden');
      return;
    }

    attachedContractFile = {
      name: file.name,
      size: file.size,
      data: null,
      fileRaw: file
    };
    $('contractFileStatus').textContent = `Hazır: ${file.name} (${formatBytes(file.size)})`;
    $('btnRemoveContractFile').classList.remove('hidden');
  });

  $('btnRemoveContractFile').addEventListener('click', () => {
    $('inpContractFile').value = '';
    attachedContractFile = null;
    $('contractFileStatus').textContent = '';
    $('btnRemoveContractFile').classList.add('hidden');
  });

  // Cari event triggers
  $('btnShowNewCariForm').addEventListener('click', () => {
    $('blockNewCariForm').classList.toggle('hidden');
    $('inpCariCode').value = suggestNextCariCode($('selCariType').value);
  });
  
  $('selCariType').addEventListener('change', () => {
    $('inpCariCode').value = suggestNextCariCode($('selCariType').value);
  });

  $('btnCancelCariForm').addEventListener('click', () => {
    $('blockNewCariForm').classList.add('hidden');
    $('inpCariName').value = '';
    $('inpCariTaxOffice').value = '';
    $('inpCariTaxNo').value = '';
    $('inpCariPhone').value = '';
    $('inpCariEmail').value = '';
    $('inpCariAuthorized').value = '';
    $('inpCariAddress').value = '';
  });

  $('btnSaveCariCard').addEventListener('click', async () => {
    const code = $('inpCariCode').value;
    const name = $('inpCariName').value.trim();
    const type = $('selCariType').value;
    const taxOffice = $('inpCariTaxOffice').value.trim();
    const taxNo = $('inpCariTaxNo').value.trim();
    const phone = $('inpCariPhone').value.trim();
    const email = $('inpCariEmail').value.trim();
    const authorized = $('inpCariAuthorized').value.trim();
    const status = $('selCariStatus').value;
    const address = $('inpCariAddress').value.trim();

    if (!name) {
      showToast('Cari Ünvanı zorunludur.', true);
      return;
    }

    const newCari = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      code,
      name,
      type,
      tax_office: taxOffice,
      tax_no: taxNo,
      phone,
      email,
      authorized,
      status,
      address,
      created_at: new Date().toISOString()
    };

    if (useSupabase) {
      try {
        const { error } = await supabase.from('cari_accounts').insert(newCari);
        if (error) throw error;
      } catch (e) {
        console.error("Supabase insert failed.", e);
      }
    }

    cariAccounts.push(newCari);
    await saveCariAccountsState();
    
    showToast('Cari Kart oluşturuldu.');
    $('btnCancelCariForm').click();
    renderCariList();
    renderCariDashboard();
  });

  $('btnSaveTahsilat').addEventListener('click', async () => {
    const cariId = $('selCariTahsilat').value;
    const date = $('inpTahsilatDate').value;
    const amount = parseFloat($('inpTahsilatAmount').value);
    const ref = $('inpTahsilatRef').value.trim();
    const notes = $('inpTahsilatNotes').value.trim();

    if (!cariId || !date || isNaN(amount) || amount <= 0) {
      showToast('Lütfen alanları eksiksiz ve geçerli doldurun.', true);
      return;
    }

    const tx = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      cari_id: cariId,
      type: 'TAHSİLAT',
      date,
      amount,
      ref_no: ref,
      notes: notes || 'Tahsilat kaydı',
      created_at: new Date().toISOString()
    };

    if (useSupabase) {
      try {
        const { error } = await supabase.from('cari_transactions').insert(tx);
        if (error) throw error;
      } catch (e) { }
    }

    cariTransactions.push(tx);
    await saveCariTransactionsState();
    showToast('Tahsilat işlemi kaydedildi.');
    
    $('inpTahsilatAmount').value = '';
    $('inpTahsilatRef').value = '';
    $('inpTahsilatNotes').value = '';
    renderCariDashboard();
  });

  $('btnSaveOdeme').addEventListener('click', async () => {
    const cariId = $('selCariOdeme').value;
    const type = $('selOdemeType').value;
    const date = $('inpOdemeDate').value;
    const amount = parseFloat($('inpOdemeAmount').value);
    const ref = $('inpOdemeRef').value.trim();
    const notes = $('inpOdemeNotes').value.trim();

    if (!cariId || !date || isNaN(amount) || amount <= 0) {
      showToast('Lütfen alanları eksiksiz ve geçerli doldurun.', true);
      return;
    }

    const tx = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      cari_id: cariId,
      type,
      date,
      amount,
      ref_no: ref,
      notes: notes || `${type} kaydı`,
      created_at: new Date().toISOString()
    };

    if (useSupabase) {
      try {
        const { error } = await supabase.from('cari_transactions').insert(tx);
        if (error) throw error;
      } catch (e) { }
    }

    cariTransactions.push(tx);
    await saveCariTransactionsState();
    showToast('Finansal işlem kaydedildi.');
    
    $('inpOdemeAmount').value = '';
    $('inpOdemeRef').value = '';
    $('inpOdemeNotes').value = '';
    renderCariDashboard();
  });

  $('btnPrintEkstre').addEventListener('click', () => {
    window.print();
  });

  $('btnFilterCariLedger').addEventListener('click', filterCariLedger);
  $('inpCariSearch').addEventListener('input', renderCariList);

  document.querySelectorAll('[data-cari-subtab]').forEach(t => {
    t.addEventListener('click', () => switchCariSubtab(t.getAttribute('data-cari-subtab')));
  });

  // Fatura triggers
  $('btnShowAddInvoiceForm').addEventListener('click', () => {
    $('blockAddInvoiceForm').classList.toggle('hidden');
    $('inpFaturaDate').value = todayISO();
  });

  $('btnCancelFaturaForm').addEventListener('click', () => {
    $('blockAddInvoiceForm').classList.add('hidden');
    $('selFaturaCari').value = '';
    $('inpFaturaAmount').value = '';
    $('inpFaturaNo').value = '';
    $('inpFaturaNotes').value = '';
  });

  $('btnSaveInvoice').addEventListener('click', async () => {
    const cariId = $('selFaturaCari').value;
    const date = $('inpFaturaDate').value;
    const amount = parseFloat($('inpFaturaAmount').value);
    const invoiceNo = $('inpFaturaNo').value.trim();
    const notes = $('inpFaturaNotes').value.trim();

    if (!cariId || !date || isNaN(amount) || amount <= 0 || !invoiceNo) {
      showToast('Lütfen fatura bilgilerini eksiksiz doldurun.', true);
      return;
    }

    const newInv = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      cariId,
      category: currentFaturaSubpage,
      date,
      amount,
      invoiceNo,
      notes,
      createdAt: new Date().toISOString()
    };

    await saveInvoice(newInv);
    
    const isSales = currentFaturaSubpage === 'kesilen' || currentFaturaSubpage === 'bekleyen' || currentFaturaSubpage === 'iptal';
    const txType = isSales ? 'BORÇ' : 'ALACAK';
    
    const tx = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      cari_id: cariId,
      type: txType,
      date,
      amount,
      ref_no: invoiceNo,
      notes: `${currentFaturaSubpage.toUpperCase()} Faturası: ${notes || 'Fatura kaydı'}`,
      created_at: new Date().toISOString()
    };

    await saveAccountingRecord(tx);

    showToast('Fatura başarıyla kaydedildi.');
    $('btnCancelFaturaForm').click();
    renderInvoices();
  });

  // Doviz Calculator triggers
  $('btnUpdateTcmbRates').addEventListener('click', fetchTcmbRates);
  $('selDovizCurrency').addEventListener('change', updateCalculatorCurrentRate);
  $('selDovizCari').addEventListener('change', calculateExchangeDiff);
  
  ['inpDovizAmount', 'inpDovizRateInvoice', 'inpDovizRateCurrent'].forEach(id => {
    $(id).addEventListener('input', calculateExchangeDiff);
  });

  $('btnSaveExchangeDiff').addEventListener('click', async () => {
    const cariId = $('selDovizCari').value;
    const currency = $('selDovizCurrency').value;
    const amount = parseFloat($('inpDovizAmount').value || 0);
    const rateInvoice = parseFloat($('inpDovizRateInvoice').value || 0);
    const rateCurrent = parseFloat($('inpDovizRateCurrent').value || 0);
    const notes = $('inpDovizNotes').value.trim();

    if (!cariId || amount <= 0 || rateInvoice <= 0 || rateCurrent <= 0) {
      showToast('Lütfen alanları eksiksiz ve geçerli doldurun.', true);
      return;
    }

    const valInvoiceTL = amount * rateInvoice;
    const valCurrentTL = amount * rateCurrent;
    const diffAmount = valCurrentTL - valInvoiceTL;

    const record = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      cariId,
      currency,
      amount,
      rateInvoice,
      rateCurrent,
      diffAmount,
      notes: notes || `${currency} kur farkı değerleme kaydı`,
      createdAt: new Date().toISOString()
    };

    await saveExchangeDiffRecord(record);
    
    const cari = cariAccounts.find(c => c.id === cariId);
    const isSupplier = cari && cari.type === 'TEDARİKÇİ';
    
    let txType = 'BORÇ';
    let txAmount = Math.abs(diffAmount);
    
    if (diffAmount >= 0) {
      txType = isSupplier ? 'ALACAK' : 'BORÇ';
    } else {
      txType = isSupplier ? 'BORÇ' : 'ALACAK';
    }

    const tx = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      cari_id: cariId,
      type: txType,
      date: todayISO(),
      amount: txAmount,
      ref_no: 'KUR-FARKI',
      notes: `${currency} Değerleme fark kaydı (${rateInvoice} -> ${rateCurrent})`,
      created_at: new Date().toISOString()
    };

    await saveAccountingRecord(tx);

    showToast('Kur farkı kaydı başarıyla işlendi ve Cari Deftere aktarıldı.');
    
    $('inpDovizAmount').value = '';
    $('inpDovizRateInvoice').value = '';
    $('inpDovizNotes').value = '';
    
    calculateExchangeDiff();
    renderExchangeDiffHistory();
  });

  // Satinalma triggers
  $('btnApproveRequestBudget').addEventListener('click', async () => {
    if (!activeReviewRequestId) return;
    const r = purchaseRequests.find(req => req.id === activeReviewRequestId);
    
    let approvedBudget = 0;
    purchaseRequests.forEach(req => {
      if (req.id !== activeReviewRequestId && ['Bütçe Onaylandı', 'Ödeme Planı Hazır', 'Satın Alma Tamamlandı'].includes(req.status)) {
        approvedBudget += req.totalPrice;
      }
    });
    const remaining = totalBudget - approvedBudget;
    const fits = r.totalPrice <= remaining;

    r.status = fits ? 'Bütçe Onaylandı' : 'Bütçe Yetersiz';
    await savePurchaseRequestsState();
    
    await logPurchaseAction(`${r.reqNo} nolu satın alma talebi için bütçe kontrolü yapıldı: ${r.status}.`);
    
    if (r.status === 'Bütçe Onaylandı') {
      showToast('Bütçe onaylandı. Ödeme planı girmelisiniz.');
      $('blockPaymentPlanForm').classList.remove('hidden');
    } else {
      showToast('Dönem bütçesi yetersiz olduğundan bütçe kontrolü olumsuz sonuçlandı.', true);
    }
    renderSatinalmaLists();
  });

  $('btnRejectRequest').addEventListener('click', async () => {
    if (!activeReviewRequestId) return;
    const r = purchaseRequests.find(req => req.id === activeReviewRequestId);
    r.status = 'Reddedildi';
    await savePurchaseRequestsState();
    
    await logPurchaseAction(`${r.reqNo} nolu satın alma talebi reddedildi.`);
    showToast('Satın alma talebi reddedildi.');
    $('blockReviewRequest').classList.add('hidden');
    renderSatinalmaLists();
  });

  $('btnSavePaymentPlan').addEventListener('click', async () => {
    if (!activeReviewRequestId) return;
    const r = purchaseRequests.find(req => req.id === activeReviewRequestId);

    const payDate = $('inpPlanPayDate').value;
    const method = $('selPlanPayMethod').value;
    const installments = parseInt($('inpPlanInstallments').value || 1);
    const dueDate = $('inpPlanDueDate').value;
    const notes = $('inpPlanNotes').value.trim();

    if (!payDate || !dueDate) {
      showToast('Lütfen ödeme planı tarihlerini doldurun.', true);
      return;
    }

    r.paymentPlan = { payDate, method, installments, dueDate, notes };
    r.status = 'Satın Alma Tamamlandı';
    await savePurchaseRequestsState();

    await logPurchaseAction(`${r.reqNo} için ödeme planı oluşturuldu (${installments} taksit, ${method}). Satın alma tamamlandı.`);
    showToast('Ödeme planı kaydedildi, satın alma başarıyla tamamlandı.');
    
    $('blockReviewRequest').classList.add('hidden');
    renderSatinalmaLists();
  });

  $('btnHideReviewBlock').addEventListener('click', () => {
    $('blockReviewRequest').classList.add('hidden');
  });

  ['inpRequestQty', 'inpRequestUnitPrice'].forEach(id => {
    $(id).addEventListener('input', () => {
      const qty = parseInt($('inpRequestQty').value || 0);
      const price = parseFloat($('inpRequestUnitPrice').value || 0);
      $('inpRequestTotal').value = (qty * price).toFixed(2) + ' TL';
    });
  });

  $('btnSavePurchaseRequest').addEventListener('click', async () => {
    const dept = $('selRequestDept').value;
    const product = $('inpRequestProduct').value.trim();
    const qty = parseInt($('inpRequestQty').value || 1);
    const unitPrice = parseFloat($('inpRequestUnitPrice').value || 0);

    if (!product || unitPrice <= 0) {
      showToast('Lütfen geçerli ürün adı ve birim fiyat girin.', true);
      return;
    }

    const nextIdNum = purchaseRequests.length + 1001;
    const reqNo = `REQ-${nextIdNum}`;

    const newRequest = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      reqNo,
      date: todayISO(),
      dept,
      product,
      qty,
      unitPrice,
      totalPrice: qty * unitPrice,
      notes: $('inpRequestNotes').value.trim(),
      status: 'Talep Oluşturuldu',
      paymentPlan: null,
      createdAt: new Date().toISOString()
    };

    purchaseRequests.unshift(newRequest);
    await savePurchaseRequestsState();

    await logPurchaseAction(`${reqNo} nolu yeni satın alma talebi oluşturuldu (${dept} -> ${product}).`);
    showToast('Satın alma talebiniz başarıyla gönderildi.');

    $('inpRequestProduct').value = '';
    $('inpRequestQty').value = '1';
    $('inpRequestUnitPrice').value = '';
    $('inpRequestTotal').value = '0.00 TL';
    $('inpRequestNotes').value = '';

    switchSatinalmaSubtab('dashboard');
  });

  // --- Initializer ---
  async function init() {
    checkSession();
    await loadCariData();
    await loadAccountingRecords();
  }
  init();
})();
