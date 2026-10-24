/* Shelf — personal book tracker. Vanilla JS, no build step. Data lives in localStorage. */
(() => {
  'use strict';

  /* ---------- Constants ---------- */
  const STORE_KEY = 'shelf.books.v1';
  const SETTINGS_KEY = 'shelf.settings.v1';
  const FORMATS = { physical: 'Physical', ebook: 'Ebook', audio: 'Audiobook' };
  const STATUSES = { want: 'Want to read', reading: 'Reading', finished: 'Finished', dnf: 'Did not finish' };
  const STATUS_SHORT = { want: 'Want', reading: 'Reading', finished: 'Finished', dnf: 'DNF' };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const CSV_FIELDS = ['id', 'title', 'author', 'formats', 'status', 'pagesRead', 'totalPages', 'audioDone', 'audioTotal',
    'rating', 'notes', 'dateAdded', 'dateStarted', 'dateFinished', 'location', 'lentTo', 'lentDate', 'isbn', 'published', 'coverUrl', 'updatedAt'];

  /* ---------- Helpers ---------- */
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
  const pad = (n) => String(n).padStart(2, '0');
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const yearOf = (d) => (d && /^\d{4}/.test(d) ? +d.slice(0, 4) : null);
  const nowYear = () => new Date().getFullYear();
  const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : 0; };
  const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const fmtNum = (n) => Math.round(n).toLocaleString();
  const fmtDate = (d) => { if (!isDate(d)) return ''; const [y, m, day] = d.split('-'); return `${MONTHS[+m - 1]} ${+day}, ${y}`; };

  /** "12:30" -> 750 minutes; "12" -> 720; "45m" -> 45; "" -> 0 */
  function parseHM(v) {
    if (v == null) return 0;
    if (typeof v === 'number') return Math.max(0, Math.round(v));
    const s = String(v).trim().toLowerCase();
    if (!s) return 0;
    let m;
    if ((m = s.match(/^(\d+)\s*[:h]\s*(\d{1,2})?\s*m?$/))) return int(m[1]) * 60 + int(m[2] || 0);
    if ((m = s.match(/^(\d+)\s*m(in)?$/))) return int(m[1]);
    if ((m = s.match(/^(\d+(?:\.\d+)?)$/))) return Math.round(parseFloat(m[1]) * 60);
    return NaN;
  }
  const fmtHM = (min) => `${Math.floor(min / 60)}:${pad(Math.round(min % 60))}`;
  const fmtHours = (min) => { const h = min / 60; return h >= 100 ? fmtNum(h) : (Math.round(h * 10) / 10).toLocaleString(); };

  function hashHue(str) { let h = 0; for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; }

  /* ---------- State ---------- */
  let books = [];
  let settings = {
    theme: null, goals: {}, view: 'library', layout: 'grid',
    status: 'all', format: 'all', extra: 'all', sort: 'updated', desc: true, statsYear: String(nowYear()),
  };

  function safeGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
  function safeSet(key, val) {
    try { localStorage.setItem(key, val); return true; }
    catch (e) { toast('Could not save — storage is full or blocked.'); return false; }
  }
  function load() {
    try { const raw = JSON.parse(safeGet(STORE_KEY) || '[]'); books = Array.isArray(raw) ? raw.map(normalize).filter(Boolean) : []; } catch { books = []; }
    try { Object.assign(settings, JSON.parse(safeGet(SETTINGS_KEY) || '{}')); } catch { /* defaults */ }
    if (!settings.goals || typeof settings.goals !== 'object') settings.goals = {};
  }
  const saveBooks = () => safeSet(STORE_KEY, JSON.stringify(books));
  const saveSettings = () => safeSet(SETTINGS_KEY, JSON.stringify(settings));

  /** Coerce any imported/legacy object into a valid book record. */
  function normalize(b) {
    if (!b || typeof b !== 'object') return null;
    const title = String(b.title ?? '').trim();
    if (!title) return null;
    let formats = b.formats ?? b.format ?? [];
    if (typeof formats === 'string') formats = formats.split(/[|;,/]+/);
    formats = [...new Set(formats.map((f) => String(f).trim().toLowerCase())
      .map((f) => (f.startsWith('audio') ? 'audio' : f.startsWith('e') || f === 'kindle' || f === 'digital' ? 'ebook' : f.startsWith('phys') || f.includes('paper') || f.includes('hard') || f === 'print' ? 'physical' : f))
      .filter((f) => f in FORMATS))];
    if (!formats.length) formats = ['physical'];
    let status = String(b.status ?? 'want').toLowerCase().trim();
    if (status === 'to-read' || status === 'want to read' || status === 'tbr') status = 'want';
    if (status === 'read' || status === 'done' || status === 'completed') status = 'finished';
    if (status === 'currently-reading' || status === 'in progress') status = 'reading';
    if (status === 'did not finish' || status === 'abandoned') status = 'dnf';
    if (!(status in STATUSES)) status = 'want';
    const audioDone = parseHM(b.audioDone);
    const audioTotal = parseHM(b.audioTotal);
    const totalPages = int(b.totalPages);
    let rating = parseFloat(b.rating); rating = Number.isFinite(rating) ? Math.min(5, Math.max(0, Math.round(rating))) : 0;
    const str = (v) => String(v ?? '').trim();
    const dateAdded = isDate(b.dateAdded) ? b.dateAdded : today();
    return {
      id: str(b.id) || uid(),
      title, author: str(b.author), formats, status,
      pagesRead: totalPages ? Math.min(int(b.pagesRead), totalPages) : int(b.pagesRead), totalPages,
      audioDone: Number.isFinite(audioDone) ? (audioTotal ? Math.min(audioDone, audioTotal) : audioDone) : 0,
      audioTotal: Number.isFinite(audioTotal) ? audioTotal : 0,
      rating, notes: str(b.notes),
      dateAdded, dateStarted: isDate(b.dateStarted) ? b.dateStarted : '', dateFinished: isDate(b.dateFinished) ? b.dateFinished : '',
      location: str(b.location), lentTo: str(b.lentTo), lentDate: isDate(b.lentDate) ? b.lentDate : '',
      isbn: str(b.isbn).replace(/[^\dXx]/g, ''), published: str(b.published), coverUrl: /^https?:\/\//i.test(str(b.coverUrl)) ? str(b.coverUrl) : '',
      updatedAt: Number(b.updatedAt) || Date.now(),
    };
  }

  const hasPages = (b) => b.formats.includes('physical') || b.formats.includes('ebook');
  const hasAudio = (b) => b.formats.includes('audio');

  /** 0..1 progress (uses page progress if available, else audio). */
  function progress(b) {
    if (b.status === 'finished') return 1;
    const p = hasPages(b) && b.totalPages ? b.pagesRead / b.totalPages : null;
    const a = hasAudio(b) && b.audioTotal ? b.audioDone / b.audioTotal : null;
    return Math.max(p ?? 0, a ?? 0);
  }
  /** Pages and minutes consumed by a book (finished = full length). */
  function consumed(b) {
    const fin = b.status === 'finished';
    return {
      pages: hasPages(b) ? (fin ? (b.totalPages || b.pagesRead) : b.pagesRead) : 0,
      minutes: hasAudio(b) ? (fin ? (b.audioTotal || b.audioDone) : b.audioDone) : 0,
    };
  }

  /* ---------- Theme ---------- */
  const mqDark = matchMedia('(prefers-color-scheme: dark)');
  function applyTheme() {
    const root = document.documentElement;
    if (settings.theme) root.dataset.theme = settings.theme; else delete root.dataset.theme;
    const dark = settings.theme ? settings.theme === 'dark' : mqDark.matches;
    $('#themeBtn').setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    $('#themeBtn').title = dark ? 'Light theme' : 'Dark theme';
  }
  mqDark.addEventListener?.('change', () => { applyTheme(); if (settings.view === 'stats') renderStats(); });

  /* ---------- Toast ---------- */
  let toastTimer;
  function toast(msg, actionLabel, action) {
    const t = $('#toast');
    t.innerHTML = `<span>${esc(msg)}</span>${actionLabel ? `<button type="button">${esc(actionLabel)}</button>` : ''}`;
    if (actionLabel) t.querySelector('button').onclick = () => { t.classList.remove('show'); action(); };
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), actionLabel ? 6000 : 3000);
  }

  /* ---------- Small dialog (confirm / prompt) ---------- */
  function ask({ title, body = '', ok = 'OK', danger = false, input = null }) {
    const dlg = $('#smallDialog');
    $('#smallTitle').textContent = title;
    $('#smallBody').innerHTML = body + (input ? `<input id="smallInput" type="${input.type || 'text'}" ${input.attrs || ''} value="${esc(input.value ?? '')}">` : '');
    const okBtn = $('#smallOk');
    okBtn.textContent = ok;
    okBtn.className = 'btn ' + (danger ? 'primary danger-fill' : 'primary');
    okBtn.style.background = danger ? 'var(--danger)' : '';
    okBtn.style.borderColor = danger ? 'var(--danger)' : '';
    return new Promise((resolve) => {
      dlg.returnValue = '';
      dlg.addEventListener('close', function onClose() {
        dlg.removeEventListener('close', onClose);
        const okd = dlg.returnValue === 'ok';
        resolve(okd ? (input ? $('#smallInput').value : true) : null);
      });
      dlg.showModal();
      if (input) setTimeout(() => { const i = $('#smallInput'); i.focus(); i.select?.(); }, 30);
    });
  }

  /* ---------- Covers ---------- */
  function placeholderCover(b, extraClass = '') {
    const h = hashHue(b.title + b.author);
    // Muted, cloth-bound palette: hue from the title, kept in a warm-ish, low-saturation band.
    return `<div class="cover ph ${extraClass}" style="--ph-a:hsl(${h} 32% 36%);--ph-b:hsl(${(h + 24) % 360} 38% 22%)" aria-hidden="true">
      <span class="ph-rule"></span><div class="ph-title">${esc(b.title || 'Untitled')}</div><span class="ph-orn">✦</span><div class="ph-author">${esc(b.author)}</div></div>`;
  }
  function coverHTML(b, extraClass = '') {
    if (!b.coverUrl) return placeholderCover(b, extraClass);
    return `<div class="cover ${extraClass}" data-ph="${esc(JSON.stringify({ title: b.title, author: b.author }))}">
      <img src="${esc(b.coverUrl)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-cover></div>`;
  }
  // Swap broken / missing cover images for a generated placeholder (works offline).
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.hasAttribute('data-cover')) return;
    const wrap = img.closest('.cover');
    if (!wrap) return;
    let info = {}; try { info = JSON.parse(wrap.dataset.ph || '{}'); } catch { /* ignore */ }
    const tmp = document.createElement('div');
    tmp.innerHTML = placeholderCover({ title: info.title || '', author: info.author || '' });
    const ph = tmp.firstElementChild;
    wrap.className = ph.className + ' ' + [...wrap.classList].filter((c) => c !== 'cover').join(' ');
    wrap.setAttribute('style', ph.getAttribute('style'));
    wrap.innerHTML = ph.innerHTML;
  }, true);
  // Open Library returns a 1x1 gif for missing covers unless ?default=false; treat tiny images as missing too.
  document.addEventListener('load', (e) => {
    const img = e.target;
    if (img instanceof HTMLImageElement && img.hasAttribute('data-cover') && img.naturalWidth < 5) img.dispatchEvent(new Event('error'));
  }, true);

  /* ---------- Library rendering ---------- */
  const starsHTML = (r) => r ? `<span class="stars" aria-label="${r} of 5 stars">${'★'.repeat(r)}<span class="off">${'★'.repeat(5 - r)}</span></span>` : '';
  const FMT_ICONS = {
    physical: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z"/><path d="M11 4h7.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H11"/><path d="M14 8h3"/>',
    ebook: '<rect x="5.5" y="3" width="13" height="18" rx="2"/><path d="M9 7h6M9 10.5h6M9 14h3.5"/><path d="M11 18h2"/>',
    audio: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3.5" y="14" width="4" height="6" rx="1.5"/><rect x="16.5" y="14" width="4" height="6" rx="1.5"/>',
  };
  const fmtIcon = (f) => `<svg viewBox="0 0 24 24" aria-hidden="true">${FMT_ICONS[f]}</svg>`;
  const fmtTags = (b) => b.formats.map((f) => `<span class="fmt fmt-${f}" title="${FORMATS[f]}">${fmtIcon(f)}<span>${FORMATS[f]}</span></span>`).join('');

  function progressHTML(b) {
    const rows = [];
    if (b.status === 'want') {
      const bits = [];
      if (hasPages(b) && b.totalPages) bits.push(`${fmtNum(b.totalPages)} pages`);
      if (hasAudio(b) && b.audioTotal) bits.push(`${fmtHM(b.audioTotal)} h`);
      return bits.length ? `<div class="progress"><span class="lbl">${bits.join(' · ')}</span></div>` : '';
    }
    if (b.status === 'finished') {
      return `<div class="progress"><span class="lbl">${b.dateFinished ? 'Finished ' + fmtDate(b.dateFinished) : 'Finished'}</span></div>`;
    }
    if (hasPages(b) && (b.totalPages || b.pagesRead)) {
      const pct = b.totalPages ? Math.min(100, (b.pagesRead / b.totalPages) * 100) : 0;
      rows.push(`<div class="progress" title="${b.pagesRead} of ${b.totalPages || '?'} pages"><div class="bar"><span style="width:${pct}%"></span></div><span class="lbl">${b.totalPages ? Math.round(pct) + '%' : b.pagesRead + ' p'}</span></div>`);
    }
    if (hasAudio(b) && (b.audioTotal || b.audioDone)) {
      const pct = b.audioTotal ? Math.min(100, (b.audioDone / b.audioTotal) * 100) : 0;
      rows.push(`<div class="progress audio" title="${fmtHM(b.audioDone)} of ${b.audioTotal ? fmtHM(b.audioTotal) : '?'}"><div class="bar"><span style="width:${pct}%"></span></div><span class="lbl">${fmtHM(b.audioDone)}${b.audioTotal ? ' / ' + fmtHM(b.audioTotal) : ''}</span></div>`);
    }
    return rows.join('');
  }

  function bookCard(b) {
    const lent = b.formats.includes('physical') && b.lentTo
      ? `<div class="lent"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"/></svg>Lent to ${esc(b.lentTo)}</div>` : '';
    return `<article class="book" tabindex="0" role="button" data-id="${esc(b.id)}" aria-label="${esc(b.title)}${b.author ? ' by ' + esc(b.author) : ''}, ${STATUSES[b.status]}">
      <div class="cover-wrap">${coverHTML(b)}</div>
      <span class="status-corner"><span class="badge st st-${b.status}"><span class="dot"></span>${STATUS_SHORT[b.status]}</span></span>
      <div class="info">
        <div class="head"><div class="title">${esc(b.title)}</div><div class="author">${esc(b.author || 'Unknown author')}</div></div>
        <div class="meta">${fmtTags(b)}</div>
        <div class="bottom">${progressHTML(b)}${starsHTML(b.rating)}${lent}</div>
        <div class="notes-snip">${esc(b.notes)}</div>
      </div>
    </article>`;
  }

  function matchesSearch(b, q) {
    if (!q) return true;
    const hay = [b.title, b.author, b.notes, b.location, b.lentTo, b.isbn, b.published].join(' ').toLowerCase();
    return q.toLowerCase().split(/\s+/).every((t) => hay.includes(t));
  }
  function matchesExtra(b, x) {
    switch (x) {
      case 'lent': return b.formats.includes('physical') && !!b.lentTo;
      case 'rated': return b.rating >= 4;
      case 'unrated': return !b.rating;
      case 'thisyear': return b.status === 'finished' && yearOf(b.dateFinished) === nowYear();
      default: return true;
    }
  }
  const lastName = (a) => (a || '').trim().split(/\s+/).pop().toLowerCase();
  const SORTERS = {
    updated: (a, b) => b.updatedAt - a.updatedAt,
    added: (a, b) => b.dateAdded.localeCompare(a.dateAdded) || b.updatedAt - a.updatedAt,
    title: (a, b) => a.title.replace(/^(the|a|an)\s+/i, '').localeCompare(b.title.replace(/^(the|a|an)\s+/i, ''), undefined, { sensitivity: 'base' }),
    author: (a, b) => lastName(a.author).localeCompare(lastName(b.author)) || a.title.localeCompare(b.title),
    finished: (a, b) => (b.dateFinished || '').localeCompare(a.dateFinished || ''),
    rating: (a, b) => b.rating - a.rating || a.title.localeCompare(b.title),
    progress: (a, b) => progress(b) - progress(a),
  };
  // Sorters that read naturally ascending (A–Z) vs descending (newest/highest first)
  const ASC_NATURAL = new Set(['title', 'author']);

  function visibleBooks() {
    const q = $('#search').value.trim();
    const list = books.filter((b) => (settings.status === 'all' || b.status === settings.status)
      && (settings.format === 'all' || b.formats.includes(settings.format))
      && matchesExtra(b, settings.extra) && matchesSearch(b, q));
    list.sort(SORTERS[settings.sort] || SORTERS.updated);
    const naturalDesc = !ASC_NATURAL.has(settings.sort);
    if (settings.desc !== naturalDesc) list.reverse();
    return list;
  }

  function renderLibrary() {
    // counts respect search + format/extra but not status
    const q = $('#search').value.trim();
    const base = books.filter((b) => (settings.format === 'all' || b.formats.includes(settings.format)) && matchesExtra(b, settings.extra) && matchesSearch(b, q));
    $$('[data-count]').forEach((el) => {
      const k = el.dataset.count;
      el.textContent = k === 'all' ? base.length : base.filter((b) => b.status === k).length;
    });
    $$('#statusFilter button').forEach((btn) => btn.setAttribute('aria-pressed', btn.dataset.v === settings.status));
    $$('#layoutToggle button').forEach((btn) => btn.setAttribute('aria-pressed', btn.dataset.v === settings.layout));
    $('#formatFilter').value = settings.format;
    $('#extraFilter').value = settings.extra;
    $('#sortBy').value = settings.sort;

    const list = visibleBooks();
    const el = $('#bookList');
    el.className = 'books ' + settings.layout;
    el.innerHTML = list.map(bookCard).join('');

    const empty = $('#emptyState');
    const filtered = books.length && !list.length;
    empty.hidden = list.length > 0;
    $('#emptyTitle').textContent = filtered ? 'No matches' : 'Your shelf is empty';
    $('#emptyText').textContent = filtered ? 'Try a different search or clear the filters.' : 'Add your first book, or load a few samples to look around.';
    $$('.empty-actions [data-action="sample"]').forEach((b) => (b.hidden = !!filtered));
    $('#resultMeta').textContent = books.length
      ? (list.length === books.length ? `${books.length} book${books.length === 1 ? '' : 's'}` : `Showing ${list.length} of ${books.length}`)
      : '';

    $('#locationList').innerHTML = [...new Set(books.map((b) => b.location).filter(Boolean))].sort().map((l) => `<option value="${esc(l)}">`).join('');
  }

  /* ---------- Book dialog ---------- */
  const dlg = $('#bookDialog');
  const form = $('#bookForm');
  let editingId = null;

  function setRating(v) {
    form.rating.value = v || '';
    $$('#starInput button[data-star]').forEach((btn) => {
      const on = +btn.dataset.star <= (v || 0);
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-checked', +btn.dataset.star === v);
    });
    $('#starInput .clear').hidden = !v;
  }
  $('#starInput').innerHTML = [1, 2, 3, 4, 5].map((n) => `<button type="button" role="radio" data-star="${n}" aria-label="${n} star${n > 1 ? 's' : ''}">★</button>`).join('')
    + '<button type="button" class="clear">Clear</button>';
  $('#starInput').addEventListener('click', (e) => {
    const btn = e.target.closest('button'); if (!btn) return;
    if (btn.classList.contains('clear')) return setRating(0);
    const n = +btn.dataset.star;
    setRating(+form.rating.value === n ? 0 : n);
  });

  function selectedFormats() { return $$('input[name="formats"]:checked', form).map((i) => i.value); }
  function syncFormatGroups() {
    const f = selectedFormats();
    $('#pagesGroup').hidden = !(f.includes('physical') || f.includes('ebook'));
    $('#audioGroup').hidden = !f.includes('audio');
    $('#physicalGroup').hidden = !f.includes('physical');
  }
  function updateCoverPreview() {
    const b = { title: form.title.value.trim() || 'Untitled', author: form.author.value.trim(), coverUrl: form.coverUrl.value.trim() };
    $('#coverPreview').outerHTML = coverHTML(b).replace('class="cover', 'id="coverPreview" class="cover');
  }

  function openBook(id = null) {
    editingId = id;
    const b = id ? books.find((x) => x.id === id) : null;
    form.reset();
    $('#formError').textContent = '';
    $('#lookupResults').innerHTML = '';
    $('#lookupStatus').textContent = '';
    $('#lookupStatus').classList.remove('err');
    $('#lookupQ').value = '';
    $('#dlgTitle').textContent = b ? 'Edit book' : 'Add book';
    $('#deleteBtn').hidden = !b;
    const d = b || { formats: [settings.format !== 'all' ? settings.format : 'physical'], status: 'want', dateAdded: today() };
    for (const k of ['title', 'author', 'notes', 'location', 'lentTo', 'isbn', 'published', 'coverUrl', 'dateAdded', 'dateStarted', 'dateFinished', 'lentDate']) form[k].value = d[k] || '';
    form.status.value = d.status;
    form.pagesRead.value = d.pagesRead || '';
    form.totalPages.value = d.totalPages || '';
    form.audioDone.value = d.audioDone ? fmtHM(d.audioDone) : '';
    form.audioTotal.value = d.audioTotal ? fmtHM(d.audioTotal) : '';
    $$('input[name="formats"]', form).forEach((i) => (i.checked = d.formats.includes(i.value)));
    setRating(d.rating || 0);
    syncFormatGroups();
    updateCoverPreview();
    $('details.more', form).open = !!(b && (b.isbn || b.coverUrl || b.published));
    dlg.showModal();
    setTimeout(() => (b ? form.title : $('#lookupQ')).focus(), 30);
  }

  function readForm() {
    const formats = selectedFormats();
    const audioDone = parseHM(form.audioDone.value);
    const audioTotal = parseHM(form.audioTotal.value);
    if (!form.title.value.trim()) return { error: 'Please enter a title.', field: form.title };
    if (!formats.length) return { error: 'Pick at least one format.', field: $('input[name="formats"]', form) };
    if (Number.isNaN(audioDone) || Number.isNaN(audioTotal)) return { error: 'Listening time should look like 7:45 (hours:minutes).', field: Number.isNaN(audioDone) ? form.audioDone : form.audioTotal };
    const totalPages = int(form.totalPages.value);
    let pagesRead = int(form.pagesRead.value);
    if (totalPages && pagesRead > totalPages) pagesRead = totalPages;
    const status = form.status.value;
    const out = {
      title: form.title.value.trim(), author: form.author.value.trim(), formats, status,
      pagesRead, totalPages, audioDone: audioTotal && audioDone > audioTotal ? audioTotal : audioDone, audioTotal,
      rating: int(form.rating.value), notes: form.notes.value.trim(),
      dateAdded: form.dateAdded.value || today(), dateStarted: form.dateStarted.value, dateFinished: form.dateFinished.value,
      location: form.location.value.trim(), lentTo: form.lentTo.value.trim(), lentDate: form.lentDate.value,
      isbn: form.isbn.value.replace(/[^\dXx]/g, ''), published: form.published.value.trim(), coverUrl: form.coverUrl.value.trim(),
    };
    if (out.coverUrl && !/^https?:\/\//i.test(out.coverUrl)) return { error: 'Cover URL must start with http:// or https://', field: form.coverUrl };
    if (out.dateStarted && out.dateFinished && out.dateFinished < out.dateStarted) return { error: 'Finish date is before the start date.', field: form.dateFinished };
    // Sensible automatic fill-ins
    if (status === 'finished') {
      if (!out.dateFinished) out.dateFinished = today();
      if (out.totalPages) out.pagesRead = out.totalPages;
      if (out.audioTotal) out.audioDone = out.audioTotal;
    }
    if (status === 'reading' && !out.dateStarted) out.dateStarted = today();
    if (status === 'dnf' && !out.dateFinished) out.dateFinished = today();
    if (status === 'want' || status === 'reading') out.dateFinished = '';
    if (!out.lentTo) out.lentDate = '';
    else if (!out.lentDate) out.lentDate = today();
    return { book: out };
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const res = readForm();
    if (res.error) { $('#formError').textContent = res.error; res.field?.focus(); return; }
    const data = res.book;
    if (editingId) {
      const i = books.findIndex((b) => b.id === editingId);
      books[i] = normalize({ ...books[i], ...data, updatedAt: Date.now() });
      toast('Saved');
    } else {
      books.push(normalize({ ...data, id: uid(), updatedAt: Date.now() }));
      toast(`Added “${data.title}”`);
    }
    saveBooks();
    dlg.close();
    render();
  });
  form.addEventListener('change', (e) => {
    if (e.target.name === 'formats') syncFormatGroups();
    if (e.target.name === 'coverUrl') updateCoverPreview();
    if (e.target.name === 'status' && e.target.value === 'reading' && !form.dateStarted.value) form.dateStarted.value = today();
    if (e.target.name === 'status' && e.target.value === 'finished' && !form.dateFinished.value) form.dateFinished.value = today();
  });
  let previewTimer;
  form.addEventListener('input', (e) => {
    if (['title', 'author'].includes(e.target.name)) { clearTimeout(previewTimer); previewTimer = setTimeout(updateCoverPreview, 250); }
  });
  $$('[data-close]', dlg).forEach((b) => b.addEventListener('click', () => dlg.close()));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // backdrop click

  $('#deleteBtn').addEventListener('click', () => {
    const i = books.findIndex((b) => b.id === editingId);
    if (i < 0) return;
    const [removed] = books.splice(i, 1);
    saveBooks(); dlg.close(); render();
    toast(`Deleted “${removed.title}”`, 'Undo', () => { books.splice(i, 0, removed); saveBooks(); render(); });
  });

  /* ---------- Open Library lookup ---------- */
  const lookupCache = new Map();
  async function lookup() {
    const q = $('#lookupQ').value.trim();
    const status = $('#lookupStatus');
    const results = $('#lookupResults');
    status.classList.remove('err');
    results.innerHTML = '';
    if (!q) { status.textContent = 'Type an ISBN or a title first.'; return; }
    if (!navigator.onLine) { status.classList.add('err'); status.textContent = 'You appear to be offline — fill in the details by hand; everything still saves locally.'; return; }
    const digits = q.replace(/[\s-]/g, '');
    const isIsbn = /^(\d{9}[\dXx]|\d{13})$/.test(digits);
    const params = new URLSearchParams({ limit: '8', fields: 'key,title,author_name,first_publish_year,number_of_pages_median,isbn,cover_i' });
    params.set(isIsbn ? 'isbn' : 'q', isIsbn ? digits : q);
    const url = `https://openlibrary.org/search.json?${params}`;
    status.textContent = 'Searching Open Library…';
    $('#lookupBtn').disabled = true;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
      let data = lookupCache.get(url);
      if (!data) {
        const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        data = await res.json();
        lookupCache.set(url, data);
      }
      const docs = (data.docs || []).filter((d) => d.title);
      if (!docs.length) { status.textContent = 'No matches. Try another spelling, or enter details manually.'; return; }
      status.textContent = `${docs.length} result${docs.length > 1 ? 's' : ''} — pick one to fill in the form.`;
      results.innerHTML = docs.map((d, i) => {
        const thumb = d.cover_i ? `<img src="https://covers.openlibrary.org/b/id/${d.cover_i}-S.jpg" alt="" loading="lazy" referrerpolicy="no-referrer">` : '';
        const bits = [d.author_name?.slice(0, 2).join(', '), d.first_publish_year, d.number_of_pages_median && d.number_of_pages_median + ' pages'].filter(Boolean).join(' · ');
        return `<li><button type="button" data-i="${i}"><span class="thumb">${thumb}</span><span><span class="t">${esc(d.title)}</span><br><span class="a">${esc(bits)}</span></span></button></li>`;
      }).join('');
      results.onclick = (e) => {
        const btn = e.target.closest('button[data-i]'); if (!btn) return;
        applyLookup(docs[+btn.dataset.i], isIsbn ? digits : null);
      };
    } catch (err) {
      status.classList.add('err');
      status.textContent = err.name === 'AbortError'
        ? 'Open Library took too long to answer. You can still enter the book by hand.'
        : 'Lookup failed (offline or Open Library unavailable). You can still enter the book by hand.';
    } finally {
      clearTimeout(timer);
      $('#lookupBtn').disabled = false;
    }
  }
  function applyLookup(d, searchedIsbn) {
    form.title.value = d.title || form.title.value;
    if (d.author_name?.length) form.author.value = d.author_name.slice(0, 3).join(', ');
    if (d.number_of_pages_median && !int(form.totalPages.value)) form.totalPages.value = d.number_of_pages_median;
    if (d.first_publish_year) form.published.value = d.first_publish_year;
    const isbn = searchedIsbn || (d.isbn || []).find((x) => x.length === 13) || (d.isbn || [])[0] || '';
    if (isbn) form.isbn.value = isbn;
    if (d.cover_i) form.coverUrl.value = `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`;
    else if (isbn) form.coverUrl.value = `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false`;
    $('#lookupResults').innerHTML = '';
    $('#lookupStatus').textContent = 'Filled in from Open Library — check and adjust anything you like.';
    updateCoverPreview();
    form.title.focus();
  }
  $('#lookupBtn').addEventListener('click', lookup);
  $('#lookupQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); lookup(); } });

  /* ---------- Stats ---------- */
  const tip = $('#tooltip');
  function showTip(html, x, y) {
    tip.innerHTML = html; tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let left = x + 14, top = y - r.height - 12;
    if (left + r.width > innerWidth - 8) left = x - r.width - 14;
    if (left < 8) left = 8;
    if (top < 8) top = y + 16;
    tip.style.left = left + 'px'; tip.style.top = top + 'px';
  }
  const hideTip = () => { tip.hidden = true; };

  /** Single-series column chart rendered at the container's real width (so text stays crisp & legible). */
  function columnChart(el, data, { height = 200, highlight = null, goal = null } = {}) {
    if (!data.length || data.every((d) => !d.value)) {
      el.innerHTML = '<div class="chart-empty">Nothing finished yet — finished books show up here.</div>';
      return;
    }
    const W = Math.max(260, el.clientWidth || 520);
    const H = height, padL = 28, padR = 6, padT = 18, padB = 24;
    const max = Math.max(1, goal || 0, ...data.map((d) => d.value));
    const step = max <= 4 ? 1 : max <= 10 ? 2 : max <= 25 ? 5 : max <= 60 ? 10 : Math.ceil(max / 5 / 10) * 10;
    const top = Math.ceil(max / step) * step;
    const y = (v) => padT + (H - padT - padB) * (1 - v / top);
    const slot = (W - padL - padR) / data.length;
    const bw = Math.max(4, Math.min(44, slot - Math.max(2, slot * 0.28)));
    const labelEvery = Math.ceil(data.length / Math.floor((W - padL) / 34));
    const maxV = Math.max(...data.map((d) => d.value));
    let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(el.dataset.label || 'Bar chart')}">`;
    for (let v = 0; v <= top; v += step) {
      svg += `<line class="${v === 0 ? 'baseline' : 'gridline'}" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/>`;
      svg += `<text x="${padL - 6}" y="${y(v) + 3.5}" text-anchor="end">${v}</text>`;
    }
    if (goal) svg += `<line class="goal-line" x1="${padL}" x2="${W - padR}" y1="${y(goal)}" y2="${y(goal)}"/><text x="${W - padR}" y="${y(goal) - 4}" text-anchor="end">goal ${goal}</text>`;
    data.forEach((d, i) => {
      const cx = padL + slot * i + slot / 2;
      const x = cx - bw / 2;
      const by = y(d.value), bh = Math.max(0, y(0) - by);
      const r = Math.min(4, bh, bw / 2);
      const dim = highlight != null && d.key !== highlight;
      svg += `<g class="col" data-i="${i}">`;
      svg += `<rect class="hit" x="${padL + slot * i}" y="${padT}" width="${slot}" height="${H - padT - padB}"/>`;
      if (bh > 0) svg += `<path class="bar${dim ? ' dim' : ''}" d="M${x},${y(0)} V${by + r} Q${x},${by} ${x + r},${by} H${x + bw - r} Q${x + bw},${by} ${x + bw},${by + r} V${y(0)} Z"/>`;
      if (d.value && (d.key === highlight || (highlight == null && d.value === maxV))) svg += `<text class="vlabel" x="${cx}" y="${by - 5}" text-anchor="middle">${d.value}</text>`;
      if (i % labelEvery === 0 || d.key === highlight) svg += `<text x="${cx}" y="${H - 7}" text-anchor="middle">${esc(d.label)}</text>`;
      svg += `</g>`;
    });
    svg += '</svg>';
    el.innerHTML = svg;
    const move = (e) => {
      const g = e.target.closest('g.col'); if (!g) return hideTip();
      showTip(data[+g.dataset.i].tip, e.clientX, e.clientY);
    };
    el.onpointermove = move; el.onpointerdown = move; el.onpointerleave = hideTip;
  }

  function hbars(el, rows, total) {
    const max = Math.max(1, ...rows.map((r) => r.value));
    el.innerHTML = rows.map((r) => `<div class="hbar">
      <span class="name"><i style="background:${r.color}"></i>${esc(r.label)}</span>
      <span class="track"><span style="width:${(r.value / max) * 100}%;background:${r.color}"></span></span>
      <span class="num">${fmtNum(r.value)}${r.sub ? ` <small>${esc(r.sub)}</small>` : total ? ` <small>${Math.round((r.value / total) * 100)}%</small>` : ''}</span>
    </div>`).join('');
  }

  function tableHTML(head, rows) {
    return `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }

  function finishedIn(year) { return books.filter((b) => b.status === 'finished' && (year === 'all' || yearOf(b.dateFinished) === year)); }

  function renderStats() {
    const cy = nowYear();
    const years = new Set([cy, ...books.map((b) => yearOf(b.dateFinished)).filter(Boolean)]);
    const yearList = [...years].sort((a, b) => b - a);
    const sel = $('#statsYear');
    if (settings.statsYear !== 'all' && !years.has(+settings.statsYear)) settings.statsYear = String(cy);
    sel.innerHTML = yearList.map((y) => `<option value="${y}">${y}</option>`).join('') + '<option value="all">All time</option>';
    sel.value = settings.statsYear;
    const year = settings.statsYear === 'all' ? 'all' : +settings.statsYear;
    const scopeLabel = year === 'all' ? 'all time' : year;

    // ---- Goal (always a specific year; "All time" shows current year's goal)
    const gy = year === 'all' ? cy : year;
    const goal = int(settings.goals[gy]);
    const doneG = finishedIn(gy).length;
    const goalCard = $('#goalCard');
    if (goal) {
      const pct = Math.min(1, doneG / goal);
      const C = 2 * Math.PI * 50;
      let paceHTML = '';
      if (gy === cy) {
        const start = new Date(cy, 0, 1), end = new Date(cy + 1, 0, 1);
        const frac = (Date.now() - start) / (end - start);
        const expected = goal * frac;
        const diff = Math.round(doneG - expected);
        const left = goal - doneG;
        const weeksLeft = Math.max(1, (end - Date.now()) / (7 * 864e5));
        if (left <= 0) paceHTML = `<p class="pace ahead"><svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>Goal reached — ${doneG - goal > 0 ? `${doneG - goal} over and counting` : 'nicely done'}.</p>`;
        else if (diff >= 0) paceHTML = `<p class="pace ahead"><svg viewBox="0 0 24 24"><path d="M12 19V5m0 0-6 6m6-6 6 6"/></svg>${diff ? `${diff} book${diff > 1 ? 's' : ''} ahead of schedule` : 'Right on schedule'} · ${left} to go</p>`;
        else paceHTML = `<p class="pace behind"><svg viewBox="0 0 24 24"><path d="M12 5v14m0 0-6-6m6 6 6-6"/></svg>${-diff} behind schedule · about ${(left / weeksLeft).toFixed(1)} a week to catch up</p>`;
      } else {
        paceHTML = `<p class="pace ${doneG >= goal ? 'ahead' : 'behind'}"><svg viewBox="0 0 24 24"><path d="${doneG >= goal ? 'm5 12 5 5 9-10' : 'M6 6l12 12M18 6 6 18'}"/></svg>${doneG >= goal ? 'Goal reached' : `Finished ${goal - doneG} short`}</p>`;
      }
      goalCard.innerHTML = `<div class="ring"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="track" cx="60" cy="60" r="50" fill="none" stroke-width="12"/>
        <circle class="val" cx="60" cy="60" r="50" fill="none" stroke-width="12" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/></svg><div class="pct">${Math.round(pct * 100)}%</div></div>
        <div><h2>${gy} reading goal</h2><p class="big"><strong>${doneG}</strong> of ${goal} books</p>${paceHTML}<button class="btn" type="button" data-action="goal">Change goal</button></div>`;
    } else {
      goalCard.innerHTML = `<div class="ring"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="track" cx="60" cy="60" r="50" fill="none" stroke-width="12"/></svg><div class="pct">${doneG}</div></div>
        <div><h2>Set a ${gy} reading goal</h2><p class="big">You've finished <strong>${doneG}</strong> book${doneG === 1 ? '' : 's'} in ${gy}. How many are you aiming for?</p><button class="btn primary" type="button" data-action="goal">Set goal</button></div>`;
    }
    goalCard.dataset.year = gy;

    // ---- Tiles
    let scopeBooks; // books whose consumption counts in scope
    if (year === 'all') scopeBooks = books;
    else scopeBooks = books.filter((b) => (b.status === 'finished' || b.status === 'dnf') ? yearOf(b.dateFinished) === year : (b.status === 'reading' && year === cy));
    const fin = finishedIn(year);
    let pages = 0, minutes = 0;
    scopeBooks.forEach((b) => { const c = consumed(b); pages += c.pages; minutes += c.minutes; });
    const rated = fin.filter((b) => b.rating);
    const avg = rated.length ? rated.reduce((s, b) => s + b.rating, 0) / rated.length : 0;
    const reading = books.filter((b) => b.status === 'reading').length;
    const lent = books.filter((b) => b.formats.includes('physical') && b.lentTo).length;
    const longest = fin.filter((b) => hasPages(b) && b.totalPages).sort((a, b) => b.totalPages - a.totalPages)[0];
    const tiles = [
      ['Books finished', fin.length, year === 'all' ? `${books.length} in library` : `in ${year}`],
      ['Pages read', fmtNum(pages), fin.length && pages ? `≈ ${fmtNum(pages / Math.max(1, fin.filter(hasPages).length))} per book` : 'physical + ebook'],
      ['Hours listened', fmtHours(minutes), 'audiobooks'],
      ['Average rating', avg ? avg.toFixed(1) + ' ★' : '—', rated.length ? `${rated.length} rated` : 'no ratings yet'],
      ['Reading now', reading, lent ? `${lent} lent out` : 'nothing lent out'],
    ];
    if (longest) tiles.push(['Longest book', fmtNum(longest.totalPages), longest.title.length > 26 ? longest.title.slice(0, 25) + '…' : longest.title]);
    const TILE_ICONS = {
      'Books finished': '<path d="m5 12 4.5 4.5L19 7"/>',
      'Pages read': FMT_ICONS.physical,
      'Hours listened': FMT_ICONS.audio,
      'Average rating': '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
      'Reading now': '<path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
      'Longest book': '<path d="M6 3h12M6 21h12M8 3v18M16 3v18"/>',
    };
    $('#tiles').innerHTML = tiles.map(([k, v, s]) => `<div class="tile"><div class="k"><svg viewBox="0 0 24 24" aria-hidden="true">${TILE_ICONS[k] || ''}</svg>${esc(k)}</div><div class="v">${esc(v)}</div><div class="s">${esc(s)}</div></div>`).join('');

    // ---- Books per year
    const finYears = books.filter((b) => b.status === 'finished' && yearOf(b.dateFinished)).map((b) => yearOf(b.dateFinished));
    const minY = Math.min(cy, ...finYears), maxY = Math.max(cy, ...finYears);
    const fromY = Math.max(minY, maxY - 14);
    const perYear = [];
    for (let yv = fromY; yv <= maxY; yv++) {
      const list = finishedIn(yv);
      let p = 0, m = 0; list.forEach((b) => { const c = consumed(b); p += c.pages; m += c.minutes; });
      const g = int(settings.goals[yv]);
      perYear.push({ key: yv, label: String(yv).slice(fromY === maxY ? 0 : 2).replace(/^(\d\d)$/, "'$1"), value: list.length, pages: p, minutes: m, goal: g,
        tip: `<strong>${yv}</strong><div class="row">Books <b>${list.length}${g ? ' / ' + g : ''}</b></div><div class="row">Pages <b>${fmtNum(p)}</b></div><div class="row">Hours <b>${fmtHours(m)}</b></div>` });
    }
    if (perYear.length <= 6) perYear.forEach((d) => (d.label = String(d.key)));
    const yc = $('#yearChart'); yc.dataset.label = 'Books finished per year';
    columnChart(yc, perYear, { highlight: year === 'all' ? null : year });
    $('#yearTable').innerHTML = tableHTML(['Year', 'Books', 'Goal', 'Pages', 'Hours'], perYear.slice().reverse().map((d) => [d.key, d.value, d.goal || '—', fmtNum(d.pages), fmtHours(d.minutes)]));

    // ---- Months (selected year, or current year for all-time)
    const my = year === 'all' ? cy : year;
    $('#monthScope').textContent = `· ${my}`;
    const monthData = MONTHS.map((mName, mi) => {
      const list = finishedIn(my).filter((b) => +b.dateFinished.slice(5, 7) === mi + 1);
      return { key: mi, label: mName, value: list.length,
        tip: `<strong>${mName} ${my}</strong><div class="row">Finished <b>${list.length}</b></div>${list.slice(0, 4).map((b) => `<div class="row">${esc(b.title.length > 30 ? b.title.slice(0, 29) + '…' : b.title)}</div>`).join('')}${list.length > 4 ? `<div class="row">+${list.length - 4} more</div>` : ''}` };
    });
    const mc = $('#monthChart'); mc.dataset.label = `Books finished per month in ${my}`;
    columnChart(mc, monthData, { height: 180 });
    $('#monthTable').innerHTML = tableHTML(['Month', 'Books'], monthData.map((d) => [d.label, d.value]));

    // ---- Formats
    $('#formatScope').textContent = `· ${year === 'all' ? 'whole library' : 'finished in ' + year}`;
    const fScope = year === 'all' ? books : fin;
    hbars($('#formatChart'), Object.keys(FORMATS).map((f) => {
      const list = fScope.filter((b) => b.formats.includes(f));
      let sub = '';
      if (f === 'audio') { const m = list.reduce((s, b) => s + consumed(b).minutes, 0); sub = m ? `${fmtHours(m)} h` : ''; }
      else { const p = list.reduce((s, b) => s + (consumed(b).pages || 0), 0); sub = p ? `${fmtNum(p)} p` : ''; }
      return { label: FORMATS[f], value: list.length, color: `var(--fmt-${f})`, sub: sub || ' ' };
    }));

    // ---- Status (whole library) + rating distribution (scope)
    hbars($('#statusChart'), Object.keys(STATUSES).map((s) => ({ label: STATUS_SHORT[s], value: books.filter((b) => b.status === s).length, color: `var(--st-${s})` })), books.length);
    const dist = [1, 2, 3, 4, 5].map((r) => rated.filter((b) => b.rating === r).length);
    const dmax = Math.max(1, ...dist);
    $('#ratingDist').innerHTML = `<div class="avg"><strong>${avg ? avg.toFixed(1) : '—'}</strong>avg rating · ${scopeLabel}</div>` +
      dist.map((n, i) => `<div class="rcol" title="${n} book${n === 1 ? '' : 's'} rated ${i + 1}"><span>${n || ''}</span><div class="rb" style="height:${(n / dmax) * 44}px"></div><span>${i + 1}★</span></div>`).join('');
  }

  /* ---------- Export / import ---------- */
  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const stamp = () => today();
  function exportJSON() {
    download(`shelf-${stamp()}.json`, JSON.stringify({ app: 'shelf', version: 1, exportedAt: new Date().toISOString(), books, goals: settings.goals }, null, 2), 'application/json');
    toast(`Exported ${books.length} books as JSON`);
  }
  const csvCell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` : s; };
  function exportCSV() {
    const rows = [CSV_FIELDS.join(',')].concat(books.map((b) => CSV_FIELDS.map((k) => {
      if (k === 'formats') return csvCell(b.formats.join('|'));
      if (k === 'audioDone' || k === 'audioTotal') return csvCell(b[k] ? fmtHM(b[k]) : '');
      return csvCell(b[k]);
    }).join(',')));
    download(`shelf-${stamp()}.csv`, '﻿' + rows.join('\r\n'), 'text/csv');
    toast(`Exported ${books.length} books as CSV`);
  }
  function parseCSV(text) {
    const rows = []; let row = [], cell = '', q = false;
    text = text.replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    const nonEmpty = rows.filter((r) => r.some((c) => c.trim()));
    if (!nonEmpty.length) return [];
    const aliases = { format: 'formats', 'my rating': 'rating', 'exclusive shelf': 'status', 'number of pages': 'totalPages', 'date read': 'dateFinished', 'date added': 'dateAdded', 'my review': 'notes', isbn13: 'isbn', 'year published': 'published' };
    const lower = Object.fromEntries(CSV_FIELDS.map((f) => [f.toLowerCase(), f]));
    const head = nonEmpty[0].map((h) => { const k = h.trim().toLowerCase(); return lower[k] || aliases[k] || k; });
    return nonEmpty.slice(1).map((r) => {
      const o = {};
      head.forEach((h, i) => { let v = (r[i] ?? '').trim(); if (/^'[=+\-@]/.test(v)) v = v.slice(1); if (!(h in o) || v) o[h] = v; });
      // Goodreads-style dates "2024/03/05" and ISBNs like ="978..."
      for (const k of ['dateFinished', 'dateAdded', 'dateStarted', 'lentDate']) if (o[k]) o[k] = o[k].replace(/\//g, '-').replace(/^(\d{4})-(\d)-/, '$1-0$2-').replace(/-(\d)$/, '-0$1');
      if (o.isbn) o.isbn = o.isbn.replace(/[^\dXx]/g, '');
      return o;
    });
  }
  async function importFile(file) {
    let text;
    try { text = await file.text(); } catch { return toast('Could not read that file.'); }
    let incoming = [], goals = null;
    try {
      if (/\.json$/i.test(file.name) || /^\s*[[{]/.test(text)) {
        const data = JSON.parse(text);
        incoming = Array.isArray(data) ? data : data.books || [];
        if (data.goals && typeof data.goals === 'object') goals = data.goals;
      } else incoming = parseCSV(text);
    } catch { return toast('That file is not valid JSON or CSV.'); }
    const valid = incoming.map(normalize).filter(Boolean);
    if (!valid.length) return toast('No books found in that file.');
    const byId = new Map(books.map((b, i) => [b.id, i]));
    const byKey = new Map(books.map((b, i) => [(b.title + '|' + b.author).toLowerCase(), i]));
    let added = 0, updated = 0;
    for (const b of valid) {
      const idx = byId.get(b.id) ?? byKey.get((b.title + '|' + b.author).toLowerCase());
      if (idx != null) { books[idx] = { ...b, id: books[idx].id }; updated++; } else { books.push(b); added++; }
    }
    if (goals) for (const [y, g] of Object.entries(goals)) if (int(g)) settings.goals[y] = int(g);
    saveBooks(); saveSettings(); render();
    toast(`Imported: ${added} new, ${updated} updated`);
  }

  /* ---------- Samples ---------- */
  function sampleBooks() {
    const y = nowYear();
    const ol = (isbn) => `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false`;
    return [
      { title: 'Project Hail Mary', author: 'Andy Weir', formats: ['audio'], status: 'finished', audioTotal: '16:10', rating: 5, dateStarted: `${y}-01-04`, dateFinished: `${y}-01-19`, isbn: '9780593135204', coverUrl: ol('9780593135204'), notes: 'Ray Porter narration is superb.' },
      { title: 'The Left Hand of Darkness', author: 'Ursula K. Le Guin', formats: ['physical'], status: 'finished', totalPages: 304, rating: 5, dateStarted: `${y}-02-01`, dateFinished: `${y}-02-20`, location: 'Living room, shelf 2', lentTo: 'Sam', isbn: '9780441478125', coverUrl: ol('9780441478125') },
      { title: 'Piranesi', author: 'Susanna Clarke', formats: ['ebook'], status: 'finished', totalPages: 272, rating: 4, dateStarted: `${y}-03-10`, dateFinished: `${y}-03-18`, isbn: '9781635575637', coverUrl: ol('9781635575637') },
      { title: 'Thinking, Fast and Slow', author: 'Daniel Kahneman', formats: ['physical', 'audio'], status: 'reading', totalPages: 499, pagesRead: 212, audioTotal: '20:02', audioDone: '3:40', dateStarted: `${y}-09-02`, location: 'Bedside table', isbn: '9780374533557', coverUrl: ol('9780374533557') },
      { title: 'The Fifth Season', author: 'N. K. Jemisin', formats: ['ebook'], status: 'reading', totalPages: 468, pagesRead: 120, dateStarted: `${y}-10-01`, isbn: '9780316229296', coverUrl: ol('9780316229296') },
      { title: 'Middlemarch', author: 'George Eliot', formats: ['physical'], status: 'dnf', totalPages: 880, pagesRead: 190, rating: 2, dateStarted: `${y}-04-02`, dateFinished: `${y}-05-01`, location: 'Study', notes: 'Will try again some winter.' },
      { title: 'Circe', author: 'Madeline Miller', formats: ['audio'], status: 'finished', audioTotal: '12:08', rating: 4, dateStarted: `${y - 1}-06-01`, dateFinished: `${y - 1}-06-20`, isbn: '9780316556347', coverUrl: ol('9780316556347') },
      { title: 'Sapiens', author: 'Yuval Noah Harari', formats: ['physical'], status: 'finished', totalPages: 443, rating: 3, dateStarted: `${y - 1}-08-01`, dateFinished: `${y - 1}-09-05`, location: 'Study', isbn: '9780062316097', coverUrl: ol('9780062316097') },
      { title: 'The Name of the Wind', author: 'Patrick Rothfuss', formats: ['physical'], status: 'finished', totalPages: 662, rating: 4, dateFinished: `${y - 2}-11-12`, location: 'Living room, shelf 1', isbn: '9780756404741', coverUrl: ol('9780756404741') },
      { title: 'Tomorrow, and Tomorrow, and Tomorrow', author: 'Gabrielle Zevin', formats: ['ebook', 'audio'], status: 'want', totalPages: 416, audioTotal: '13:52', isbn: '9780593321201', coverUrl: ol('9780593321201') },
      { title: 'A Psalm for the Wild-Built', author: 'Becky Chambers', formats: ['physical'], status: 'want', totalPages: 160, location: 'To-read pile' },
    ].map((b, i) => normalize({ ...b, dateAdded: b.dateStarted || `${y}-01-01`, updatedAt: Date.now() - i * 1000 }));
  }

  /* ---------- Views & events ---------- */
  function setView(v) {
    settings.view = v; saveSettings();
    $$('.tabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.view === v));
    $('#view-library').hidden = v !== 'library';
    $('#view-stats').hidden = v !== 'stats';
    render();
  }
  function render() {
    if (settings.view === 'stats') renderStats(); else renderLibrary();
  }

  $$('.tabs button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  $('.tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const next = settings.view === 'library' ? 'stats' : 'library';
    setView(next); $(`.tabs [data-view="${next}"]`).focus();
  });

  let searchTimer;
  $('#search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderLibrary, 120); });
  $('#statusFilter').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; settings.status = b.dataset.v; saveSettings(); renderLibrary(); });
  $('#layoutToggle').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; settings.layout = b.dataset.v; saveSettings(); renderLibrary(); });
  $('#formatFilter').addEventListener('change', (e) => { settings.format = e.target.value; saveSettings(); renderLibrary(); });
  $('#extraFilter').addEventListener('change', (e) => { settings.extra = e.target.value; saveSettings(); renderLibrary(); });
  $('#sortBy').addEventListener('change', (e) => { settings.sort = e.target.value; settings.desc = !ASC_NATURAL.has(settings.sort); saveSettings(); renderLibrary(); });
  $('#sortDir').addEventListener('click', () => { settings.desc = !settings.desc; saveSettings(); renderLibrary(); });
  $('#statsYear').addEventListener('change', (e) => { settings.statsYear = e.target.value; saveSettings(); renderStats(); });

  $('#bookList').addEventListener('click', (e) => { const c = e.target.closest('.book'); if (c) openBook(c.dataset.id); });
  $('#bookList').addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.book')) { e.preventDefault(); openBook(e.target.dataset.id); } });
  $('#addBtn').addEventListener('click', () => openBook());

  $('#themeBtn').addEventListener('click', () => {
    const dark = settings.theme ? settings.theme === 'dark' : mqDark.matches;
    settings.theme = dark ? 'light' : 'dark';
    saveSettings(); applyTheme();
    if (settings.view === 'stats') renderStats();
  });

  const menu = $('#dataMenu'), menuBtn = $('#menuBtn');
  const closeMenu = () => { menu.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); };
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = menu.hidden; menu.hidden = !open; menuBtn.setAttribute('aria-expanded', String(open));
    if (open) menu.querySelector('button').focus();
  });
  document.addEventListener('click', (e) => { if (!menu.hidden && !e.target.closest('.menu-wrap')) closeMenu(); });

  async function doAction(action) {
    switch (action) {
      case 'export-json': return exportJSON();
      case 'export-csv': return exportCSV();
      case 'import': return $('#importFile').click();
      case 'add': return openBook();
      case 'sample': {
        const s = sampleBooks();
        const keys = new Set(books.map((b) => (b.title + '|' + b.author).toLowerCase()));
        const fresh = s.filter((b) => !keys.has((b.title + '|' + b.author).toLowerCase()));
        books.push(...fresh);
        if (!settings.goals[nowYear()]) settings.goals[nowYear()] = 12;
        saveBooks(); saveSettings(); render();
        return toast(fresh.length ? `Added ${fresh.length} sample books` : 'Samples are already on your shelf');
      }
      case 'clear': {
        if (!books.length) return toast('Nothing to delete.');
        const ok = await ask({ title: 'Delete all books?', body: `<p>This removes all ${books.length} books from this browser. Export a backup first if you might want them back.</p>`, ok: 'Delete all', danger: true });
        if (!ok) return;
        const backup = books; books = []; saveBooks(); render();
        return toast('All books deleted', 'Undo', () => { books = backup; saveBooks(); render(); });
      }
      case 'goal': {
        const y = +$('#goalCard').dataset.year;
        const v = await ask({ title: `${y} reading goal`, body: '<p>How many books do you want to finish? Enter 0 to remove the goal.</p>', ok: 'Save goal', input: { type: 'number', value: settings.goals[y] || '', attrs: 'min="0" max="1000" inputmode="numeric" aria-label="Goal"' } });
        if (v == null) return;
        const n = int(v);
        if (n) settings.goals[y] = n; else delete settings.goals[y];
        saveSettings(); renderStats();
        return;
      }
    }
  }
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    closeMenu();
    doAction(el.dataset.action);
  });
  $('#importFile').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) importFile(f); e.target.value = ''; });

  // Show/hide chart tables
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-toggle-table]'); if (!b) return;
    const t = document.getElementById(b.dataset.toggleTable);
    t.hidden = !t.hidden; b.textContent = t.hidden ? 'Show table' : 'Hide table';
  });

  // Drag & drop import
  document.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
  document.addEventListener('drop', (e) => { const f = e.dataTransfer?.files?.[0]; if (f) { e.preventDefault(); importFile(f); } });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select, dialog') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '/') { e.preventDefault(); setView('library'); $('#search').focus(); }
    else if (e.key === 'n') { e.preventDefault(); openBook(); }
    else if (e.key === 'Escape') closeMenu();
  });
  menu.addEventListener('keydown', (e) => {
    const items = $$('button', menu); const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    if (e.key === 'Escape') { closeMenu(); menuBtn.focus(); }
  });

  // Re-render charts at new width
  let resizeTimer, lastW = innerWidth;
  addEventListener('resize', () => {
    if (innerWidth === lastW) return; lastW = innerWidth;
    clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (settings.view === 'stats') renderStats(); }, 150);
  });
  addEventListener('scroll', hideTip, { passive: true });

  // Sync across tabs
  addEventListener('storage', (e) => { if (e.key === STORE_KEY || e.key === SETTINGS_KEY) { load(); applyTheme(); render(); } });

  /* ---------- Init ---------- */
  load();
  applyTheme();
  setView(settings.view === 'stats' ? 'stats' : 'library');
})();
