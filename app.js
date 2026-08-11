(function () {
      // --- Supabase Config ---
      const SUPABASE_URL = 'https://alavnnyyyxhntmylduup.supabase.co/rest/v1/';
      const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFsYXZubnl5eXhobnRteWxkdXVwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0ODk3NTgsImV4cCI6MjEwMTA2NTc1OH0.prWAVrUS195htU1xBih_r0IXizOSwodIFN9MhJTvf5Y';

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
      let crmStartCode = String(new Date().getFullYear()).slice(-2) + '-00001';

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
                notes: parsed.notes || ''
              };
            }
          } catch (e) {
            // Not valid JSON
          }
        }
        return {
          customerName: '',
          notes: notesStr
        };
      }

      function serializeNotesField(customerName, notes) {
        if (!customerName) return notes;
        return JSON.stringify({
          customerName: customerName.trim(),
          notes: (notes || '').trim()
        });
      }

      window.downloadProjectFileCustom = async function(e, url, originalName, id) {
        e.preventDefault();
        e.stopPropagation();
        const p = projects.find(pr => pr.id === id);
        if (!p) return;
        
        // Build the beautiful filename:
        // FİRMA ADI - CRM KODU - MÜŞTERİ İSMİ - BİNA KODU - BİNA ALANI - KONUT TİPİ.uzanti
        const parts = [];
        if (p.company) parts.push(p.company.trim());
        if (p.crmCode) parts.push(p.crmCode.trim());
        if (p.customerName) parts.push(p.customerName.trim());
        if (p.buildingCode) parts.push(p.buildingCode.trim());
        if (p.areaM2) {
          const areaStr = p.areaM2.toString().includes('m²') ? p.areaM2.trim() : p.areaM2.trim() + ' m²';
          parts.push(areaStr);
        }
        if (p.projectType) parts.push(p.projectType.trim());
        
        let customName = parts.join(' - ');
        if (!customName) {
          customName = originalName || 'cizim';
        } else {
          const ext = originalName ? originalName.split('.').pop() : 'dwg';
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
              showApp();
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

      function showApp() {
        $('loginContainer').style.display = 'none';
        $('appContainer').classList.remove('hidden');
        $('lblCurrentUser').textContent = `${currentUser.username} (${currentUser.role === 'admin' ? 'Yönetici' : 'Kullanıcı'})`;

        if (currentUser.role === 'admin') {
          $('tab-admin').classList.remove('hidden');
        } else {
          $('tab-admin').classList.add('hidden');
        }
        switchTab('board');
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
          showApp();
          showToast('Giriş başarılı.');
        } else {
          showToast('Hatalı kullanıcı adı veya şifre.', true);
        }
      }

      function handleLogout() {
        currentUser = null;
        sessionStorage.removeItem('mimari-session');
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
          const canDelete = users.filter(x => x.role === 'admin').length > 1 || u.role !== 'admin';
          const isSelf = currentUser && currentUser.username === u.username;

          const delBtn = (canDelete && !isSelf)
            ? `<button class="personnel-del" data-userdel="${esc(u.username)}" title="Kullanıcıyı Sil">✕</button>`
            : `<span style="font-size:11px;color:var(--ink-soft);">${isSelf ? '(Siz)' : ''}</span>`;

          return `<div class="personnel-item">
        <span class="personnel-name">${esc(u.username)} <span style="font-size:12px; font-weight:normal; color:var(--ink-soft);">(${u.role === 'admin' ? 'Yönetici' : 'Kullanıcı'})</span> — <span style="font-size:12px; font-weight:bold; color:var(--accent-dark);">Personel: ${esc(u.personnelName || u.username)}</span></span>
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
              return {
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
                fileName: p.file_name,
                fileSize: p.file_size ? parseInt(p.file_size) : null,
                fileData: p.file_url
              };
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
          } catch (e) {}

          try {
            const val = await getStorageItem(STORAGE_KEY);
            const parsed = val ? JSON.parse(val) : [];
            projects = Array.isArray(parsed) ? parsed.filter(p => p.id !== '__settings__').map(p => {
              const notesParsed = parseNotesField(p.notes);
              return {
                ...p,
                notes: notesParsed.notes,
                customerName: p.customerName || notesParsed.customerName || ''
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
        const isUserAdmin = currentUser && currentUser.role === 'admin';
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
        if (!currentUser || currentUser.role !== 'admin') {
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
        if (!currentUser || currentUser.role !== 'admin') {
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
        const q = (searchInput.value || '').trim().toLowerCase();
        const filtered = projects
          .filter(p => {
            if (!q) return true;
            return (p.company || '').toLowerCase().includes(q)
              || (p.crmCode || '').toLowerCase().includes(q)
              || (p.buildingCode || '').toLowerCase().includes(q)
              || (p.projectType || '').toLowerCase().includes(q)
              || (p.employee || '').toLowerCase().includes(q)
              || (p.customerName || '').toLowerCase().includes(q)
              || (p.notes || '').toLowerCase().includes(q)
              || (p.fileName || '').toLowerCase().includes(q)
              || (p.status || '').toLowerCase().includes(q)
              || (p.areaM2 || '').toString().toLowerCase().includes(q)
              || (p.date || '').toLowerCase().includes(q)
              || fmtDate(p.date).toLowerCase().includes(q);
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
        if (currentUser.role === 'admin') return true;

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

        const cardClass = allowed ? 'card' : 'card readonly-card';

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
          <p class="card-company">${esc(p.company)}</p>
          <div class="card-row"><span>Bina Kodu</span><b>${esc(p.buildingCode || '—')}</b></div>
          <div class="card-row"><span>Bina Alanı</span><b>${p.areaM2 ? (p.areaM2.toString().includes('m²') ? esc(p.areaM2) : esc(p.areaM2) + ' m²') : '—'}</b></div>
          <div class="card-row"><span>Personel</span><b>${esc(p.employee) || '—'}</b></div>
          <div class="card-row"><span>Tarih</span><b>${fmtDate(p.date)}</b></div>
          ${p.customerName ? `<div class="card-row"><span>Müşteri</span><b>${esc(p.customerName)}</b></div>` : ''}
          ${p.notes ? `<div class="card-row"><span>Not</span><b style="font-family:'Inter',sans-serif;font-weight:500;">${esc(p.notes)}</b></div>` : ''}
          ${p.fileName && p.fileData ? `
            <div class="card-row" style="background:#e8f0fe; padding:6px 8px; border-radius:4px; margin-top:8px;">
              <span>Dosya</span>
              <a href="${p.fileData}" style="color:#1a73e8; font-weight:700; text-decoration:none; display:inline-flex; align-items:center; gap:4px; max-width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" onclick="downloadProjectFileCustom(event, '${esc(p.fileData)}', '${esc(p.fileName)}', '${esc(p.id)}')" title="${esc(p.fileName)}">
                📁 ${esc(p.fileName)} (${formatBytes(p.fileSize)})
              </a>
            </div>
          ` : ''}
          <span class="card-type">${esc(p.projectType)}</span>
        </div>
      </div>`;
      }

      function startEditProject(id) {
        const p = projects.find(pr => pr.id === id);
        if (!p) return;
        if (!canManageProject(p)) {
          showToast('Bu talebi düzenleme yetkiniz yok (sadece size atanan işleri düzenleyebilirsiniz).', true);
          return;
        }
        editingProjectId = id;

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

        // Handle attached files
        ['dwg', 'excel', 'axd'].forEach(type => {
          const uType = type.charAt(0).toUpperCase() + type.slice(1);
          if (p['file' + uType + 'Name'] && p['file' + uType + 'Data']) {
            attachedFiles[type] = {
              name: p['file' + uType + 'Name'],
              size: p['file' + uType + 'Size'],
              data: p['file' + uType + 'Data']
            };
            $('fileStatus' + uType).textContent = `Yüklü: ${p['file' + uType + 'Name']} (${formatBytes(p['file' + uType + 'Size'])})`;
            $('btnRemoveFile' + uType).classList.remove('hidden');
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

        switchTab('form');
      }

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

        let ok = false;
        if (useSupabase) {
          try {
            const { error } = await supabase.from('projects').update({ status: newStatus }).eq('id', id);
            if (error) throw error;
            p.status = newStatus;
            ok = true;
          } catch (e) {
            console.error(e);
            showToast('Hata: Durum güncellenemedi.', true);
          }
        } else {
          p.status = newStatus;
          ok = await saveProjects();
        }

        if (ok) {
          renderGrid();
          renderPersonnelPanel();
          checkEmployeeWarning();
          showToast(p.status === 'Bekliyor' ? 'İş bekliyor olarak işaretlendi.' : 'İş yapıldı olarak işaretlendi.');
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
              const notesRaw = serializeNotesField(customerName, notes);
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
                  file_name: fileName,
                  file_size: fileSize,
                  file_url: fileUrl
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
              p.fileName = fileName;
              p.fileSize = fileSize;
              p.fileData = fileData;

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
            const notesRaw = serializeNotesField(customerName, notes);
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
                file_name: fileName,
                file_size: fileSize,
                file_url: fileUrl
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
              fileName,
              fileSize,
              fileData
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
          resetForm();
          renderGrid();
          updateNextCodeHint();
          renderPersonnelPanel();
          switchTab('board');
        }
      }

      function resetForm() {
        editingProjectId = null;
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
        ['cell-company', 'cell-crm', 'cell-area', 'cell-m2', 'cell-type'].forEach(id => $(id).classList.remove('invalid'));
        $('cell-crm').querySelector('.field-err').textContent = 'Format: YY-00000';

        $('tbTopTitle').textContent = 'ÇİZİM TALEP KİMLİK BLOĞU';
        $('btnSubmit').textContent = 'Listeye Ekle';
        $('btnCancelEdit').classList.add('hidden');
      }

      // ---- tabs ----
      function switchTab(name) {
        document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
        $('panel-board').classList.toggle('hidden', name !== 'board');
        $('panel-form').classList.toggle('hidden', name !== 'form');
        $('panel-personnel').classList.toggle('hidden', name !== 'personnel');
        $('panel-admin').classList.toggle('hidden', name !== 'admin');
        if (name === 'form') {
          updateNextCodeHint();
          if (!$('inpCrm').value) $('inpCrm').value = suggestNextCrm();
          if (!$('inpDate').value) $('inpDate').value = todayISO();
          checkEmployeeWarning();
        }
        if (name === 'personnel') {
          const isUserAdmin = currentUser && currentUser.role === 'admin';
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
      $('btnSubmit').addEventListener('click', submitForm);
      $('btnCancelEdit').addEventListener('click', cancelEdit);
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

      $('inpFile').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) {
          attachedFile = null;
          $('fileStatus').textContent = '';
          $('btnRemoveFile').classList.add('hidden');
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
          $('inpFile').value = '';
          attachedFile = null;
          $('fileStatus').textContent = '';
          $('btnRemoveFile').classList.add('hidden');
          return;
        }

        if (useSupabase) {
          attachedFile = {
            name: file.name,
            size: file.size,
            data: null,
            fileRaw: file
          };
          $('fileStatus').textContent = `Hazır: ${file.name} (${formatBytes(file.size)})`;
          $('btnRemoveFile').classList.remove('hidden');
        } else {
          const reader = new FileReader();
          reader.onload = function (evt) {
            attachedFile = {
              name: file.name,
              size: file.size,
              data: evt.target.result
            };
            $('fileStatus').textContent = `Hazır: ${file.name} (${formatBytes(file.size)})`;
            $('btnRemoveFile').classList.remove('hidden');
          };
          reader.onerror = function () {
            showToast('Dosya okunurken hata oluştu.', true);
            $('inpFile').value = '';
            attachedFile = null;
            $('fileStatus').textContent = '';
            $('btnRemoveFile').classList.add('hidden');
          };
          reader.readAsDataURL(file);
        }
      });

      $('btnRemoveFile').addEventListener('click', () => {
        $('inpFile').value = '';
        attachedFile = null;
        $('fileStatus').textContent = '';
        $('btnRemoveFile').classList.add('hidden');
      });

      $('btnAddPersonnel').addEventListener('click', addPersonnel);
      $('inpNewPersonnel').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addPersonnel(); }
      });

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