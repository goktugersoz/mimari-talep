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

  const STORAGE_KEY = 'mimari-projeler-listesi';
  const STORAGE_KEY_FIRMS = 'sube-firma-listesi';
  const STORAGE_KEY_TYPES = 'cizim-tipi-listesi';
  const STORAGE_KEY_PERSONNEL = 'personel-listesi';
  const FIXED_BRANCHES = ['SİVAS', 'ANKARA', 'YOZGAT', 'KAYSERİ', 'ERZİNCAN', 'ESKİŞEHİR', 'BOLU', 'SAKARYA', 'BİLECİK'];
  const FIXED_TYPES = ['Hafif Çelik Konut Planı', 'Çift Katlı Hafif Çelik Konut Planı', 'Prefabrik Konut Planı', 'Çift Katlı Prefabrik Konut Planı'];
  let projects = [];
  let otherFirms = [];
  let otherTypes = [];
  let personnelList = [];
  let loaded = false;
  let editingProjectId = null;
  let attachedFiles = { dwg: null, excel: null, axd: null };
  let currentView = 'grid';
  let onlyPersonnelEdit = false;
  let crmStartCode = String(new Date().getFullYear()).slice(-2) + '-00001';
  let drafts = [];
  let attachedDraftFile = null;
  let activeDraftIdForNewProject = null;


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
            date: todayISO()
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
    $('btnAdminSaveSettings').disabled = true;
    await saveSettings(val);
    updateNextCodeHint();
    if (!$('inpCrm').value || !editingProjectId) {
      $('inpCrm').value = suggestNextCrm();
    }
    $('btnAdminSaveSettings').disabled = false;
    showToast('Genel ayarlar kaydedildi.');
  }

  function parseNotesField(notesStr) {
    notesStr = (notesStr || '').trim();
    if (notesStr.startsWith('{') && notesStr.endsWith('}')) {
      try {
        const parsed = JSON.parse(notesStr);
        if (parsed && typeof parsed === 'object') {
          return {
            customerName: parsed.customerName || '',
            notes: parsed.notes || '',
            createdAt: parsed.createdAt || null,
            updatedAt: parsed.updatedAt || null
          };
        }
      } catch (e) {
        // Not valid JSON
      }
    }
    return {
      customerName: '',
      notes: notesStr,
      createdAt: null,
      updatedAt: null
    };
  }

  function serializeNotesField(customerName, notes, createdAt, updatedAt) {
    return JSON.stringify({
      customerName: (customerName || '').trim(),
      notes: (notes || '').trim(),
      createdAt: createdAt || new Date().toISOString(),
      updatedAt: updatedAt || new Date().toISOString()
    });
  }

  // serializeNotesField removed from here, integrated above parseNotesField

  function toTitleCase(str) {
    let result = str.split(' ').map(word => {
      if (!word) return '';
      let first = word.charAt(0);
      if (first === 'i' || first === 'İ') first = 'İ';
      else if (first === 'ı' || first === 'I') first = 'I';
      else first = first.toUpperCase();

      let rest = word.slice(1).replace(/I/g, 'ı').replace(/İ/g, 'i').toLowerCase();
      return first + rest;
    }).join(' ');

    // Post-processing to enforce uppercase "AK" in "AK-xxx" and lowercase "m²"
    result = result.replace(/\bAk-(\d+)/g, 'AK-$1');
    result = result.replace(/M²/g, 'm²');
    result = result.replace(/M2/g, 'm²');
    return result;
  }

  window.downloadProjectFileCustom = async function (e, url, originalName, id) {
    e.preventDefault();
    e.stopPropagation();
    const p = projects.find(pr => pr.id === id);
    if (!p) return;

    // Build the beautiful filename:
    // FİRMA ADI - CRM KODU - MÜŞTERİ İSMİ - BİNA KODU - BİNA ALANI - KONUT TİPİ
    const parts = [];
    if (p.company) parts.push(p.company.trim());
    if (p.crmCode) parts.push(p.crmCode.trim());
    if (p.customerName) parts.push(p.customerName.trim());
    if (p.buildingCode) parts.push(p.buildingCode.trim());
    if (p.areaM2) {
      const areaStr = p.areaM2.toString().includes('m²') ? p.areaM2.trim() : p.areaM2.trim() + ' m²';
      parts.push(areaStr);
    }
    if (p.projectType) {
      let typePart = p.projectType.trim();
      const trLower = typePart.toLocaleLowerCase('tr-TR');
      if (trLower.endsWith(' planı')) {
        typePart = typePart.slice(0, -6).trim();
      } else if (trLower.endsWith(' plan')) {
        typePart = typePart.slice(0, -5).trim();
      }
      if (typePart) parts.push(typePart);
    }

    let customName = parts.join(' - ');
    if (!customName) {
      customName = originalName || 'cizim';
    } else {
      customName = toTitleCase(customName);

      const ext = originalName ? originalName.split('.').pop().toLowerCase() : 'dwg';
      if (ext === 'dwg') {
        if (customName.toLocaleLowerCase('tr-TR').endsWith('konut')) {
          customName += ' Planı';
        } else {
          customName += ' Konut Planı';
        }
      } else if (ext === 'xls' || ext === 'xlsx') {
        customName += ' Sayım Listesi';
      } else if (ext === 'axd') {
        customName += ' Makas Planı';
      }

      customName = customName + '.' + ext;
    }

    // Sanitize for illegal Windows filename characters: \ / : * ? " < > |
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
      console.error("Custom download failed: ", err);
      // Fallback if fetch fails (e.g. CORS block)
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.download = customName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  // Supabase storage helper
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

  function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function formatBuildingCode(val) {
    val = val.trim();
    if (!val) return '';
    if (/^\d+$/.test(val)) {
      return 'AK-' + val;
    }
    const match = /^(ak)[-\s]?(\d+)$/i.exec(val);
    if (match) {
      return 'AK-' + match[2];
    }
    if (val.toLowerCase().startsWith('ak')) {
      return 'AK' + val.slice(2);
    }
    return val;
  }

  const $ = (id) => document.getElementById(id);
  const gridArea = $('gridArea');
  const countPill = $('countPill');
  const searchInput = $('searchInput');
  const draftSearchInput = $('draftSearchInput');
  const btnSaveDraft = $('btnSaveDraft');
  const toast = $('toast');

  function showToast(msg, isErr) {
    toast.textContent = msg;
    toast.className = 'toast show' + (isErr ? ' err' : '');
    setTimeout(() => toast.className = 'toast', 2200);
  }

  const STORAGE_KEY_USERS = 'mimari-kullanicilar';
  let users = [];
  let currentUser = null;

  async function loadUsers() {
    if (!storageAvailable()) {
      users = [{ username: 'admin', password: '123', role: 'admin', personnelName: 'Admin' }];
      renderUsersPanel();
      return;
    }
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
        if (!users.length) {
          users = [{ username: 'admin', password: '123', role: 'admin', personnelName: 'Admin' }];
          await supabase.from('users').insert({ username: 'admin', password: '123', role: 'admin', personnel_name: 'Admin' });
        }
      } catch (e) {
        console.error("loadUsers error:", e);
        users = [{ username: 'admin', password: '123', role: 'admin', personnelName: 'Admin' }];
      }
    } else {
      try {
        const val = await getStorageItem(STORAGE_KEY_USERS);
        const parsed = val ? JSON.parse(val) : [];
        users = Array.isArray(parsed) && parsed.length ? parsed.map(u => ({
          ...u,
          personnelName: u.personnelName || u.username
        })) : [{ username: 'admin', password: '123', role: 'admin', personnelName: 'Admin' }];
      } catch (e) {
        users = [{ username: 'admin', password: '123', role: 'admin', personnelName: 'Admin' }];
      }
    }
    renderUsersPanel();
  }

  async function saveUsers() {
    if (useSupabase) return true;
    if (!storageAvailable()) return true;
    try {
      const res = await setStorageItem(STORAGE_KEY_USERS, JSON.stringify(users));
      return res;
    } catch (e) {
      console.error(e);
      return false;
    }
  }

  function checkSession() {
    const stored = sessionStorage.getItem('mimari-session');
    if (stored) {
      try {
        const u = JSON.parse(stored);
        const matched = users.find(x => x.username.toLowerCase() === u.username.toLowerCase() && x.password === u.password);
        if (matched) {
          currentUser = matched;
          showApp(false);
          return;
        }
      } catch (e) { }
    }
    showLogin();
  }

  function showLogin() {
    $('loginContainer').style.display = 'block';
    $('appContainer').classList.add('hidden');
    $('inpLoginUser').value = '';
    $('inpLoginPass').value = '';
    const now = new Date();
    $('dateNowLogin').textContent = now.toLocaleDateString('tr-TR');
  }

  function showApp(isLoginTriggered = false) {
    $('loginContainer').style.display = 'none';
    
    const isAccountant = currentUser && (currentUser.role === 'MUHASEBE' || currentUser.role === 'MUHASEBECİ');
    if (isAccountant) {
      window.location.href = 'muhasebe.html';
      return;
    }

    const FABRIKA_ROLES = [
      'FABRİKA',
      'Panel Grubu',
      'Metal Grubu',
      'Kapı ve Pencere Grubu',
      'Alçıpan ve Kaplama grubu',
      'Çatı Makas grubu',
      'Çatı Sacı grubu',
      'Elektrik tesisat g',
      'Vida grubu',
      'Depo Grubu',
      'Tesisat grubu',
      'Çatı oluk grubu',
      'Boya mastik grubu'
    ];
    const isFabrika = currentUser && FABRIKA_ROLES.includes(currentUser.role);
    if (isFabrika) {
      window.location.href = 'fabrika.html';
      return;
    }

    const isManager = currentUser && (currentUser.role === 'admin' || currentUser.role === 'YÖNETİM' || currentUser.role === 'YÖNETİCİ');
    if (isManager && isLoginTriggered) {
      window.location.href = 'yonetim.html';
      return;
    }

    $('muhasebeContainer').classList.add('hidden');
    $('appContainer').classList.remove('hidden');
    $('lblCurrentUser').textContent = `${currentUser.username} (${(currentUser.role === 'admin' || currentUser.role === 'YÖNETİM') ? 'Yönetici' : currentUser.role})`;

    if ($('tab-admin')) {
      if (currentUser.role === 'admin' || currentUser.role === 'YÖNETİM') {
        $('tab-admin').classList.remove('hidden');
      } else {
        $('tab-admin').classList.add('hidden');
      }
    }

    if (isManager) {
      if ($('btnGoToYonetim')) $('btnGoToYonetim').classList.remove('hidden');
      if ($('btnGoToAccounting')) $('btnGoToAccounting').classList.remove('hidden');
    } else {
      if ($('btnGoToYonetim')) $('btnGoToYonetim').classList.add('hidden');
      if ($('btnGoToAccounting')) $('btnGoToAccounting').classList.add('hidden');
    }
    const tabContainer = document.querySelector('.tabs');
    const tabBoard = document.querySelector('.tab[data-tab="board"]');
    const tabForm = document.querySelector('.tab[data-tab="form"]');
    const tabDrafts = document.querySelector('.tab[data-tab="drafts"]');

    if (currentUser.role === 'PROJE') {
      if (tabContainer && tabBoard && tabForm && tabDrafts) {
        tabContainer.appendChild(tabDrafts);
        tabContainer.appendChild(tabForm);
        tabContainer.appendChild(tabBoard);
      }
      switchTab('drafts');
    } else {
      if (tabContainer && tabBoard && tabForm && tabDrafts) {
        tabContainer.appendChild(tabBoard);
        tabContainer.appendChild(tabForm);
        tabContainer.appendChild(tabDrafts);
      }
      switchTab('board');
    }
  }

  let monthlyChartInstance = null;

  function renderStats() {
    const totalProjects = projects.length;
    const pendingProjects = projects.filter(p => (p.status || 'Bekliyor') === 'Bekliyor').length;
    const completedProjects = totalProjects - pendingProjects;
    const activePersonnel = personnelList.length;

    // Doldur kartları
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

    // Aylık Verileri Hesapla
    const monthlyData = {};
    projects.forEach(p => {
      if (!p.date) return;
      const d = new Date(p.date);
      if (isNaN(d.getTime())) return;
      const month = d.toLocaleString('tr-TR', { month: 'long', year: 'numeric' });
      monthlyData[month] = (monthlyData[month] || 0) + 1;
    });

    // Sort months conceptually, but for simplicity just Object.entries
    const sortedMonths = Object.keys(monthlyData).sort((a, b) => {
      // Rough sorting string comparison (won't be perfect chronologically without proper parsing, but ok for now)
      return a.localeCompare(b);
    });
    const labels = sortedMonths;
    const dataValues = sortedMonths.map(m => monthlyData[m]);

    const ctx = document.getElementById('monthlyChart').getContext('2d');

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

  function handleLogin() {
    const uName = $('inpLoginUser').value.trim();
    const uPass = $('inpLoginPass').value.trim();

    let err = false;
    if (!uName) { $('cell-login-user').classList.add('invalid'); err = true; } else { $('cell-login-user').classList.remove('invalid'); }
    if (!uPass) { $('cell-login-pass').classList.add('invalid'); err = true; } else { $('cell-login-pass').classList.remove('invalid'); }
    if (err) return;

    const matched = users.find(x => x.username.toLowerCase() === uName.toLowerCase() && x.password === uPass);
    if (matched) {
      currentUser = matched;
      sessionStorage.setItem('mimari-session', JSON.stringify(currentUser));
      showApp(true);
      showToast('Giriş başarılı.');
    } else {
      showToast('Hatalı kullanıcı adı veya şifre.', true);
    }
  }

  function handleLogout() {
    currentUser = null;
    sessionStorage.removeItem('mimari-session');
    $('muhasebeContainer').classList.add('hidden');
    showLogin();
    showToast('Çıkış yapıldı.');
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
        ? `<button class="personnel-del" data-userdel="${esc(u.username)}" title="Kullanıcıyı Sil">✕</button>`
        : `<span style="font-size:11px;color:var(--ink-soft);">${isSelf ? '(Siz)' : ''}</span>`;

      return `<div class="personnel-item">
        <span class="personnel-name">${esc(u.username)} <span style="font-size:12px; font-weight:normal; color:var(--ink-soft);">(${(u.role === 'admin' || u.role === 'YÖNETİM') ? 'Yönetici' : u.role})</span> — <span style="font-size:12px; font-weight:bold; color:var(--accent-dark);">Personel: ${esc(u.personnelName || u.username)}</span></span>
        <span style="font-family:'JetBrains Mono',monospace; font-size:12px; margin-right:15px; color:var(--ink-soft);">Şifre: ${esc(u.password)}</span>
        ${delBtn}
      </div>`;
    }).join('');

    list.querySelectorAll('[data-userdel]').forEach(btn => {
      btn.addEventListener('click', () => deleteUser(btn.dataset.userdel));
    });
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
        console.error(e);
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
      } catch (e) {
        console.error(e);
      }
    }

    if (!personnelList.some(p => p.toLowerCase() === pName.toLowerCase())) {
      personnelList.push(pName);
      renderEmployeeOptions();
      await savePersonnel();
    }

    $('inpAdminNewUser').value = '';
    $('inpAdminNewPass').value = '';
    $('inpAdminNewPersonnelName').value = '';
    renderUsersPanel();
    await saveUsers();
    showToast('Kullanıcı başarıyla oluşturuldu: ' + uName);
  }

  async function deleteUser(username) {
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
        console.error(e);
        showToast('Kullanıcı silinemedi: ' + e.message, true);
        return;
      }
    }

    users = users.filter(x => x.username !== username);
    renderUsersPanel();
    await saveUsers();
    showToast('Kullanıcı silindi: ' + username);
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

  function fmtDate(iso) {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}.${m}.${y}`;
  }

  function fmtDateTime(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '—';
      return d.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch(e) {
      return '—';
    }
  }

  // ---- storage ----
  async function loadProjects() {
    if (!storageAvailable()) {
      projects = [];
      loaded = true;
      renderGrid();
      updateNextCodeHint();
      renderPersonnelPanel();
      checkEmployeeWarning();
      return;
    }
    if (useSupabase) {
      try {
        const { data: settingsData } = await supabase.from('projects').select('notes').eq('id', '__settings__');
        if (settingsData && settingsData.length > 0) {
          try {
            const parsed = JSON.parse(settingsData[0].notes);
            crmStartCode = parsed.crmStartCode || (parsed.crmStartSeq ? (String(new Date().getFullYear()).slice(-2) + '-' + String(parsed.crmStartSeq).padStart(5, '0')) : crmStartCode);
          } catch (e) {
            const oldSeq = parseInt(settingsData[0].notes);
            if (!isNaN(oldSeq)) {
              crmStartCode = String(new Date().getFullYear()).slice(-2) + '-' + String(oldSeq).padStart(5, '0');
            }
          }
        }
      } catch (e) {
        console.error("Failed to load settings from Supabase:", e);
      }

      try {
        const { data, error } = await supabase.from('projects').select('*');
        if (error) throw error;
        projects = (data || []).filter(p => p.id !== '__settings__').map(p => {
          const notesParsed = parseNotesField(p.notes);
          const obj = {
            id: p.id,
            company: p.company,
            crmCode: p.crm_code,
            buildingCode: p.building_code,
            areaM2: p.area_m2,
            projectType: p.project_type,
            employee: p.employee,
            status: p.status,
            date: p.date,
            notes: notesParsed.notes,
            customerName: notesParsed.customerName,
            createdAt: notesParsed.createdAt,
            updatedAt: notesParsed.updatedAt
          };

          let fName = p.file_name;
          let fSize = p.file_size ? parseInt(p.file_size) : null;
          let fUrl = p.file_url;

          if (fName === '[MULTI]' && fUrl) {
            try {
              const multi = JSON.parse(fUrl);
              obj.fileDwgName = multi.dwg ? multi.dwg.name : null;
              obj.fileDwgSize = multi.dwg ? multi.dwg.size : null;
              obj.fileDwgData = multi.dwg ? multi.dwg.url : null;
              obj.fileExcelName = multi.excel ? multi.excel.name : null;
              obj.fileExcelSize = multi.excel ? multi.excel.size : null;
              obj.fileExcelData = multi.excel ? multi.excel.url : null;
              obj.fileAxdName = multi.axd ? multi.axd.name : null;
              obj.fileAxdSize = multi.axd ? multi.axd.size : null;
              obj.fileAxdData = multi.axd ? multi.axd.url : null;
            } catch (e) { }
          } else {
            obj.fileDwgName = fName;
            obj.fileDwgSize = fSize;
            obj.fileDwgData = fUrl;
          }

          return obj;
        });
      } catch (e) {
        console.error("Supabase load projects error:", e);
        showToast("Veriler yüklenirken hata oluştu: " + e.message, true);
        projects = [];
      }
    } else {
      try {
        const val = await getStorageItem('mimari-crm-start-code');
        if (val) {
          crmStartCode = val;
        } else {
          const oldVal = await getStorageItem('mimari-crm-start-seq');
          if (oldVal) {
            crmStartCode = String(new Date().getFullYear()).slice(-2) + '-' + String(oldVal).padStart(5, '0');
          }
        }
      } catch (e) { }

      try {
        const val = await getStorageItem(STORAGE_KEY);
        const parsed = val ? JSON.parse(val) : [];
        projects = Array.isArray(parsed) ? parsed.filter(p => p.id !== '__settings__').map(p => {
          const notesParsed = parseNotesField(p.notes);
          return {
            ...p,
            notes: notesParsed.notes,
            customerName: p.customerName || notesParsed.customerName || '',
            createdAt: p.createdAt || notesParsed.createdAt || null,
            updatedAt: p.updatedAt || notesParsed.updatedAt || null
          };
        }) : [];
      } catch (e) {
        projects = [];
      }
    }
    loaded = true;
    renderGrid();
    updateNextCodeHint();
    renderPersonnelPanel();
    checkEmployeeWarning();
  }

  async function saveProjects() {
    if (useSupabase) return true;
    if (!storageAvailable()) return true;
    try {
      const res = await setStorageItem(STORAGE_KEY, JSON.stringify(projects));
      if (!res) { showToast('Kaydetme başarısız oldu, tekrar deneyin.', true); return false; }
      return true;
    } catch (e) {
      showToast('Depolama hatası: kaydedilemedi.', true);
      return false;
    }
  }

  // ---- şube / firma listesi ----
  async function loadFirms() {
    if (!storageAvailable()) {
      otherFirms = [];
      renderCompanyOptions();
      return;
    }
    if (useSupabase) {
      try {
        const { data, error } = await supabase.from('firms').select('*');
        if (error) throw error;
        otherFirms = (data || []).map(x => x.name);
      } catch (e) {
        console.error("loadFirms error:", e);
        otherFirms = [];
      }
    } else {
      try {
        const val = await getStorageItem(STORAGE_KEY_FIRMS);
        const parsed = val ? JSON.parse(val) : [];
        otherFirms = Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        otherFirms = [];
      }
    }
    renderCompanyOptions();
  }

  async function saveFirms() {
    if (useSupabase) return true;
    if (!storageAvailable()) return true;
    try {
      const res = await setStorageItem(STORAGE_KEY_FIRMS, JSON.stringify(otherFirms));
      if (!res) { showToast('Firma listesi kaydedilemedi.', true); return false; }
      return true;
    } catch (e) {
      showToast('Depolama hatası: firma eklenemedi.', true);
      return false;
    }
  }

  function renderCompanyOptions(selectedValue) {
    const branchGroup = $('optgroupBranches');
    const otherGroup = $('optgroupOther');
    branchGroup.innerHTML = FIXED_BRANCHES.map(c => {
      const v = `AKSA ÇELİK AŞ - ${c}`;
      return `<option value="${esc(v)}">${esc(v)}</option>`;
    }).join('');
    otherGroup.innerHTML = otherFirms.map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join('');
    otherGroup.style.display = otherFirms.length ? '' : 'none';
    const sel = $('selCompany');
    if (selectedValue) {
      sel.value = selectedValue;
    } else if (sel.value === '') {
      sel.selectedIndex = 0;
    }
  }

  function isDuplicateFirm(val) {
    const lower = val.toLowerCase();
    return otherFirms.some(f => f.toLowerCase() === lower)
      || FIXED_BRANCHES.some(c => `aksa çelik aş - ${c}`.toLowerCase() === lower);
  }

  async function addNewFirma() {
    const val = $('inpNewFirma').value.trim();
    if (!val) {
      showToast('Firma / şube adı boş olamaz.', true);
      return;
    }
    if (isDuplicateFirm(val)) {
      showToast('Bu firma / şube zaten listede mevcut.', true);
      renderCompanyOptions(val);
      $('addFirmaRow').classList.add('hidden');
      $('inpNewFirma').value = '';
      return;
    }

    if (useSupabase) {
      try {
        const { error } = await supabase.from('firms').insert({ name: val });
        if (error) throw error;
      } catch (e) {
        console.error(e);
        showToast('Firma eklenemedi: ' + e.message, true);
        return;
      }
    }

    otherFirms.push(val);
    renderCompanyOptions(val);
    $('inpNewFirma').value = '';
    $('addFirmaRow').classList.add('hidden');
    const ok = await saveFirms();
    if (ok) showToast('Yeni firma / şube eklendi: ' + val);
  }

  // ---- çizim / proje tipi listesi ----
  async function loadTypes() {
    if (!storageAvailable()) {
      otherTypes = [];
      renderTypeOptions();
      return;
    }
    if (useSupabase) {
      try {
        const { data, error } = await supabase.from('types').select('*');
        if (error) throw error;
        otherTypes = (data || []).map(x => x.name);
      } catch (e) {
        console.error("loadTypes error:", e);
        otherTypes = [];
      }
    } else {
      try {
        const val = await getStorageItem(STORAGE_KEY_TYPES);
        const parsed = val ? JSON.parse(val) : [];
        otherTypes = Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        otherTypes = [];
      }
    }
    renderTypeOptions();
  }

  async function saveTypes() {
    if (useSupabase) return true;
    if (!storageAvailable()) return true;
    try {
      const res = await setStorageItem(STORAGE_KEY_TYPES, JSON.stringify(otherTypes));
      if (!res) { showToast('Çizim tipi listesi kaydedilemedi.', true); return false; }
      return true;
    } catch (e) {
      showToast('Depolama hatası: çizim tipi eklenemedi.', true);
      return false;
    }
  }

  function renderTypeOptions(selectedValue) {
    const fixedGroup = $('optgroupTypesFixed');
    const otherGroup = $('optgroupTypesOther');
    fixedGroup.innerHTML = FIXED_TYPES.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
    otherGroup.innerHTML = otherTypes.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
    otherGroup.style.display = otherTypes.length ? '' : 'none';
    const sel = $('selType');
    if (selectedValue) {
      sel.value = selectedValue;
    } else if (sel.value === '') {
      sel.selectedIndex = 0;
    }
  }

  function isDuplicateType(val) {
    const lower = val.toLowerCase();
    return otherTypes.some(t => t.toLowerCase() === lower)
      || FIXED_TYPES.some(t => t.toLowerCase() === lower);
  }

  async function addNewType() {
    const val = $('inpNewType').value.trim();
    if (!val) {
      showToast('Çizim tipi boş olamaz.', true);
      return;
    }
    if (isDuplicateType(val)) {
      showToast('Bu çizim tipi zaten listede mevcut.', true);
      renderTypeOptions(val);
      $('addTypeRow').classList.add('hidden');
      $('inpNewType').value = '';
      return;
    }

    if (useSupabase) {
      try {
        const { error } = await supabase.from('types').insert({ name: val });
        if (error) throw error;
      } catch (e) {
        console.error(e);
        showToast('Çizim tipi eklenemedi: ' + e.message, true);
        return;
      }
    }

    otherTypes.push(val);
    renderTypeOptions(val);
    $('inpNewType').value = '';
    $('addTypeRow').classList.add('hidden');
    const ok = await saveTypes();
    if (ok) showToast('Yeni çizim tipi eklendi: ' + val);
  }

  // ---- personel listesi ----
  async function loadPersonnel() {
    if (!storageAvailable()) {
      personnelList = [];
      renderEmployeeOptions();
      renderPersonnelPanel();
      return;
    }
    if (useSupabase) {
      try {
        const { data, error } = await supabase.from('personnel').select('*');
        if (error) throw error;
        personnelList = (data || []).map(x => x.name);
      } catch (e) {
        console.error("loadPersonnel error:", e);
        personnelList = [];
      }
    } else {
      try {
        const val = await getStorageItem(STORAGE_KEY_PERSONNEL);
        const parsed = val ? JSON.parse(val) : [];
        personnelList = Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        personnelList = [];
      }
    }
    renderEmployeeOptions();
    renderPersonnelPanel();
  }

  async function savePersonnel() {
    if (useSupabase) return true;
    if (!storageAvailable()) return true;
    try {
      const res = await setStorageItem(STORAGE_KEY_PERSONNEL, JSON.stringify(personnelList));
      if (!res) { showToast('Personel listesi kaydedilemedi.', true); return false; }
      return true;
    } catch (e) {
      showToast('Depolama hatası: personel kaydedilemedi.', true);
      return false;
    }
  }

  function isDuplicatePersonnel(val) {
    const lower = val.toLowerCase();
    return personnelList.some(p => p.toLowerCase() === lower);
  }

  function hasActiveJob(name) {
    if (!name) return false;
    const lower = name.trim().toLowerCase();
    return projects.some(p => (p.employee || '').trim().toLowerCase() === lower && (p.status || 'Bekliyor') === 'Bekliyor');
  }

  function activeJobOf(name) {
    if (!name) return null;
    const lower = name.trim().toLowerCase();
    return projects.find(p => (p.employee || '').trim().toLowerCase() === lower && (p.status || 'Bekliyor') === 'Bekliyor') || null;
  }

  function renderEmployeeOptions(selectedValue) {
    const sel = $('selEmployee');
    const current = selectedValue !== undefined ? selectedValue : sel.value;
    sel.innerHTML = '<option value="">— Seçilmedi —</option>' +
      personnelList.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
    sel.value = current || '';
    if (sel.value !== (current || '')) sel.value = '';
  }

  function renderPersonnelPanel() {
    const list = $('personnelList');
    if (personnelList.length === 0) {
      list.innerHTML = `<div class="empty-state"><div class="big">Henüz personel eklenmemiş</div>Yukarıdaki alandan ilk personeli ekleyerek başlayın.</div>`;
      return;
    }
    const isUserAdmin = currentUser && (currentUser.role === 'admin' || currentUser.role === 'YÖNETİM');
    const sorted = [...personnelList].sort((a, b) => a.localeCompare(b, 'tr'));
    list.innerHTML = sorted.map(name => {
      const job = activeJobOf(name);
      const tag = job ? `<span class="personnel-busy-tag">AKTİF İŞ: ${esc(job.crmCode)}</span>` : '';
      const delBtn = isUserAdmin
        ? `<button class="personnel-del" data-persondel="${esc(name)}" title="Personeli sil">✕</button>`
        : '';
      return `<div class="personnel-item">
        <span class="personnel-name">${esc(name)}</span>
        ${tag}
        ${delBtn}
      </div>`;
    }).join('');
    list.querySelectorAll('[data-persondel]').forEach(btn => {
      btn.addEventListener('click', () => removePersonnel(btn.dataset.persondel));
    });
  }

  async function addPersonnel() {
    if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'YÖNETİM')) {
      showToast('Sadece yöneticiler personel ekleyebilir.', true);
      return;
    }
    const val = $('inpNewPersonnel').value.trim();
    if (!val) {
      showToast('Personel adı boş olamaz.', true);
      return;
    }
    if (isDuplicatePersonnel(val)) {
      showToast('Bu personel zaten listede mevcut.', true);
      return;
    }

    if (useSupabase) {
      try {
        const { error } = await supabase.from('personnel').insert({ name: val });
        if (error) throw error;
      } catch (e) {
        console.error(e);
        showToast('Personel eklenemedi: ' + e.message, true);
        return;
      }
    }

    personnelList.push(val);
    $('inpNewPersonnel').value = '';
    renderPersonnelPanel();
    renderEmployeeOptions();
    const ok = await savePersonnel();
    if (ok) showToast('Personel eklendi: ' + val);
  }

  async function removePersonnel(name) {
    if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'YÖNETİM')) {
      showToast('Sadece yöneticiler personel silebilir.', true);
      return;
    }
    const job = activeJobOf(name);
    const msg = job
      ? `"${name}" adlı personelin şu anda bekleyen bir işi var (CRM: ${job.crmCode}). Yine de listeden silmek istiyor musunuz?`
      : `"${name}" adlı personeli listeden silmek istediğinize emin misiniz?`;
    if (!confirm(msg)) return;

    if (useSupabase) {
      try {
        const { error } = await supabase.from('personnel').delete().eq('name', name);
        if (error) throw error;
      } catch (e) {
        console.error(e);
        showToast('Personel silinemedi: ' + e.message, true);
        return;
      }
    }

    personnelList = personnelList.filter(p => p !== name);
    renderPersonnelPanel();
    renderEmployeeOptions();
    checkEmployeeWarning();
    const ok = await savePersonnel();
    if (ok) showToast('Personel silindi: ' + name);
  }

  function checkEmployeeWarning() {
    const name = $('selEmployee').value.trim();
    const warnBox = $('employeeWarning');
    const job = name ? activeJobOf(name) : null;
    if (job) {
      warnBox.textContent = `⚠ ${name} adlı personel bekleyen bir iş almıştır (CRM: ${job.crmCode} — ${job.company}).`;
      warnBox.classList.remove('hidden');
    } else {
      warnBox.classList.add('hidden');
    }
  }

  // ---- CRM code suggestion ----
  function suggestNextCrm() {
    const matchStart = /^(\d{2})-(\d{5})$/.exec(crmStartCode.trim());
    let configPrefix = String(new Date().getFullYear()).slice(-2);
    let startSeq = 1;
    if (matchStart) {
      configPrefix = matchStart[1];
      startSeq = parseInt(matchStart[2], 10);
    }

    let maxSeq = startSeq - 1;
    projects.forEach(p => {
      const m = /^(\d{2})-(\d{5})$/.exec((p.crmCode || '').trim());
      if (m && m[1] === configPrefix) {
        const seq = parseInt(m[2], 10);
        if (seq > maxSeq) maxSeq = seq;
      }
    });
    const next = String(maxSeq + 1).padStart(5, '0');
    return `${configPrefix}-${next}`;
  }

  function updateNextCodeHint() {
    $('nextCodeHint').textContent = 'sıradaki kod: ' + suggestNextCrm();
  }

  // ---- rendering ----
  function renderGrid() {
    const q = (searchInput.value || '').trim().toLocaleLowerCase('tr-TR');
    const filtered = projects
      .filter(p => {
        if (!q) return true;
        const trLower = (str) => String(str || '').toLocaleLowerCase('tr-TR');
        return trLower(p.company).includes(q)
          || trLower(p.crmCode).includes(q)
          || trLower(p.buildingCode).includes(q)
          || trLower(p.projectType).includes(q)
          || trLower(p.employee).includes(q)
          || trLower(p.customerName).includes(q)
          || trLower(p.notes).includes(q)
          || trLower(p.fileName).includes(q)
          || trLower(p.status).includes(q)
          || trLower(p.areaM2).includes(q)
          || trLower(p.date).includes(q)
          || trLower(fmtDate(p.date)).includes(q);
      })
      .sort((a, b) => (b.crmCode || '').localeCompare(a.crmCode || ''));

    countPill.textContent = `${filtered.length} proje${projects.length !== filtered.length ? ` (toplam ${projects.length})` : ''}`;

    if (!loaded) {
      gridArea.innerHTML = `<div class="empty-state"><div class="big">Yükleniyor…</div>Proje listesi getiriliyor.</div>`;
      return;
    }

    if (filtered.length === 0) {
      gridArea.innerHTML = projects.length === 0
        ? `<div class="empty-state"><div class="big">Henüz proje eklenmemiş</div>"Yeni Talep Gir" sekmesinden ilk çizim talebini ekleyerek panoyu başlatın.</div>`
        : `<div class="empty-state"><div class="big">Sonuç bulunamadı</div>Arama kriterlerinizi kontrol edin.</div>`;
      return;
    }

    const bekleyen = filtered.filter(p => (p.status || 'Bekliyor') === 'Bekliyor');
    const yapilan = filtered.filter(p => (p.status || 'Bekliyor') === 'Yapıldı');
    const gridClass = currentView === 'list' ? 'grid list-view' : 'grid';

    gridArea.innerHTML = `
      <div class="board-section">
        <div class="board-section-head">
          <span class="board-section-title">Devam Eden İşler</span>
          <span class="board-section-count">${bekleyen.length}</span>
        </div>
        ${bekleyen.length
        ? `<div class="${gridClass}">${bekleyen.map(cardHtml).join('')}</div>`
        : `<div class="empty-state small">Devam eden iş yok.</div>`}
      </div>
      <div class="board-section">
        <div class="board-section-head">
          <span class="board-section-title">Yapılan İşler</span>
          <span class="board-section-count">${yapilan.length}</span>
        </div>
        ${yapilan.length
        ? `<div class="${gridClass}">${yapilan.map(cardHtml).join('')}</div>`
        : `<div class="empty-state small">Henüz tamamlanan iş yok.</div>`}
      </div>
    `;

    filtered.forEach(p => {
      const card = document.querySelector(`[data-card="${p.id}"]`);
      if (card) card.addEventListener('click', () => startEditProject(p.id));
      const btn = document.querySelector(`[data-del="${p.id}"]`);
      if (btn) btn.addEventListener('click', (e) => { e.stopPropagation(); deleteProject(p.id); });
      const toggleBtn = document.querySelector(`[data-toggle="${p.id}"]`);
      if (toggleBtn) toggleBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleStatus(p.id); });
    });
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function canManageProject(p) {
    if (!currentUser) return false;
    if (currentUser.role === 'admin' || currentUser.role === 'YÖNETİM') return true;

    const empName = (p.employee || '').trim().toLowerCase();
    const currName = (currentUser.username || '').trim().toLowerCase();
    const currPersName = (currentUser.personnelName || '').trim().toLowerCase();
    return empName === currName || empName === currPersName;
  }

  function cardHtml(p) {
    const status = p.status || 'Bekliyor';
    const statusClass = status === 'Yapıldı' ? 'yapildi' : 'bekliyor';
    const allowed = canManageProject(p);

    const delButton = allowed
      ? `<button class="card-del" data-del="${p.id}" title="Kaydı sil">✕</button>`
      : '';

    const statusBadge = allowed
      ? `<button class="status-badge ${statusClass}" data-toggle="${p.id}" title="Durumu değiştir">${esc(status)}</button>`
      : `<span class="status-badge ${statusClass}" style="cursor: default; opacity: 0.85;">${esc(status)}</span>`;

    const cardClass = 'card';

    return `
      <div class="${cardClass}" data-card="${p.id}">
        <div class="card-head">
          <span class="card-crm">${esc(p.crmCode)}</span>
          <div style="display:flex;align-items:center;gap:8px;">
            ${statusBadge}
            ${delButton}
          </div>
        </div>
        <div class="card-body">
          <div class="card-main-info">
            <p class="card-company">${esc(p.company)}</p>
            <div class="card-row"><span>Bina Kodu</span><b>${esc(p.buildingCode || '—')}</b></div>
            <div class="card-row"><span>Bina Alanı</span><b>${p.areaM2 ? (p.areaM2.toString().includes('m²') ? esc(p.areaM2) : esc(p.areaM2) + ' m²') : '—'}</b></div>
            <div class="card-row"><span>Personel</span><b>${esc(p.employee) || '—'}</b></div>
            <div class="card-row"><span>Tarih</span><b>${fmtDate(p.date)}</b></div>
            ${p.customerName ? `<div class="card-row"><span>Müşteri</span><b>${esc(p.customerName)}</b></div>` : ''}
            <div class="card-row"><span>Eklenme</span><b style="font-size:11px;">${fmtDateTime(p.createdAt)}</b></div>
            ${p.updatedAt && p.updatedAt !== p.createdAt ? `<div class="card-row"><span>Güncellenme</span><b style="font-size:11px;">${fmtDateTime(p.updatedAt)}</b></div>` : ''}
            <span class="card-type">${esc(p.projectType)}</span>
          </div>
          
          ${(() => {
            const displayNotes = p.notes ? p.notes.replace(/\[DraftID: [^\]]+\]/g, '').trim() : '';
            const hasNotes = !!displayNotes;
            const hasFiles = (p.fileDwgName && p.fileDwgData) || (p.fileExcelName && p.fileExcelData) || (p.fileAxdName && p.fileAxdData) || (p.fileName && p.fileData);
            
            if (!hasNotes && !hasFiles) return '';
            
            let filesHtml = '';
            if (p.fileDwgName && p.fileDwgData) {
              filesHtml += `
                <div class="card-file-item dwg-file">
                  <span>AutoCAD (.dwg)</span>
                  <a href="${p.fileDwgData}" onclick="downloadProjectFileCustom(event, '${esc(p.fileDwgData)}', '${esc(p.fileDwgName)}', '${esc(p.id)}')" title="${esc(p.fileDwgName)}">
                    📁 ${esc(p.fileDwgName)} (${formatBytes(p.fileDwgSize)})
                  </a>
                </div>
              `;
            }
            if (p.fileExcelName && p.fileExcelData) {
              filesHtml += `
                <div class="card-file-item excel-file">
                  <span>Excel (.xls/.xlsx)</span>
                  <a href="${p.fileExcelData}" onclick="downloadProjectFileCustom(event, '${esc(p.fileExcelData)}', '${esc(p.fileExcelName)}', '${esc(p.id)}')" title="${esc(p.fileExcelName)}">
                    📁 ${esc(p.fileExcelName)} (${formatBytes(p.fileExcelSize)})
                  </a>
                </div>
              `;
            }
            if (p.fileAxdName && p.fileAxdData) {
              filesHtml += `
                <div class="card-file-item axd-file">
                  <span>AXD (.axd)</span>
                  <a href="${p.fileAxdData}" onclick="downloadProjectFileCustom(event, '${esc(p.fileAxdData)}', '${esc(p.fileAxdName)}', '${esc(p.id)}')" title="${esc(p.fileAxdName)}">
                    📁 ${esc(p.fileAxdName)} (${formatBytes(p.fileAxdSize)})
                  </a>
                </div>
              `;
            }
            if (p.fileName && p.fileData) {
              filesHtml += `
                <div class="card-file-item other-file">
                  <span>Dosya</span>
                  <a href="${p.fileData}" onclick="downloadProjectFileCustom(event, '${esc(p.fileData)}', '${esc(p.fileName)}', '${esc(p.id)}')" title="${esc(p.fileName)}">
                    📁 ${esc(p.fileName)} (${formatBytes(p.fileSize)})
                  </a>
                </div>
              `;
            }
            
            return `
              <div class="card-sub-info">
                ${displayNotes ? `<div class="card-sub-note"><strong>Not:</strong><span>${esc(displayNotes)}</span></div>` : '<div></div>'}
                <div class="card-sub-files">
                  ${filesHtml}
                </div>
              </div>
            `;
          })()}
        </div>
      </div>`;
  }

  function startEditProject(id, draftId = null) {
    const p = projects.find(pr => pr.id === id);
    if (!p) return;
    
    editingProjectId = id;
    const allowed = canManageProject(p);
    onlyPersonnelEdit = !allowed;

    if (onlyPersonnelEdit) {
      showToast('Sadece atanmış personeli değiştirme yetkiniz vardır.', false);
      $('selCompany').disabled = true;
      $('inpCrm').disabled = true;
      $('inpBuildingCode').disabled = true;
      $('inpAreaM2').disabled = true;
      $('inpCustomerName').disabled = true;
      $('selType').disabled = true;
      $('inpDate').disabled = true;
      $('inpNotes').disabled = true;
      $('inpFileDwg').disabled = true;
      $('inpFileExcel').disabled = true;
      $('inpFileAxd').disabled = true;
      $('btnSubmit').textContent = 'Sadece Personeli Güncelle';
    } else {
      $('selCompany').disabled = false;
      $('inpCrm').disabled = false;
      $('inpBuildingCode').disabled = false;
      $('inpAreaM2').disabled = false;
      $('inpCustomerName').disabled = false;
      $('selType').disabled = false;
      $('inpDate').disabled = false;
      $('inpNotes').disabled = false;
      $('inpFileDwg').disabled = false;
      $('inpFileExcel').disabled = false;
      $('inpFileAxd').disabled = false;
      $('btnSubmit').textContent = 'Değişiklikleri Kaydet';
    }

    // Fill company
    const baseCompany = p.company.replace('AKSA ÇELİK AŞ - ', '');
    if (!FIXED_BRANCHES.includes(baseCompany) && !otherFirms.includes(p.company)) {
      otherFirms.push(p.company);
      renderCompanyOptions(p.company);
    } else {
      renderCompanyOptions(p.company);
    }

    $('inpCrm').value = p.crmCode || '';
    $('inpBuildingCode').value = p.buildingCode || '';
    $('inpAreaM2').value = p.areaM2 || '';
    $('inpCustomerName').value = p.customerName || '';

    // Fill type
    if (!FIXED_TYPES.includes(p.projectType) && !otherTypes.includes(p.projectType)) {
      otherTypes.push(p.projectType);
      renderTypeOptions(p.projectType);
    } else {
      renderTypeOptions(p.projectType);
    }

    $('selEmployee').value = p.employee || '';
    $('inpDate').value = p.date || todayISO();
    $('inpNotes').value = p.notes || '';

    const draftObj = draftId ? drafts.find(x => x.id === draftId) : null;
    if (draftObj) {
      updateDraftStatus(draftId, 'status', 'bekleyen');
      activeDraftIdForNewProject = draftId;
      if (btnSaveDraft) btnSaveDraft.classList.remove('hidden');
      $('btnSubmit').textContent = 'Panoya Ekle';
      
      const tales = [];
      if (draftObj.crmRequested) tales.push('CRM');
      if (draftObj.takimRequested) tales.push('TAKIM');
      if (draftObj.sayimRequested) tales.push('SAYIM');
      
      let currentNotes = p.notes || '';
      if (!currentNotes.includes(`[DraftID: ${draftObj.id}]`)) {
        $('inpNotes').value = `[Taslaktan Talebe Gönderildi. Talepler: ${tales.join(', ')}] [DraftID: ${draftObj.id}]\n` + currentNotes;
      }
    } else {
      if (btnSaveDraft) btnSaveDraft.classList.add('hidden');
      if (!onlyPersonnelEdit) {
        $('btnSubmit').textContent = 'Değişiklikleri Kaydet';
      }
    }

    // Handle attached files
    ['dwg', 'excel', 'axd'].forEach(type => {
      const uType = type.charAt(0).toUpperCase() + type.slice(1);
      
      if (type === 'dwg' && draftObj) {
        attachedFiles.dwg = {
          name: draftObj.fileName,
          size: draftObj.fileSize,
          data: draftObj.fileUrl,
          fileRaw: null
        };
        $('fileStatusDwg').textContent = `Hazır (Taslak): ${draftObj.fileName} (${formatBytes(draftObj.fileSize)})`;
        if (onlyPersonnelEdit) {
          $('btnRemoveFileDwg').classList.add('hidden');
        } else {
          $('btnRemoveFileDwg').classList.remove('hidden');
        }
        return;
      }

      if (p['file' + uType + 'Name'] && p['file' + uType + 'Data']) {
        attachedFiles[type] = {
          name: p['file' + uType + 'Name'],
          size: p['file' + uType + 'Size'],
          data: p['file' + uType + 'Data']
        };
        $('fileStatus' + uType).textContent = `Yüklü: ${p['file' + uType + 'Name']} (${formatBytes(p['file' + uType + 'Size'])})`;
        if (onlyPersonnelEdit) {
          $('btnRemoveFile' + uType).classList.add('hidden');
        } else {
          $('btnRemoveFile' + uType).classList.remove('hidden');
        }
      } else if (p.fileName && p.fileData && type === 'dwg') {
        // Backwards compatibility
        attachedFiles.dwg = { name: p.fileName, size: p.fileSize, data: p.fileData };
        $('fileStatusDwg').textContent = `Yüklü: ${p.fileName} (${formatBytes(p.fileSize)})`;
        $('btnRemoveFileDwg').classList.remove('hidden');
      } else {
        attachedFiles[type] = null;
        $('inpFile' + uType).value = '';
        $('fileStatus' + uType).textContent = '';
        $('btnRemoveFile' + uType).classList.add('hidden');
      }
    });

    // Edit mode UI
    $('tbTopTitle').textContent = 'TALEBİ DÜZENLE';
    $('btnSubmit').textContent = 'Değişiklikleri Kaydet';
    $('btnCancelEdit').classList.remove('hidden');
    if ($('btnSendToFabrika')) $('btnSendToFabrika').classList.remove('hidden');

    switchTab('form');
  }
  window.startEditProject = startEditProject;

  function cancelEdit() {
    resetForm();
    switchTab('board');
  }

  async function toggleStatus(id) {
    const p = projects.find(pr => pr.id === id);
    if (!p) return;
    if (!canManageProject(p)) {
      showToast('Bu projenin durumunu değiştirme yetkiniz yok.', true);
      return;
    }
    const newStatus = (p.status || 'Bekliyor') === 'Bekliyor' ? 'Yapıldı' : 'Bekliyor';

    if (newStatus === 'Yapıldı') {
      const hasDwg = p.fileDwgData && p.fileDwgData.trim() !== '';
      const hasAxd = p.fileAxdData && p.fileAxdData.trim() !== '';
      const hasExcel = p.fileExcelData && p.fileExcelData.trim() !== '';
      
      if (!hasDwg || !hasAxd || !hasExcel) {
        const missing = [];
        if (!hasDwg) missing.push("AutoCAD (.dwg)");
        if (!hasAxd) missing.push("AXD (.axd)");
        if (!hasExcel) missing.push("Excel (.xls/.xlsx)");
        
        showToast(`Talebi "Yapıldı" yapmak için eksik dosyaları yüklemelisiniz: ${missing.join(', ')}`, true);
        return;
      }
    }

    const updatedAt = new Date().toISOString();
    const notesRaw = serializeNotesField(p.customerName || '', p.notes || '', p.createdAt, updatedAt);

    let ok = false;
    if (useSupabase) {
      try {
        const { error } = await supabase.from('projects').update({ status: newStatus, notes: notesRaw }).eq('id', id);
        if (error) throw error;
        p.status = newStatus;
        p.updatedAt = updatedAt;
        ok = true;
      } catch (e) {
        console.error(e);
        showToast('Hata: Durum güncellenemedi.', true);
      }
    } else {
      p.status = newStatus;
      p.updatedAt = updatedAt;
      ok = await saveProjects();
    }

    if (ok) {
      renderGrid();
      renderPersonnelPanel();
      checkEmployeeWarning();
      showToast(p.status === 'Bekliyor' ? 'İş bekliyor olarak işaretlendi.' : 'İş yapıldı olarak işaretlendi.');
      if (newStatus === 'Yapıldı') {
        sendProjectToFabrika(p);
      }
    }
  }

  async function sendProjectToFabrika(p) {
    const orderId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const createdAt = new Date().toISOString();
    const title = `${p.company} (${p.crmCode}) - ${p.projectType}`;
    const excelUrl = p.fileExcelData || '';
    const excelName = p.fileExcelName || 'Excel Dosyası';
    const excelSize = p.fileExcelSize || 0;
    
    const notesArr = [
      `Bina Kodu: ${p.buildingCode || '—'}`,
      `Bina Alanı: ${p.areaM2 || '—'}`,
      p.notes ? `Proje Notu: ${p.notes}` : ''
    ];
    if (p.fileDwgData && p.fileDwgName) {
      notesArr.push(`AutoCAD DWG: ${p.fileDwgName} (${p.fileDwgData})`);
    }
    if (p.fileAxdData && p.fileAxdName) {
      notesArr.push(`AXD Dosyası: ${p.fileAxdName} (${p.fileAxdData})`);
    }
    const notes = notesArr.filter(Boolean).join('\n');

    if (useSupabase) {
      try {
        const { error } = await supabase.from('fabrika_orders').insert({
          id: orderId,
          title: title,
          excel_url: excelUrl,
          excel_name: excelName,
          excel_size: excelSize,
          status: 'Bekliyor',
          notes: notes,
          created_at: createdAt,
          updated_at: createdAt
        });
        if (error) throw error;
      } catch (e) {
        console.error("sendProjectToFabrika error:", e);
      }
    } else {
      try {
        const val = await getStorageItem('mimari-fabrika-talepleri');
        const list = val ? JSON.parse(val) : [];
        list.unshift({
          id: orderId,
          title: title,
          excel_url: excelUrl,
          excel_name: excelName,
          excel_size: excelSize,
          status: 'Bekliyor',
          notes: notes,
          created_at: createdAt,
          updated_at: createdAt
        });
        await setStorageItem('mimari-fabrika-talepleri', JSON.stringify(list));
      } catch (e) {
        console.error("sendProjectToFabrika local error:", e);
      }
    }
  }

  async function deleteProject(id) {
    const p = projects.find(pr => pr.id === id);
    if (!p) return;
    if (!canManageProject(p)) {
      showToast('Bu projeyi silme yetkiniz yok.', true);
      return;
    }
    if (!confirm('Bu talebi listeden silmek istediğinize emin misiniz?')) return;

    let ok = false;
    if (useSupabase) {
      try {
        const { error } = await supabase.from('projects').delete().eq('id', id);
        if (error) throw error;
        projects = projects.filter(pr => pr.id !== id);
        ok = true;
      } catch (e) {
        console.error(e);
        showToast('Hata: Kayıt silinemedi.', true);
      }
    } else {
      projects = projects.filter(pr => pr.id !== id);
      ok = await saveProjects();
    }

    if (ok) {
      renderGrid();
      updateNextCodeHint();
      renderPersonnelPanel();
      checkEmployeeWarning();
      showToast('Kayıt silindi.');
    }
  }

  // ---- form validation & submit ----
  function setInvalid(cellId, invalid) {
    $(cellId).classList.toggle('invalid', invalid);
  }

  function validateForm() {
    let ok = true;
    const company = $('selCompany').value.trim();
    const companyInvalid = !company || company === '__add__';
    const crm = $('inpCrm').value.trim();
    const areaM2 = $('inpAreaM2').value.trim();
    const type = $('selType').value.trim();
    const typeInvalid = !type || type === '__add__';

    setInvalid('cell-company', companyInvalid); if (companyInvalid) ok = false;
    setInvalid('cell-crm', !/^\d{2}-\d{5}$/.test(crm)); if (!/^\d{2}-\d{5}$/.test(crm)) ok = false;
    setInvalid('cell-m2', !areaM2); if (!areaM2) ok = false;
    setInvalid('cell-type', typeInvalid); if (typeInvalid) ok = false;

    return ok;
  }

  async function submitForm() {
    if (onlyPersonnelEdit && editingProjectId) {
      $('btnSubmit').disabled = true;
      const p = projects.find(pr => pr.id === editingProjectId);
      if (p) {
        const employee = $('selEmployee').value.trim();
        const updatedAt = new Date().toISOString();
        const notesRaw = serializeNotesField(p.customerName || '', p.notes || '', p.createdAt, updatedAt);
        
        let ok = false;
        try {
          if (useSupabase) {
            const { error } = await supabase.from('projects').update({
              employee,
              notes: notesRaw
            }).eq('id', editingProjectId);
            if (error) throw error;
          }
          p.employee = employee;
          p.updatedAt = updatedAt;
          
          ok = useSupabase ? true : await saveProjects();
        } catch (err) {
          console.error("submitForm personnel edit error:", err);
          showToast("İşlem başarısız: " + err.message, true);
          ok = false;
        }
        
        if (ok) {
          showToast("Personel başarıyla güncellendi.");
          renderGrid();
          renderPersonnelPanel();
          checkEmployeeWarning();
          
          if (currentUser.role === 'PROJE') {
            switchTab('drafts');
          } else {
            switchTab('board');
          }
          editingProjectId = null;
        }
      }
      $('btnSubmit').disabled = false;
      return;
    }

    if (!editingProjectId) {
      $('inpCrm').value = suggestNextCrm();
    }

    const formattedCode = formatBuildingCode($('inpBuildingCode').value);
    $('inpBuildingCode').value = formattedCode;

    if (!validateForm()) {
      showToast('Lütfen işaretli alanları kontrol edin.', true);
      return;
    }
    const crm = $('inpCrm').value.trim();
    if (projects.some(p => p.crmCode === crm && p.id !== editingProjectId)) {
      setInvalid('cell-crm', true);
      $('cell-crm').querySelector('.field-err').textContent = 'Bu CRM kodu zaten kayıtlı.';
      showToast('Bu CRM kodu zaten listede mevcut.', true);
      return;
    }

    $('btnSubmit').disabled = true;

    let ok = false;
    try {
      let fileUrls = { dwg: null, excel: null, axd: null };
      for (let type of ['dwg', 'excel', 'axd']) {
        if (attachedFiles[type]) {
          if (attachedFiles[type].fileRaw) {
            fileUrls[type] = await uploadProjectFile(attachedFiles[type]);
          } else {
            fileUrls[type] = attachedFiles[type].data;
          }
        }
      }

      if (editingProjectId) {
        const p = projects.find(pr => pr.id === editingProjectId);
        if (p) {
          const company = $('selCompany').value.trim();
          const buildingCode = $('inpBuildingCode').value.trim();
          const areaM2 = $('inpAreaM2').value.trim();
          const customerName = $('inpCustomerName').value.trim();
          const projectType = $('selType').value.trim();
          const employee = $('selEmployee').value.trim();
          const date = $('inpDate').value || todayISO();
          const notes = $('inpNotes').value.trim();
          const createdAt = p ? p.createdAt : new Date().toISOString();
          const updatedAt = new Date().toISOString();
          const notesRaw = serializeNotesField(customerName, notes, createdAt, updatedAt);
          const fileDwgName = attachedFiles.dwg ? attachedFiles.dwg.name : null;
          const fileDwgSize = attachedFiles.dwg ? attachedFiles.dwg.size : null;
          const fileDwgData = fileUrls.dwg;
          const fileExcelName = attachedFiles.excel ? attachedFiles.excel.name : null;
          const fileExcelSize = attachedFiles.excel ? attachedFiles.excel.size : null;
          const fileExcelData = fileUrls.excel;
          const fileAxdName = attachedFiles.axd ? attachedFiles.axd.name : null;
          const fileAxdSize = attachedFiles.axd ? attachedFiles.axd.size : null;
          const fileAxdData = fileUrls.axd;

          if (useSupabase) {
            const { error } = await supabase.from('projects').update({
              company,
              crm_code: crm,
              building_code: buildingCode,
              area_m2: areaM2,
              project_type: projectType,
              employee,
              date,
              notes: notesRaw,
              file_name: '[MULTI]',
              file_size: (fileDwgSize || 0) + (fileExcelSize || 0) + (fileAxdSize || 0),
              file_url: JSON.stringify({
                dwg: { name: fileDwgName, size: fileDwgSize, url: fileDwgData },
                excel: { name: fileExcelName, size: fileExcelSize, url: fileExcelData },
                axd: { name: fileAxdName, size: fileAxdSize, url: fileAxdData }
              })
            }).eq('id', editingProjectId);

            if (error) throw error;
          }

          p.company = company;
          p.crmCode = crm;
          p.buildingCode = buildingCode;
          p.areaM2 = areaM2;
          p.projectType = projectType;
          p.employee = employee;
          p.date = date;
          p.notes = notes;
          p.customerName = customerName;
          p.createdAt = createdAt;
          p.updatedAt = updatedAt;
          p.notes = notes;
          p.customerName = customerName;
          p.fileDwgName = fileDwgName;
          p.fileDwgSize = fileDwgSize;
          p.fileDwgData = fileDwgData;
          p.fileExcelName = fileExcelName;
          p.fileExcelSize = fileExcelSize;
          p.fileExcelData = fileExcelData;
          p.fileAxdName = fileAxdName;
          p.fileAxdSize = fileAxdSize;
          p.fileAxdData = fileAxdData;

          ok = useSupabase ? true : await saveProjects();
        }
      } else {
        const entryId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const company = $('selCompany').value.trim();
        const buildingCode = $('inpBuildingCode').value.trim();
        const areaM2 = $('inpAreaM2').value.trim();
        const customerName = $('inpCustomerName').value.trim();
        const projectType = $('selType').value.trim();
        const employee = $('selEmployee').value.trim();
        const date = $('inpDate').value || todayISO();
        const notes = $('inpNotes').value.trim();
        const createdAt = new Date().toISOString();
        const updatedAt = createdAt;
        const notesRaw = serializeNotesField(customerName, notes, createdAt, updatedAt);
        const fileDwgName = attachedFiles.dwg ? attachedFiles.dwg.name : null;
        const fileDwgSize = attachedFiles.dwg ? attachedFiles.dwg.size : null;
        const fileDwgData = fileUrls.dwg;
        const fileExcelName = attachedFiles.excel ? attachedFiles.excel.name : null;
        const fileExcelSize = attachedFiles.excel ? attachedFiles.excel.size : null;
        const fileExcelData = fileUrls.excel;
        const fileAxdName = attachedFiles.axd ? attachedFiles.axd.name : null;
        const fileAxdSize = attachedFiles.axd ? attachedFiles.axd.size : null;
        const fileAxdData = fileUrls.axd;

        if (useSupabase) {
          const { error } = await supabase.from('projects').insert({
            id: entryId,
            company,
            crm_code: crm,
            building_code: buildingCode,
            area_m2: areaM2,
            project_type: projectType,
            employee,
            status: 'Bekliyor',
            date,
            notes: notesRaw,
            file_name: '[MULTI]',
            file_size: (fileDwgSize || 0) + (fileExcelSize || 0) + (fileAxdSize || 0),
            file_url: JSON.stringify({
              dwg: { name: fileDwgName, size: fileDwgSize, url: fileDwgData },
              excel: { name: fileExcelName, size: fileExcelSize, url: fileExcelData },
              axd: { name: fileAxdName, size: fileAxdSize, url: fileAxdData }
            })
          });

          if (error) throw error;
        }

        const entry = {
          id: entryId,
          company,
          crmCode: crm,
          buildingCode,
          areaM2,
          customerName,
          projectType,
          employee,
          status: 'Bekliyor',
          date,
          notes,
          fileDwgName,
          fileDwgSize,
          fileDwgData,
          fileExcelName,
          fileExcelSize,
          fileExcelData,
          fileAxdName,
          fileAxdSize,
          fileAxdData,
          createdAt,
          updatedAt
        };
        projects.push(entry);

        ok = useSupabase ? true : await saveProjects();
        if (!ok && !useSupabase) {
          projects = projects.filter(p => p.id !== entry.id);
        }
      }
    } catch (err) {
      console.error("submitForm error:", err);
      showToast("İşlem başarısız: " + err.message, true);
      ok = false;
    }

    $('btnSubmit').disabled = false;

    if (ok) {
      showToast(editingProjectId ? 'Değişiklikler kaydedildi.' : 'Talep listeye eklendi: ' + crm);
      const wasDraftProject = !!activeDraftIdForNewProject || (editingProjectId && drafts.some(d => (projects.find(p => p.id === editingProjectId)?.notes || '').includes(`[DraftID: ${d.id}]`)));
      if (activeDraftIdForNewProject) {
        // Do not force completed status; let the dynamic rules in renderDrafts handle it.
        activeDraftIdForNewProject = null;
      }
      resetForm();
      renderGrid();
      updateNextCodeHint();
      renderPersonnelPanel();

      // Trigger draft status refresh
      loadDrafts();

      if (wasDraftProject) {
        switchTab('drafts');
      } else {
        switchTab('board');
      }
    }
  }

  function resetForm() {
    editingProjectId = null;
    onlyPersonnelEdit = false;
    $('selCompany').disabled = false;
    $('inpCrm').disabled = false;
    $('inpBuildingCode').disabled = false;
    $('inpAreaM2').disabled = false;
    $('inpCustomerName').disabled = false;
    $('selType').disabled = false;
    $('inpDate').disabled = false;
    $('inpNotes').disabled = false;
    $('inpFileDwg').disabled = false;
    $('inpFileExcel').disabled = false;
    $('inpFileAxd').disabled = false;
    attachedFiles = { dwg: null, excel: null, axd: null };
    ['Dwg', 'Excel', 'Axd'].forEach(type => {
      $('inpFile' + type).value = '';
      $('fileStatus' + type).textContent = '';
      $('btnRemoveFile' + type).classList.add('hidden');
    });
    ['inpBuildingCode', 'inpAreaM2', 'inpNotes', 'inpCustomerName'].forEach(id => $(id).value = '');
    $('selCompany').selectedIndex = 0;
    $('addFirmaRow').classList.add('hidden');
    $('inpNewFirma').value = '';
    $('selType').selectedIndex = 0;
    $('addTypeRow').classList.add('hidden');
    $('inpNewType').value = '';
    $('selEmployee').value = '';
    $('employeeWarning').classList.add('hidden');
    $('inpDate').value = todayISO();
    $('inpCrm').value = suggestNextCrm();
    $('inpCrm').placeholder = 'YY-00000';
    ['cell-company', 'cell-crm', 'cell-area', 'cell-m2', 'cell-type'].forEach(id => $(id).classList.remove('invalid'));
    $('cell-crm').querySelector('.field-err').textContent = 'Format: YY-00000';

    $('tbTopTitle').textContent = 'ÇİZİM TALEP KİMLİK BLOĞU';
    $('btnSubmit').textContent = 'Kaydet';
    $('btnCancelEdit').classList.add('hidden');
    if (btnSaveDraft) btnSaveDraft.classList.add('hidden');
    if ($('btnSendToFabrika')) $('btnSendToFabrika').classList.add('hidden');
  }

  // ---- tabs ----
  function switchTab(name) {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    $('panel-board').classList.toggle('hidden', name !== 'board');
    $('panel-form').classList.toggle('hidden', name !== 'form');
    $('panel-personnel').classList.toggle('hidden', name !== 'personnel');
    $('panel-admin').classList.toggle('hidden', name !== 'admin');
    $('panel-stats').classList.toggle('hidden', name !== 'stats');
    $('panel-drafts').classList.toggle('hidden', name !== 'drafts');
    if (name === 'form') {
      updateNextCodeHint();
      if (!$('inpCrm').value) $('inpCrm').value = suggestNextCrm();
      if (!$('inpDate').value) $('inpDate').value = todayISO();
      checkEmployeeWarning();
    }
    if (name === 'personnel') {
      const isUserAdmin = currentUser && (currentUser.role === 'admin' || currentUser.role === 'YÖNETİM');
      const addRow = document.querySelector('.personnel-add-row');
      if (addRow) {
        addRow.style.display = isUserAdmin ? 'flex' : 'none';
      }
      renderPersonnelPanel();
    }
    if (name === 'admin') {
      renderUsersPanel();
      $('inpCrmStartCode').value = crmStartCode;
    }
    if (name === 'stats') {
      renderStats();
    }
    if (name === 'drafts') {
      loadDrafts();
    }
  }

  // ---- draft projects logic ----
  async function loadDrafts() {
    if (!useSupabase) {
      showToast("Supabase bağlantısı aktif değil.", true);
      drafts = [];
      renderDrafts();
      return;
    }
    // Ensure projects are synced from database before rendering draft badge statuses
    await loadProjects();
    try {
      const { data, error } = await supabase.from('draft_projects').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      drafts = (data || []).map(d => {
        let details = null;
        let fileUrl = d.file_url;
        let fileName = d.file_name;
        let fileSize = d.file_size;
        
        if (d.file_url && d.file_url.trim().startsWith('{') && d.file_url.trim().endsWith('}')) {
          try {
            details = JSON.parse(d.file_url);
            if (details.dwg) {
              fileUrl = details.dwg.url || d.file_url;
              fileName = details.dwg.name || d.file_name;
              fileSize = details.dwg.size || d.file_size;
            }
          } catch(e) {}
        }
        
        return {
          id: d.id,
          fileName: fileName,
          fileUrl: fileUrl,
          fileSize: fileSize,
          crmRequested: !!d.crm_requested,
          takimRequested: !!d.takim_requested,
          sayimRequested: !!d.sayim_requested,
          uploadedBy: d.uploaded_by || '—',
          createdAt: d.created_at,
          status: d.status || 'mevcut',
          details: details
        };
      });
      $('draftsTableWarning').classList.add('hidden');
    } catch (e) {
      console.error("Supabase loadDrafts error:", e);
      const warnEl = $('draftsTableWarning');
      if (warnEl) {
        warnEl.querySelector('p').innerHTML = `Taslaklar veritabanından yüklenemedi. Hata detayı: <strong style="color:var(--danger); font-weight:bold;">${e.message || e}</strong>. Bu sorunu çözmek için lütfen Supabase SQL Editor panelinizde aşağıdaki kodları çalıştırın ve sayfayı Ctrl+F5 ile yenileyin:`;
        warnEl.classList.remove('hidden');
      }
      drafts = [];
    }
    renderDrafts();
  }

  async function saveDrafts() {
    return true;
  }

  async function saveDraftOnly() {
    // Determine the draft ID to update
    let draftId = activeDraftIdForNewProject;
    if (!draftId && editingProjectId) {
      const p = projects.find(pr => pr.id === editingProjectId);
      if (p) {
        const match = /\[DraftID:\s*([a-zA-Z0-9_-]+)\]/.exec(p.notes || '');
        if (match) draftId = match[1];
      }
    }

    if (!draftId) {
      showToast("Güncellenecek taslak bulunamadı.", true);
      return;
    }

    const d = drafts.find(x => x.id === draftId);
    if (!d) {
      showToast("Taslak projesi bulunamadı.", true);
      return;
    }

    btnSaveDraft.disabled = true;

    try {
      // 1. Upload files if any have fileRaw
      let fileUrls = { dwg: null, excel: null, axd: null };
      for (let type of ['dwg', 'excel', 'axd']) {
        if (attachedFiles[type]) {
          if (attachedFiles[type].fileRaw) {
            fileUrls[type] = await uploadProjectFile(attachedFiles[type]);
          } else {
            fileUrls[type] = attachedFiles[type].data;
          }
        }
      }

      // 2. Gather values from form fields
      const company = $('selCompany').value.trim();
      const buildingCode = $('inpBuildingCode').value.trim();
      const areaM2 = $('inpAreaM2').value.trim();
      const customerName = $('inpCustomerName').value.trim();
      const projectType = $('selType').value.trim();
      const employee = $('selEmployee').value.trim();
      const date = $('inpDate').value || todayISO();
      const notes = $('inpNotes').value.trim();

      const fileDwgName = attachedFiles.dwg ? attachedFiles.dwg.name : null;
      const fileDwgSize = attachedFiles.dwg ? attachedFiles.dwg.size : null;
      const fileDwgData = fileUrls.dwg;
      const fileExcelName = attachedFiles.excel ? attachedFiles.excel.name : null;
      const fileExcelSize = attachedFiles.excel ? attachedFiles.excel.size : null;
      const fileExcelData = fileUrls.excel;
      const fileAxdName = attachedFiles.axd ? attachedFiles.axd.name : null;
      const fileAxdSize = attachedFiles.axd ? attachedFiles.axd.size : null;
      const fileAxdData = fileUrls.axd;

      // 3. Serialize details
      const detailsJson = JSON.stringify({
        company,
        buildingCode,
        areaM2,
        customerName,
        projectType,
        employee,
        date,
        notes,
        dwg: { name: fileDwgName, size: fileDwgSize, url: fileDwgData },
        excel: { name: fileExcelName, size: fileExcelSize, url: fileExcelData },
        axd: { name: fileAxdName, size: fileAxdSize, url: fileAxdData }
      });

      // 4. Update the draft_projects row in Supabase
      if (useSupabase) {
        // Also compute overall file size
        const overallSize = (fileDwgSize || 0) + (fileExcelSize || 0) + (fileAxdSize || 0);
        const { error } = await supabase.from('draft_projects').update({
          file_url: detailsJson,
          file_size: overallSize
        }).eq('id', draftId);
        
        if (error) throw error;
      }

      showToast("Taslak güncellendi.");
      resetForm();
      await loadDrafts();
      switchTab('drafts');
    } catch (e) {
      console.error("saveDraftOnly error:", e);
      showToast("Taslak kaydedilemedi: " + e.message, true);
    } finally {
      btnSaveDraft.disabled = false;
    }
  }

  window.downloadDraftFileCustom = async function (e, url, originalName) {
    e.preventDefault();
    e.stopPropagation();
    let customName = originalName.replace(/\.[^/.]+$/, "");
    customName = toTitleCase(customName) + ' Taslak.dwg';
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

  async function updateDraftStatus(id, field, value) {
    const d = drafts.find(x => x.id === id);
    if (!d) return;
    const oldValue = d[field];
    d[field] = value;

    try {
      if (!useSupabase) throw new Error("Supabase bağlantısı aktif değil.");
      let dbField = field;
      if (field === 'crmRequested') dbField = 'crm_requested';
      else if (field === 'takimRequested') dbField = 'takim_requested';
      else if (field === 'sayimRequested') dbField = 'sayim_requested';

      const { error } = await supabase.from('draft_projects').update({ [dbField]: value }).eq('id', id);
      if (error) throw error;
      showToast("Taslak güncellendi.");
    } catch (e) {
      console.error(e);
      showToast("Hata: Güncellenemedi. " + e.message, true);
      d[field] = oldValue;
      renderDrafts();
    }
  }

  window.deleteDraftProject = async function (id) {
    if (!confirm("Bu taslak projeyi silmek istediğinize emin misiniz?")) return;
    const d = drafts.find(x => x.id === id);
    if (!d) return;

    try {
      if (!useSupabase) throw new Error("Supabase bağlantısı aktif değil.");
      const { error } = await supabase.from('draft_projects').delete().eq('id', id);
      if (error) throw error;

      drafts = drafts.filter(x => x.id !== id);
      renderDrafts();
      showToast("Taslak silindi.");
    } catch (e) {
      console.error(e);
      showToast("Hata: Silinemedi. " + e.message, true);
    }
  };

  async function handleUploadDraft() {
    if (!attachedDraftFile) {
      showToast("Lütfen bir .dwg dosyası seçin.", true);
      return;
    }

    const btn = $('btnUploadDraft');
    btn.disabled = true;
    btn.textContent = 'Yükleniyor...';

    try {
      if (!useSupabase) throw new Error("Supabase bağlantısı aktif değil.");
      const fileUrl = await uploadProjectFile(attachedDraftFile);

      const entryId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const username = currentUser ? (currentUser.personnelName || currentUser.username) : 'Anonim';
      const dateStr = new Date().toISOString();

      const { error } = await supabase.from('draft_projects').insert({
        id: entryId,
        file_name: attachedDraftFile.name,
        file_url: fileUrl,
        file_size: attachedDraftFile.size,
        crm_requested: false,
        takim_requested: false,
        sayim_requested: false,
        uploaded_by: username,
        created_at: dateStr,
        status: 'mevcut'
      });
      if (error) throw error;

      const newDraft = {
        id: entryId,
        fileName: attachedDraftFile.name,
        fileUrl: fileUrl,
        fileSize: attachedDraftFile.size,
        crmRequested: false,
        takimRequested: false,
        sayimRequested: false,
        uploadedBy: username,
        createdAt: dateStr,
        status: 'mevcut'
      };

      drafts.unshift(newDraft);

      $('inpDraftFile').value = '';
      attachedDraftFile = null;
      $('draftFileStatus').textContent = '';
      $('btnRemoveDraftFile').classList.add('hidden');

      renderDrafts();
      showToast("Taslak başarıyla yüklendi.");
    } catch (e) {
      console.error("Draft upload error:", e);
      showToast("Taslak yüklenirken hata oluştu: " + e.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Taslağı Sisteme Yükle';
    }
  }

  window.sendDraftToForm = async function (id) {
    const d = drafts.find(x => x.id === id);
    if (!d) return;

    if (!d.crmRequested && !d.takimRequested && !d.sayimRequested) {
      showToast("Lütfen en az bir yapılacak iş (CRM, TAKIM, SAYIM) işaretleyin.", true);
      return;
    }

    await updateDraftStatus(id, 'status', 'bekleyen');
    
    // Reset form first, then configure for draft project mode
    resetForm();
    $('inpCrm').value = '';
    $('inpCrm').placeholder = 'Panoya eklenince atanacaktır';
    activeDraftIdForNewProject = id;
    if (btnSaveDraft) btnSaveDraft.classList.remove('hidden');
    $('btnSubmit').textContent = 'Panoya Ekle';

    // Fill Dwg input
    attachedFiles.dwg = {
      name: d.fileName,
      size: d.fileSize,
      data: d.fileUrl,
      fileRaw: null
    };
    $('fileStatusDwg').textContent = `Hazır (Taslak): ${d.fileName} (${formatBytes(d.fileSize)})`;
    $('btnRemoveFileDwg').classList.remove('hidden');

    // Fill Notes with requests
    const tales = [];
    if (d.crmRequested) tales.push('CRM');
    if (d.takimRequested) tales.push('TAKIM');
    if (d.sayimRequested) tales.push('SAYIM');

    // Try to find a matching project on the board to copy details from
    const extractCrmCode = (filename) => {
      if (!filename) return null;
      const match = /(\d{2}-\d{5})/.exec(filename);
      return match ? match[0] : null;
    };
    const draftCrm = extractCrmCode(d.fileName);
    const matchingProj = projects.find(p => {
      if (p.notes && p.notes.includes(`[DraftID: ${d.id}]`)) return true;
      if (p.fileDwgData === d.fileUrl || p.fileDwgName === d.fileName) return true;
      return draftCrm && p.crmCode && p.crmCode.trim() === draftCrm;
    });

    if (matchingProj) {
      // Found matching project, open it in edit mode with draft details
      startEditProject(matchingProj.id, d.id);
      showToast("Taslak bilgileri panodaki mevcut projeden alındı.");
      return;
    }

    // Populate saved draft details if available
    if (d.details) {
      if (d.details.company) $('selCompany').value = d.details.company;
      if (d.details.buildingCode) $('inpBuildingCode').value = d.details.buildingCode;
      if (d.details.areaM2) $('inpAreaM2').value = d.details.areaM2;
      if (d.details.customerName) $('inpCustomerName').value = d.details.customerName;
      if (d.details.projectType) $('selType').value = d.details.projectType;
      if (d.details.employee) $('selEmployee').value = d.details.employee;
      if (d.details.date) $('inpDate').value = d.details.date;
      if (d.details.notes) {
        $('inpNotes').value = d.details.notes;
      } else {
        $('inpNotes').value = `[Taslaktan Talebe Gönderildi. Talepler: ${tales.join(', ')}] [DraftID: ${d.id}]`;
      }

      // Load other files from details if they exist
      ['excel', 'axd'].forEach(type => {
        const uType = type.charAt(0).toUpperCase() + type.slice(1);
        if (d.details[type] && d.details[type].url) {
          attachedFiles[type] = {
            name: d.details[type].name,
            size: d.details[type].size,
            data: d.details[type].url,
            fileRaw: null
          };
          $('fileStatus' + uType).textContent = `Hazır (Taslak): ${d.details[type].name} (${formatBytes(d.details[type].size)})`;
          $('btnRemoveFile' + uType).classList.remove('hidden');
        }
      });
    } else {
      $('inpNotes').value = `[Taslaktan Talebe Gönderildi. Talepler: ${tales.join(', ')}] [DraftID: ${d.id}]`;
    }

    switchTab('form');
    renderDrafts();
    showToast("Taslak talep formuna gönderildi! Lütfen diğer detayları doldurup kaydedin.");
  };

  async function updateDraftStatusInDbSilent(id, field, value) {
    if (useSupabase) {
      try {
        let dbField = field;
        if (field === 'crmRequested') dbField = 'crm_requested';
        else if (field === 'takimRequested') dbField = 'takim_requested';
        else if (field === 'sayimRequested') dbField = 'sayim_requested';
        await supabase.from('draft_projects').update({ [dbField]: value }).eq('id', id);
      } catch (e) {
        console.error("Silent status update failed:", e);
      }
    }
  }

  function renderDrafts() {
    const listPending = $('draftsPendingTable');
    const listCompleted = $('draftsCompletedTable');

    const query = draftSearchInput ? (draftSearchInput.value || '').trim().toLocaleLowerCase('tr-TR') : '';

    const filterFn = d => {
      if (!query) return true;
      const dateStr = d.createdAt ? new Date(d.createdAt).toLocaleDateString('tr-TR').toLocaleLowerCase('tr-TR') : '';
      const sizeStr = formatBytes(d.fileSize).toLocaleLowerCase('tr-TR');
      const name = (d.fileName || '').toLocaleLowerCase('tr-TR');
      const uploaded = (d.uploadedBy || '').toLocaleLowerCase('tr-TR');
      
      const demands = [];
      if (d.crmRequested) demands.push('crm');
      if (d.takimRequested) demands.push('takim');
      if (d.sayimRequested) demands.push('sayim');
      const demandsStr = demands.join(' ');

      const terms = query.split(/\s+/);
      return terms.every(term => 
        name.includes(term) || 
        uploaded.includes(term) || 
        dateStr.includes(term) || 
        sizeStr.includes(term) ||
        demandsStr.includes(term)
      );
    };

    const activeDrafts = drafts.filter(d => (d.status || 'mevcut') === 'mevcut' || d.status === 'bekleyen').filter(filterFn);
    const completed = drafts.filter(d => d.status === 'tamamlanan').filter(filterFn);

    // Helper for CRM extraction
    const extractCrmCode = (filename) => {
      if (!filename) return null;
      const match = /(\d{2}-\d{5})/.exec(filename);
      return match ? match[0] : null;
    };

    // Render Pending (now includes newly uploaded/mevcut drafts)
    if (listPending) {
      if (activeDrafts.length === 0) {
        listPending.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--ink-soft); padding:30px;">${query ? 'Aramanızla eşleşen bekleyen taslak bulunamadı.' : 'Bekleyen taslak bulunmamaktadır.'}</td></tr>`;
      } else {
        let needsRerender = false;
        listPending.innerHTML = activeDrafts.map(d => {
          const dateStr = d.createdAt ? new Date(d.createdAt).toLocaleDateString('tr-TR') : '—';

          if ((d.status || 'mevcut') === 'mevcut') {
            const crmChecked = d.crmRequested ? 'checked' : '';
            const takimChecked = d.takimRequested ? 'checked' : '';
            const sayimChecked = d.sayimRequested ? 'checked' : '';

            const checkboxHtml = `
              <div style="display:inline-flex; gap:10px; justify-content:center; align-items:center; flex-wrap:wrap;">
                <label style="display:inline-flex; align-items:center; gap:3px; font-size:11px; font-weight:600; cursor:pointer;"><input type="checkbox" class="draft-chk" data-id="${d.id}" data-field="crmRequested" ${crmChecked}> CRM</label>
                <label style="display:inline-flex; align-items:center; gap:3px; font-size:11px; font-weight:600; cursor:pointer;"><input type="checkbox" class="draft-chk" data-id="${d.id}" data-field="takimRequested" ${takimChecked}> TAKIM</label>
                <label style="display:inline-flex; align-items:center; gap:3px; font-size:11px; font-weight:600; cursor:pointer;"><input type="checkbox" class="draft-chk" data-id="${d.id}" data-field="sayimRequested" ${sayimChecked}> SAYIM</label>
              </div>
            `;

            return `<tr>
                  <td>
                    <a href="${d.fileUrl}" style="color:#1a73e8; font-weight:700; text-decoration:none;" onclick="downloadDraftFileCustom(event, '${esc(d.fileUrl)}', '${esc(d.fileName)}')">
                      📁 ${esc(d.fileName)} (${formatBytes(d.fileSize)})
                    </a>
                  </td>
                  <td>${esc(d.uploadedBy)}</td>
                  <td>${dateStr}</td>
                  <td style="text-align:center;">
                    ${checkboxHtml}
                  </td>
                  <td style="text-align:center; display:flex; gap:6px; justify-content:center; align-items:center;">
                    <button class="btn-submit" style="padding: 5px 10px; font-size: 11px; margin:0; width:auto; height:auto; background:var(--accent);" onclick="sendDraftToForm('${d.id}')" title="Talebe Gönder">Talebe Gönder ➡️</button>
                    <button class="personnel-del" style="float:none;" onclick="deleteDraftProject('${d.id}')" title="Taslağı Sil">✕</button>
                  </td>
                </tr>`;
          } else {
            // Find linked project by matching DraftID in notes, or fileUrl/fileName, or extracted CRM code
            const draftCrm = extractCrmCode(d.fileName);
            const linkedProject = projects.find(p => {
              if (p.notes && p.notes.includes(`[DraftID: ${d.id}]`)) return true;
              if (p.fileDwgData === d.fileUrl || p.fileDwgName === d.fileName) return true;
              return draftCrm && p.crmCode && p.crmCode.trim() === draftCrm;
            });

            let crmOk = !d.crmRequested;
            let takimOk = !d.takimRequested;
            let sayimOk = !d.sayimRequested;

            const badgesHtml = [];

            if (d.crmRequested) {
              const crmValid = !!(linkedProject && linkedProject.crmCode && linkedProject.crmCode.trim() !== '');
              crmOk = crmValid;
              const color = crmValid ? '#2ecc71' : '#e74c3c';
              badgesHtml.push(`<span style="display:inline-block; font-size:10px; background:${color}; color:#fff; padding:2px 6px; border-radius:4px; font-weight:bold; margin-right:4px;">CRM</span>`);
            }

            if (d.takimRequested) {
              const takimValid = !!(
                (linkedProject && linkedProject.fileAxdData && linkedProject.fileAxdData.trim() !== '') || 
                (d.details && d.details.axd && d.details.axd.url && d.details.axd.url.trim() !== '')
              );
              takimOk = takimValid;
              const color = takimValid ? '#2ecc71' : '#e74c3c';
              badgesHtml.push(`<span style="display:inline-block; font-size:10px; background:${color}; color:#fff; padding:2px 6px; border-radius:4px; font-weight:bold; margin-right:4px;">TAKIM</span>`);
            }

            if (d.sayimRequested) {
              const sayimValid = !!(
                (linkedProject && linkedProject.fileExcelData && linkedProject.fileExcelData.trim() !== '') || 
                (d.details && d.details.excel && d.details.excel.url && d.details.excel.url.trim() !== '')
              );
              sayimOk = sayimValid;
              const color = sayimValid ? '#2ecc71' : '#e74c3c';
              badgesHtml.push(`<span style="display:inline-block; font-size:10px; background:${color}; color:#fff; padding:2px 6px; border-radius:4px; font-weight:bold; margin-right:4px;">SAYIM</span>`);
            }

            // If all active checkboxes are satisfied, auto-transition to completed!
            if (crmOk && takimOk && sayimOk) {
              d.status = 'tamamlanan';
              updateDraftStatusInDbSilent(d.id, 'status', 'tamamlanan');
              needsRerender = true;
            }

            return `<tr>
                  <td>
                    <a href="${d.fileUrl}" style="color:#1a73e8; font-weight:700; text-decoration:none;" onclick="downloadDraftFileCustom(event, '${esc(d.fileUrl)}', '${esc(d.fileName)}')">
                      📁 ${esc(d.fileName)} (${formatBytes(d.fileSize)})
                    </a>
                  </td>
                  <td>${esc(d.uploadedBy)}</td>
                  <td>${dateStr}</td>
                  <td style="text-align:center;">
                    ${badgesHtml.join('')}
                  </td>
                  <td style="text-align:center; display:flex; gap:6px; justify-content:center; align-items:center;">
                    ${linkedProject ?
                      `<button class="btn-submit" style="padding: 5px 10px; font-size: 11px; margin:0; width:auto; height:auto; background:#3498db;" onclick="startEditProject('${linkedProject.id}', '${d.id}')" title="Taslağı Düzenle">Taslağı Düzenle 📝</button>` :
                      `<button class="btn-submit" style="padding: 5px 10px; font-size: 11px; margin:0; width:auto; height:auto; background:var(--accent-dark);" onclick="sendDraftToForm('${d.id}')" title="Yeni Talep Formuna Git">Taslağı Düzenle 📝</button>`
                    }
                    <button class="personnel-del" style="float:none;" onclick="deleteDraftProject('${d.id}')" title="Taslağı Sil">✕</button>
                  </td>
                </tr>`;
          }
        }).join('');

        if (needsRerender) {
          setTimeout(() => renderDrafts(), 10);
        }
      }
    }

    // Render Completed
    if (listCompleted) {
      if (completed.length === 0) {
        listCompleted.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--ink-soft); padding:30px;">${query ? 'Aramanızla eşleşen tamamlanan taslak bulunamadı.' : 'Tamamlanan taslak bulunmamaktadır.'}</td></tr>`;
      } else {
        listCompleted.innerHTML = completed.map(d => {
          const dateStr = d.createdAt ? new Date(d.createdAt).toLocaleDateString('tr-TR') : '—';
          const tales = [];
          if (d.crmRequested) tales.push('CRM');
          if (d.takimRequested) tales.push('TAKIM');
          if (d.sayimRequested) tales.push('SAYIM');

          return `<tr>
                <td>
                  <a href="${d.fileUrl}" style="color:#1a73e8; font-weight:700; text-decoration:none;" onclick="downloadDraftFileCustom(event, '${esc(d.fileUrl)}', '${esc(d.fileName)}')">
                    📁 ${esc(d.fileName)} (${formatBytes(d.fileSize)})
                  </a>
                </td>
                <td>${esc(d.uploadedBy)}</td>
                <td>${dateStr}</td>
                <td style="text-align:center;">
                  ${tales.map(t => `<span style="display:inline-block; font-size:10px; background:var(--success); color:#fff; padding:2px 6px; border-radius:4px; font-weight:bold; margin-right:4px;">${t}</span>`).join('')}
                </td>
                <td style="text-align:center; display:flex; gap:6px; justify-content:center; align-items:center;">
                  <span style="display:inline-block; font-size:11px; background:#e8f5e9; color:#2e7d32; border:1px solid #c8e6c9; padding:4px 8px; border-radius:4px; font-weight:bold;">TAMAMLANDI ✓</span>
                  <button class="personnel-del" style="float:none;" onclick="deleteDraftProject('${d.id}')" title="Taslağı Sil">✕</button>
                </td>
              </tr>`;
        }).join('');
      }
    }

    // Attach change listeners to table checkboxes
    document.querySelectorAll('#draftsPendingTable .draft-chk').forEach(chk => {
      chk.addEventListener('change', async (e) => {
        const id = e.target.dataset.id;
        const field = e.target.dataset.field;
        const value = e.target.checked;
        await updateDraftStatus(id, field, value);
      });
    });
  }

  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => switchTab(t.dataset.tab));
  });

  // Login & Admin listeners
  $('btnLoginSubmit').addEventListener('click', handleLogin);
  $('inpLoginPass').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleLogin(); }
  });
  $('btnLogout').addEventListener('click', handleLogout);
  if ($('btnGoToYonetim')) {
    $('btnGoToYonetim').addEventListener('click', () => { window.location.href = 'yonetim.html'; });
  }
  if ($('btnGoToAccounting')) {
    $('btnGoToAccounting').addEventListener('click', () => { window.location.href = 'muhasebe.html'; });
  }
  $('btnAdminAddUser').addEventListener('click', addAdminUser);
  $('inpAdminNewPass').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addAdminUser(); }
  });
  $('btnAdminSaveSettings').addEventListener('click', handleSaveSettings);

  function updateViewToggleBtn() {
    if (currentView === 'list') {
      $('toggleViewIcon').textContent = '🎴';
      $('toggleViewText').textContent = 'Kutu Görünümü';
    } else {
      $('toggleViewIcon').textContent = '📋';
      $('toggleViewText').textContent = 'Yatay Liste';
    }
  }

  $('btnToggleView').addEventListener('click', () => {
    currentView = currentView === 'grid' ? 'list' : 'grid';
    try {
      localStorage.setItem('mimari-view-preference', currentView);
    } catch (e) { }
    updateViewToggleBtn();
    renderGrid();
  });

  searchInput.addEventListener('input', renderGrid);
  if (draftSearchInput) {
    draftSearchInput.addEventListener('input', renderDrafts);
  }
  $('btnSubmit').addEventListener('click', submitForm);
  if (btnSaveDraft) {
    btnSaveDraft.addEventListener('click', saveDraftOnly);
  }
  $('btnCancelEdit').addEventListener('click', cancelEdit);
  if ($('btnSendToFabrika')) {
    $('btnSendToFabrika').addEventListener('click', async () => {
      if (!editingProjectId) return;
      const p = projects.find(pr => pr.id === editingProjectId);
      if (!p) return;

      const hasDwg = (p.fileDwgData && p.fileDwgData.trim() !== '') || (attachedFiles.dwg && attachedFiles.dwg.data);
      const hasAxd = (p.fileAxdData && p.fileAxdData.trim() !== '') || (attachedFiles.axd && attachedFiles.axd.data);
      const hasExcel = (p.fileExcelData && p.fileExcelData.trim() !== '') || (attachedFiles.excel && attachedFiles.excel.data);

      if (!hasDwg || !hasAxd || !hasExcel) {
        const missing = [];
        if (!hasDwg) missing.push("AutoCAD (.dwg)");
        if (!hasAxd) missing.push("AXD (.axd)");
        if (!hasExcel) missing.push("Excel (.xls/.xlsx)");
        showToast(`Fabrikaya göndermek için eksik dosyaları yüklemelisiniz: ${missing.join(', ')}`, true);
        return;
      }

      const btn = $('btnSendToFabrika');
      btn.disabled = true;
      showToast('Fabrikaya gönderiliyor...');
      await sendProjectToFabrika(p);
      showToast('Proje başarıyla fabrikaya gönderildi!');
      btn.disabled = false;
    });
  }
  $('inpDate').value = todayISO();
  renderCompanyOptions();
  renderTypeOptions();

  $('selCompany').addEventListener('change', () => {
    if ($('selCompany').value === '__add__') {
      $('addFirmaRow').classList.remove('hidden');
      $('inpNewFirma').focus();
    } else {
      $('addFirmaRow').classList.add('hidden');
      setInvalid('cell-company', false);
    }
  });
  $('btnAddFirma').addEventListener('click', addNewFirma);
  $('inpNewFirma').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addNewFirma(); }
  });

  $('selType').addEventListener('change', () => {
    if ($('selType').value === '__add__') {
      $('addTypeRow').classList.remove('hidden');
      $('inpNewType').focus();
    } else {
      $('addTypeRow').classList.add('hidden');
      setInvalid('cell-type', false);
    }
  });
  $('btnAddType').addEventListener('click', addNewType);
  $('inpNewType').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addNewType(); }
  });

  $('selEmployee').addEventListener('change', checkEmployeeWarning);

  ['dwg', 'excel', 'axd'].forEach(type => {
    const uType = type.charAt(0).toUpperCase() + type.slice(1);

    $('inpFile' + uType).addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) {
        attachedFiles[type] = null;
        $('fileStatus' + uType).textContent = '';
        $('btnRemoveFile' + uType).classList.add('hidden');
        return;
      }

      const maxLocalStorageSize = 2.5 * 1024 * 1024;
      const maxSupabaseSize = 50 * 1024 * 1024;
      const currentLimit = useSupabase ? maxSupabaseSize : maxLocalStorageSize;

      if (file.size > currentLimit) {
        if (useSupabase) {
          showToast('Dosya boyutu 50MB\'tan küçük olmalıdır.', true);
        } else {
          showToast('Dosya boyutu 2.5MB\'tan küçük olmalıdır. Büyük dosyalar yerel tarayıcı hafızasına kaydedilemez.', true);
        }
        $('inpFile' + uType).value = '';
        attachedFiles[type] = null;
        $('fileStatus' + uType).textContent = '';
        $('btnRemoveFile' + uType).classList.add('hidden');
        return;
      }

      if (useSupabase) {
        attachedFiles[type] = {
          name: file.name,
          size: file.size,
          data: null,
          fileRaw: file
        };
        $('fileStatus' + uType).textContent = `Hazır: ${file.name} (${formatBytes(file.size)})`;
        $('btnRemoveFile' + uType).classList.remove('hidden');
      } else {
        const reader = new FileReader();
        reader.onload = function (evt) {
          attachedFiles[type] = {
            name: file.name,
            size: file.size,
            data: evt.target.result
          };
          $('fileStatus' + uType).textContent = `Hazır: ${file.name} (${formatBytes(file.size)})`;
          $('btnRemoveFile' + uType).classList.remove('hidden');
        };
        reader.onerror = function () {
          showToast('Dosya okunurken hata oluştu.', true);
          $('inpFile' + uType).value = '';
          attachedFiles[type] = null;
          $('fileStatus' + uType).textContent = '';
          $('btnRemoveFile' + uType).classList.add('hidden');
        };
        reader.readAsDataURL(file);
      }
    });

    $('btnRemoveFile' + uType).addEventListener('click', () => {
      $('inpFile' + uType).value = '';
      attachedFiles[type] = null;
      $('fileStatus' + uType).textContent = '';
      $('btnRemoveFile' + uType).classList.add('hidden');
    });
  });

  $('btnAddPersonnel').addEventListener('click', addPersonnel);
  $('inpNewPersonnel').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addPersonnel(); }
  });

  // Draft Project listeners
  $('inpDraftFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) {
      attachedDraftFile = null;
      $('draftFileStatus').textContent = '';
      $('btnRemoveDraftFile').classList.add('hidden');
      return;
    }

    const maxLocalStorageSize = 2.5 * 1024 * 1024;
    const maxSupabaseSize = 50 * 1024 * 1024;
    const currentLimit = useSupabase ? maxSupabaseSize : maxLocalStorageSize;

    if (file.size > currentLimit) {
      if (useSupabase) {
        showToast('Dosya boyutu 50MB\'tan küçük olmalıdır.', true);
      } else {
        showToast('Dosya boyutu 2.5MB\'tan küçük olmalıdır. Büyük dosyalar yerel tarayıcı hafızasına kaydedilemez.', true);
      }
      $('inpDraftFile').value = '';
      attachedDraftFile = null;
      $('draftFileStatus').textContent = '';
      $('btnRemoveDraftFile').classList.add('hidden');
      return;
    }

    if (useSupabase) {
      attachedDraftFile = {
        name: file.name,
        size: file.size,
        data: null,
        fileRaw: file
      };
      $('draftFileStatus').textContent = `Hazır: ${file.name} (${formatBytes(file.size)})`;
      $('btnRemoveDraftFile').classList.remove('hidden');
    } else {
      const reader = new FileReader();
      reader.onload = function (evt) {
        attachedDraftFile = {
          name: file.name,
          size: file.size,
          data: evt.target.result
        };
        $('draftFileStatus').textContent = `Hazır: ${file.name} (${formatBytes(file.size)})`;
        $('btnRemoveDraftFile').classList.remove('hidden');
      };
      reader.readAsDataURL(file);
    }
  });

  $('btnRemoveDraftFile').addEventListener('click', () => {
    $('inpDraftFile').value = '';
    attachedDraftFile = null;
    $('draftFileStatus').textContent = '';
    $('btnRemoveDraftFile').classList.add('hidden');
  });

  $('btnUploadDraft').addEventListener('click', handleUploadDraft);

  const now = new Date();
  $('revTag').textContent = now.toLocaleDateString('tr-TR') + ' · REV-01';
  $('dateNow').textContent = now.toLocaleDateString('tr-TR');

  let hasCloudStorage = false;
  let hasLocalStorage = false;
  try {
    hasCloudStorage = typeof window !== 'undefined' && !!window.storage && typeof window.storage.get === 'function';
  } catch (e) { }
  try {
    hasLocalStorage = typeof window !== 'undefined' && !!window.localStorage;
  } catch (e) { }

  if (useSupabase) {
    $('storageWarning').textContent = '🟢 Supabase veritabanı aktif ve bağlandı. Verileriniz bulutta güvenle saklanıyor ve tüm kullanıcılarla anlık eşitleniyor.';
    $('storageWarning').style.background = '#e8f5e9';
    $('storageWarning').style.border = '1.5px solid #2e7d32';
    $('storageWarning').style.color = '#1b5e20';
    $('storageWarning').classList.remove('hidden');
  } else if (hasCloudStorage) {
    $('storageWarning').classList.add('hidden');
  } else if (hasLocalStorage) {
    $('storageWarning').textContent = 'ℹ Bilgiler bu tarayıcıya (Local Storage) kaydediliyor. Sayfayı yenilediğinizde veya kapatıp açtığınızda kaybolmaz. Ancak başka kullanıcılar veya farklı tarayıcılar bu kayıtları göremez. Supabase veritabanına bağlanmak için index.html dosyası içindeki SUPABASE_URL ve SUPABASE_ANON_KEY sabitlerini doldurabilirsiniz.';
    $('storageWarning').style.background = '#e1f5fe';
    $('storageWarning').style.border = '1.5px solid #0288d1';
    $('storageWarning').style.color = '#01579b';
    $('storageWarning').classList.remove('hidden');
  } else {
    $('storageWarning').classList.remove('hidden');
  }

  // ---- MUHASEBE PORTAL LOGIC ----
  let accountingRecords = [];
  let attachedContractFile = null;
  const STORAGE_KEY_ACCOUNTING = 'mimari-muhasebe-kayitlari';

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

  // ---- CARİ HESAP YÖNETİMİ PORTAL LOGIC ----
  let cariAccounts = [];
  let cariTransactions = [];
  const STORAGE_KEY_CARI_ACCOUNTS = 'mimari-cari-hesaplar';
  const STORAGE_KEY_CARI_TRANSACTIONS = 'mimari-cari-hareketler';

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
        console.warn("Supabase Cari tables not found. Using local fallback.", e);
        $('muhasebeStorageWarning').innerHTML = `⚠️ Supabase bağlantısı aktif fakat <strong>cari_accounts</strong> ve <strong>cari_transactions</strong> tabloları bulunamadı. Verileriniz bu tarayıcıda saklanacak. Bulut eşleşmesi için Supabase SQL Editor panelinizde şu SQL komutlarını çalıştırın:<br><pre style="background:#fff; padding:6px; margin:5px 0 0 0; font-family:monospace; font-size:11px; border:1px solid #ddd; overflow-x:auto; text-align:left;">create table if not exists cari_accounts (
  id text primary key,
  code text,
  name text,
  type text,
  tax_office text,
  tax_no text,
  phone text,
  email text,
  authorized text,
  status text,
  address text,
  created_at timestamptz default now()
);
create table if not exists cari_transactions (
  id text primary key,
  cari_id text,
  type text,
  date text,
  amount numeric,
  ref_no text,
  notes text,
  created_at timestamptz default now()
);
grant all privileges on table cari_accounts, cari_transactions to anon;
grant all privileges on table cari_accounts, cari_transactions to authenticated;
grant all privileges on table cari_accounts, cari_transactions to service_role;
alter table cari_accounts disable row level security;
alter table cari_transactions disable row level security;</pre>`;
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
        $('muhasebeStorageWarning').style.background = '#e8f5e9';
        $('muhasebeStorageWarning').style.border = '1.5px solid #2e7d32';
        $('muhasebeStorageWarning').style.color = '#1b5e20';
        $('muhasebeStorageWarning').classList.remove('hidden');
      } catch (e) {
        console.warn("accounting_records table not found in Supabase. Using localStorage.", e);
        $('muhasebeStorageWarning').innerHTML = `⚠️ Supabase bağlantısı aktif fakat <strong>accounting_records</strong> tablosu bulunamadı. Verileriniz bu tarayıcıda saklanacak. Bulut eşleşmesi için Supabase SQL Editor panelinizde şu SQL komutunu çalıştırın:<br><pre style="background:#fff; padding:6px; margin:5px 0 0 0; font-family:monospace; font-size:11px; border:1px solid #ddd; overflow-x:auto;">create table if not exists accounting_records (
  id text primary key,
  created_at timestamptz default now(),
  type text,
  data jsonb,
  uploaded_by text
);
grant all privileges on table accounting_records to anon;
grant all privileges on table accounting_records to authenticated;
grant all privileges on table accounting_records to service_role;
alter table accounting_records disable row level security;</pre>`;
        $('muhasebeStorageWarning').style.background = '#fff3cd';
        $('muhasebeStorageWarning').style.border = '1.5px solid #ffeeba';
        $('muhasebeStorageWarning').style.color = '#856404';
        $('muhasebeStorageWarning').classList.remove('hidden');
        await loadAccountingFromLocalStorage();
      }
    } else {
      $('muhasebeStorageWarning').textContent = 'ℹ Bilgiler bu tarayıcıya (Local Storage) kaydediliyor. Sayfayı yenilediğinizde veya kapatıp açtığınızda kaybolmaz. Supabase veritabanına bağlanmak için index.html dosyası içindeki SUPABASE_URL ve SUPABASE_ANON_KEY sabitlerini doldurabilirsiniz.';
      $('muhasebeStorageWarning').style.background = '#e1f5fe';
      $('muhasebeStorageWarning').style.border = '1.5px solid #0288d1';
      $('muhasebeStorageWarning').style.color = '#01579b';
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
        console.error("Supabase accounting insert error:", error);
      } catch (e) {
        console.error(e);
      }
    }
    // Fallback/Local Save
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
        if (!error) {
          ok = true;
        }
      } catch (e) {
        console.error(e);
      }
    }
    // Always clean from local memory/storage as well to stay consistent
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

  // Render Lists
  function renderAccounting() {
    const listContracts = $('contractsListTable');
    const listDrivers = $('driversListTable');
    const listCustomers = $('customersListTable');

    if (!listContracts || !listDrivers || !listCustomers) return;

    const contracts = accountingRecords.filter(r => r.type === 'contract');
    const drivers = accountingRecords.filter(r => r.type === 'driver');
    const customers = accountingRecords.filter(r => r.type === 'customer');

    // Render Contracts
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

    // Render Drivers
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

    // Render Customers
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

  // Contract Upload Handler
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
      if (!useSupabase) {
        renderAccounting();
      } else {
        await loadAccountingRecords();
      }

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

  // Driver Add Handler
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
    if (!useSupabase) {
      renderAccounting();
    } else {
      await loadAccountingRecords();
    }

    $('inpDriverName').value = '';
    $('inpDriverPhone').value = '';
    $('inpDriverPlate').value = '';
    showToast('Şoför başarıyla kaydedildi.');
  }

  // Customer Add Handler
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
    if (!useSupabase) {
      renderAccounting();
    } else {
      await loadAccountingRecords();
    }

    $('inpCustomerNameAcc').value = '';
    $('inpCustomerPhoneAcc').value = '';
    $('inpCustomerAddressAcc').value = '';
    showToast('Müşteri başarıyla kaydedildi.');
  }

  // Bind accounting actions window scope for list buttons
  window.deleteAccountingRecord = deleteAccountingRecord;

  // Set up listeners for accounting
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

    const maxLocalStorageSize = 2.5 * 1024 * 1024;
    const maxSupabaseSize = 50 * 1024 * 1024;
    const currentLimit = useSupabase ? maxSupabaseSize : maxLocalStorageSize;

    if (file.size > currentLimit) {
      if (useSupabase) {
        showToast('Dosya boyutu 50MB\'tan küçük olmalıdır.', true);
      } else {
        showToast('Dosya boyutu 2.5MB\'tan küçük olmalıdır. Büyük dosyalar yerel tarayıcı hafızasına kaydedilemez.', true);
      }
      $('inpContractFile').value = '';
      attachedContractFile = null;
      $('contractFileStatus').textContent = '';
      $('btnRemoveContractFile').classList.add('hidden');
      return;
    }

    if (useSupabase) {
      attachedContractFile = {
        name: file.name,
        size: file.size,
        data: null,
        fileRaw: file
      };
      $('contractFileStatus').textContent = `Hazır: ${file.name} (${formatBytes(file.size)})`;
      $('btnRemoveContractFile').classList.remove('hidden');
    } else {
      const reader = new FileReader();
      reader.onload = function (evt) {
        attachedContractFile = {
          name: file.name,
          size: file.size,
          data: evt.target.result
        };
        $('contractFileStatus').textContent = `Hazır: ${file.name} (${formatBytes(file.size)})`;
        $('btnRemoveContractFile').classList.remove('hidden');
      };
      reader.readAsDataURL(file);
    }
  });

  $('btnRemoveContractFile').addEventListener('click', () => {
    $('inpContractFile').value = '';
    attachedContractFile = null;
    $('contractFileStatus').textContent = '';
    $('btnRemoveContractFile').classList.add('hidden');
  });

  // Cari Hesaplar Event Bindings
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
        console.error("Supabase insert failed. Using LocalStorage fallback.", e);
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

  // ---- FATURA YÖNETİMİ PORTAL LOGIC ----
  let invoices = [];
  let currentFaturaSubpage = '';
  const STORAGE_KEY_INVOICES = 'mimari-faturalar';

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
        console.warn("Supabase Invoices table not found. Using local fallback.", e);
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

  // Fatura Form Control listeners
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

  // ---- DÖVİZ TAKİBİ & KUR FARKI LOGIC ----
  let liveRates = {
    USD: { buying: 34.2500, selling: 34.3500 },
    EUR: { buying: 37.5200, selling: 37.6400 },
    GBP: { buying: 43.8500, selling: 43.9900 }
  };
  let exchangeDiffRecords = [];
  const STORAGE_KEY_EXCHANGE_DIFF = 'mimari-kur-farki-kayitlari';

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
      console.warn("TCMB rates fetch failed, using fallback:", err);
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
        console.warn("Supabase exchange_diff_records table not found. Using local fallback.", e);
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

  // ---- SATIN ALMA FİNANS KONTROLÜ LOGIC ----
  let purchaseRequests = [];
  let totalBudget = 500000.00;
  let purchaseLogs = [];
  let activeReviewRequestId = null;
  const STORAGE_KEY_PURCHASE = 'mimari-satinalma-talepleri';
  const STORAGE_KEY_PURCHASE_LOGS = 'mimari-satinalma-islem-gecmisi';

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
        console.warn("Supabase Satinalma tables not found. Using local fallback.", err);
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
    const user = (currentUser && currentUser.name) || 'Muhasebe Kullanıcısı';
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

    r.paymentPlan = {
      payDate,
      method,
      installments,
      dueDate,
      notes
    };
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

  // Calculate live total on new request form
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

  window.startReviewRequest = startReviewRequest;



  async function init() {
    await loadUsers();
    checkSession();
    loadFirms();
    loadTypes();
    loadPersonnel();
    try {
      const pref = localStorage.getItem('mimari-view-preference');
      if (pref === 'list') {
        currentView = 'list';
      }
    } catch (e) { }
    updateViewToggleBtn();
    loadProjects();
  }
  init();
})();

