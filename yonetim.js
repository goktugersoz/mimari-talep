(function () {
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
  const STORAGE_KEY_PURCHASE = 'mimari-satinalma-talepleri';
  const STORAGE_KEY_PURCHASE_LOGS = 'mimari-satinalma-islem-gecmisi';

  let currentUser = null;
  let projectsList = [];
  let accountingRecords = [];
  let purchaseRequests = [];
  let projectsExtraData = {};
  let currentYonetimTab = 'projects-pending';

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

  // --- Session Validation ---
  function checkSession() {
    const stored = sessionStorage.getItem('mimari-session');
    if (stored) {
      try {
        const u = JSON.parse(stored);
        const isManager = u && (u.role === 'admin' || u.role === 'YÖNETİM' || u.role === 'YÖNETİCİ');
        if (isManager) {
          currentUser = u;
          $('lblCurrentYonetimUser').textContent = `${currentUser.username} (${currentUser.role})`;
          return;
        }
      } catch (e) { }
    }
    // Redirect if not manager
    window.location.href = 'index.html';
  }

  function handleLogout() {
    sessionStorage.removeItem('mimari-session');
    window.location.href = 'index.html';
  }

  // --- Storage Fallbacks ---
  async function getStorageItem(key) {
    if (window.storage && typeof window.storage.get === 'function') {
      const res = await window.storage.get(key, true);
      return res && res.value ? res.value : null;
    }
    return window.localStorage ? window.localStorage.getItem(key) : null;
  }

  async function setStorageItem(key, value) {
    if (window.storage && typeof window.storage.set === 'function') {
      return await window.storage.set(key, value, true);
    }
    if (window.localStorage) {
      window.localStorage.setItem(key, value);
      return true;
    }
    return false;
  }

  // --- Data Loading ---
  async function loadData() {
    checkSession();
    if (useSupabase) {
      $('yonetimStorageWarning').classList.remove('hidden');
    }

    await loadProjects();
    await loadAccountingRecords();
    await loadPurchaseRequests();
    
    parseProjectsExtra();
    renderAll();
  }

  async function loadProjects() {
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
      } catch (e) {
        await loadAccountingFromLocalStorage();
      }
    } else {
      await loadAccountingFromLocalStorage();
    }
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
    accountingRecords.unshift(record);
    await setStorageItem(STORAGE_KEY_ACCOUNTING, JSON.stringify(accountingRecords));
    return true;
  }

  async function loadPurchaseRequests() {
    if (useSupabase) {
      try {
        const { data, error } = await supabase.from('purchase_requests').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        purchaseRequests = (data || []).map(r => ({
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
      } catch (err) {
        await loadPurchaseFromLocalStorage();
      }
    } else {
      await loadPurchaseFromLocalStorage();
    }
  }

  async function loadPurchaseFromLocalStorage() {
    try {
      const val = await getStorageItem(STORAGE_KEY_PURCHASE);
      purchaseRequests = val ? JSON.parse(val) : [];
    } catch (e) {
      purchaseRequests = [];
    }
  }

  async function updatePurchaseRequestStatus(id, newStatus) {
    if (useSupabase) {
      try {
        const { error } = await supabase.from('purchase_requests').update({ status: newStatus }).eq('id', id);
        if (error) throw error;
      } catch (e) {
        console.error(e);
      }
    }
    const req = purchaseRequests.find(r => r.id === id);
    if (req) {
      req.status = newStatus;
    }
    await setStorageItem(STORAGE_KEY_PURCHASE, JSON.stringify(purchaseRequests));
  }

  // --- Parse project extras ---
  function parseProjectsExtra() {
    projectsExtraData = {};
    accountingRecords.filter(r => r.type === 'project_extra').forEach(r => {
      const pId = r.data.projectId;
      if (!projectsExtraData[pId]) {
        projectsExtraData[pId] = r.data;
      }
    });
  }

  // --- Rendering ---
  function renderAll() {
    renderProjectsApprovals();
    renderPurchaseApprovals();
  }

  function renderProjectsApprovals() {
    const tbody = $('tblYonetimProjectsBody');
    if (!tbody) return;

    // Filter projects that have approval_status === 'onay_bekliyor'
    const pendingList = projectsList.filter(p => {
      const extra = projectsExtraData[p.id];
      return extra && extra.approval_status === 'onay_bekliyor';
    });

    if (pendingList.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:30px; color:var(--ink-soft);">Onay bekleyen proje bilgi güncellemesi bulunmamaktadır.</td></tr>`;
      return;
    }

    tbody.innerHTML = pendingList.map(p => {
      const extra = projectsExtraData[p.id];
      const proposed = extra.pending_changes || {};

      // Current values
      const curContract = extra.contract_status || 'bekliyor';
      const curProduction = extra.production_status || 'bekliyor';
      const curLoading = extra.loading_status || 'bekliyor';
      const curCollected = parseFloat(extra.collected_amount || 0);

      const currentDesc = `Sözleşme: ${curContract}, Üretim: ${curProduction}, Yükleme: ${curLoading}, Tahsilat: ${curCollected.toFixed(2)} TL`;

      return `<tr>
        <td><strong>Muhasebe Birimi</strong></td>
        <td style="font-family:monospace; font-weight:bold;">${esc(p.crm_code)}</td>
        <td style="font-weight:700;">${esc(p.company)}</td>
        <td style="font-size:12px; color:var(--ink-soft);">${currentDesc}</td>
        <td style="background:#fef9e7;"><span class="px-2 py-1 text-xs font-bold rounded bg-amber-100 text-amber-800">${esc(proposed.contract_status)}</span></td>
        <td style="background:#fef9e7;"><span class="px-2 py-1 text-xs font-bold rounded bg-amber-100 text-amber-800">${esc(proposed.production_status)}</span></td>
        <td style="background:#fef9e7;"><span class="px-2 py-1 text-xs font-bold rounded bg-amber-100 text-amber-800">${esc(proposed.loading_status)}</span></td>
        <td style="text-align:right; font-weight:bold; background:#fef9e7;">${parseFloat(proposed.collected_amount || 0).toFixed(2)} TL</td>
        <td style="text-align:center;">
          <div style="display:flex; gap:6px; justify-content:center;">
            <button class="bg-emerald-600 hover:bg-emerald-700 text-white text-xs px-3 py-1.5 rounded font-bold" onclick="approveProjectChanges('${p.id}')">Onayla</button>
            <button class="bg-rose-600 hover:bg-rose-700 text-white text-xs px-3 py-1.5 rounded font-bold" onclick="rejectProjectChanges('${p.id}')">Reddet</button>
          </div>
        </td>
      </tr>`;
    }).join('');
  }

  function renderPurchaseApprovals() {
    const tbody = $('tblYonetimPurchaseBody');
    if (!tbody) return;

    // Filter purchase requests with status === 'Talep Oluşturuldu' or 'Muhasebe İncelemesinde'
    const pendingList = purchaseRequests.filter(r => ['Talep Oluşturuldu', 'Muhasebe İncelemesinde'].includes(r.status));

    if (pendingList.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:30px; color:var(--ink-soft);">Onay bekleyen satın alma talebi bulunmamaktadır.</td></tr>`;
      return;
    }

    tbody.innerHTML = pendingList.map(r => {
      return `<tr>
        <td style="font-family:monospace; font-weight:bold;">${esc(r.reqNo)}</td>
        <td>${fmtDate(r.date)}</td>
        <td><span class="px-2 py-1 text-xs font-bold rounded bg-blue-100 text-blue-800">${esc(r.dept)}</span></td>
        <td style="font-weight:700;">${esc(r.product)}</td>
        <td style="text-align:right;">${r.qty}</td>
        <td style="text-align:right;">${r.unitPrice.toFixed(2)} TL</td>
        <td style="text-align:right; font-weight:bold; color:var(--accent-dark);">${r.totalPrice.toFixed(2)} TL</td>
        <td style="text-align:center;">
          <div style="display:flex; gap:6px; justify-content:center;">
            <button class="bg-emerald-600 hover:bg-emerald-700 text-white text-xs px-3 py-1.5 rounded font-bold" onclick="approvePurchase('${r.id}')">Bütçe Onayla</button>
            <button class="bg-rose-600 hover:bg-rose-700 text-white text-xs px-3 py-1.5 rounded font-bold" onclick="rejectPurchase('${r.id}')">Reddet</button>
          </div>
        </td>
      </tr>`;
    }).join('');
  }

  // --- ACTIONS ---
  window.approveProjectChanges = async function(projectId) {
    const extra = projectsExtraData[projectId];
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
      uploadedBy: currentUser ? currentUser.username : 'Yönetim',
      createdAt: new Date().toISOString()
    };

    await saveAccountingRecord(record);
    showToast('Proje güncellemesi onaylandı.');
    await loadData();
  };

  window.rejectProjectChanges = async function(projectId) {
    const extra = projectsExtraData[projectId];
    if (!extra) return;

    const rejectedData = {
      projectId,
      contract_status: extra.contract_status,
      production_status: extra.production_status,
      loading_status: extra.loading_status,
      collected_amount: extra.collected_amount,
      approval_status: 'onaylandi',
      pending_changes: null
    };

    const record = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      type: 'project_extra',
      data: rejectedData,
      uploadedBy: currentUser ? currentUser.username : 'Yönetim',
      createdAt: new Date().toISOString()
    };

    await saveAccountingRecord(record);
    showToast('Proje güncellemesi reddedildi.');
    await loadData();
  };

  window.approvePurchase = async function(id) {
    const req = purchaseRequests.find(r => r.id === id);
    if (!req) return;

    await updatePurchaseRequestStatus(id, 'Bütçe Onaylandı');
    
    // Log purchase action
    const log = {
      id: Date.now().toString(36),
      date: new Date().toISOString(),
      user: currentUser ? currentUser.username : 'Yönetim',
      action: `${req.reqNo} nolu satın alma talebinin bütçesi yönetim tarafından onaylandı.`
    };
    try {
      const logs = await getStorageItem(STORAGE_KEY_PURCHASE_LOGS);
      const logList = logs ? JSON.parse(logs) : [];
      logList.unshift(log);
      await setStorageItem(STORAGE_KEY_PURCHASE_LOGS, JSON.stringify(logList));
    } catch(e){}

    showToast('Satın alma bütçesi onaylandı.');
    await loadData();
  };

  window.rejectPurchase = async function(id) {
    const req = purchaseRequests.find(r => r.id === id);
    if (!req) return;

    await updatePurchaseRequestStatus(id, 'Reddedildi');
    
    // Log action
    const log = {
      id: Date.now().toString(36),
      date: new Date().toISOString(),
      user: currentUser ? currentUser.username : 'Yönetim',
      action: `${req.reqNo} nolu satın alma talebi yönetim tarafından reddedildi.`
    };
    try {
      const logs = await getStorageItem(STORAGE_KEY_PURCHASE_LOGS);
      const logList = logs ? JSON.parse(logs) : [];
      logList.unshift(log);
      await setStorageItem(STORAGE_KEY_PURCHASE_LOGS, JSON.stringify(logList));
    } catch(e){}

    showToast('Satın alma talebi reddedildi.');
    await loadData();
  };

  // --- Tab switching ---
  function switchYonetimTab(tabName) {
    currentYonetimTab = tabName;
    document.querySelectorAll('[data-yonetim-tab]').forEach(tab => {
      tab.classList.toggle('active', tab.getAttribute('data-yonetim-tab') === tabName);
    });
    $('panel-projects-pending').classList.toggle('hidden', tabName !== 'projects-pending');
    $('panel-purchase-pending').classList.toggle('hidden', tabName !== 'purchase-pending');
  }

  // --- Navigation & Bindings ---
  $('btnYonetimLogout').addEventListener('click', handleLogout);
  $('btnGoToBoard').addEventListener('click', () => { window.location.href = 'index.html'; });
  $('btnGoToAccounting').addEventListener('click', () => { window.location.href = 'muhasebe.html'; });

  document.querySelectorAll('[data-yonetim-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      switchYonetimTab(tab.getAttribute('data-yonetim-tab'));
    });
  });

  // --- Init ---
  loadData();
})();
