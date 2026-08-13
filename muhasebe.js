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
    $('panel-projects').classList.toggle('hidden', name !== 'projects');
    $('panel-cari').classList.toggle('hidden', name !== 'cari');
    $('panel-fatura').classList.toggle('hidden', name !== 'fatura');
    $('panel-doviz').classList.toggle('hidden', name !== 'doviz');
    $('panel-satinalma').classList.toggle('hidden', name !== 'satinalma');
    $('panel-raporlar').classList.toggle('hidden', name !== 'raporlar');
    if (name === 'cari') {
      switchCariSubtab('cari-dashboard');
      loadCariData();
    } else if (name === 'fatura') {
      loadFaturaData();
    } else if (name === 'doviz') {
      loadDovizData();
    } else if (name === 'satinalma') {
      loadSatinalmaData();
    } else if (name === 'raporlar') {
      initRaporlar();
    } else if (name === 'projects') {
      loadProjectsAndRender();
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
    if (!listContracts) return;

    const contracts = accountingRecords.filter(r => r.type === 'contract');

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
  // Driver and Customer buttons removed from HTML, event bindings commented out
  // $('btnAddDriver').addEventListener('click', handleAddDriver);
  // $('btnAddCustomer').addEventListener('click', handleAddCustomer);

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
    const account_id = $('selTahsilatAccount').value;
    const category = $('selTahsilatCategory').value;
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
      account_id,
      category,
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
    const account_id = $('selOdemeAccount').value;
    const category = $('selOdemeCategory').value;
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
      account_id: type === 'ÖDEME' ? account_id : null,
      category,
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

  // ==========================================
  // --- FINANS RAPORLARI VE DASHBOARD MANTIĞI ---
  // ==========================================
  
  let auditLogs = [];
  let currentRaporSubtab = 'kasa';
  let chartNakitObj = null;
  let chartGelirGiderObj = null;
  let chartBorcAlacakObj = null;

  async function loadAuditLogs() {
    try {
      const stored = await getStorageItem('mimari-audit-logs');
      auditLogs = stored ? JSON.parse(stored) : [];
    } catch (e) {
      auditLogs = [];
    }
  }

  async function saveAuditLog(action, detail) {
    const userDisplay = currentUser ? `${currentUser.username} (${currentUser.role})` : 'Anonim';
    const log = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      time: new Date().toISOString(),
      user: currentUser ? currentUser.username : 'Anonim',
      role: currentUser ? currentUser.role : 'Belirtilmemiş',
      action,
      detail
    };
    auditLogs.unshift(log);
    try {
      await setStorageItem('mimari-audit-logs', JSON.stringify(auditLogs));
    } catch (e) {}
  }

  // --- Rapor Paneli Başlatıcı ---
  async function initRaporlar() {
    await loadAuditLogs();
    
    // Rol kontrolü ve yetkilendirme gösterimi
    const userRole = (currentUser && currentUser.role) || 'MUHASEBE';
    $('lblSelectedUserRole').textContent = `Rol: ${userRole}`;

    // Admin / Yönetici ise Audit Log sekmesini göster
    if (userRole === 'admin' || userRole === 'YÖNETİM' || userRole === 'YÖNETİCİ') {
      $('tabRaporAudit').style.display = 'block';
    } else {
      $('tabRaporAudit').style.display = 'none';
      if (currentRaporSubtab === 'audit') {
        currentRaporSubtab = 'kasa';
      }
    }

    // Varsayılan tarih filtrelerini ayarla (Ayın 1'inden bugüne)
    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    
    // ISO string formatına dönüştür (YYYY-MM-DD)
    const toISO = (d) => d.toISOString().slice(0, 10);
    if (!$('inpRaporStart').value) {
      $('inpRaporStart').value = toISO(startOfMonth);
    }
    if (!$('inpRaporEnd').value) {
      $('inpRaporEnd').value = toISO(today);
    }

    // Carileri Dropdown'a yükle
    const emptyOpt = '<option value="">Tüm Cariler</option>';
    const cariOpts = cariAccounts.map(c => `<option value="${c.id}">${esc(c.code)} - ${esc(c.name)}</option>`).join('');
    $('selRaporCari').innerHTML = emptyOpt + cariOpts;

    // Subtab geçiş eventleri
    document.querySelectorAll('[data-rapor-subtab]').forEach(tab => {
      const newTab = tab.cloneNode(true);
      tab.parentNode.replaceChild(newTab, tab);
      newTab.addEventListener('click', () => {
        switchRaporSubtab(newTab.getAttribute('data-rapor-subtab'));
      });
    });

    // Filtreleme click event
    const btnFilter = $('btnFilterRapor');
    const newBtnFilter = btnFilter.cloneNode(true);
    btnFilter.parentNode.replaceChild(newBtnFilter, btnFilter);
    newBtnFilter.addEventListener('click', () => {
      saveAuditLog('Filtre Uygulandı', 'Finansal raporlar yeni filtre kriterleriyle güncellendi.');
      renderFinansDashboard();
      renderSelectedReport();
    });

    // Dışa Aktarma ve Yazdırma Eventleri
    setupExportEvents();

    // İlk gösterim
    renderFinansDashboard();
    renderSelectedReport();
  }

  function switchRaporSubtab(tabName) {
    currentRaporSubtab = tabName;
    document.querySelectorAll('[data-rapor-subtab]').forEach(tab => {
      tab.classList.toggle('active', tab.getAttribute('data-rapor-subtab') === tabName);
    });

    $('subpanel-rapor-kasa').classList.toggle('hidden', tabName !== 'kasa');
    $('subpanel-rapor-banka').classList.toggle('hidden', tabName !== 'banka');
    $('subpanel-rapor-nakit').classList.toggle('hidden', tabName !== 'nakit');
    $('subpanel-rapor-gelirgider').classList.toggle('hidden', tabName !== 'gelirgider');
    $('subpanel-rapor-karzarar').classList.toggle('hidden', tabName !== 'karzarar');
    $('subpanel-rapor-bilanco').classList.toggle('hidden', tabName !== 'bilanco');
    $('subpanel-rapor-borcalacak').classList.toggle('hidden', tabName !== 'borcalacak');
    $('subpanel-rapor-audit').classList.toggle('hidden', tabName !== 'audit');

    saveAuditLog('Rapor Görüntüleme', `${tabName.toUpperCase()} raporu görüntülendi.`);
    renderSelectedReport();
  }

  // --- Filtrelenmiş Veri Çekme ---
  function getFilteredTransactions() {
    const start = $('inpRaporStart').value;
    const end = $('inpRaporEnd').value;
    const account = $('selRaporAccount').value;
    const cari = $('selRaporCari').value;
    const category = $('selRaporCategory').value;

    return cariTransactions.filter(t => {
      if (start && t.date < start) return false;
      if (end && t.date > end) return false;
      if (account && t.account_id !== account) return false;
      if (cari && t.cari_id !== cari) return false;
      if (category && t.category !== category) return false;
      return true;
    });
  }

  function getFilteredInvoices() {
    const start = $('inpRaporStart').value;
    const end = $('inpRaporEnd').value;
    const cari = $('selRaporCari').value;

    return invoices.filter(i => {
      if (start && i.date < start) return false;
      if (end && i.date > end) return false;
      if (cari && i.cariId !== cari) return false;
      return true;
    });
  }

  // --- 1. GÜNLÜK KASA RAPORU HESAPLAMA VE ÇİZİM ---
  function renderKasaReport(txs) {
    const start = $('inpRaporStart').value;
    const end = $('inpRaporEnd').value;
    
    // Devir (Açılış) Bakiyesi hesapla (Seçilen tarih aralığından önceki tüm nakit hareketleri)
    let openingBal = 0;
    cariTransactions.forEach(t => {
      if (t.account_id === 'MERKEZ_KASA' && start && t.date < start) {
        const amt = parseFloat(t.amount || 0);
        if (t.type === 'TAHSİLAT') openingBal += amt;
        else if (t.type === 'ÖDEME') openingBal -= amt;
      }
    });

    let totalIn = 0;
    let totalOut = 0;
    let running = openingBal;

    const tbody = $('tblKasaRaporuBody');
    const kasaTxs = txs.filter(t => t.account_id === 'MERKEZ_KASA').sort((a, b) => a.date.localeCompare(b.date));

    if (kasaTxs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:20px; color:var(--ink-soft);">Filtrelere uygun kasa hareketi bulunamadı.</td></tr>`;
    } else {
      tbody.innerHTML = kasaTxs.map(t => {
        const amt = parseFloat(t.amount || 0);
        const cari = cariAccounts.find(c => c.id === t.cari_id);
        const cariName = cari ? cari.name : 'Genel Kasa';
        let giris = '—';
        let cikis = '—';

        if (t.type === 'TAHSİLAT') {
          giris = amt.toFixed(2) + ' TL';
          totalIn += amt;
          running += amt;
        } else if (t.type === 'ÖDEME') {
          cikis = amt.toFixed(2) + ' TL';
          totalOut += amt;
          running -= amt;
        }

        return `<tr>
          <td>${fmtDate(t.date)}</td>
          <td><strong>${esc(cariName)}</strong></td>
          <td><span class="badge-status ${t.type.toLowerCase()}">${esc(t.type)}</span></td>
          <td>${esc(t.category || 'Belirtilmemiş')}</td>
          <td>${esc(t.notes || '—')}</td>
          <td style="text-align:right; color:var(--success); font-weight:bold;">${giris}</td>
          <td style="text-align:right; color:var(--accent-dark); font-weight:bold;">${cikis}</td>
          <td style="text-align:right; font-weight:bold;">${running.toFixed(2)} TL</td>
        </tr>`;
      }).join('');
    }

    $('lblKasaAcilis').textContent = openingBal.toFixed(2) + ' TL';
    $('lblKasaTahsilat').textContent = totalIn.toFixed(2) + ' TL';
    $('lblKasaOdeme').textContent = totalOut.toFixed(2) + ' TL';
    $('lblKasaKapanis').textContent = running.toFixed(2) + ' TL';
  }

  // --- 2. GÜNLÜK BANKA RAPORU HESAPLAMA VE ÇİZİM ---
  function renderBankaReport(txs) {
    const bankList = [
      { id: 'ZİRAAT_BANKASI', name: 'Ziraat Bankası A.Ş.' },
      { id: 'GARANTİ_BANKASI', name: 'Garanti BBVA' }
    ];

    const bankTxs = txs.filter(t => t.account_id && t.account_id !== 'MERKEZ_KASA').sort((a, b) => a.date.localeCompare(b.date));
    
    // Banka bazlı özet kartlarını oluştur
    const ozetEl = $('divBankaHesapOzetleri');
    ozetEl.innerHTML = bankList.map(bank => {
      let balance = 0;
      // Tüm zamanlar bakiyesi
      cariTransactions.filter(t => t.account_id === bank.id).forEach(t => {
        const amt = parseFloat(t.amount || 0);
        if (t.type === 'TAHSİLAT') balance += amt;
        else if (t.type === 'ÖDEME') balance -= amt;
      });

      return `
        <div class="panel" style="min-height: auto; padding: 15px; border: 1.5px solid var(--line); box-shadow:none; text-align:center;">
          <h4 style="margin:0 0 5px 0; color:var(--ink-soft);">${bank.name}</h4>
          <div style="font-size: 20px; font-weight:bold; color:var(--accent-dark);">${balance.toFixed(2)} TL</div>
        </div>
      `;
    }).join('');

    const tbody = $('tblBankaRaporuBody');
    if (bankTxs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--ink-soft);">Filtrelere uygun banka hareketi bulunamadı.</td></tr>`;
    } else {
      let runningBalances = {};
      bankList.forEach(b => runningBalances[b.id] = 0);

      // Başlangıç bakiyelerini hesapla
      const start = $('inpRaporStart').value;
      if (start) {
        cariTransactions.forEach(t => {
          if (t.account_id && t.account_id !== 'MERKEZ_KASA' && t.date < start) {
            const amt = parseFloat(t.amount || 0);
            if (!runningBalances[t.account_id]) runningBalances[t.account_id] = 0;
            if (t.type === 'TAHSİLAT') runningBalances[t.account_id] += amt;
            else if (t.type === 'ÖDEME') runningBalances[t.account_id] -= amt;
          }
        });
      }

      tbody.innerHTML = bankTxs.map(t => {
        const amt = parseFloat(t.amount || 0);
        const bankName = bankList.find(b => b.id === t.account_id)?.name || 'Banka Hesabı';
        const cari = cariAccounts.find(c => c.id === t.cari_id);
        const cariName = cari ? cari.name : 'Banka Hareketi';
        let gelen = '—';
        let giden = '—';

        if (t.type === 'TAHSİLAT') {
          gelen = amt.toFixed(2) + ' TL';
          runningBalances[t.account_id] += amt;
        } else if (t.type === 'ÖDEME') {
          giden = amt.toFixed(2) + ' TL';
          runningBalances[t.account_id] -= amt;
        }

        return `<tr>
          <td>${fmtDate(t.date)}</td>
          <td><strong>${esc(bankName)}</strong></td>
          <td>${esc(cariName)}</td>
          <td>${esc(t.notes || '—')} (Ref: ${esc(t.ref_no || '—')})</td>
          <td style="text-align:right; color:var(--success); font-weight:bold;">${gelen}</td>
          <td style="text-align:right; color:var(--accent-dark); font-weight:bold;">${giden}</td>
          <td style="text-align:right; font-weight:bold;">${runningBalances[t.account_id].toFixed(2)} TL</td>
        </tr>`;
      }).join('');
    }
  }

  // --- 3. NAKİT AKIŞI RAPORU ---
  function renderNakitReport(txs) {
    let realizedIn = 0;
    let realizedOut = 0;
    
    // Gerçekleşenler (Tüm kasa/banka giriş çıkışları)
    txs.forEach(t => {
      const amt = parseFloat(t.amount || 0);
      if (t.type === 'TAHSİLAT') realizedIn += amt;
      else if (t.type === 'ÖDEME') realizedOut += amt;
    });

    // Beklenen Tahsilatlar (Bekleyen faturalar - 'bekleyen' durumlu satış faturaları)
    let expectedIn = 0;
    invoices.filter(i => i.category === 'bekleyen').forEach(i => {
      expectedIn += parseFloat(i.amount || 0);
    });

    // Beklenen Ödemeler (Onaylanan satın alma talepleri - Bütçesi onaylanmış ödeme planı bekleyenler)
    let expectedOut = 0;
    purchaseRequests.forEach(r => {
      if (['Bütçe Onaylandı', 'Ödeme Planı Hazır'].includes(r.status)) {
        expectedOut += parseFloat(r.totalPrice || 0);
      }
    });

    const netProj = (realizedIn + expectedIn) - (realizedOut + expectedOut);

    $('lblNakitGerceklesenTahsilat').textContent = realizedIn.toFixed(2) + ' TL';
    $('lblNakitGerceklesenOdeme').textContent = realizedOut.toFixed(2) + ' TL';
    $('lblNakitBeklenenTahsilat').textContent = expectedIn.toFixed(2) + ' TL';
    $('lblNakitBeklenenOdeme').textContent = expectedOut.toFixed(2) + ' TL';
    
    const netEl = $('lblNakitNetDurum');
    netEl.textContent = netProj.toFixed(2) + ' TL';
    netEl.style.color = netProj >= 0 ? 'var(--success)' : 'var(--danger)';

    // Çizelge (Chart.js) güncelleme
    if (chartNakitObj) chartNakitObj.destroy();
    const ctx = $('chartNakitAkisi').getContext('2d');
    chartNakitObj = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['Gerçekleşen Giriş', 'Gerçekleşen Çıkış', 'Beklenen Giriş', 'Beklenen Çıkış'],
        datasets: [{
          label: 'Nakit Pozisyonu (TL)',
          data: [realizedIn, realizedOut, expectedIn, expectedOut],
          backgroundColor: ['#2ecc71', '#e74c3c', '#82e0aa', '#f1948a']
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } }
      }
    });

    // Tablo doldurma
    const tbody = $('tblNakitAkisiBody');
    let items = [];

    // Gerçekleşenleri ekle
    txs.forEach(t => {
      items.push({
        date: t.date,
        type: 'Gerçekleşen ' + t.type,
        detail: cariAccounts.find(c => c.id === t.cari_id)?.name || 'Cari Hesap',
        notes: t.notes || '',
        in: t.type === 'TAHSİLAT' ? t.amount : 0,
        out: t.type === 'ÖDEME' ? t.amount : 0
      });
    });

    // Beklenen faturaları ekle
    invoices.filter(i => i.category === 'bekleyen').forEach(i => {
      items.push({
        date: i.date,
        type: 'Bekleyen Tahsilat',
        detail: cariAccounts.find(c => c.id === i.cariId)?.name || 'Cari Hesap',
        notes: `Fatura No: ${i.invoiceNo} (${i.notes || ''})`,
        in: i.amount,
        out: 0
      });
    });

    // Beklenen satın almaları ekle
    purchaseRequests.filter(r => ['Bütçe Onaylandı', 'Ödeme Planı Hazır'].includes(r.status)).forEach(r => {
      items.push({
        date: r.date,
        type: 'Bekleyen Ödeme',
        detail: `${r.dept} Birimi`,
        notes: `Satın Alma: ${r.product}`,
        in: 0,
        out: r.totalPrice
      });
    });

    items.sort((a, b) => a.date.localeCompare(b.date));

    let netPos = 0;
    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--ink-soft);">Nakit akış hareketi bulunmamaktadır.</td></tr>`;
    } else {
      tbody.innerHTML = items.map(item => {
        netPos += (item.in - item.out);
        return `<tr>
          <td>${fmtDate(item.date)}</td>
          <td><strong>${item.type}</strong></td>
          <td>${esc(item.detail)}</td>
          <td>${esc(item.notes)}</td>
          <td style="text-align:right; color:var(--success);">${item.in > 0 ? item.in.toFixed(2) + ' TL' : '—'}</td>
          <td style="text-align:right; color:var(--accent-dark);">${item.out > 0 ? item.out.toFixed(2) + ' TL' : '—'}</td>
          <td style="text-align:right; font-weight:bold; color:${netPos >= 0 ? 'var(--success)' : 'var(--accent-dark)'};">${netPos.toFixed(2)} TL</td>
        </tr>`;
      }).join('');
    }
  }

  // --- 4. GELİR - GİDER RAPORU ---
  function renderGelirGiderReport(txs) {
    let totals = {
      SATIS_GELIRI: 0,
      HIZMET_GELIRI: 0,
      DIGER_GELIR: 0,
      SATIS_MALIYETI: 0,
      FAALIYET_GIDERI: 0,
      DIGER_GIDER: 0
    };

    txs.forEach(t => {
      const amt = parseFloat(t.amount || 0);
      if (t.category && totals.hasOwnProperty(t.category)) {
        totals[t.category] += amt;
      }
    });

    // Fatura verilerinden de giderleri kategorileştirip ekleyelim
    invoices.forEach(i => {
      const amt = parseFloat(i.amount || 0);
      if (i.category === 'malzeme') totals.SATIS_MALIYETI += amt;
      else if (['hizmet', 'nakliye'].includes(i.category)) totals.FAALIYET_GIDERI += amt;
      else if (['elektrik', 'su', 'dogalgaz'].includes(i.category)) totals.FAALIYET_GIDERI += amt;
    });

    const totalGelir = totals.SATIS_GELIRI + totals.HIZMET_GELIRI + totals.DIGER_GELIR;
    const totalGider = totals.SATIS_MALIYETI + totals.FAALIYET_GIDERI + totals.DIGER_GIDER;
    const netResult = totalGelir - totalGider;

    $('lblGelirGiderTotalGelir').textContent = totalGelir.toFixed(2) + ' TL';
    $('lblGelirGiderTotalGider').textContent = totalGider.toFixed(2) + ' TL';
    
    const resultEl = $('lblGelirGiderNet');
    resultEl.textContent = netResult.toFixed(2) + ' TL';
    resultEl.style.color = netResult >= 0 ? 'var(--success)' : 'var(--danger)';

    // Grafik (Pie Chart) çizim
    if (chartGelirGiderPasta) chartGelirGiderPasta.destroy();
    const ctx = $('chartGelirGiderPasta').getContext('2d');
    chartGelirGiderPasta = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Satış Maliyeti', 'Faaliyet Giderleri', 'Diğer Giderler'],
        datasets: [{
          data: [totals.SATIS_MALIYETI, totals.FAALIYET_GIDERI, totals.DIGER_GIDER],
          backgroundColor: ['#e74c3c', '#f39c12', '#95a5a6']
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false
      }
    });

    // Tablo doldurma
    const tbody = $('tblGelirGiderBody');
    const categoriesMap = {
      SATIS_GELIRI: ['Gelir', 'Satış Gelirleri'],
      HIZMET_GELIRI: ['Gelir', 'Hizmet Gelirleri'],
      DIGER_GELIR: ['Gelir', 'Diğer Gelirler'],
      SATIS_MALIYETI: ['Gider', 'Satış Maliyetleri'],
      FAALIYET_GIDERI: ['Gider', 'Faaliyet Giderleri'],
      DIGER_GIDER: ['Gider', 'Diğer Giderler']
    };

    tbody.innerHTML = Object.keys(totals).map(key => {
      const isGelir = categoriesMap[key][0] === 'Gelir';
      return `<tr>
        <td>Dönem İçi</td>
        <td><strong>${categoriesMap[key][0]}</strong></td>
        <td>${categoriesMap[key][1]}</td>
        <td>Filtrelenen aralıktaki toplam hareketler</td>
        <td style="text-align:right; font-weight:bold; color:${isGelir ? 'var(--success)' : 'var(--accent-dark)'};">${totals[key].toFixed(2)} TL</td>
      </tr>`;
    }).join('');
  }

  // --- 5. KÂR - ZARAR RAPORU ---
  function renderKarZararReport(txs) {
    const start = $('inpRaporStart').value;
    const end = $('inpRaporEnd').value;
    $('lblKarZararPeriod').textContent = (start && end) ? `${fmtDate(start)} - ${fmtDate(end)}` : 'Tüm Dönemler';

    let sG = 0, hG = 0, sM = 0, fG = 0, dG = 0, dGi = 0;

    txs.forEach(t => {
      const amt = parseFloat(t.amount || 0);
      if (t.category === 'SATIS_GELIRI') sG += amt;
      else if (t.category === 'HIZMET_GELIRI') hG += amt;
      else if (t.category === 'SATIS_MALIYETI') sM += amt;
      else if (t.category === 'FAALIYET_GIDERI') fG += amt;
      else if (t.category === 'DIGER_GELIR') dG += amt;
      else if (t.category === 'DIGER_GIDER') dGi += amt;
    });

    // Fatura verileri
    invoices.forEach(i => {
      const amt = parseFloat(i.amount || 0);
      if (i.category === 'malzeme') sM += amt;
      else if (['hizmet', 'nakliye', 'elektrik', 'su', 'dogalgaz'].includes(i.category)) fG += amt;
    });

    const brutSales = sG + hG;
    const salesCost = sM;
    const brutKar = brutSales - salesCost;
    const faaliyetGid = fG;
    const faaliyetKar = brutKar - faaliyetGid;
    const digerNet = dG - dGi;
    const netKar = faaliyetKar + digerNet;

    $('valKzSatisGelirleri').textContent = brutSales.toFixed(2) + ' TL';
    $('valKzSatisG').textContent = sG.toFixed(2) + ' TL';
    $('valKzHizmetG').textContent = hG.toFixed(2) + ' TL';
    $('valKzSatisMaliyetleri').textContent = salesCost.toFixed(2) + ' TL';
    $('valKzSatisM').textContent = sM.toFixed(2) + ' TL';
    $('valKzBrutKar').textContent = brutKar.toFixed(2) + ' TL';
    $('valKzFaaliyetGiderleri').textContent = faaliyetGid.toFixed(2) + ' TL';
    $('valKzFaaliyetG').textContent = fG.toFixed(2) + ' TL';
    $('valKzFaaliyetKar').textContent = faaliyetKar.toFixed(2) + ' TL';
    $('valKzDigerNet').textContent = digerNet.toFixed(2) + ' TL';
    $('valKzDigerG').textContent = dG.toFixed(2) + ' TL';
    $('valKzDigerGi').textContent = dGi.toFixed(2) + ' TL';
    
    const netEl = $('valKzNetKar');
    netEl.textContent = netKar.toFixed(2) + ' TL';
    netEl.style.color = netKar >= 0 ? 'var(--success)' : 'var(--danger)';
  }

  // --- 6. BİLANÇO RAPORU ---
  function renderBilancoReport() {
    let kasaBal = 0;
    let bankaBal = 0;
    
    // Kasa ve banka bakiyeleri
    cariTransactions.forEach(t => {
      const amt = parseFloat(t.amount || 0);
      if (t.account_id === 'MERKEZ_KASA') {
        if (t.type === 'TAHSİLAT') kasaBal += amt;
        else if (t.type === 'ÖDEME') kasaBal -= amt;
      } else if (t.account_id) {
        if (t.type === 'TAHSİLAT') bankaBal += amt;
        else if (t.type === 'ÖDEME') bankaBal -= amt;
      }
    });

    let alacaklar = 0;
    let borclar = 0;

    cariAccounts.forEach(c => {
      const bal = calculateCariBalance(c.id);
      if (bal > 0) alacaklar += bal;
      else if (bal < 0) borclar += Math.abs(bal);
    });

    const donenVarliklar = kasaBal + bankaBal + alacaklar;
    const duranVarliklar = 150000.00; // Sabit Tesis Varlığı
    const toplamAktif = donenVarliklar + duranVarliklar;

    const kisaVadeliBorc = borclar;
    const uzunVadeliBorc = 50000.00; // Sabit Banka Kredisi
    const ozSermaye = toplamAktif - (kisaVadeliBorc + uzunVadeliBorc);

    $('valBKasa').textContent = kasaBal.toFixed(2) + ' TL';
    $('valBBankalar').textContent = bankaBal.toFixed(2) + ' TL';
    $('valBAlacaklar').textContent = alacaklar.toFixed(2) + ' TL';
    $('valBDonenVarliklar').textContent = donenVarliklar.toFixed(2) + ' TL';
    $('valBToplamAktif').textContent = toplamAktif.toFixed(2) + ' TL';
    $('valBBorclar').textContent = borclar.toFixed(2) + ' TL';
    $('valBKisaVadeliBorc').textContent = kisaVadeliBorc.toFixed(2) + ' TL';
    
    $('valBOzSermaye').textContent = ozSermaye.toFixed(2) + ' TL';
    $('valBSermayeKar').textContent = ozSermaye.toFixed(2) + ' TL';
    $('valBToplamPasif').textContent = toplamAktif.toFixed(2) + ' TL';
  }

  // --- 7. BORÇ - ALACAK RAPORU ---
  function renderBorcAlacakReport() {
    let alacakToplam = 0;
    let borcToplam = 0;
    let age0 = 0, age30 = 0, age60 = 0, age90 = 0, age120 = 0;
    let borc0 = 0, borc30 = 0, borc60 = 0, borc90 = 0, borc120 = 0;

    const tbody = $('tblBorcAlacakRaporuBody');
    
    const rows = cariAccounts.map(c => {
      const bal = calculateCariBalance(c.id);
      let borcVal = 0;
      let alacakVal = 0;

      // Cari hareketlerinden yaşlandırma hesabı
      const now = new Date();
      cariTransactions.filter(t => t.cari_id === c.id).forEach(t => {
        const tDate = new Date(t.date);
        const diffDays = Math.floor((now - tDate) / (1000 * 60 * 60 * 24));
        const amt = parseFloat(t.amount || 0);

        if (t.type === 'BORÇ' || t.type === 'ÖDEME') {
          if (diffDays <= 0) borc0 += amt;
          else if (diffDays <= 30) borc30 += amt;
          else if (diffDays <= 60) borc60 += amt;
          else if (diffDays <= 90) borc90 += amt;
          else borc120 += amt;
        } else if (t.type === 'ALACAK' || t.type === 'TAHSİLAT') {
          if (diffDays <= 0) age0 += amt;
          else if (diffDays <= 30) age30 += amt;
          else if (diffDays <= 60) age60 += amt;
          else if (diffDays <= 90) age90 += amt;
          else age120 += amt;
        }
      });

      if (bal > 0) {
        alacakVal = bal;
        alacakToplam += bal;
      } else if (bal < 0) {
        borcVal = Math.abs(bal);
        borcToplam += borcVal;
      }

      let riskColor = '#27ae60';
      let riskText = 'Düşük Risk';
      if (bal > 100000) {
        riskColor = '#e74c3c';
        riskText = 'Yüksek Risk';
      } else if (bal > 50000) {
        riskColor = '#f39c12';
        riskText = 'Orta Risk';
      }

      return `<tr>
        <td style="font-family:monospace;">${esc(c.code)}</td>
        <td><strong>${esc(c.name)}</strong></td>
        <td>${esc(c.type)}</td>
        <td style="text-align:right; color:var(--accent-dark);">${borcVal > 0 ? borcVal.toFixed(2) + ' TL' : '—'}</td>
        <td style="text-align:right; color:var(--success);">${alacakVal > 0 ? alacakVal.toFixed(2) + ' TL' : '—'}</td>
        <td style="text-align:right; font-weight:bold; color:${bal > 0 ? 'var(--success)' : (bal < 0 ? 'var(--accent-dark)' : 'var(--ink)')};">${bal.toFixed(2)} TL</td>
        <td style="text-align:center;"><span style="background:${riskColor}; color:#fff; padding:3px 8px; border-radius:4px; font-size:11px; font-weight:bold;">${riskText}</span></td>
      </tr>`;
    });

    tbody.innerHTML = rows.length === 0 
      ? `<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--ink-soft);">Kayıtlı cari hesap bulunmamaktadır.</td></tr>` 
      : rows.join('');

    // Yaşlandırma Analizi Değerleri
    $('lblYasAlacak0').textContent = age0.toFixed(2);
    $('lblYasAlacak30').textContent = age30.toFixed(2);
    $('lblYasAlacak60').textContent = age60.toFixed(2);
    $('lblYasAlacak90').textContent = age90.toFixed(2);
    $('lblYasAlacak120').textContent = age120.toFixed(2);

    $('lblYasBorc0').textContent = borc0.toFixed(2);
    $('lblYasBorc30').textContent = borc30.toFixed(2);
    $('lblYasBorc60').textContent = borc60.toFixed(2);
    $('lblYasBorc90').textContent =  borc90.toFixed(2);
    $('lblYasBorc120').textContent = borc120.toFixed(2);

    // Borç-Alacak Pasta Grafiği
    if (chartBorcAlacakPasta) chartBorcAlacakPasta.destroy();
    const ctx = $('chartBorcAlacakPasta').getContext('2d');
    chartBorcAlacakPasta = new Chart(ctx, {
      type: 'pie',
      data: {
        labels: ['Toplam Alacak', 'Toplam Borç'],
        datasets: [{
          data: [alacakToplam, borcToplam],
          backgroundColor: ['#2ecc71', '#e74c3c']
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false
      }
    });
  }

  // --- 8. AUDIT LOG RAPORU ---
  function renderAuditReport() {
    const tbody = $('tblAuditRaporuBody');
    if (!tbody) return;

    if (auditLogs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px; color:var(--ink-soft);">Sistem logu bulunmamaktadır.</td></tr>`;
      return;
    }

    tbody.innerHTML = auditLogs.map(l => {
      return `<tr>
        <td style="font-size:11px; color:var(--ink-soft);">${new Date(l.time).toLocaleString('tr-TR')}</td>
        <td style="font-weight:bold;">${esc(l.user)}</td>
        <td><span class="badge-status her-ikisi">${esc(l.role)}</span></td>
        <td><strong>${esc(l.action)}</strong></td>
        <td style="font-size:12px;">${esc(l.detail)}</td>
      </tr>`;
    }).join('');
  }

  // --- Rapor Seçimine Göre Gösterim ---
  function renderSelectedReport() {
    const txs = getFilteredTransactions();
    
    if (currentRaporSubtab === 'kasa') renderKasaReport(txs);
    else if (currentRaporSubtab === 'banka') renderBankaReport(txs);
    else if (currentRaporSubtab === 'nakit') renderNakitReport(txs);
    else if (currentRaporSubtab === 'gelirgider') renderGelirGiderReport(txs);
    else if (currentRaporSubtab === 'karzarar') renderKarZararReport(txs);
    else if (currentRaporSubtab === 'bilanco') renderBilancoReport();
    else if (currentRaporSubtab === 'borcalacak') renderBorcAlacakReport();
    else if (currentRaporSubtab === 'audit') renderAuditReport();
  }

  // --- DASHBOARD ÖZET KARTLARINI RENDER ETME ---
  function renderFinansDashboard() {
    const todayStr = todayISO();
    
    // Kasa / Banka Günlük Bakiyeleri
    let kasaBakiye = 0;
    let bankaBakiye = 0;

    cariTransactions.forEach(t => {
      const amt = parseFloat(t.amount || 0);
      if (t.account_id === 'MERKEZ_KASA') {
        if (t.type === 'TAHSİLAT') kasaBakiye += amt;
        else if (t.type === 'ÖDEME') kasaBakiye -= amt;
      } else if (t.account_id) {
        if (t.type === 'TAHSİLAT') bankaBakiye += amt;
        else if (t.type === 'ÖDEME') bankaBakiye -= amt;
      }
    });

    // Toplam Gelir, Gider ve Kâr
    let totalGelir = 0;
    let totalGider = 0;
    
    cariTransactions.forEach(t => {
      const amt = parseFloat(t.amount || 0);
      if (t.type === 'TAHSİLAT') totalGelir += amt;
      else if (t.type === 'ÖDEME') totalGider += amt;
    });

    invoices.forEach(i => {
      const amt = parseFloat(i.amount || 0);
      if (i.category === 'kesilen') totalGelir += amt;
      else if (i.category !== 'bekleyen' && i.category !== 'iptal') totalGider += amt;
    });

    const netKar = totalGelir - totalGider;

    // Alacak & Borç Bakiyeleri
    let totalAlacak = 0;
    let totalBorc = 0;
    cariAccounts.forEach(c => {
      const bal = calculateCariBalance(c.id);
      if (bal > 0) totalAlacak += bal;
      else if (bal < 0) totalBorc += Math.abs(bal);
    });

    // Bekleyenler
    let bekleyenTahsilat = 0;
    invoices.filter(i => i.category === 'bekleyen').forEach(i => {
      bekleyenTahsilat += i.amount;
    });

    let bekleyenOdeme = 0;
    purchaseRequests.filter(r => ['Talep Oluşturuldu', 'Muhasebe İncelemesinde'].includes(r.status)).forEach(r => {
      bekleyenOdeme += r.totalPrice;
    });

    const grid = $('finansStatsGrid');
    if (!grid) return;

    grid.innerHTML = `
      <div class="stat-card" style="border-left: 4px solid #2ecc71;">
        <h4 style="margin:0; font-size:11px; color:var(--ink-soft);">GÜNLÜK KASA BAKİYESİ</h4>
        <div class="val" style="font-size:18px; margin-top:5px; font-weight:bold;">${kasaBakiye.toFixed(2)} TL</div>
      </div>
      <div class="stat-card" style="border-left: 4px solid #3498db;">
        <h4 style="margin:0; font-size:11px; color:var(--ink-soft);">GÜNLÜK BANKA BAKİYESİ</h4>
        <div class="val" style="font-size:18px; margin-top:5px; font-weight:bold;">${bankaBakiye.toFixed(2)} TL</div>
      </div>
      <div class="stat-card" style="border-left: 4px solid #2ecc71;">
        <h4 style="margin:0; font-size:11px; color:var(--ink-soft);">TOPLAM GELİR</h4>
        <div class="val" style="font-size:18px; margin-top:5px; font-weight:bold; color:var(--success);">${totalGelir.toFixed(2)} TL</div>
      </div>
      <div class="stat-card" style="border-left: 4px solid #e74c3c;">
        <h4 style="margin:0; font-size:11px; color:var(--ink-soft);">TOPLAM GİDER</h4>
        <div class="val" style="font-size:18px; margin-top:5px; font-weight:bold; color:var(--danger);">${totalGider.toFixed(2)} TL</div>
      </div>
      <div class="stat-card" style="border-left: 4px solid #9b59b6;">
        <h4 style="margin:0; font-size:11px; color:var(--ink-soft);">NET KÂR</h4>
        <div class="val" style="font-size:18px; margin-top:5px; font-weight:bold; color:${netKar >= 0 ? 'var(--success)' : 'var(--danger)'};">${netKar.toFixed(2)} TL</div>
      </div>
      <div class="stat-card" style="border-left: 4px solid #1abc9c;">
        <h4 style="margin:0; font-size:11px; color:var(--ink-soft);">TOPLAM ALACAK</h4>
        <div class="val" style="font-size:18px; margin-top:5px; font-weight:bold; color:var(--success);">${totalAlacak.toFixed(2)} TL</div>
      </div>
      <div class="stat-card" style="border-left: 4px solid #e67e22;">
        <h4 style="margin:0; font-size:11px; color:var(--ink-soft);">TOPLAM BORÇ</h4>
        <div class="val" style="font-size:18px; margin-top:5px; font-weight:bold; color:var(--danger);">${totalBorc.toFixed(2)} TL</div>
      </div>
      <div class="stat-card" style="border-left: 4px solid #f1c40f;">
        <h4 style="margin:0; font-size:11px; color:var(--ink-soft);">BEKLEYEN TAHSİLAT</h4>
        <div class="val" style="font-size:18px; margin-top:5px; font-weight:bold;">${bekleyenTahsilat.toFixed(2)} TL</div>
      </div>
      <div class="stat-card" style="border-left: 4px solid #e74c3c;">
        <h4 style="margin:0; font-size:11px; color:var(--ink-soft);">BEKLEYEN ÖDEME</h4>
        <div class="val" style="font-size:18px; margin-top:5px; font-weight:bold;">${bekleyenOdeme.toFixed(2)} TL</div>
      </div>
    `;
  }

  // --- DIŞA AKTARMA VE YAZDIRMA DESTEĞİ ---
  function setupExportEvents() {
    const btnCSV = $('btnExportCSV');
    const newBtnCSV = btnCSV.cloneNode(true);
    btnCSV.parentNode.replaceChild(newBtnCSV, btnCSV);
    newBtnCSV.addEventListener('click', () => {
      exportToCSV();
    });

    const btnExcel = $('btnExportExcel');
    const newBtnExcel = btnExcel.cloneNode(true);
    btnExcel.parentNode.replaceChild(newBtnExcel, btnExcel);
    newBtnExcel.addEventListener('click', () => {
      exportToExcel();
    });

    const btnPDF = $('btnExportPDF');
    const newBtnPDF = btnPDF.cloneNode(true);
    btnPDF.parentNode.replaceChild(newBtnPDF, btnPDF);
    newBtnPDF.addEventListener('click', () => {
      saveAuditLog('PDF / Yazdırma', `${currentRaporSubtab.toUpperCase()} raporu yazdırıldı.`);
      window.print();
    });
  }

  function exportToCSV() {
    let rows = [];
    const tab = currentRaporSubtab;

    if (tab === 'kasa') {
      rows.push(['Tarih', 'Cari Hesap', 'Islem Turu', 'Kategori', 'Aciklama', 'Tutar']);
      getFilteredTransactions().filter(t => t.account_id === 'MERKEZ_KASA').forEach(t => {
        const cari = cariAccounts.find(c => c.id === t.cari_id)?.name || 'Genel Kasa';
        rows.push([t.date, cari, t.type, t.category || '', t.notes || '', t.amount]);
      });
    } else if (tab === 'banka') {
      rows.push(['Tarih', 'Banka Hesabi', 'Cari Hesap', 'Aciklama', 'Tur', 'Tutar']);
      getFilteredTransactions().filter(t => t.account_id && t.account_id !== 'MERKEZ_KASA').forEach(t => {
        const cari = cariAccounts.find(c => c.id === t.cari_id)?.name || 'Genel Banka';
        rows.push([t.date, t.account_id, cari, t.notes || '', t.type, t.amount]);
      });
    } else {
      rows.push(['Rapor Kalemi', 'Tutar']);
      rows.push(['Veri', 'Detaylar PDF veya Excel olarak goruntulenebilir']);
    }

    const csvContent = "data:text/csv;charset=utf-8," 
      + rows.map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(",")).join("\n");
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `finans_rapor_${tab}_${todayISO()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    saveAuditLog('CSV Aktarımı', `${tab.toUpperCase()} raporu CSV olarak indirildi.`);
    showToast('CSV dosyası başarıyla indirildi.');
  }

  function exportToExcel() {
    // Excel için basit HTML formatını XLS olarak kaydetme tekniği
    const tab = currentRaporSubtab;
    let html = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head><meta charset="utf-8"></head>
      <body>
        <h2>Finans Raporu - ${tab.toUpperCase()} (${todayISO()})</h2>
        <table border="1">
    `;

    let activeTableId = '';
    if (tab === 'kasa') activeTableId = 'tblKasaRaporuBody';
    else if (tab === 'banka') activeTableId = 'tblBankaRaporuBody';
    else if (tab === 'nakit') activeTableId = 'tblNakitAkisiBody';
    else if (tab === 'gelirgider') activeTableId = 'tblGelirGiderBody';
    else if (tab === 'karzarar') activeTableId = 'tblKarZararTablosu';
    else if (tab === 'borcalacak') activeTableId = 'tblBorcAlacakRaporuBody';
    else if (tab === 'audit') activeTableId = 'tblAuditRaporuBody';

    const tableBody = $(activeTableId);
    if (tableBody) {
      html += tableBody.innerHTML;
    } else {
      html += `<tr><td>Veri Bulunmamaktadir</td></tr>`;
    }

    html += '</table></body></html>';

    const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `finans_rapor_${tab}_${todayISO()}.xls`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    saveAuditLog('Excel Aktarımı', `${tab.toUpperCase()} raporu Excel (XLS) olarak indirildi.`);
    showToast('Excel dosyası başarıyla indirildi.');
  }

  // --- PROJELER BÖLÜMÜ MANTIĞI ---
  let projectsList = [];
  let projectsExtraData = {};

  function parseProjectsExtra() {
    projectsExtraData = {};
    // accountingRecords is sorted descending by created_at, so first found is the latest.
    accountingRecords.filter(r => r.type === 'project_extra').forEach(r => {
      const pId = r.data.projectId;
      if (!projectsExtraData[pId]) {
        projectsExtraData[pId] = r.data;
      }
    });
  }

  async function loadProjectsAndRender() {
    const tbody = $('projectsListTableBody');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:30px; color:var(--ink-soft);">Projeler yükleniyor...</td></tr>`;
    
    await loadAccountingRecords();
    parseProjectsExtra();

    if (useSupabase) {
      try {
        const { data, error } = await supabase.from('projects').select('*').order('crm_code', { ascending: false });
        if (error) throw error;
        projectsList = (data || []).filter(p => p.id !== '__settings__');
      } catch (e) {
        await loadProjectsFromLocalStorage();
      }
    } else {
      await loadProjectsFromLocalStorage();
    }
    
    renderProjectsTable();
  }

  async function loadProjectsFromLocalStorage() {
    try {
      const val = await getStorageItem('mimari-projeler-listesi');
      const list = val ? JSON.parse(val) : [];
      projectsList = list.filter(p => p.id !== '__settings__');
    } catch (e) {
      projectsList = [];
    }
  }

  function getProjectExtraValues(pId) {
    const defaultVals = {
      contract_status: 'bekliyor',
      production_status: 'bekliyor',
      loading_status: 'bekliyor',
      collected_amount: 0,
      approval_status: 'onaylandi',
      pending_changes: null
    };
    
    const extra = projectsExtraData[pId];
    if (!extra) return defaultVals;
    
    return {
      contract_status: extra.contract_status || 'bekliyor',
      production_status: extra.production_status || 'bekliyor',
      loading_status: extra.loading_status || 'bekliyor',
      collected_amount: parseFloat(extra.collected_amount || 0),
      approval_status: extra.approval_status || 'onaylandi',
      pending_changes: extra.pending_changes || null
    };
  }

  function renderProjectsTable() {
    const tbody = $('projectsListTableBody');
    if (!tbody) return;

    if (projectsList.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:30px; color:var(--ink-soft);">Kayıtlı proje bulunmamaktadır.</td></tr>`;
      return;
    }

    const userRole = (currentUser && currentUser.role) || 'MUHASEBE';
    const isManager = userRole === 'admin' || userRole === 'YÖNETİM' || userRole === 'YÖNETİCİ';

    tbody.innerHTML = projectsList.map(p => {
      let statusColor = 'var(--ink-soft)';
      if (p.status === 'Tamamlandı') statusColor = 'var(--success)';
      else if (p.status === 'Devam Ediyor') statusColor = 'var(--accent-dark)';
      else if (p.status === 'İptal') statusColor = 'var(--danger)';

      const extra = getProjectExtraValues(p.id);
      
      // Determine what values to show
      let showContract = extra.contract_status;
      let showProduction = extra.production_status;
      let showLoading = extra.loading_status;
      let showCollected = extra.collected_amount;

      // Badges
      const contractBadge = showContract === 'hazırlandı' 
        ? `<span class="px-2 py-1 text-xs font-semibold rounded bg-green-100 text-green-800">hazırlandı</span>`
        : `<span class="px-2 py-1 text-xs font-semibold rounded bg-slate-100 text-slate-800">bekliyor</span>`;
      
      const productionBadge = showProduction === 'hazırlandı'
        ? `<span class="px-2 py-1 text-xs font-semibold rounded bg-green-100 text-green-800">hazırlandı</span>`
        : `<span class="px-2 py-1 text-xs font-semibold rounded bg-slate-100 text-slate-800">bekliyor</span>`;

      const loadingBadge = showLoading === 'tamamlandı'
        ? `<span class="px-2 py-1 text-xs font-semibold rounded bg-green-100 text-green-800">tamamlandı</span>`
        : `<span class="px-2 py-1 text-xs font-semibold rounded bg-slate-100 text-slate-800">bekliyor</span>`;

      // Actions / Approval Column
      let actionHtml = '';
      if (extra.approval_status === 'onay_bekliyor') {
        const changes = extra.pending_changes || {};
        const changesDesc = `Sözleşme: ${changes.contract_status}, Üretim: ${changes.production_status}, Yükleme: ${changes.loading_status}, Tahsilat: ${parseFloat(changes.collected_amount || 0).toFixed(2)} TL`;
        
        if (isManager) {
          actionHtml = `
            <div class="flex flex-col gap-1 items-center" style="display:flex; flex-direction:column; gap:4px; align-items:center;">
              <span class="text-xs text-amber-600 font-bold" title="${changesDesc}">Onay Bekliyor ⏳</span>
              <div style="display:flex; gap:4px;">
                <button class="bg-emerald-600 hover:bg-emerald-700 text-white text-xs px-2 py-1 rounded" onclick="approveProjectChanges('${p.id}')">Onayla</button>
                <button class="bg-rose-600 hover:bg-rose-700 text-white text-xs px-2 py-1 rounded" onclick="rejectProjectChanges('${p.id}')">Reddet</button>
              </div>
            </div>
          `;
        } else {
          actionHtml = `<span class="text-xs text-amber-600 font-bold" title="${changesDesc}">Onay Bekliyor ⏳</span>`;
        }
      } else {
        actionHtml = `<button class="bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-3 py-1 rounded" onclick="openEditProjectModal('${p.id}')">Düzenle</button>`;
      }

      return `<tr>
        <td style="font-family:monospace; font-weight:bold;">${esc(p.crm_code)}</td>
        <td style="font-weight:700;">${esc(p.company)}</td>
        <td>${esc(p.project_type || '—')}</td>
        <td><span style="color:${statusColor}; font-weight:bold;">● ${esc(p.status || '—')}</span></td>
        <td>${contractBadge}</td>
        <td>${productionBadge}</td>
        <td>${loadingBadge}</td>
        <td style="text-align:right; font-weight:bold;">${showCollected.toFixed(2)} TL</td>
        <td style="text-align:center;">${actionHtml}</td>
      </tr>`;
    }).join('');
  }

  // --- PROJECT ACTIONS (EDIT, APPROVE, REJECT) ---
  window.openEditProjectModal = function(projectId) {
    const p = projectsList.find(pr => pr.id === projectId);
    if (!p) return;

    const extra = getProjectExtraValues(projectId);
    
    // Fill values (use proposed changes if pending, otherwise approved)
    const base = extra.approval_status === 'onay_bekliyor' && extra.pending_changes ? extra.pending_changes : extra;

    $('mdlEditProjectId').value = projectId;
    $('mdlSelContractStatus').value = base.contract_status || 'bekliyor';
    $('mdlSelProductionStatus').value = base.production_status || 'bekliyor';
    $('mdlSelLoadingStatus').value = base.loading_status || 'bekliyor';
    $('mdlInpCollectedAmount').value = base.collected_amount || 0;

    $('mdlEditProject').classList.remove('hidden');
  };

  $('btnCancelEditProject').addEventListener('click', () => {
    $('mdlEditProject').classList.add('hidden');
  });

  $('btnSaveEditProject').addEventListener('click', async () => {
    const projectId = $('mdlEditProjectId').value;
    const contract_status = $('mdlSelContractStatus').value;
    const production_status = $('mdlSelProductionStatus').value;
    const loading_status = $('mdlSelLoadingStatus').value;
    const collected_amount = parseFloat($('mdlInpCollectedAmount').value || 0);

    const oldExtra = getProjectExtraValues(projectId);

    const extraData = {
      projectId,
      contract_status: oldExtra.contract_status, // Keep original values as approved
      production_status: oldExtra.production_status,
      loading_status: oldExtra.loading_status,
      collected_amount: oldExtra.collected_amount,
      approval_status: 'onay_bekliyor',
      pending_changes: {
        contract_status,
        production_status,
        loading_status,
        collected_amount
      }
    };

    const record = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      type: 'project_extra',
      data: extraData,
      uploadedBy: currentUser ? (currentUser.personnelName || currentUser.username) : 'Anonim',
      createdAt: new Date().toISOString()
    };

    await saveAccountingRecord(record);
    $('mdlEditProject').classList.add('hidden');
    showToast('Değişiklikler onay için yöneticiye gönderildi.');
    await loadProjectsAndRender();
  });

  window.approveProjectChanges = async function(projectId) {
    const extra = getProjectExtraValues(projectId);
    if (!extra || !extra.pending_changes) return;

    const approvedData = {
      projectId,
      contract_status: extra.pending_changes.contract_status,
      production_status: extra.pending_changes.production_status,
      loading_status: extra.pending_changes.loading_status,
      collected_amount: extra.pending_changes.collected_amount,
      approval_status: 'onaylandi',
      pending_changes: null
    };

    const record = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      type: 'project_extra',
      data: approvedData,
      uploadedBy: currentUser ? (currentUser.personnelName || currentUser.username) : 'Anonim',
      createdAt: new Date().toISOString()
    };

    await saveAccountingRecord(record);
    showToast('Değişiklikler başarıyla onaylandı.');
    await loadProjectsAndRender();
  };

  window.rejectProjectChanges = async function(projectId) {
    const extra = getProjectExtraValues(projectId);
    if (!extra) return;

    const rejectedData = {
      projectId,
      contract_status: extra.contract_status,
      production_status: extra.production_status,
      loading_status: extra.loading_status,
      collected_amount: extra.collected_amount,
      approval_status: 'onaylandi', // Reset to approved state
      pending_changes: null
    };

    const record = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      type: 'project_extra',
      data: rejectedData,
      uploadedBy: currentUser ? (currentUser.personnelName || currentUser.username) : 'Anonim',
      createdAt: new Date().toISOString()
    };

    await saveAccountingRecord(record);
    showToast('Değişiklikler reddedildi.');
    await loadProjectsAndRender();
  };

  // --- Initializer ---
  async function init() {
    checkSession();
    await loadCariData();
    await loadAccountingRecords();
    
    // Rapor modülü ilk sekme kontrolü
    if ($('panel-raporlar')) {
      await loadAuditLogs();
    }
  }
  init();
})();
