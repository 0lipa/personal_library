(() => {
  'use strict';
  const COLORS = ['#c15b44', '#3f8b82', '#d9a441', '#4c6c8c', '#6e8b5d', '#8a5a78', '#b85c7e', '#5b7a4a'];
  const LOCAL_KEY = 'digitalPicturebookShelf_static_v1';
  const seed = { classes: { '2734': { name: '내가 쓰고 함께 읽는 디지털 그림책', books: [{ id: 'bmuc2wl8ef6m50', title: '핸드폰 이어폰', author: '박서윤', value: 'https://simplebooklet.com/PmysES96yi7A8BXvIsrB1k', type: 'link', color: '#c15b44' }] } } };
  const config = window.SUPABASE_CONFIG || {};
  const configured = Boolean(config.url && config.publishableKey && !config.publishableKey.includes('PASTE_'));
  const $ = (id) => document.getElementById(id);
  let localState = loadLocal(), cloud = null, authUser = null, isTeacher = false, isAdmin = false, currentClass = null, currentBooks = [];
  let editingId = null, selectedColor = COLORS[0], mode = 'link', pendingQrData = null, currentBook = null, deleteArmed = false, realtimeChannel = null, feedbackFiles = [], feedbackObjectUrls = [];

  function loadLocal() { try { const saved = JSON.parse(localStorage.getItem(LOCAL_KEY)); return saved && saved.classes ? saved : structuredClone(seed); } catch { return structuredClone(seed); } }
  function saveLocal() { localStorage.setItem(LOCAL_KEY, JSON.stringify(localState)); }
  function escapeHtml(text) { const node = document.createElement('div'); node.textContent = text; return node.innerHTML; }
  function newId() { return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`; }
  function newJoinCode() { return Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join(''); }
  function isCloud() { return cloud !== null; }
  function flash(message, okay = true) { const banner = $('syncBanner'); banner.textContent = message; banner.classList.toggle('error', !okay); banner.classList.add('notice-visible'); clearTimeout(flash.timer); flash.timer = setTimeout(() => { banner.classList.remove('notice-visible'); setTimeout(() => { if (!banner.classList.contains('notice-visible')) { banner.textContent = ''; banner.classList.remove('error'); } }, 220); }, 4500); }
  function friendlyError(error, fallback = '요청을 처리하지 못했어요. 잠시 후 다시 시도해주세요.') {
    const message = error?.message || '';
    if (/[가-힣]/.test(message)) return message;
    if (/ambiguous|column reference/i.test(message)) return '반을 만들지 못했어요. 페이지를 새로고침한 뒤 다시 시도해주세요.';
    if (/row-level security|permission denied/i.test(message)) return '권한을 확인하지 못했어요. 선생님 계정으로 다시 로그인한 뒤 시도해주세요.';
    if (/duplicate key|already exists/i.test(message)) return '같은 정보가 이미 등록되어 있어요.';
    if (/invalid login credentials/i.test(message)) return '이메일 또는 비밀번호를 다시 확인해주세요.';
    if (/email not confirmed/i.test(message)) return '이메일 인증을 먼저 완료해주세요.';
    if (/rate limit/i.test(message)) return '요청이 많아요. 잠시 후 다시 시도해주세요.';
    if (/function.*does not exist|could not find the function/i.test(message)) return '사이트 설정을 업데이트하는 중이에요. 잠시 후 다시 시도해주세요.';
    return fallback;
  }
  async function copy(text) { try { await navigator.clipboard.writeText(text); } catch { const area = document.createElement('textarea'); area.value = text; document.body.append(area); area.select(); document.execCommand('copy'); area.remove(); } }
  function localBook(book) { return { ...book, status: 'published' }; }

  async function initialiseCloud() {
    if (!configured || !window.supabase) return;
    try {
      cloud = window.supabase.createClient(config.url, config.publishableKey);
      const { data: { session } } = await cloud.auth.getSession();
      if (!session) { const { error } = await cloud.auth.signInAnonymously(); if (error) throw error; }
      await refreshIdentity();
    } catch (error) { cloud = null; console.error(error); }
  }
  async function refreshIdentity() {
    if (!cloud) return;
    const { data: { user } } = await cloud.auth.getUser(); authUser = user; isTeacher = false; isAdmin = false;
    if (user) { const { data } = await cloud.from('profiles').select('role').eq('id', user.id).maybeSingle(); isAdmin = data?.role === 'admin'; isTeacher = data?.role === 'teacher' || isAdmin; }
    renderTeacherPanel();
  }
  function unsubscribe() { if (realtimeChannel && cloud) cloud.removeChannel(realtimeChannel); realtimeChannel = null; }
  async function loadBooks() {
    const { data, error } = await cloud.from('books').select('id,title,author,link_url,color,status,created_at').eq('class_id', currentClass.id).order('created_at');
    if (error) { flash(friendlyError(error, '책장을 불러오지 못했어요. 잠시 후 다시 시도해주세요.'), false); return; }
    currentBooks = (data || []).map((book) => ({ ...book, value: book.link_url, type: 'link' }));
  }
  function subscribe() {
    unsubscribe();
    realtimeChannel = cloud.channel(`books:${currentClass.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'books', filter: `class_id=eq.${currentClass.id}` }, async () => { await loadBooks(); renderShelf(); }).subscribe();
  }

  function switchScreen(hideId, showId) { const hiding = $(hideId), showing = $(showId); clearTimeout(switchScreen.timer); if (hiding.classList.contains('hidden')) { showing.classList.remove('hidden'); return; } hiding.classList.add('screen-exiting'); switchScreen.timer = setTimeout(() => { hiding.classList.add('hidden'); hiding.classList.remove('screen-exiting'); showing.classList.remove('hidden'); showing.classList.add('screen-entering'); requestAnimationFrame(() => requestAnimationFrame(() => showing.classList.remove('screen-entering'))); }, 180); }
  function showLanding() { unsubscribe(); currentClass = null; currentBooks = []; switchScreen('shelfScreen', 'landing'); renderTeacherPanel(); }
  function openShelf() { switchScreen('landing', 'shelfScreen'); renderShelf(); }
  async function joinClass() {
    const code = $('joinCodeInput').value.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,8}$/.test(code)) { $('joinMsg').textContent = '4~8자리 반 코드를 입력해주세요.'; return; }
    $('joinMsg').textContent = '';
    if (!isCloud()) {
      const localClass = localState.classes[code]; if (!localClass) { $('joinMsg').textContent = '해당 코드의 반을 찾을 수 없어요.'; return; }
      currentClass = { id: code, name: localClass.name, join_code: code }; currentBooks = localClass.books.map(localBook); openShelf(); return;
    }
    const { data, error } = await cloud.rpc('join_class', { p_join_code: code });
    if (error || !data?.[0]) { $('joinMsg').textContent = error ? friendlyError(error, '반 코드를 찾지 못했어요. 다시 확인해주세요.') : '해당 반을 찾을 수 없어요.'; return; }
    currentClass = { id: data[0].result_class_id, name: data[0].result_class_name, join_code: data[0].result_join_code }; await loadBooks(); subscribe(); openShelf();
  }

  function renderTeacherPanel() {
    const panel = $('teacherPanel'); if (!panel.classList.contains('is-open')) return;
    $('teacherAuth').classList.toggle('hidden', !isCloud() || (authUser && !authUser.is_anonymous));
    $('localTeacherBtn').classList.toggle('hidden', isCloud());
    $('teacherClasses').classList.toggle('hidden', !isTeacher);
    $('teacherSignOutBtn').classList.toggle('hidden', !isCloud() || !isTeacher);
    $('adminFeedbackBtn').classList.toggle('hidden', !isAdmin);
    if (!isCloud()) $('teacherStatus').textContent = '로컬 데모 모드입니다. Supabase 공개키를 설정하면 공동 책장이 됩니다.';
    else if (authUser?.is_anonymous) $('teacherStatus').textContent = '학생은 별도 가입 없이 제출할 수 있어요. 선생님은 이메일로 로그인하세요.';
    else if (!isTeacher) $('teacherStatus').textContent = '로그인되었습니다. 첫 선생님 계정은 설정 단계에서 권한을 부여합니다.';
    else { $('teacherStatus').textContent = `${isAdmin ? '관리자' : '선생님'} 계정: ${authUser.email}`; renderClassList(); }
  }
  async function renderClassList() {
    const wrap = $('classListWrap'); wrap.innerHTML = '';
    let classes = [];
    if (isCloud()) { const { data, error } = await cloud.from('classes').select('id,name,join_code').eq('teacher_id', authUser.id).order('created_at'); if (error) { wrap.textContent = friendlyError(error, '만든 반 목록을 불러오지 못했어요.'); return; } classes = data || []; }
    else classes = Object.entries(localState.classes).map(([join_code, item]) => ({ id: join_code, name: item.name, join_code }));
    if (!classes.length) wrap.innerHTML = '<p class="author">아직 만든 반이 없어요.</p>';
    classes.forEach((classInfo) => { const row = document.createElement('button'); row.className = 'class-row'; row.innerHTML = `<span>${escapeHtml(classInfo.name)}</span><strong class="ccode">${classInfo.join_code}</strong>`; row.onclick = async () => { currentClass = classInfo; if (isCloud()) { await loadBooks(); subscribe(); } else currentBooks = localState.classes[classInfo.join_code].books.map(localBook); openShelf(); }; wrap.append(row); });
  }
  async function createClass() {
    const name = $('newClassName').value.trim(); if (!name) { $('createMsg').textContent = '반 이름을 입력해주세요.'; return; }
    $('createMsg').textContent = '';
    if (!isCloud()) { const code = newJoinCode(); localState.classes[code] = { name, books: [] }; saveLocal(); currentClass = { id: code, name, join_code: code }; currentBooks = []; openShelf(); return; }
    for (let i = 0; i < 3; i += 1) { const code = newJoinCode(); const { data, error } = await cloud.rpc('create_class', { p_name: name, p_join_code: code }); if (!error && data?.[0]) { $('newClassName').value = ''; currentClass = data[0]; await loadBooks(); subscribe(); openShelf(); return; } if (i === 2) $('createMsg').textContent = friendlyError(error, '반을 만들지 못했어요. 다시 시도해주세요.'); }
  }

  function renderShelf() {
    if (!currentClass) return;
    $('shelfTitle').textContent = currentClass.name; $('shelfCodeText').textContent = currentClass.join_code; renderTools();
    const books = isCloud() && !isTeacher ? currentBooks.filter((book) => book.status === 'published') : currentBooks;
    const container = $('shelfContainer'); container.innerHTML = '';
    const rows = books.length ? Array.from({ length: Math.ceil(books.length / 6) }, (_, index) => books.slice(index * 6, index * 6 + 6)) : [[]];
    rows.forEach((rowBooks) => { const row = document.createElement('section'); row.className = 'shelf-row'; row.innerHTML = '<div class="side-post left"></div><div class="side-post right"></div><div class="books-track"></div><div class="plank"></div>'; const track = row.querySelector('.books-track'); if (!rowBooks.length) track.innerHTML = '<div class="empty-state">아직 공개된 책이 없어요.<br><b>오른쪽 아래 “책 꽂기”</b>로 그림책을 제출해 보세요 📚</div>'; rowBooks.forEach((book) => track.append(buildBook(book))); container.append(row); });
  }
  function renderTools() { const wrap = $('toolsWrap'); wrap.innerHTML = ''; if (isCloud() && isTeacher) { const approvals = document.createElement('button'); approvals.className = 'tool-btn'; approvals.textContent = `제출 승인하기 (${currentBooks.filter((book) => book.status === 'pending').length})`; approvals.onclick = openApprovalModal; wrap.append(approvals); } const backup = document.createElement('button'); backup.className = 'tool-btn'; backup.textContent = '이 반 백업하기'; backup.onclick = () => { $('backupText').value = JSON.stringify({ class: currentClass, books: currentBooks }); openOverlay('backupOverlay'); }; wrap.append(backup); }
  function hash(value) { let result = 0; for (let i = 0; i < value.length; i += 1) result = (result * 31 + value.charCodeAt(i)) >>> 0; return result; }
  function shade(hex, amount) { const value = parseInt(hex.slice(1), 16); const channel = (number) => Math.max(0, Math.min(255, number + Math.round(255 * amount / 100))); return `#${(0x1000000 + channel(value >> 16) * 0x10000 + channel((value >> 8) & 255) * 0x100 + channel(value & 255)).toString(16).slice(1)}`; }
  function buildBook(book) { const value = hash(book.id); const compact = window.matchMedia('(max-width: 600px)').matches; const veryCompact = window.matchMedia('(max-width: 360px)').matches; const width = veryCompact ? 31 + value % 8 : compact ? 36 + value % 12 : 40 + value % 20; const height = veryCompact ? 114 + (value >> 4) % 18 : compact ? 126 + (value >> 4) % 22 : 150 + (value >> 4) % 35; const element = document.createElement('button'); element.className = `book${book.status === 'pending' ? ' pending-book' : ''}`; element.style.width = `${width}px`; element.style.height = `${height}px`; element.style.background = `linear-gradient(160deg,${shade(book.color, 12)},${book.color} 45%,${shade(book.color, -14)})`; element.setAttribute('aria-label', `${book.title} 열기`); element.innerHTML = '<span class="spine-band top"></span><span class="spine-band bottom"></span>'; const title = document.createElement('span'); title.className = 'spine-title'; title.textContent = book.title; element.append(title); element.onclick = () => openBook(book); return element; }

  function openOverlay(id) { $(id).classList.add('show'); $(id).setAttribute('aria-hidden', 'false'); }
  function closeAll() { document.querySelectorAll('.overlay').forEach((overlay) => { overlay.classList.remove('show'); overlay.setAttribute('aria-hidden', 'true'); }); }
  function showActionSuccess(title, message) { $('actionSuccessTitle').textContent = title; $('actionSuccessText').textContent = message; openOverlay('actionSuccessOverlay'); }
  async function openApprovalModal() { await loadBooks(); renderShelf(); renderPendingBooks(); openOverlay('mergeOverlay'); }
  function renderPendingBooks() { const list = $('pendingList'); list.innerHTML = ''; const pending = currentBooks.filter((book) => book.status === 'pending'); if (!pending.length) { list.innerHTML = '<p class="author">승인 대기 중인 그림책이 없어요.</p>'; return; } pending.forEach((book) => { const row = document.createElement('article'); row.className = 'pending-row'; row.innerHTML = `<div><strong>${escapeHtml(book.title)}</strong><span>${escapeHtml(book.author)}</span></div>`; const actions = document.createElement('div'); actions.className = 'pending-actions'; const approve = document.createElement('button'); approve.className = 'primary'; approve.textContent = '공개'; approve.onclick = () => changeBookStatus(book.id, true); const reject = document.createElement('button'); reject.className = 'secondary'; reject.textContent = '삭제'; reject.onclick = () => changeBookStatus(book.id, false); actions.append(approve, reject); row.append(actions); list.append(row); }); }
  async function changeBookStatus(id, approved) { const request = approved ? cloud.from('books').update({ status: 'published', approved_by: authUser.id, approved_at: new Date().toISOString() }).eq('id', id) : cloud.from('books').delete().eq('id', id); const { error } = await request; if (error) { flash(friendlyError(error, '제출물을 처리하지 못했어요.'), false); return; } await loadBooks(); renderShelf(); renderPendingBooks(); flash(approved ? '그림책을 공개했어요.' : '제출물을 삭제했어요.'); }
  function setMode(next) { mode = next; $('segLink').classList.toggle('active', next === 'link'); $('segQr').classList.toggle('active', next === 'qr'); $('linkField').classList.toggle('hidden', next !== 'link'); $('qrField').classList.toggle('hidden', next !== 'qr'); }
  function buildSwatches(color) { selectedColor = color; const wrap = $('swatches'); wrap.innerHTML = ''; COLORS.forEach((current) => { const swatch = document.createElement('button'); swatch.type = 'button'; swatch.className = `swatch${current === color ? ' selected' : ''}`; swatch.style.background = current; swatch.setAttribute('aria-label', `책등 색 ${current}`); swatch.onclick = () => { selectedColor = current; wrap.querySelectorAll('.swatch').forEach((item) => item.classList.remove('selected')); swatch.classList.add('selected'); }; wrap.append(swatch); }); }
  function openAdd(book = null) { editingId = book?.id || null; pendingQrData = book?.type === 'qr' ? book.value : null; $('fTitle').value = book?.title || ''; $('fAuthor').value = book?.author || ''; $('fUrl').value = book?.value || ''; const canUseQr = !isCloud() && isTeacher; $('modeSwitchWrap').classList.toggle('hidden', !canUseQr); setMode(canUseQr && book?.type === 'qr' ? 'qr' : 'link'); $('notWriterNote').classList.toggle('hidden', isTeacher); $('saveBtn').textContent = isTeacher ? '책장에 꽂기' : '제출하고 승인 기다리기'; $('deleteBtn').classList.toggle('hidden', !(isTeacher && book)); $('deleteBtn').textContent = '이 책 빼기'; $('formMsg').textContent = ''; buildSwatches(book?.color || COLORS[Math.floor(Math.random() * COLORS.length)]); openOverlay('addOverlay'); setTimeout(() => $('fTitle').focus(), 10); }
  async function saveBook() {
    const title = $('fTitle').value.trim(), author = $('fAuthor').value.trim(); let value = $('fUrl').value.trim();
    if (!title || !author) { $('formMsg').textContent = '책 제목과 이름을 모두 적어주세요.'; return; }
    if (mode === 'qr' && !isCloud()) value = pendingQrData;
    if (!value) { $('formMsg').textContent = '그림책 링크를 붙여넣어주세요.'; return; }
    if (mode !== 'qr' && !/^https?:\/\//i.test(value)) value = `https://${value}`;
    if (isCloud()) {
      if (isTeacher) { const payload = { title, author, link_url: value, color: selectedColor, class_id: currentClass.id, submitted_by: authUser.id, status: 'published', approved_by: authUser.id, approved_at: new Date().toISOString() }; const request = editingId ? cloud.from('books').update(payload).eq('id', editingId) : cloud.from('books').insert(payload); const { error } = await request; if (error) { $('formMsg').textContent = friendlyError(error, '그림책을 저장하지 못했어요.'); return; } closeAll(); await loadBooks(); renderShelf(); flash('책장에 공개했어요.'); return; }
      const { error } = await cloud.rpc('submit_book', { p_join_code: currentClass.join_code, p_title: title, p_author: author, p_link_url: value, p_color: selectedColor }); if (error) { $('formMsg').textContent = friendlyError(error, '그림책을 제출하지 못했어요.'); return; } closeAll(); showActionSuccess('제출되었습니다', '선생님이 확인하고 승인하면 우리 반 책장에 공개돼요.'); return;
    }
    const books = localState.classes[currentClass.join_code].books; const book = { id: editingId || newId(), title, author, value, type: mode === 'qr' ? 'qr' : 'link', color: selectedColor }; const index = books.findIndex((item) => item.id === editingId); if (index >= 0) books[index] = book; else books.push(book); saveLocal(); closeAll(); currentBooks = books.map(localBook); renderShelf(); flash('이 기기 책장에 저장했어요.');
  }
  function openBook(book) { currentBook = book; $('vTitle').textContent = book.title; $('vAuthor').textContent = `지은이: ${book.author}`; const link = $('vOpenLink'), wrap = $('vQrCanvasWrap'); wrap.innerHTML = ''; link.href = book.value; link.classList.remove('hidden'); const canvas = document.createElement('canvas'); wrap.append(canvas); if (window.QRCode) window.QRCode.toCanvas(canvas, book.value, { width: 160, margin: 1, color: { dark: '#3a2a1c', light: '#ffffff' } }); $('editBtn').classList.toggle('hidden', !isTeacher); openOverlay('viewOverlay'); }
  async function deleteBook() { if (!deleteArmed) { deleteArmed = true; $('deleteBtn').textContent = '정말 뺄까요? 한 번 더 누르면 삭제돼요'; setTimeout(() => { deleteArmed = false; $('deleteBtn').textContent = '이 책 빼기'; }, 4000); return; } if (isCloud()) { const { error } = await cloud.from('books').delete().eq('id', editingId); if (error) { flash(friendlyError(error, '그림책을 삭제하지 못했어요.'), false); return; } await loadBooks(); } else { localState.classes[currentClass.join_code].books = localState.classes[currentClass.join_code].books.filter((book) => book.id !== editingId); saveLocal(); currentBooks = localState.classes[currentClass.join_code].books.map(localBook); } closeAll(); renderShelf(); flash('책을 뺐어요.'); }
  function clearFeedbackFiles() { feedbackObjectUrls.forEach((url) => URL.revokeObjectURL(url)); feedbackObjectUrls = []; feedbackFiles = []; $('feedbackImages').value = ''; $('feedbackPreviews').innerHTML = ''; }
  function renderFeedbackFiles() { const wrap = $('feedbackPreviews'); feedbackObjectUrls.forEach((url) => URL.revokeObjectURL(url)); feedbackObjectUrls = []; wrap.innerHTML = ''; feedbackFiles.forEach((file, index) => { const url = URL.createObjectURL(file); feedbackObjectUrls.push(url); const preview = document.createElement('article'); preview.className = 'feedback-preview'; const image = document.createElement('img'); image.src = url; image.alt = `첨부 사진 ${index + 1}`; const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', `첨부 사진 ${index + 1} 삭제`); remove.onclick = () => { feedbackFiles.splice(index, 1); renderFeedbackFiles(); }; preview.append(image, remove); wrap.append(preview); }); }
  function chooseFeedbackFiles(event) { const files = Array.from(event.target.files || []); if (files.length > 2) { $('feedbackMsg').textContent = '사진은 한 번에 최대 2장까지 첨부할 수 있어요.'; event.target.value = ''; return; } if (files.some((file) => !file.type.startsWith('image/'))) { $('feedbackMsg').textContent = '사진 파일만 첨부할 수 있어요.'; event.target.value = ''; return; } if (files.some((file) => file.size > 5 * 1024 * 1024)) { $('feedbackMsg').textContent = '사진 한 장의 크기는 5MB 이하여야 해요.'; event.target.value = ''; return; } feedbackFiles = files; $('feedbackMsg').textContent = ''; renderFeedbackFiles(); }
  function updateFeedbackCount() { const field = $('feedbackMessage'); if (field.value.length > 500) field.value = field.value.slice(0, 500); $('feedbackCount').textContent = `${field.value.length} / 500자`; }
  function openFeedback() { $('feedbackCategory').value = 'error'; $('feedbackMessage').value = ''; $('feedbackContact').value = ''; $('feedbackMsg').textContent = ''; updateFeedbackCount(); clearFeedbackFiles(); openOverlay('feedbackOverlay'); setTimeout(() => $('feedbackMessage').focus(), 10); }
  function showFeedbackSuccess(message = '소중한 의견 감사합니다. 확인 후 더 좋은 서가로 개선할게요.') { $('feedbackSuccessText').textContent = message; openOverlay('feedbackSuccessOverlay'); }
  async function submitFeedback() {
    const message = $('feedbackMessage').value.trim(), contact = $('feedbackContact').value.trim();
    if (!message) { $('feedbackMsg').textContent = '내용을 입력해주세요.'; return; }
    if ($('feedbackMessage').value.length > 500) { $('feedbackMsg').textContent = '내용은 띄어쓰기 포함 500자 이내로 입력해주세요.'; return; }
    if (contact && !/^\S+@\S+\.\S+$/.test(contact)) { $('feedbackMsg').textContent = '답변 받을 이메일을 정확히 입력해주세요.'; return; }
    if (!isCloud() || !authUser) { $('feedbackMsg').textContent = '의견 접수 기능을 준비하는 중이에요. 잠시 후 다시 시도해주세요.'; return; }
    $('feedbackSubmitBtn').disabled = true; $('feedbackSubmitBtn').textContent = '보내는 중…';
    const { data, error } = await cloud.from('feedback_reports').insert({ category: $('feedbackCategory').value, message, contact_email: contact || null, page_path: window.location.pathname, user_id: authUser.id }).select('id').single();
    if (error) { $('feedbackMsg').textContent = friendlyError(error, '의견을 보내지 못했어요. 잠시 후 다시 시도해주세요.'); $('feedbackSubmitBtn').disabled = false; $('feedbackSubmitBtn').textContent = '의견 보내기'; return; }
    const paths = [];
    for (let index = 0; index < feedbackFiles.length; index += 1) { const file = feedbackFiles[index]; const extension = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'; const path = `${authUser.id}/${data.id}/${index + 1}.${extension}`; const { error: uploadError } = await cloud.storage.from('feedback-images').upload(path, file, { contentType: file.type, upsert: false }); if (uploadError) { closeAll(); clearFeedbackFiles(); flash('의견은 접수됐지만 사진은 저장하지 못했어요.', false); $('feedbackSubmitBtn').disabled = false; $('feedbackSubmitBtn').textContent = '의견 보내기'; return; } paths.push(path); }
    if (paths.length) { const { error: updateError } = await cloud.from('feedback_reports').update({ image_paths: paths }).eq('id', data.id); if (updateError) { closeAll(); clearFeedbackFiles(); flash('의견은 접수됐지만 사진 목록을 저장하지 못했어요.', false); $('feedbackSubmitBtn').disabled = false; $('feedbackSubmitBtn').textContent = '의견 보내기'; return; } }
    closeAll(); clearFeedbackFiles(); $('feedbackSubmitBtn').disabled = false; $('feedbackSubmitBtn').textContent = '의견 보내기'; showFeedbackSuccess();
  }
  function feedbackCategoryLabel(category) { return ({ error: '오류 신고', question: '이용 문의', suggestion: '개선 제안', other: '기타' })[category] || '기타'; }
  async function openAdminFeedback() {
    if (!isCloud() || !isAdmin) return;
    const list = $('adminFeedbackList'); list.innerHTML = '<p class="admin-feedback-empty">의견을 불러오는 중이에요…</p>'; openOverlay('adminFeedbackOverlay');
    const { data, error } = await cloud.from('feedback_reports').select('id,category,message,contact_email,image_paths,created_at').order('created_at', { ascending: false });
    if (error) { list.innerHTML = ''; const message = document.createElement('p'); message.className = 'admin-feedback-empty'; message.textContent = friendlyError(error, '의견을 불러오지 못했어요.'); list.append(message); return; }
    list.innerHTML = '';
    if (!data?.length) { list.innerHTML = '<p class="admin-feedback-empty">아직 접수된 의견이 없어요.</p>'; return; }
    for (const report of data) {
      const item = document.createElement('article'); item.className = 'admin-feedback-item';
      const header = document.createElement('header'); const category = document.createElement('strong'); category.textContent = feedbackCategoryLabel(report.category); const date = document.createElement('span'); date.textContent = new Date(report.created_at).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }); header.append(category, date);
      const content = document.createElement('p'); content.textContent = report.message; item.append(header, content);
      if (report.contact_email) { const contact = document.createElement('div'); contact.className = 'admin-feedback-contact'; contact.textContent = `답변 이메일: ${report.contact_email}`; item.append(contact); }
      if (report.image_paths?.length) { const images = document.createElement('div'); images.className = 'admin-feedback-images'; for (const path of report.image_paths) { const { data: signed } = await cloud.storage.from('feedback-images').createSignedUrl(path, 600); if (signed?.signedUrl) { const image = document.createElement('img'); image.src = signed.signedUrl; image.alt = '첨부 사진'; images.append(image); } } if (images.childElementCount) item.append(images); }
      list.append(item);
    }
  }
  async function signUpTeacher() { const email = $('teacherEmail').value.trim(), password = $('teacherPassword').value; if (!email || password.length < 8) { $('teacherAuthMsg').textContent = '이메일과 8자 이상 비밀번호를 입력해주세요.'; return; } const { data, error } = await cloud.auth.signUp({ email, password }); if (error) { $('teacherAuthMsg').textContent = friendlyError(error, '계정을 만들지 못했어요. 다시 시도해주세요.'); return; } $('teacherAuthMsg').textContent = data.session ? '가입 및 로그인되었습니다.' : '인증 이메일을 보냈어요. 이메일 인증 후 로그인해주세요.'; await refreshIdentity(); }
  async function signInTeacher() { const { error } = await cloud.auth.signInWithPassword({ email: $('teacherEmail').value.trim(), password: $('teacherPassword').value }); if (error) { $('teacherAuthMsg').textContent = friendlyError(error, '로그인하지 못했어요. 다시 시도해주세요.'); return; } $('teacherAuthMsg').textContent = ''; await refreshIdentity(); }
  async function signOutTeacher() { await cloud.auth.signOut(); await cloud.auth.signInAnonymously(); await refreshIdentity(); }
  async function inviteTeacher() {
    const email = $('teacherInviteEmail').value.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) { $('teacherInviteMsg').textContent = '초대할 선생님의 이메일을 정확히 입력해주세요.'; return; }
    $('teacherInviteMsg').textContent = '';
    const { data, error } = await cloud.rpc('invite_teacher', { p_email: email });
    if (error) { $('teacherInviteMsg').textContent = friendlyError(error, '초대를 등록하지 못했어요. 다시 시도해주세요.'); return; }
    $('teacherInviteEmail').value = '';
    $('teacherInviteMsg').textContent = data || '초대를 등록했어요.';
  }

  $('joinBtn').onclick = joinClass; $('joinCodeInput').addEventListener('keydown', (event) => { if (event.key === 'Enter') joinClass(); }); $('backBtn').onclick = showLanding;
  $('teacherModeBtn').onclick = () => { const panel = $('teacherPanel'); const opening = panel.classList.toggle('is-open'); panel.inert = !opening; panel.setAttribute('aria-hidden', String(!opening)); $('teacherModeBtn').setAttribute('aria-expanded', String(opening)); if (opening) renderTeacherPanel(); }; $('localTeacherBtn').onclick = () => { isTeacher = !isTeacher; renderTeacherPanel(); }; $('teacherSignUpBtn').onclick = signUpTeacher; $('teacherSignInBtn').onclick = signInTeacher; $('teacherSignOutBtn').onclick = signOutTeacher; $('createClassBtn').onclick = createClass; $('teacherInviteBtn').onclick = inviteTeacher; $('teacherInviteEmail').addEventListener('keydown', (event) => { if (event.key === 'Enter') inviteTeacher(); }); $('adminFeedbackBtn').onclick = openAdminFeedback;
  $('feedbackBtn').onclick = openFeedback; $('feedbackMessage').oninput = updateFeedbackCount; $('feedbackImages').onchange = chooseFeedbackFiles; $('feedbackSubmitBtn').onclick = submitFeedback; $('feedbackSuccessClose').onclick = closeAll; $('actionSuccessClose').onclick = closeAll;
  $('copyCodeBtn').onclick = async () => { await copy(currentClass.join_code); $('copyCodeBtn').textContent = '복사됨!'; setTimeout(() => { $('copyCodeBtn').textContent = '복사'; }, 1200); }; $('addBtn').onclick = () => openAdd(); $('segLink').onclick = () => setMode('link'); $('segQr').onclick = () => setMode('qr'); $('fQrFile').onchange = (event) => { const file = event.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = (load) => { pendingQrData = load.target.result; }; reader.readAsDataURL(file); };
  $('saveBtn').onclick = saveBook; $('editBtn').onclick = () => { closeAll(); openAdd(currentBook); }; $('deleteBtn').onclick = deleteBook; $('copyBackup').onclick = async () => { await copy($('backupText').value); $('copyBackup').textContent = '복사됐어요!'; setTimeout(() => { $('copyBackup').textContent = '복사하기'; }, 1500); }; document.querySelectorAll('[data-close]').forEach((button) => { button.onclick = closeAll; }); document.querySelectorAll('.overlay').forEach((overlay) => { overlay.onclick = (event) => { if (event.target === overlay) closeAll(); }; }); document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeAll(); }); window.addEventListener('resize', () => { if (currentClass) renderShelf(); });
  (async () => { await initialiseCloud(); showLanding(); })();
})();
