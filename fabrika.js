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

  const STORAGE_KEY_ORDERS = 'mimari-fabrika-talepleri';

  let currentUser = null;
  let ordersList = [];
  let attachedPhotoFile = null;

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
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '—';
      return d.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch(e) {
      return '—';
    }
  }

  function checkSession() {
    const stored = sessionStorage.getItem('mimari-session');
    if (stored) {
      try {
        const u = JSON.parse(stored);
        const isAuthorized = u && (u.role === 'FABRİKA' || u.role === 'admin' || u.role === 'YÖNETİM' || u.role === 'YÖNETİCİ');
        if (isAuthorized) {
          currentUser = u;
          $('lblCurrentFabrikaUser').textContent = `${currentUser.username} (${currentUser.role})`;
          
          if (currentUser.role === 'admin' || currentUser.role === 'YÖNETİM' || currentUser.role === 'YÖNETİCİ') {
            if ($('btnFabrikaGoToYonetim')) $('btnFabrikaGoToYonetim').classList.remove('hidden');
            if ($('btnFabrikaGoToBoard')) $('btnFabrikaGoToBoard').classList.remove('hidden');
          }
          return;
        }
      } catch (e) { }
    }
    window.location.href = 'index.html';
  }

  function handleLogout() {
    sessionStorage.removeItem('mimari-session');
    window.location.href = 'index.html';
  }

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

  async function loadOrders() {
    checkSession();
    if (useSupabase) {
      $('fabrikaStorageWarning').classList.remove('hidden');
      try {
        const { data, error } = await supabase.from('fabrika_orders').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        ordersList = data || [];
      } catch (e) {
        console.error("loadOrders Supabase error, falling back to local:", e);
        await loadOrdersFromLocalStorage();
      }
    } else {
      await loadOrdersFromLocalStorage();
    }
    renderOrders();
  }

  async function loadOrdersFromLocalStorage() {
    try {
      const val = await getStorageItem(STORAGE_KEY_ORDERS);
      ordersList = val ? JSON.parse(val) : [];
    } catch (e) {
      ordersList = [];
    }
  }

  async function saveOrdersToLocalStorage() {
    await setStorageItem(STORAGE_KEY_ORDERS, JSON.stringify(ordersList));
  }

  function renderOrders() {
    const tbody = $('tblFabrikaOrdersBody');
    if (!tbody) return;

    if (ordersList.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:30px; color:var(--ink-soft);">Yönetim tarafından gönderilmiş sipariş bulunmamaktadır.</td></tr>`;
      return;
    }

    tbody.innerHTML = ordersList.map(o => {
      let excelLink = o.excel_url 
        ? `<a href="${esc(o.excel_url)}" target="_blank" class="text-blue-600 hover:underline font-bold" style="display:flex; align-items:center; gap:4px;">📎 ${esc(o.excel_name || 'Excel İndir')}</a>` 
        : '';

      let dwgLink = '';
      let axdLink = '';
      let cleanNotes = o.notes || '';
      
      if (o.notes) {
        const dwgRegex = /AutoCAD DWG:\s*([^\(]+)\s*\((https?:\/\/[^\)]+)\)/i;
        const dwgMatch = o.notes.match(dwgRegex);
        if (dwgMatch) {
          dwgLink = `<a href="${esc(dwgMatch[2])}" target="_blank" class="text-red-600 hover:underline font-bold" style="display:flex; align-items:center; gap:4px; margin-top:4px;">📐 ${esc(dwgMatch[1].trim())}</a>`;
          cleanNotes = cleanNotes.replace(dwgMatch[0], '');
        }

        const axdRegex = /AXD Dosyası:\s*([^\(]+)\s*\((https?:\/\/[^\)]+)\)/i;
        const axdMatch = o.notes.match(axdRegex);
        if (axdMatch) {
          axdLink = `<a href="${esc(axdMatch[2])}" target="_blank" class="text-orange-600 hover:underline font-bold" style="display:flex; align-items:center; gap:4px; margin-top:4px;">📄 ${esc(axdMatch[1].trim())}</a>`;
          cleanNotes = cleanNotes.replace(axdMatch[0], '');
        }
      }

      let filesHtml = [excelLink, dwgLink, axdLink].filter(Boolean).join('');
      if (!filesHtml) filesHtml = '—';

      const crmMatch = o.title ? o.title.match(/\((\d{2}-\d{5})\)/) : null;
      let displayTitle = o.title || '';
      let crmBadge = '';
      if (crmMatch) {
        crmBadge = `<span class="px-2 py-0.5 text-xs font-bold rounded bg-slate-200 text-slate-800" style="font-family:monospace; margin-right:6px;">${crmMatch[1]}</span>`;
        displayTitle = displayTitle.replace(crmMatch[0], '').trim();
      }

      let photoDisplay = '—';
      if (o.photo_url) {
        photoDisplay = `<a href="${esc(o.photo_url)}" target="_blank"><img src="${esc(o.photo_url)}" style="max-height:50px; max-width:80px; object-fit:cover; border-radius:4px; border:1px solid var(--line);" title="Büyütmek için tıklayın"></a>`;
      }

      let statusBadge = '';
      if (o.status === 'Bekliyor') {
        statusBadge = `<span class="px-2.5 py-1 text-xs font-bold rounded bg-amber-100 text-amber-800">Excel Gönderildi</span>`;
      } else if (o.status === 'Onay Bekliyor') {
        statusBadge = `<span class="px-2.5 py-1 text-xs font-bold rounded bg-blue-100 text-blue-800">Onay Bekliyor</span>`;
      } else if (o.status === 'Onaylandı') {
        statusBadge = `<span class="px-2.5 py-1 text-xs font-bold rounded bg-emerald-100 text-emerald-800">Onaylandı</span>`;
      } else if (o.status === 'Reddedildi') {
        statusBadge = `<span class="px-2.5 py-1 text-xs font-bold rounded bg-rose-100 text-rose-800">Reddedildi</span>`;
      }

      let actionsHtml = '';
      if (o.status === 'Bekliyor' || o.status === 'Reddedildi') {
        actionsHtml = `<button class="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-3.5 py-2 rounded" onclick="openUploadModal('${o.id}')">Fotoğraf Yükle & Onaya Gönder</button>`;
      } else {
        actionsHtml = `<span style="font-size:12px; color:var(--ink-soft); font-style:italic;">İşlem Tamamlandı</span>`;
      }

      return `<tr>
        <td style="font-size:12px; color:var(--ink-soft);">${fmtDate(o.created_at)}</td>
        <td>${crmBadge}<strong>${esc(displayTitle)}</strong><div style="font-size:11px;color:var(--ink-soft);margin-top:4px;white-space:pre-wrap;">${esc(cleanNotes.trim() || '—')}</div></td>
        <td>${filesHtml}</td>
        <td>${photoDisplay}</td>
        <td>${statusBadge}</td>
        <td style="text-align:center;">${actionsHtml}</td>
      </tr>`;
    }).join('');
  }

  window.openUploadModal = function(id) {
    const o = ordersList.find(x => x.id === id);
    if (!o) return;
    $('uploadOrderId').value = id;
    $('inpFabrikaPhotoFile').value = '';
    $('inpFabrikaNotes').value = '';
    attachedPhotoFile = null;
    $('uploadPhotoModal').style.display = 'flex';
  };

  window.closeUploadModal = function() {
    $('uploadPhotoModal').style.display = 'none';
  };

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

  async function submitFabrikaPhoto() {
    const id = $('uploadOrderId').value;
    const fileInput = $('inpFabrikaPhotoFile');
    const notes = $('inpFabrikaNotes').value.trim();

    if (!fileInput.files || !fileInput.files[0]) {
      showToast('Lütfen onay için bir fotoğraf dosyası seçin.', true);
      return;
    }
    const file = fileInput.files[0];
    $('btnSubmitFabrikaPhoto').disabled = true;
    showToast('Fotoğraf yükleniyor...');

    try {
      let photoUrl = '';
      if (useSupabase) {
        photoUrl = await uploadFileToSupabase(file);
      } else {
        photoUrl = await fileToBase64(file);
      }

      if (useSupabase) {
        const { error } = await supabase.from('fabrika_orders').update({
          status: 'Onay Bekliyor',
          photo_url: photoUrl,
          photo_name: file.name,
          notes: notes || null,
          updated_at: new Date().toISOString()
        }).eq('id', id);
        if (error) throw error;
      } else {
        const o = ordersList.find(x => x.id === id);
        if (o) {
          o.status = 'Onay Bekliyor';
          o.photo_url = photoUrl;
          o.photo_name = file.name;
          o.notes = notes;
          o.updated_at = new Date().toISOString();
        }
        await saveOrdersToLocalStorage();
      }

      showToast('Onay talebi başarıyla yönetime gönderildi.');
      closeUploadModal();
      await loadOrders();
    } catch (e) {
      console.error(e);
      showToast('Yükleme hatası: ' + e.message, true);
    } finally {
      $('btnSubmitFabrikaPhoto').disabled = false;
    }
  }

  $('btnFabrikaLogout').addEventListener('click', handleLogout);
  if ($('btnFabrikaGoToYonetim')) {
    $('btnFabrikaGoToYonetim').addEventListener('click', () => { window.location.href = 'yonetim.html'; });
  }
  if ($('btnFabrikaGoToBoard')) {
    $('btnFabrikaGoToBoard').addEventListener('click', () => { window.location.href = 'index.html'; });
  }
  $('btnSubmitFabrikaPhoto').addEventListener('click', submitFabrikaPhoto);

  loadOrders();
})();
