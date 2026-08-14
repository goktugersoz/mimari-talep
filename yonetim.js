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
    renderPersonnelPanel();
    renderUsersPanel();
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

  function renderPersonnelPanel() {
    const list = $('personnelList');
    if (!list) return;
    if (personnelList.length === 0) {
      list.innerHTML = `<div class="empty-state"><div class="big">Henüz personel eklenmemiş</div>Yukarıdaki alandan ilk personeli ekleyerek başlayın.</div>`;
      return;
    }
    const sorted = [...personnelList].sort((a, b) => a.localeCompare(b, 'tr'));
    list.innerHTML = sorted.map(name => {
      const job = projectsList.find(p => p.employee === name && (p.status || 'Bekliyor') === 'Bekliyor');
      const tag = job ? `<span class="personnel-busy-tag">AKTİF İŞ: ${esc(job.crm_code)}</span>` : '';
      const delBtn = `<button class="personnel-del" onclick="removePersonnel('${esc(name)}')" title="Personeli sil">✕</button>`;
      return `<div class="personnel-item">
        <span class="personnel-name">${esc(name)}</span>
        ${tag}
        ${delBtn}
      </div>`;
    }).join('');
  }

  window.removePersonnel = async function(name) {
    const job = projectsList.find(p => p.employee === name && (p.status || 'Bekliyor') === 'Bekliyor');
    const msg = job
      ? `"${name}" adlı personelin şu anda bekleyen bir işi var (CRM: ${job.crm_code}). Yine de listeden silmek istiyor musunuz?`
      : `"${name}" adlı personeli listeden silmek istediğinize emin misiniz?`;
    if (!confirm(msg)) return;

    if (useSupabase) {
      try {
        const { error } = await supabase.from('personnel').delete().eq('name', name);
        if (error) throw error;
      } catch (e) {
        showToast('Personel silinemedi: ' + e.message, true);
        return;
      }
    }
    personnelList = personnelList.filter(p => p !== name);
    renderPersonnelPanel();
    await savePersonnel();
    showToast('Personel silindi: ' + name);
  };

  async function handleAddPersonnel() {
    const val = $('inpNewPersonnel').value.trim();
    if (!val) {
      showToast('Personel adı boş olamaz.', true);
      return;
    }
    if (personnelList.some(p => p.toLowerCase() === val.toLowerCase())) {
      showToast('Bu personel zaten listede mevcut.', true);
      return;
    }
    if (useSupabase) {
      try {
        const { error } = await supabase.from('personnel').insert({ name: val });
        if (error) throw error;
      } catch (e) {
        showToast('Personel eklenemedi: ' + e.message, true);
        return;
      }
    }
    personnelList.push(val);
    $('inpNewPersonnel').value = '';
    renderPersonnelPanel();
    await savePersonnel();
    showToast('Personel eklendi: ' + val);
  }

  // --- STATS RENDERING ---
  function renderStats() {
    const totalProjects = projectsList.length;
    const pendingProjects = projectsList.filter(p => (p.status || 'Bekliyor') === 'Bekliyor').length;
    const completedProjects = totalProjects - pendingProjects;
    const activePersonnel = personnelList.length;

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
    }

    monthlyChartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Aylık Eklenen Projeler',
          data: dataValues,
          backgroundColor: 'rgba(207, 46, 46, 0.8)',
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
    } else {
      await setStorageItem('mimari-crm-start-code', crmStartCode);
    }
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
    renderPersonnelPanel();
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

  // --- Tab switching ---
  function switchYonetimTab(tabName) {
    currentYonetimTab = tabName;
    document.querySelectorAll('[data-yonetim-tab]').forEach(tab => {
      tab.classList.toggle('active', tab.getAttribute('data-yonetim-tab') === tabName);
    });
    $('panel-projects-pending').classList.toggle('hidden', tabName !== 'projects-pending');
    $('panel-purchase-pending').classList.toggle('hidden', tabName !== 'purchase-pending');
    $('panel-personnel').classList.toggle('hidden', tabName !== 'personnel');
    $('panel-stats').classList.toggle('hidden', tabName !== 'stats');
    $('panel-admin').classList.toggle('hidden', tabName !== 'admin');
    
    if (tabName === 'stats') {
      renderStats();
    }
  }

  // --- Navigation & Bindings ---
  $('btnYonetimLogout').addEventListener('click', handleLogout);
  $('btnGoToBoard').addEventListener('click', () => { window.location.href = 'index.html'; });
  $('btnGoToAccounting').addEventListener('click', () => { window.location.href = 'muhasebe.html'; });
  if ($('btnAddPersonnel')) $('btnAddPersonnel').addEventListener('click', handleAddPersonnel);
  if ($('btnAdminSaveSettings')) $('btnAdminSaveSettings').addEventListener('click', handleSaveSettings);
  if ($('btnAdminAddUser')) $('btnAdminAddUser').addEventListener('click', addAdminUser);

  document.querySelectorAll('[data-yonetim-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      switchYonetimTab(tab.getAttribute('data-yonetim-tab'));
    });
  });

  // --- Init ---
  loadData();
})();
