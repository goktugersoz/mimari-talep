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
  const STORAGE_KEY_USERS = 'mimari-kullanicilar';

  let currentUser = null;
  let projectsList = [];
  let accountingRecords = [];
  let purchaseRequests = [];
  let projectsExtraData = {};
  let currentYonetimTab = 'projects-pending';

  let personnelList = [];
  let users = [];
  let crmStartCode = '26-00370';
  let monthlyChartInstance = null;
  let personnelChartInstance = null;
  let personnelDetailChartInstance = null;
  let selectedPersonnelStatsFilter = '__all__';
  let draftProjectsList = [];
  let fabrikaOrders = [];
  const STORAGE_KEY_FABRIKA = 'mimari-fabrika-talepleri';

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
    await loadPersonnel();
    await loadUsers();
    await loadCrmStartCode();
    await loadFabrikaOrders();
    await loadDraftProjects();
    
    parseProjectsExtra();
    renderAll();
  }

  async function loadDraftProjects() {
    if (useSupabase) {
      try {
        const { data, error } = await supabase.from('draft_projects').select('*');
        if (error) throw error;
        draftProjectsList = data || [];
      } catch (e) {
        console.error("Yonetim loadDraftProjects error:", e);
        draftProjectsList = [];
      }
    } else {
      draftProjectsList = [];
    }
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
    renderPersonnelPanel();
    renderUsersPanel();
    renderFabrikaOrders();
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

  // --- PERSONNEL MANAGEMENT ---
  async function loadPersonnel() {
    if (useSupabase) {
      try {
        const { data, error } = await supabase.from('personnel').select('name');
        if (error) throw error;
        personnelList = (data || []).map(p => p.name);
      } catch (e) {
        await loadPersonnelFromLocalStorage();
      }
    } else {
      await loadPersonnelFromLocalStorage();
    }
  }

  async function loadPersonnelFromLocalStorage() {
    try {
      const val = await getStorageItem('personel-listesi');
      personnelList = val ? JSON.parse(val) : [];
    } catch(e) { personnelList = []; }
  }

  async function savePersonnel() {
    return await setStorageItem('personel-listesi', JSON.stringify(personnelList));
  }

  // --- STATS RENDERING ---
  function normName(s) {
    return (s || '').trim().toLocaleLowerCase('tr-TR');
  }

  function resolvePersonnelName(raw) {
    if (!raw) return '';
    const trimmed = String(raw).trim();
    if (!trimmed || trimmed === '—' || trimmed === '-' || trimmed.toLowerCase() === 'null') return '';
    const lower = normName(trimmed);

    // Direct match against personnelList
    for (const p of personnelList) {
      if (normName(p) === lower) return p.trim();
    }

    // Match against users (username or personnelName)
    for (const u of users) {
      const uUser = normName(u.username);
      const uPers = normName(u.personnelName);
      if (lower === uUser || lower === uPers) {
        return (u.personnelName || u.username).trim();
      }
    }

    // Partial contains in personnelList
    for (const p of personnelList) {
      const pLower = normName(p);
      if (pLower.includes(lower) || lower.includes(pLower)) {
        return p.trim();
      }
    }

    return trimmed;
  }

  function getPersonnelStatsList() {
    const map = new Map();

    const getOrCreate = (name) => {
      const key = normName(name);
      if (!map.has(key)) {
        map.set(key, {
          name: name,
          projeCount: 0,
          taslakCount: 0,
          projeBekliyor: 0,
          projeYapildi: 0,
          total: 0
        });
      }
      return map.get(key);
    };

    // 1. Personnel list
    personnelList.forEach(p => {
      const name = resolvePersonnelName(p);
      if (name) getOrCreate(name);
    });

    // 2. Users list
    users.forEach(u => {
      const pName = resolvePersonnelName(u.personnelName || u.username);
      if (pName) getOrCreate(pName);
    });

    // 3. Projects from projectsList
    projectsList.forEach(p => {
      if (!p.employee) return;
      const name = resolvePersonnelName(p.employee);
      if (!name) return;
      const item = getOrCreate(name);
      item.projeCount++;
      if ((p.status || 'Bekliyor') === 'Yapıldı') {
        item.projeYapildi++;
      } else {
        item.projeBekliyor++;
      }
      item.total++;
    });

    // 4. Drafts from draftProjectsList
    draftProjectsList.forEach(d => {
      const author = d.uploaded_by || d.uploadedBy;
      if (!author) return;
      const name = resolvePersonnelName(author);
      if (!name) return;
      const item = getOrCreate(name);
      item.taslakCount++;
      item.total++;
    });

    return Array.from(map.values()).sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      return a.name.localeCompare(b.name, 'tr-TR');
    });
  }

  function renderPersonnelStatsFilter(allStats) {
    const sel = $('selPersonnelStatsFilter');
    if (!sel) return;

    const currentVal = selectedPersonnelStatsFilter;
    let html = `<option value="__all__">📊 Tüm Personeller (Karşılaştırma Görünümü)</option>`;
    allStats.forEach(item => {
      const isSelected = item.name === currentVal ? 'selected' : '';
      html += `<option value="${esc(item.name)}" ${isSelected}>${esc(item.name)} (${item.projeCount} Proje, ${item.taslakCount} Taslak)</option>`;
    });
    sel.innerHTML = html;
    sel.value = currentVal;
    if (sel.value !== currentVal) {
      sel.value = '__all__';
      selectedPersonnelStatsFilter = '__all__';
    }
  }

  function renderPersonnelKpiCards(allStats, selectedPersonName) {
    const container = $('personnelKpiContainer');
    if (!container) return;

    let projeCount = 0;
    let taslakCount = 0;
    let totalCount = 0;
    let bekleyenCount = 0;
    let yapildiCount = 0;

    if (selectedPersonName && selectedPersonName !== '__all__') {
      const found = allStats.find(x => normName(x.name) === normName(selectedPersonName));
      if (found) {
        projeCount = found.projeCount;
        taslakCount = found.taslakCount;
        totalCount = found.total;
        bekleyenCount = found.projeBekliyor;
        yapildiCount = found.projeYapildi;
      }
    } else {
      allStats.forEach(x => {
        projeCount += x.projeCount;
        taslakCount += x.taslakCount;
        totalCount += x.total;
        bekleyenCount += x.projeBekliyor;
        yapildiCount += x.projeYapildi;
      });
    }

    const taslakRatio = totalCount > 0 ? Math.round((taslakCount / totalCount) * 100) : 0;
    const projeRatio = totalCount > 0 ? Math.round((projeCount / totalCount) * 100) : 0;

    container.innerHTML = `
      <div class="kpi-card kpi-proje">
        <div class="kpi-head">
          <span class="kpi-label">Çizilen Proje</span>
          <span class="kpi-icon">📐</span>
        </div>
        <div class="kpi-val" style="color:#2563eb;">${projeCount}</div>
        <div class="kpi-sub">Kayıtlı mimari projeler (${projeRatio}% pay)</div>
      </div>

      <div class="kpi-card kpi-taslak">
        <div class="kpi-head">
          <span class="kpi-label">Çizilen Taslak</span>
          <span class="kpi-icon">📝</span>
        </div>
        <div class="kpi-val" style="color:#f59e0b;">${taslakCount}</div>
        <div class="kpi-sub">Sisteme yüklenen taslaklar (${taslakRatio}% pay)</div>
      </div>

      <div class="kpi-card kpi-total">
        <div class="kpi-head">
          <span class="kpi-label">Toplam Çizim</span>
          <span class="kpi-icon">📊</span>
        </div>
        <div class="kpi-val" style="color:#10b981;">${totalCount}</div>
        <div class="kpi-sub">Üretilen proje ve taslak toplamı</div>
      </div>

      <div class="kpi-card kpi-pending">
        <div class="kpi-head">
          <span class="kpi-label">Bekleyen Projeler</span>
          <span class="kpi-icon">⏳</span>
        </div>
        <div class="kpi-val" style="color:#ef4444;">${bekleyenCount}</div>
        <div class="kpi-sub">Çizim veya revizyon aşamasında</div>
      </div>

      <div class="kpi-card kpi-done">
        <div class="kpi-head">
          <span class="kpi-label">Tamamlanan Projeler</span>
          <span class="kpi-icon">✅</span>
        </div>
        <div class="kpi-val" style="color:#059669;">${yapildiCount}</div>
        <div class="kpi-sub">Çizimi tamamlanmış projeler</div>
      </div>
    `;
  }

  function renderPersonnelCharts(allStats, selectedPersonName) {
    const canvasMain = document.getElementById('personnelChart');
    if (!canvasMain) return;
    const ctxMain = canvasMain.getContext('2d');

    if (personnelChartInstance) {
      personnelChartInstance.destroy();
      personnelChartInstance = null;
    }

    const isAll = !selectedPersonName || selectedPersonName === '__all__';

    const labels = allStats.map(s => s.name);
    const projeData = allStats.map(s => s.projeCount);
    const taslakData = allStats.map(s => s.taslakCount);

    const projeBg = allStats.map(s => {
      if (isAll) return 'rgba(37, 99, 235, 0.85)';
      return normName(s.name) === normName(selectedPersonName) ? 'rgba(37, 99, 235, 1)' : 'rgba(37, 99, 235, 0.2)';
    });
    const projeBorder = allStats.map(s => {
      if (isAll) return '#1d4ed8';
      return normName(s.name) === normName(selectedPersonName) ? '#1d4ed8' : 'rgba(29, 78, 216, 0.3)';
    });

    const taslakBg = allStats.map(s => {
      if (isAll) return 'rgba(245, 158, 11, 0.85)';
      return normName(s.name) === normName(selectedPersonName) ? 'rgba(245, 158, 11, 1)' : 'rgba(245, 158, 11, 0.2)';
    });
    const taslakBorder = allStats.map(s => {
      if (isAll) return '#d97706';
      return normName(s.name) === normName(selectedPersonName) ? '#d97706' : 'rgba(217, 119, 6, 0.3)';
    });

    personnelChartInstance = new Chart(ctxMain, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Çizilen Proje',
            data: projeData,
            backgroundColor: projeBg,
            borderColor: projeBorder,
            borderWidth: 1.5,
            borderRadius: 6
          },
          {
            label: 'Çizilen Taslak',
            data: taslakData,
            backgroundColor: taslakBg,
            borderColor: taslakBorder,
            borderWidth: 1.5,
            borderRadius: 6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              font: { family: 'Roboto', size: 12, weight: '500' },
              color: '#32373c'
            }
          },
          y: {
            beginAtZero: true,
            ticks: {
              stepSize: 1,
              font: { family: 'JetBrains Mono', size: 11 },
              color: '#6c757d'
            },
            grid: {
              color: '#f1f5f9'
            }
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.9)',
            titleFont: { family: 'Montserrat', size: 13, weight: 'bold' },
            bodyFont: { family: 'Roboto', size: 12 },
            padding: 12,
            cornerRadius: 8,
            callbacks: {
              afterBody: function(items) {
                const idx = items[0].dataIndex;
                const total = (projeData[idx] || 0) + (taslakData[idx] || 0);
                return `\nToplam Çizim: ${total} adet`;
              }
            }
          }
        }
      }
    });

    // Secondary Doughnut Chart (Breakdown)
    const canvasDetail = document.getElementById('personnelDetailChart');
    if (!canvasDetail) return;
    const ctxDetail = canvasDetail.getContext('2d');

    if (personnelDetailChartInstance) {
      personnelDetailChartInstance.destroy();
      personnelDetailChartInstance = null;
    }

    let detailProje = 0;
    let detailTaslak = 0;
    let detailTitle = "Tüm Ekip Çizim Dağılımı";
    let detailSub = "Genel proje ve taslak payı";

    if (!isAll) {
      const found = allStats.find(x => normName(x.name) === normName(selectedPersonName));
      if (found) {
        detailProje = found.projeCount;
        detailTaslak = found.taslakCount;
        detailTitle = `${found.name} Çizim Dağılımı`;
        detailSub = `${found.total} toplam çizimin oransal dağılımı`;
      }
    } else {
      allStats.forEach(x => {
        detailProje += x.projeCount;
        detailTaslak += x.taslakCount;
      });
    }

    if ($('personnelDetailChartTitle')) $('personnelDetailChartTitle').textContent = detailTitle;
    if ($('personnelDetailChartSub')) $('personnelDetailChartSub').textContent = detailSub;

    const hasData = (detailProje + detailTaslak) > 0;

    personnelDetailChartInstance = new Chart(ctxDetail, {
      type: 'doughnut',
      data: {
        labels: hasData ? ['Çizilen Proje', 'Çizilen Taslak'] : ['Veri Yok'],
        datasets: [{
          data: hasData ? [detailProje, detailTaslak] : [1],
          backgroundColor: hasData ? ['#2563eb', '#f59e0b'] : ['#e2e8f0'],
          borderColor: '#ffffff',
          borderWidth: 3,
          hoverOffset: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              font: { family: 'Roboto', size: 12, weight: '600' },
              padding: 14
            }
          },
          tooltip: {
            callbacks: {
              label: function(item) {
                if (!hasData) return ' Henüz çizim verisi yok';
                const total = detailProje + detailTaslak;
                const val = item.raw || 0;
                const pct = total > 0 ? Math.round((val / total) * 100) : 0;
                return ` ${item.label}: ${val} adet (%${pct})`;
              }
            }
          }
        },
        cutout: '65%'
      }
    });
  }

  function renderPersonnelTable(allStats, selectedPersonName) {
    const tbody = $('tblPersonnelStatsBody');
    if (!tbody) return;

    if ($('lblTotalPersonnelCount')) {
      $('lblTotalPersonnelCount').textContent = allStats.length;
    }

    const myName = currentUser ? resolvePersonnelName(currentUser.personnelName || currentUser.username) : '';

    if (allStats.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:20px; color:var(--ink-soft);">Personel bulunamadı.</td></tr>`;
      return;
    }

    tbody.innerHTML = allStats.map(s => {
      const isMe = myName && normName(s.name) === normName(myName);
      const isSelected = selectedPersonName && normName(s.name) === normName(selectedPersonName);
      const rowClass = isSelected ? 'row-highlighted' : '';
      const meBadge = isMe ? `<span style="background:var(--ink); color:#fff; font-size:10px; padding:2px 6px; border-radius:4px; margin-left:6px; font-weight:700;">SİZ</span>` : '';

      return `
        <tr class="${rowClass}">
          <td style="padding:12px 14px; font-weight:600; color:var(--ink);">
            ${esc(s.name)} ${meBadge}
          </td>
          <td style="padding:12px 14px; text-align:center;">
            <span class="badge-count-proje">${s.projeCount} Proje</span>
          </td>
          <td style="padding:12px 14px; text-align:center;">
            <span class="badge-count-taslak">${s.taslakCount} Taslak</span>
          </td>
          <td style="padding:12px 14px; text-align:center;">
            <span class="badge-count-total">${s.total} Çizim</span>
          </td>
          <td style="padding:12px 14px; text-align:center; font-size:12px;">
            <span style="color:#ef4444; font-weight:600;">${s.projeBekliyor} Bekleyen</span> · 
            <span style="color:#059669; font-weight:600;">${s.projeYapildi} Tamamlanan</span>
          </td>
          <td style="padding:12px 14px; text-align:center;">
            <button type="button" class="btn-table-examine" data-examine="${esc(s.name)}">
              🔍 İncele
            </button>
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('[data-examine]').forEach(btn => {
      btn.addEventListener('click', () => {
        const pName = btn.getAttribute('data-examine');
        const sel = $('selPersonnelStatsFilter');
        if (sel) {
          sel.value = pName;
          selectedPersonnelStatsFilter = pName;
          updatePersonnelStatsView();
          $('panel-stats').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  }

  function updatePersonnelStatsView() {
    const allStats = getPersonnelStatsList();
    renderPersonnelStatsFilter(allStats);
    renderPersonnelKpiCards(allStats, selectedPersonnelStatsFilter);
    renderPersonnelCharts(allStats, selectedPersonnelStatsFilter);
    renderPersonnelTable(allStats, selectedPersonnelStatsFilter);
  }

  function renderMonthlyChart() {
    const monthlyData = {};
    projectsList.forEach(p => {
      if (!p.date) return;
      const d = new Date(p.date);
      if (isNaN(d.getTime())) return;
      const month = d.toLocaleString('tr-TR', { month: 'long', year: 'numeric' });
      monthlyData[month] = (monthlyData[month] || 0) + 1;
    });

    const sortedMonths = Object.keys(monthlyData).sort((a, b) => a.localeCompare(b));
    const labels = sortedMonths;
    const dataValues = sortedMonths.map(m => monthlyData[m]);

    const canvas = document.getElementById('monthlyChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    if (monthlyChartInstance) {
      monthlyChartInstance.destroy();
      monthlyChartInstance = null;
    }

    monthlyChartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Aylık Eklenen Projeler',
          data: dataValues,
          backgroundColor: 'rgba(207, 46, 46, 0.85)',
          borderColor: 'rgba(207, 46, 46, 1)',
          borderWidth: 1,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true,
            ticks: { stepSize: 1 }
          }
        },
        plugins: {
          legend: { display: false }
        }
      }
    });
  }

  function renderStats() {
    const allStats = getPersonnelStatsList();

    // 1. User Banner
    const myName = currentUser ? resolvePersonnelName(currentUser.personnelName || currentUser.username) : '';
    const bannerContainer = $('statsUserBannerContainer');
    const btnFocusMe = $('btnFocusMyStats');

    if (bannerContainer) {
      if (myName) {
        const myItem = allStats.find(x => normName(x.name) === normName(myName)) || { projeCount: 0, taslakCount: 0, total: 0 };
        bannerContainer.innerHTML = `
          <div class="stats-user-banner">
            <div>
              <h4>👋 Hoş Geldiniz, ${esc(myName)}</h4>
              <p>Kendi çizimleriniz: <b>${myItem.projeCount}</b> Proje, <b>${myItem.taslakCount}</b> Taslak (Toplam: <b>${myItem.total}</b> çizim)</p>
            </div>
            <div>
              <button type="button" class="btn-focus-me" id="btnBannerFocusMe">📊 Çizimlerime Odaklan</button>
            </div>
          </div>
        `;
        if ($('btnBannerFocusMe')) {
          $('btnBannerFocusMe').addEventListener('click', () => {
            selectedPersonnelStatsFilter = myName;
            updatePersonnelStatsView();
          });
        }
        if (btnFocusMe) {
          btnFocusMe.classList.remove('hidden');
          btnFocusMe.onclick = () => {
            selectedPersonnelStatsFilter = myName;
            updatePersonnelStatsView();
          };
        }
      } else {
        bannerContainer.innerHTML = '';
        if (btnFocusMe) btnFocusMe.classList.add('hidden');
      }
    }

    // 2. Personnel filter listener
    const filterSelect = $('selPersonnelStatsFilter');
    if (filterSelect && !filterSelect._hasChangeListener) {
      filterSelect.addEventListener('change', (e) => {
        selectedPersonnelStatsFilter = e.target.value;
        updatePersonnelStatsView();
      });
      filterSelect._hasChangeListener = true;
    }

    // 3. Render Personnel Stats (KPIs, Charts, Table)
    updatePersonnelStatsView();

    // 4. General Cards
    const totalProjects = projectsList.length;
    const pendingProjects = projectsList.filter(p => (p.status || 'Bekliyor') === 'Bekliyor').length;
    const completedProjects = totalProjects - pendingProjects;
    const activePersonnel = personnelList.length;

    if ($('statsCardsContainer')) {
      $('statsCardsContainer').innerHTML = `
        <div class="stat-card">
          <h4>Toplam Proje</h4>
          <div class="val">${totalProjects}</div>
        </div>
        <div class="stat-card">
          <h4>Bekleyen</h4>
          <div class="val" style="color:var(--secondary);">${pendingProjects}</div>
        </div>
        <div class="stat-card">
          <h4>Tamamlanan</h4>
          <div class="val" style="color:#2ecc71;">${completedProjects}</div>
        </div>
        <div class="stat-card">
          <h4>Aktif Personel</h4>
          <div class="val">${activePersonnel}</div>
        </div>
      `;
    }

    // 5. Monthly chart
    renderMonthlyChart();
  }

  // --- ADMIN & USERS MANAGEMENT ---
  async function loadCrmStartCode() {
    if (useSupabase) {
      try {
        const { data, error } = await supabase.from('projects').select('notes').eq('id', '__settings__');
        if (error) throw error;
        if (data && data[0] && data[0].notes) {
          const parsed = typeof data[0].notes === 'string' ? JSON.parse(data[0].notes) : data[0].notes;
          crmStartCode = parsed.crmStartCode || crmStartCode;
        }
      } catch (e) {
        console.error("loadCrmStartCode error:", e);
      }
    } else {
      try {
        const val = await getStorageItem('mimari-crm-start-code');
        if (val) crmStartCode = val;
      } catch (e) {}
    }
    const inp = $('inpCrmStartCode');
    if (inp) inp.value = crmStartCode;
  }

  async function saveSettings(codeVal) {
    crmStartCode = codeVal.trim();
    if (useSupabase) {
      try {
        const notesRaw = JSON.stringify({ crmStartCode: crmStartCode });
        const { data } = await supabase.from('projects').select('id').eq('id', '__settings__');
        if (data && data.length > 0) {
          await supabase.from('projects').update({ notes: notesRaw }).eq('id', '__settings__');
        } else {
          await supabase.from('projects').insert({
            id: '__settings__',
            company: 'SYSTEM_CONFIG',
            crm_code: '00-00000',
            notes: notesRaw,
            project_type: 'Config',
            status: 'System',
            date: new Date().toISOString().slice(0,10)
          });
        }
      } catch (e) {
        console.error("saveSettings Supabase error:", e);
      }
    }
    try {
      await setStorageItem('mimari-crm-start-code', crmStartCode);
    } catch (e) {}
  }

  async function handleSaveSettings() {
    const val = $('inpCrmStartCode').value.trim();
    if (!/^\d{2}-\d{5}$/.test(val)) {
      showToast('Lütfen geçerli bir CRM kodu girin (Format: YY-00000).', true);
      return;
    }
    await saveSettings(val);
    showToast('Ayarlar başarıyla kaydedildi: ' + val);
  }

  async function loadUsers() {
    if (useSupabase) {
      try {
        const { data, error } = await supabase.from('users').select('*');
        if (error) throw error;
        users = (data || []).map(u => ({
          username: u.username,
          password: u.password,
          role: u.role,
          personnelName: u.personnel_name || u.username
        }));
      } catch (e) {
        console.error("loadUsers error:", e);
      }
    } else {
      try {
        const val = await getStorageItem(STORAGE_KEY_USERS);
        users = val ? JSON.parse(val) : [];
      } catch (e) {}
    }
    renderUsersPanel();
  }

  async function saveUsers() {
    if (useSupabase) return true;
    try {
      return await setStorageItem(STORAGE_KEY_USERS, JSON.stringify(users));
    } catch (e) {
      console.error(e);
      return false;
    }
  }

  function renderUsersPanel() {
    const list = $('usersList');
    if (!list) return;
    if (users.length === 0) {
      list.innerHTML = `<div class="empty-state">Kullanıcı bulunamadı.</div>`;
      return;
    }
    list.innerHTML = users.map(u => {
      const canDelete = users.filter(x => x.role === 'admin' || x.role === 'YÖNETİM').length > 1 || (u.role !== 'admin' && u.role !== 'YÖNETİM');
      const isSelf = currentUser && currentUser.username === u.username;

      const delBtn = (canDelete && !isSelf)
        ? `<button class="personnel-del" onclick="deleteUser('${esc(u.username)}')" title="Kullanıcıyı Sil">✕</button>`
        : `<span style="font-size:11px;color:var(--ink-soft);">${isSelf ? '(Siz)' : ''}</span>`;

      return `<div class="personnel-item">
        <span class="personnel-name">${esc(u.username)} <span style="font-size:12px; font-weight:normal; color:var(--ink-soft);">(${(u.role === 'admin' || u.role === 'YÖNETİM') ? 'Yönetici' : u.role})</span> — <span style="font-size:12px; font-weight:bold; color:var(--accent-dark);">Personel: ${esc(u.personnelName || u.username)}</span></span>
        <span style="font-family:'JetBrains Mono',monospace; font-size:12px; margin-right:15px; color:var(--ink-soft);">Şifre: ${esc(u.password)}</span>
        ${delBtn}
      </div>`;
    }).join('');
  }

  async function addAdminUser() {
    const uName = $('inpAdminNewUser').value.trim();
    const uPass = $('inpAdminNewPass').value.trim();
    const pName = $('inpAdminNewPersonnelName').value.trim();
    const uRole = $('selAdminNewRole').value;

    let err = false;
    if (!uName) { $('cell-admin-user').classList.add('invalid'); err = true; } else { $('cell-admin-user').classList.remove('invalid'); }
    if (!uPass) { $('cell-admin-pass').classList.add('invalid'); err = true; } else { $('cell-admin-pass').classList.remove('invalid'); }
    if (!pName) { $('cell-admin-personnel-name').classList.add('invalid'); err = true; } else { $('cell-admin-personnel-name').classList.remove('invalid'); }
    if (err) return;

    if (users.some(x => x.username.toLowerCase() === uName.toLowerCase())) {
      showToast('Bu kullanıcı adı zaten mevcut.', true);
      $('cell-admin-user').classList.add('invalid');
      return;
    }

    if (useSupabase) {
      try {
        const { error } = await supabase.from('users').insert({
          username: uName,
          password: uPass,
          role: uRole,
          personnel_name: pName
        });
        if (error) throw error;
      } catch (e) {
        showToast('Kullanıcı eklenemedi: ' + e.message, true);
        return;
      }
    }

    users.push({ username: uName, password: uPass, role: uRole, personnelName: pName });

    if (useSupabase) {
      try {
        if (!personnelList.some(p => p.toLowerCase() === pName.toLowerCase())) {
          const { error: pErr } = await supabase.from('personnel').insert({ name: pName });
          if (pErr) console.error(pErr);
        }
      } catch (e) {}
    }

    if (!personnelList.some(p => p.toLowerCase() === pName.toLowerCase())) {
      personnelList.push(pName);
      await savePersonnel();
    }

    $('inpAdminNewUser').value = '';
    $('inpAdminNewPass').value = '';
    $('inpAdminNewPersonnelName').value = '';
    renderUsersPanel();
    await saveUsers();
    showToast('Kullanıcı başarıyla oluşturuldu: ' + uName);
  }

  window.deleteUser = async function(username) {
    if (currentUser && currentUser.username === username) {
      showToast('Kendinizi silemezsiniz.', true);
      return;
    }
    if (!confirm(`"${username}" kullanıcısını silmek istediğinize emin misiniz?`)) return;

    if (useSupabase) {
      try {
        const { error } = await supabase.from('users').delete().eq('username', username);
        if (error) throw error;
      } catch (e) {
        showToast('Kullanıcı silinemedi: ' + e.message, true);
        return;
      }
    }

    users = users.filter(x => x.username !== username);
    renderUsersPanel();
    await saveUsers();
    showToast('Kullanıcı silindi: ' + username);
  };

  // --- FABRIKA ORDERS MANAGEMENT ---
  async function loadFabrikaOrders() {
    if (useSupabase) {
      try {
        const { data, error } = await supabase.from('fabrika_orders').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        fabrikaOrders = data || [];
      } catch(e) {
        console.error("loadFabrikaOrders error:", e);
        await loadFabrikaOrdersFromLocalStorage();
      }
    } else {
      await loadFabrikaOrdersFromLocalStorage();
    }
    renderFabrikaOrders();
  }

  async function loadFabrikaOrdersFromLocalStorage() {
    try {
      const val = await getStorageItem(STORAGE_KEY_FABRIKA);
      fabrikaOrders = val ? JSON.parse(val) : [];
    } catch(e) { fabrikaOrders = []; }
  }

  async function saveFabrikaOrdersToLocalStorage() {
    await setStorageItem(STORAGE_KEY_FABRIKA, JSON.stringify(fabrikaOrders));
  }

  function renderFabrikaOrders() {
    const tbody = $('tblYonetimFabrikaOrdersBody');
    if (!tbody) return;

    if (fabrikaOrders.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:30px; color:var(--ink-soft);">Henüz gönderilmiş bir fabrika siparişi bulunmamaktadır.</td></tr>`;
      return;
    }

    tbody.innerHTML = fabrikaOrders.map(o => {
      const crmMatch = o.title ? o.title.match(/\((\d{2}-\d{5})\)/) : null;
      let displayTitle = o.title || '';
      let crmBadge = '';
      if (crmMatch) {
        crmBadge = `<span class="px-2 py-1 text-xs font-bold rounded bg-slate-200 text-slate-800" style="font-family:monospace; margin-right:8px;">${crmMatch[1]}</span>`;
        displayTitle = displayTitle.replace(crmMatch[0], '').trim();
      }

      let statusBadge = '';
      if (o.status === 'Bekliyor') {
        statusBadge = `<span class="px-2 py-0.5 text-xs font-bold rounded bg-amber-100 text-amber-800">Fabrikada</span>`;
      } else if (o.status === 'Onay Bekliyor') {
        statusBadge = `<span class="px-2 py-0.5 text-xs font-bold rounded bg-blue-100 text-blue-800">Onay Bekliyor</span>`;
      } else if (o.status === 'Onaylandı') {
        statusBadge = `<span class="px-2 py-0.5 text-xs font-bold rounded bg-emerald-100 text-emerald-800">Onaylandı</span>`;
      } else if (o.status === 'Reddedildi') {
        statusBadge = `<span class="px-2 py-0.5 text-xs font-bold rounded bg-rose-100 text-rose-800">Reddedildi</span>`;
      }

      let actionButtons = `
        <div style="display:flex; gap:6px; justify-content:center; align-items:center; flex-wrap:wrap;">
          <button class="bg-gray-600 hover:bg-gray-700 text-white text-xs px-2.5 py-1.5 rounded font-bold" onclick="showFabrikaOrderDetail('${o.id}')">Detayları Görüntüle</button>
      `;

      if (o.status === 'Onay Bekliyor') {
        actionButtons += `
          <button class="bg-emerald-600 hover:bg-emerald-700 text-white text-xs px-2.5 py-1.5 rounded font-bold" onclick="approveFabrikaOrder('${o.id}')">Onayla</button>
          <button class="bg-rose-600 hover:bg-rose-700 text-white text-xs px-2.5 py-1.5 rounded font-bold" onclick="rejectFabrikaOrder('${o.id}')">Reddet</button>
        `;
      }
      actionButtons += `
          <button class="bg-red-600 hover:bg-red-700 text-white text-xs px-2.5 py-1.5 rounded font-bold" onclick="deleteFabrikaOrder('${o.id}')">Sil</button>
      </div>`;

      return `<tr>
        <td style="font-size:11px; color:var(--ink-soft);">${fmtDate(o.created_at)}</td>
        <td>${crmBadge}<strong>${esc(displayTitle)}</strong></td>
        <td>${statusBadge}</td>
        <td style="text-align:center;">${actionButtons}</td>
      </tr>`;
    }).join('');
  }

  async function uploadFileToSupabase(fileObj) {
    try {
      const fileExt = fileObj.name.split('.').pop();
      const cleanName = fileObj.name.replace(/[^a-zA-Z0-9]/g, '_');
      const path = `fabrika/${Date.now()}_${cleanName}.${fileExt}`;
      const { data, error } = await supabase.storage
        .from('drawings')
        .upload(path, fileObj, { cacheControl: '3600', upsert: true });
      if (error) throw error;
      const { data: urlData } = supabase.storage.from('drawings').getPublicUrl(path);
      return urlData.publicUrl;
    } catch (e) {
      console.error(e);
      throw e;
    }
  }

  async function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = error => reject(error);
      reader.readAsDataURL(file);
    });
  }

  async function handleSendExcelToFabrika() {
    const title = $('inpFabrikaOrderTitle').value.trim();
    const fileInput = $('inpFabrikaExcelFile');

    if (!title) {
      showToast('Lütfen sipariş başlığı girin.', true);
      return;
    }
    if (!fileInput.files || !fileInput.files[0]) {
      showToast('Lütfen göndermek için bir Excel dosyası seçin.', true);
      return;
    }

    const file = fileInput.files[0];
    $('btnSendExcelToFabrika').disabled = true;
    showToast('Dosya yükleniyor ve gönderiliyor...');

    try {
      let excelUrl = '';
      if (useSupabase) {
        excelUrl = await uploadFileToSupabase(file);
      } else {
        excelUrl = await fileToBase64(file);
      }

      const orderId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const createdAt = new Date().toISOString();

      if (useSupabase) {
        const { error } = await supabase.from('fabrika_orders').insert({
          id: orderId,
          title: title,
          excel_url: excelUrl,
          excel_name: file.name,
          excel_size: file.size,
          status: 'Bekliyor',
          created_at: createdAt,
          updated_at: createdAt
        });
        if (error) throw error;
      } else {
        fabrikaOrders.unshift({
          id: orderId,
          title: title,
          excel_url: excelUrl,
          excel_name: file.name,
          excel_size: file.size,
          status: 'Bekliyor',
          created_at: createdAt,
          updated_at: createdAt
        });
        await saveFabrikaOrdersToLocalStorage();
      }

      showToast('Sipariş başarıyla fabrikaya gönderildi.');
      $('inpFabrikaOrderTitle').value = '';
      $('inpFabrikaExcelFile').value = '';
      await loadFabrikaOrders();
    } catch(e) {
      console.error(e);
      showToast('Gönderim hatası: ' + e.message, true);
    } finally {
      $('btnSendExcelToFabrika').disabled = false;
    }
  }

  window.approveFabrikaOrder = async function(id) {
    try {
      if (useSupabase) {
        const { error } = await supabase.from('fabrika_orders').update({
          status: 'Onaylandı',
          updated_at: new Date().toISOString()
        }).eq('id', id);
        if (error) throw error;
      } else {
        const o = fabrikaOrders.find(x => x.id === id);
        if (o) {
          o.status = 'Onaylandı';
          o.updated_at = new Date().toISOString();
        }
        await saveFabrikaOrdersToLocalStorage();
      }
      showToast('Fabrika siparişi onaylandı.');
      await loadFabrikaOrders();
    } catch(e) {
      showToast('İşlem başarısız: ' + e.message, true);
    }
  };

  window.rejectFabrikaOrder = async function(id) {
    try {
      if (useSupabase) {
        const { error } = await supabase.from('fabrika_orders').update({
          status: 'Reddedildi',
          updated_at: new Date().toISOString()
        }).eq('id', id);
        if (error) throw error;
      } else {
        const o = fabrikaOrders.find(x => x.id === id);
        if (o) {
          o.status = 'Reddedildi';
          o.updated_at = new Date().toISOString();
        }
        await saveFabrikaOrdersToLocalStorage();
      }
      showToast('Fabrika siparişi reddedildi.');
      await loadFabrikaOrders();
    } catch(e) {
      showToast('İşlem başarısız: ' + e.message, true);
    }
  };

  window.deleteFabrikaOrder = async function(id) {
    if (!confirm('Bu fabrika siparişini silmek istediğinize emin misiniz?')) return;
    try {
      if (useSupabase) {
        const { error } = await supabase.from('fabrika_orders').delete().eq('id', id);
        if (error) throw error;
      } else {
        fabrikaOrders = fabrikaOrders.filter(x => x.id !== id);
        await saveFabrikaOrdersToLocalStorage();
      }
      showToast('Fabrika siparişi silindi.');
      await loadFabrikaOrders();
    } catch(e) {
      showToast('Silme hatası: ' + e.message, true);
    }
  };

  let activeDetailOrderId = null;

  window.showFabrikaOrderDetail = function(id) {
    const o = fabrikaOrders.find(x => x.id === id);
    if (!o) return;
    activeDetailOrderId = id;

    const crmMatch = o.title ? o.title.match(/\((\d{2}-\d{5})\)/) : null;
    $('lblDetailCrmCode').textContent = crmMatch ? crmMatch[1] : '—';
    
    let displayTitle = o.title || '';
    if (crmMatch) {
      displayTitle = displayTitle.replace(crmMatch[0], '').trim();
    }
    $('lblDetailTitle').textContent = displayTitle;
    
    let statusHtml = '';
    if (o.status === 'Bekliyor') {
      statusHtml = `<span class="px-2.5 py-1 text-xs font-bold rounded bg-amber-100 text-amber-800">Fabrikada</span>`;
    } else if (o.status === 'Onay Bekliyor') {
      statusHtml = `<span class="px-2.5 py-1 text-xs font-bold rounded bg-blue-100 text-blue-800">Onay Bekliyor</span>`;
    } else if (o.status === 'Onaylandı') {
      statusHtml = `<span class="px-2.5 py-1 text-xs font-bold rounded bg-emerald-100 text-emerald-800">Onaylandı</span>`;
    } else if (o.status === 'Reddedildi') {
      statusHtml = `<span class="px-2.5 py-1 text-xs font-bold rounded bg-rose-100 text-rose-800">Reddedildi</span>`;
    }
    $('lblDetailStatus').innerHTML = statusHtml;

    $('lblDetailExcelName').textContent = o.excel_name || 'Excel Yüklenmemiş';
    $('lblDetailExcelLink').innerHTML = o.excel_url 
      ? `<a href="${esc(o.excel_url)}" onclick="downloadUrlWithCleanName(event, '${esc(o.excel_url)}')" class="text-blue-600 hover:underline font-bold">İndir</a>` 
      : '—';

    let dwgLink = '—';
    let axdLink = '—';
    let dwgName = 'Yüklenmemiş';
    let axdName = 'Yüklenmemiş';
    let cleanNotes = o.notes || '';

    if (o.notes) {
      const dwgRegex = /AutoCAD DWG:\s*([^\(]+)\s*\((https?:\/\/[^\)]+)\)/i;
      const dwgMatch = o.notes.match(dwgRegex);
      if (dwgMatch) {
        dwgName = dwgMatch[1].trim();
        dwgLink = `<a href="${esc(dwgMatch[2])}" onclick="downloadUrlWithCleanName(event, '${esc(dwgMatch[2])}')" class="text-red-600 hover:underline font-bold">İndir</a>`;
        cleanNotes = cleanNotes.replace(dwgMatch[0], '');
      }

      const axdRegex = /AXD Dosyası:\s*([^\(]+)\s*\((https?:\/\/[^\)]+)\)/i;
      const axdMatch = o.notes.match(axdRegex);
      if (axdMatch) {
        axdName = axdMatch[1].trim();
        axdLink = `<a href="${esc(axdMatch[2])}" onclick="downloadUrlWithCleanName(event, '${esc(axdMatch[2])}')" class="text-orange-600 hover:underline font-bold">İndir</a>`;
        cleanNotes = cleanNotes.replace(axdMatch[0], '');
      }
    }
    $('lblDetailDwgName').textContent = dwgName;
    $('lblDetailDwgLink').innerHTML = dwgLink;
    $('lblDetailAxdName').textContent = axdName;
    $('lblDetailAxdLink').innerHTML = axdLink;

    $('lblDetailNotes').textContent = cleanNotes.trim() || '—';

    if (o.photo_url) {
      $('divDetailPhotoSection').style.display = 'block';
      $('lblDetailPhoto').innerHTML = `
        <a href="${esc(o.photo_url)}" target="_blank">
          <img src="${esc(o.photo_url)}" style="max-width:100%; max-height:200px; border-radius:6px; border:1px solid var(--line); object-fit:contain;">
        </a>
      `;
    } else {
      $('divDetailPhotoSection').style.display = 'none';
    }

    let actionButtonsHtml = '';
    if (o.status === 'Onay Bekliyor') {
      actionButtonsHtml = `
        <button class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded text-sm" onclick="approveFabrikaOrder('${o.id}'); closeDetailModal();">Onayla</button>
        <button class="bg-rose-600 hover:bg-rose-700 text-white font-bold px-4 py-2 rounded text-sm" onclick="rejectFabrikaOrder('${o.id}'); closeDetailModal();">Reddet</button>
      `;
    }
    $('divDetailActions').innerHTML = actionButtonsHtml;

    $('fabrikaOrderDetailModal').style.display = 'flex';
  };

  window.closeDetailModal = function() {
    $('fabrikaOrderDetailModal').style.display = 'none';
    activeDetailOrderId = null;
  };

  async function handleDetailExcelChange() {
    const fileInput = $('inpDetailExcelUpload');
    if (!fileInput.files || !fileInput.files[0] || !activeDetailOrderId) return;
    const file = fileInput.files[0];
    
    const triggerBtn = $('btnTriggerDetailExcelUpload');
    triggerBtn.disabled = true;
    triggerBtn.textContent = 'Yükleniyor...';
    showToast('Yeni Excel listesi yükleniyor...');

    try {
      let excelUrl = '';
      if (useSupabase) {
        excelUrl = await uploadFileToSupabase(file);
      } else {
        excelUrl = await fileToBase64(file);
      }

      if (useSupabase) {
        const { error } = await supabase.from('fabrika_orders').update({
          excel_url: excelUrl,
          excel_name: file.name,
          excel_size: file.size,
          updated_at: new Date().toISOString()
        }).eq('id', activeDetailOrderId);
        if (error) throw error;
      } else {
        const o = fabrikaOrders.find(x => x.id === activeDetailOrderId);
        if (o) {
          o.excel_url = excelUrl;
          o.excel_name = file.name;
          o.excel_size = file.size;
          o.updated_at = new Date().toISOString();
        }
        await saveFabrikaOrdersToLocalStorage();
      }

      showToast('Excel listesi başarıyla güncellendi.');
      await loadFabrikaOrders();
      if (activeDetailOrderId) {
        showFabrikaOrderDetail(activeDetailOrderId);
      }
    } catch(e) {
      console.error(e);
      showToast('Güncelleme hatası: ' + e.message, true);
    } finally {
      triggerBtn.disabled = false;
      triggerBtn.textContent = 'Yükle / Değiştir';
      fileInput.value = '';
    }
  }

  // --- Tab switching ---
  function switchYonetimTab(tabName) {
    currentYonetimTab = tabName;
    document.querySelectorAll('[data-yonetim-tab]').forEach(tab => {
      tab.classList.toggle('active', tab.getAttribute('data-yonetim-tab') === tabName);
    });
    if ($('panel-projects-pending')) $('panel-projects-pending').classList.toggle('hidden', tabName !== 'projects-pending');
    if ($('panel-purchase-pending')) $('panel-purchase-pending').classList.toggle('hidden', tabName !== 'purchase-pending');
    if ($('panel-fabrika-management')) $('panel-fabrika-management').classList.toggle('hidden', tabName !== 'fabrika-management');
    if ($('panel-stats')) $('panel-stats').classList.toggle('hidden', tabName !== 'stats');
    if ($('panel-admin')) $('panel-admin').classList.toggle('hidden', tabName !== 'admin');
    
    if (tabName === 'stats') {
      renderStats();
    }
    if (tabName === 'fabrika-management') {
      renderFabrikaOrders();
    }
  }

  // --- Navigation & Bindings ---
  $('btnYonetimLogout').addEventListener('click', handleLogout);
  $('btnGoToBoard').addEventListener('click', () => { window.location.href = 'index.html'; });
  $('btnGoToAccounting').addEventListener('click', () => { window.location.href = 'muhasebe.html'; });
  if ($('btnAdminSaveSettings')) $('btnAdminSaveSettings').addEventListener('click', handleSaveSettings);
  if ($('btnAdminAddUser')) $('btnAdminAddUser').addEventListener('click', addAdminUser);
  if ($('btnSendExcelToFabrika')) $('btnSendExcelToFabrika').addEventListener('click', handleSendExcelToFabrika);
  if ($('btnCancelDetailModal')) $('btnCancelDetailModal').addEventListener('click', closeDetailModal);
  if ($('btnTriggerDetailExcelUpload')) $('btnTriggerDetailExcelUpload').addEventListener('click', () => $('inpDetailExcelUpload').click());
  if ($('inpDetailExcelUpload')) $('inpDetailExcelUpload').addEventListener('change', handleDetailExcelChange);

  document.querySelectorAll('[data-yonetim-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      switchYonetimTab(tab.getAttribute('data-yonetim-tab'));
    });
  });

  function getCleanFileName(url) {
    if (!url) return 'dosya';
    let filename = url.split('/').pop();
    try {
      filename = decodeURIComponent(filename);
    } catch(e){}
    filename = filename.replace(/^\d+_/, '');
    filename = filename.replace(/_+/g, ' ');
    const parts = filename.split('.');
    if (parts.length > 2) {
      const ext = parts.pop();
      const prev = parts[parts.length - 1];
      if (prev.toLowerCase() === ext.toLowerCase()) {
        parts.pop();
      }
      filename = parts.join('.') + '.' + ext;
    }
    return filename;
  }

  window.downloadUrlWithCleanName = async function(e, url) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const cleanName = getCleanFileName(url);
    showToast('Dosya indiriliyor...');
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP error ' + res.status);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = cleanName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      showToast('Dosya indirildi.');
    } catch (err) {
      console.error("Download failed: ", err);
      window.open(url, '_blank');
    }
  };

  // --- Init ---
  loadData();
})();
