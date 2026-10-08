/* Tonal — app UI. Data lives in tonal.db via the local server (tonal.py). */

const T = Theory;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  songs: [],
  playlists: [],
  byId: new Map(),
  lib: { search: '', cam: null, compat: false, mode: '', bpmMin: '', bpmMax: '', halfDouble: false, harm: null, harmKinds: ['same', 'relative', 'neighbor'], complete: false, sort: { col: 'bpm', dir: 1 } },
  selected: new Set(),
  builder: { name: 'Untitled set', ids: [], current: null, editingId: null },
  opts: { strict: 1, window: 6, energy: '', halfDouble: true },
  plView: null,          // null = grid, otherwise playlist id
  plUndo: null,
  wheelSel: { num: 3, letter: 'B' },
  importRows: null,
  importPlaylists: [],
};

/* ================================================================ utilities */

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtBpm = b => b == null ? '—' : (Math.round(b * 10) / 10).toString();
const fmtDur = s => s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '';
const fmtTotal = s => { if (!s) return '—'; const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h} h ${m} min` : `${m} min`; };
function parseDur(v) {
  if (v == null || v === '') return null;
  const m = String(v).trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (m) return (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]);
  const n = parseFloat(v);
  return isNaN(n) ? null : Math.round(n);
}
const numOrNull = (v, lo, hi, int) => {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace(/bpm/i, ''));
  if (isNaN(n) || (lo != null && n < lo) || (hi != null && n > hi)) return null;
  return int ? Math.round(n) : Math.round(n * 100) / 100;
};
const normKey = (t, a) => `${(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${(a || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
};

function camOf(s) { return T.hasKey(s) ? T.camelot(s.tonic, s.mode) : null; }

function keyChip(s, { short = false, clickable = false } = {}) {
  if (!T.hasKey(s)) return `<span class="keychip none"><span class="cam">?</span>${short ? '' : '<span class="kname">No key</span>'}</span>`;
  const c = T.camelot(s.tonic, s.mode);
  const attrs = clickable ? ` role="button" tabindex="0" title="Filter library by ${c.code}" data-filter-cam="${c.num}${c.letter}" style="--hue:var(--c${c.num});cursor:pointer"` : ` style="--hue:var(--c${c.num})"`;
  return `<span class="keychip"${attrs}><span class="cam">${c.code}</span>${short ? '' : `<span class="kname">${esc(T.keyName(s.tonic, s.mode))}</span>`}</span>`;
}
const relBadge = key => `<span class="badge ${key.cls}" title="${esc(key.detail)}">${esc(key.label)}</span>`;
function tempoBadge(t, target) {
  if (!t.known) return `<span class="tempo-badge">BPM unknown</span>`;
  const warn = Math.abs(t.pct) > 6;
  return `<span class="tempo-badge${warn ? ' warn' : ''}" title="Stretch needed to play at ${fmtBpm(target)} BPM. Pitch shift without key lock: ${t.semitones >= 0 ? '+' : ''}${t.semitones.toFixed(2)} semitones">${esc(t.label)}${t.keyLock ? ' · use key lock' : ''}</span>`;
}
const stars = r => r ? `<span class="stars" title="${r} of 5">${'★'.repeat(r)}<span class="off">${'★'.repeat(5 - r)}</span></span>` : '';
const energyBars = e => e ? `<span class="energy" title="Energy ${e} of 5">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= e ? 'on' : ''}"></i>`).join('')}</span>` : '';
// Accidentals render from the sans font so they sit tight against serif letters.
const serifAcc = name => esc(name).replace(/([♭♯])/g, '<span class="acc">$1</span>');
const gradeColor = g => ({ great: 'var(--olive)', good: 'var(--spruce)', ok: 'var(--mustard)', rough: 'var(--burgundy)' })[g];

let toastTimer;
function toast(msg, action) {
  const el = $('#toast');
  el.innerHTML = esc(msg) + (action ? ` <button class="btn btn-sm" style="margin-left:10px" id="toast-act">${esc(action.label)}</button>` : '');
  el.style.pointerEvents = action ? 'auto' : 'none';
  if (action) $('#toast-act').onclick = () => { action.fn(); el.classList.remove('show'); };
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 6000 : 2600);
}

function openModal(html, onMount) {
  $('#modal').innerHTML = html;
  $('#backdrop').classList.add('open');
  onMount?.($('#modal'));
  setTimeout(() => $('#modal [autofocus]')?.focus(), 20);
}
function closeModal() { $('#backdrop').classList.remove('open'); $('#modal').innerHTML = ''; tap.active = false; }
$('#backdrop').addEventListener('mousedown', e => { if (e.target.id === 'backdrop') closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#backdrop').classList.contains('open')) closeModal(); });

function confirmModal(title, body, okLabel, onOk, danger = true) {
  openModal(`<h3>${esc(title)}</h3><p class="dim">${body}</p>
    <div class="modal-actions"><button class="btn" data-close>Cancel</button>
    <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="cm-ok" autofocus>${esc(okLabel)}</button></div>`, m => {
    $('[data-close]', m).onclick = closeModal;
    $('#cm-ok', m).onclick = async () => { closeModal(); await onOk(); };
  });
}

/* ================================================================ server */

function setSave(status, text) {
  const p = $('#save-pill');
  p.className = 'save-pill' + (status === 'busy' ? ' busy' : status === 'error' ? ' error' : '');
  $('#save-text').textContent = text;
}

async function api(method, path, body) {
  setSave('busy', 'Saving…');
  try {
    const res = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    setSave('ok', 'Saved to tonal.db');
    return data;
  } catch (e) {
    setSave('error', 'Not saved — is Tonal running?');
    toast(`Couldn't save: ${e.message}`);
    throw e;
  }
}

function setSongs(songs) {
  state.songs = songs;
  state.byId = new Map(songs.map(s => [s.id, s]));
  for (const id of [...state.selected]) if (!state.byId.has(id)) state.selected.delete(id);
  state.builder.ids = state.builder.ids.filter(id => state.byId.has(id));
  if (state.builder.current && !state.byId.has(state.builder.current)) state.builder.current = state.builder.ids.at(-1) ?? null;
}
function setPlaylists(pls) { state.playlists = pls; }

function renderAll() {
  renderStats();
  renderLibrary();
  renderBuilder();
  renderPlaylists();
  renderWheel();
}

function renderStats() {
  $('#stat-songs').textContent = state.songs.length;
  $('#stat-sets').textContent = state.playlists.length;
  $('#stat-keys').textContent = new Set(state.songs.filter(T.hasKey).map(s => `${s.tonic}-${s.mode}`)).size;
  $('#tab-pl-count').textContent = state.playlists.length ? `(${state.playlists.length})` : '';
}

/* ================================================================ tabs & theme */

function switchTab(name) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  $$('.panel').forEach(p => p.classList.toggle('active', p.id === `panel-${name}`));
  store.set('tonal:tab', name);
  if (name === 'builder') renderBuilder();
}
$$('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));

function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  $('#theme-btn').textContent = t === 'light' ? 'Dark theme' : 'Light theme';
  try { localStorage.setItem('tonal:theme', t); } catch (e) {}
}
$('#theme-btn').onclick = () => applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');

/* ================================================================ tap tempo */

const tap = { times: [], active: false, onUse: null };
function openTap(onUse) {
  tap.times = []; tap.active = true; tap.onUse = onUse;
  openModal(`<h3>Tap tempo</h3>
    <div class="tap-display" id="tap-bpm">—</div>
    <div class="muted" style="text-align:center" id="tap-info">Tap along to the beat — click the pad or press Space</div>
    <button class="btn tap-pad" id="tap-pad">Tap</button>
    <div class="modal-actions"><button class="btn" id="tap-reset">Reset</button><button class="btn" data-close>Cancel</button>
    <button class="btn btn-primary" id="tap-use" disabled>Use this BPM</button></div>`, m => {
    $('#tap-pad', m).onclick = e => { registerTap(); e.currentTarget.blur(); };
    $('#tap-reset', m).onclick = () => { tap.times = []; $('#tap-bpm').textContent = '—'; $('#tap-use').disabled = true; $('#tap-info').textContent = 'Ready'; };
    $('[data-close]', m).onclick = closeModal;
    $('#tap-use', m).onclick = () => { const v = $('#tap-bpm').textContent; closeModal(); tap.onUse?.(v); };
  });
}
function registerTap() {
  const t = performance.now();
  if (tap.times.length && t - tap.times.at(-1) > 2000) tap.times = [];
  tap.times.push(t);
  if (tap.times.length > 12) tap.times.shift();
  if (tap.times.length > 1) {
    const iv = (tap.times.at(-1) - tap.times[0]) / (tap.times.length - 1);
    $('#tap-bpm').textContent = Math.round(60000 / iv);
    $('#tap-info').textContent = `${tap.times.length} taps`;
    $('#tap-use').disabled = tap.times.length < 4;
  } else $('#tap-info').textContent = 'Keep tapping…';
}
document.addEventListener('keydown', e => {
  if (tap.active && e.code === 'Space') { e.preventDefault(); registerTap(); }
});

/* ================================================================ library: quick add */

const qa = id => $(`#qa-${id}`);
function updateKeyPreview(input, out) {
  const v = input.value.trim();
  if (!v) { out.className = 'key-preview'; out.textContent = 'Any format: Am, F♯m, E♭ dorian, 3B'; return null; }
  const k = T.parseKey(v);
  if (!k) { out.className = 'key-preview bad'; out.textContent = 'Not recognised yet — try e.g. Bbm or Ab mixolydian'; return null; }
  const c = T.camelot(k.tonic, k.mode);
  out.className = 'key-preview ok';
  out.textContent = `→ ${T.keyName(k.tonic, k.mode)} · Camelot ${c.code}`;
  return k;
}
qa('key').addEventListener('input', () => updateKeyPreview(qa('key'), $('#qa-key-preview')));
qa('more-btn').onclick = () => {
  const open = $('#qa-more').classList.toggle('hidden');
  qa('more-btn').textContent = open ? 'More fields' : 'Fewer fields';
};
qa('tap').onclick = () => openTap(v => { qa('bpm').value = v; qa('key').focus(); });

$('#qa-form').addEventListener('submit', async e => {
  e.preventDefault();
  const keyText = qa('key').value.trim();
  const k = keyText ? T.parseKey(keyText) : null;
  if (keyText && !k) { toast('That key wasn\'t recognised — fix it or leave it blank'); qa('key').focus(); return; }
  const song = {
    title: qa('title').value.trim(), artist: qa('artist').value.trim(),
    bpm: numOrNull(qa('bpm').value, 30, 300),
    tonic: k?.tonic ?? null, mode: k?.mode ?? null,
    energy: numOrNull(qa('energy').value, 1, 5, true), rating: numOrNull(qa('rating').value, 1, 5, true),
    duration: parseDur(qa('duration').value), tags: qa('tags').value.trim(), notes: qa('notes').value.trim(),
  };
  if (!song.title) return;
  const r = await api('POST', '/api/songs', { songs: [song] });
  setSongs(r.songs);
  if (r.added) {
    toast(`Added “${song.title}”`);
    ['title', 'artist', 'bpm', 'key', 'energy', 'rating', 'duration', 'tags', 'notes'].forEach(f => qa(f).value = '');
    updateKeyPreview(qa('key'), $('#qa-key-preview'));
  } else toast(`“${song.title}” by ${song.artist || 'unknown'} is already in your library`);
  qa('title').focus();
  renderAll();
});

/* ================================================================ library: filters & table */

Theory.MODES.forEach(m => $('#lib-mode').insertAdjacentHTML('beforeend', `<option value="${m.id}">${m.name}</option>`));
$('#lib-search').addEventListener('input', e => { state.lib.search = e.target.value; renderLibrary(); });
$('#lib-mode').addEventListener('change', e => { state.lib.mode = e.target.value; renderLibrary(); });
$('#lib-bpm-min').addEventListener('input', e => { state.lib.bpmMin = e.target.value; renderLibrary(); });
$('#lib-bpm-max').addEventListener('input', e => { state.lib.bpmMax = e.target.value; renderLibrary(); });
$('#lib-halfdouble').addEventListener('change', e => { state.lib.halfDouble = e.target.checked; renderLibrary(); });
$('#lib-complete').addEventListener('change', e => { state.lib.complete = e.target.checked; renderLibrary(); });
$('#lib-harm').addEventListener('change', e => {
  const [t, m] = e.target.value.split('-');
  setHarm(e.target.value ? { tonic: +t, mode: m } : null);
});
$('#lib-clear').onclick = () => {
  Object.assign(state.lib, { search: '', cam: null, compat: false, mode: '', bpmMin: '', bpmMax: '', halfDouble: false, harm: null, complete: false });
  if (state.lib.sort.col === 'match') state.lib.sort = { col: 'bpm', dir: 1 };
  $('#lib-search').value = ''; $('#lib-mode').value = ''; $('#lib-bpm-min').value = ''; $('#lib-bpm-max').value = ''; $('#lib-halfdouble').checked = false; $('#lib-complete').checked = false;
  renderLibrary();
};

/* ---------- harmonic match: pick a key, see which keys blend with it ---------- */

const HARM_GROUPS = [
  { kind: 'same',     title: 'Same key',            hint: 'Mix anywhere' },
  { kind: 'relative', title: 'Shared scale',        hint: 'Same 7 notes, different mode — seamless' },
  { kind: 'neighbor', title: 'Neighbors ±1',        hint: 'One note changes — the classic Camelot move' },
  { kind: 'parallel', title: 'Same root',           hint: 'Major ↔ minor-type swap on the same tonic — a mood flip' },
  { kind: 'twostep',  title: 'Two steps',           hint: 'Two notes change — bolder, best over a breakdown' },
  { kind: 'lift',     title: 'Key lift',            hint: 'Up a semitone — an energy-boosting key change' },
];
const keyId = k => `${k.tonic}-${k.mode}`;

function setHarm(k) {
  const L = state.lib;
  L.harm = k;
  if (k) { L.cam = null; L.compat = false; if (L.sort.col !== 'match') L.sort = { col: 'match', dir: -1 }; }
  else if (L.sort.col === 'match') L.sort = { col: 'bpm', dir: 1 };
  switchTab('library');
  renderLibrary();
}

function keyCounts() {
  const counts = new Map();
  state.songs.forEach(s => { if (T.hasKey(s)) counts.set(keyId(s), (counts.get(keyId(s)) || 0) + 1); });
  return counts;
}

function renderHarmSelect(counts) {
  const sel = $('#lib-harm');
  const used = [...counts.keys()].map(id => { const [t, m] = id.split('-'); return { tonic: +t, mode: m }; })
    .sort((a, b) => { const ca = T.camelot(a.tonic, a.mode), cb = T.camelot(b.tonic, b.mode); return ca.num - cb.num || ca.letter.localeCompare(cb.letter); });
  const opt = k => { const c = T.camelot(k.tonic, k.mode), n = counts.get(keyId(k)); return `<option value="${keyId(k)}">${c.code} · ${esc(T.keyName(k.tonic, k.mode))}${n ? ` (${n})` : ''}</option>`; };
  let all = '';
  for (let num = 1; num <= 12; num++) all += `<optgroup label="${num}A / ${num}B">${T.family(num).map(opt).join('')}</optgroup>`;
  sel.innerHTML = `<option value="">Blend with key…</option>${used.length ? `<optgroup label="Keys in your library">${used.map(opt).join('')}</optgroup>` : ''}${all}`;
  sel.value = state.lib.harm ? keyId(state.lib.harm) : '';
}

function renderHarmPanel(counts) {
  const L = state.lib, panel = $('#lib-harm-panel');
  if (!L.harm) { panel.innerHTML = ''; return; }
  const groups = Object.fromEntries(HARM_GROUPS.map(g => [g.kind, []]));
  for (let tonic = 0; tonic < 12; tonic++) for (const m of T.MODES) {
    const k = { tonic, mode: m.id };
    const rel = T.keyRelation(L.harm, k);
    if (groups[rel.kind]) groups[rel.kind].push({ ...k, rel, n: counts.get(keyId(k)) || 0 });
  }
  const chip = k => k.n
    ? `<button class="harm-key" data-key="${keyId(k)}" title="${esc(k.rel.detail)} — click to blend from this key instead">${keyChip(k)}<span class="n">${k.n}</span></button>`
    : `<button class="harm-key nosongs" data-key="${keyId(k)}" title="${esc(k.rel.detail)} — no songs in this key yet">${esc(T.keyName(k.tonic, k.mode))}</button>`;
  panel.innerHTML = `<div class="card harm-panel">
    <div class="harm-head">
      <div><div class="section-title" style="margin:0">Blends with ${keyChip(L.harm)}</div>
        <div class="hint">Tick the kinds of moves to include. Click any key to blend from it instead.</div></div>
      <button class="btn btn-ghost btn-sm" id="harm-x">Remove key match ✕</button>
    </div>
    ${HARM_GROUPS.filter(g => groups[g.kind].length).map(g => {
      const ks = groups[g.kind].sort((a, b) => b.n - a.n);
      const songs = ks.reduce((t, k) => t + k.n, 0);
      return `<div class="harm-group">
        <label class="check"><input type="checkbox" data-kind="${g.kind}" ${L.harmKinds.includes(g.kind) ? 'checked' : ''}>
          <span class="badge ${T.RELATIONS[g.kind].cls}">${g.title}</span></label>
        <div><div class="hint" style="margin:0 0 6px">${g.hint} · ${songs} song${songs === 1 ? '' : 's'}</div>
          <div class="harm-keys">${ks.map(chip).join('')}</div></div>
      </div>`;
    }).join('')}
  </div>`;
  $('#harm-x').onclick = () => setHarm(null);
  $$('#lib-harm-panel [data-kind]').forEach(cb => cb.onchange = () => {
    L.harmKinds = $$('#lib-harm-panel [data-kind]').filter(c => c.checked).map(c => c.dataset.kind);
    renderLibrary();
  });
  $$('#lib-harm-panel .harm-key').forEach(b => b.onclick = () => { const [t, m] = b.dataset.key.split('-'); setHarm({ tonic: +t, mode: m }); });
}

function setCamFilter(num, letter, mode = '') {
  state.lib.cam = { num, letter };
  state.lib.harm = null;
  if (state.lib.sort.col === 'match') state.lib.sort = { col: 'bpm', dir: 1 };
  state.lib.mode = mode;
  $('#lib-mode').value = mode;
  switchTab('library');
  renderLibrary();
}

function filteredSongs() {
  const L = state.lib;
  const q = L.search.trim().toLowerCase();
  const lo = parseFloat(L.bpmMin), hi = parseFloat(L.bpmMax);
  const inRange = b => (isNaN(lo) || b >= lo) && (isNaN(hi) || b <= hi);
  const list = state.songs.filter(s => {
    if (q && !`${s.title} ${s.artist} ${s.tags} ${s.notes} ${T.hasKey(s) ? T.keyName(s.tonic, s.mode) : ''}`.toLowerCase().includes(q)) return false;
    if (L.mode && s.mode !== L.mode) return false;
    if (L.complete && (s.bpm == null || !T.hasKey(s))) return false;
    if (L.harm && !L.harmKinds.includes(T.keyRelation(L.harm, s).kind)) return false;
    if (L.cam) {
      const c = camOf(s);
      if (!c) return false;
      const dist = Math.min((c.num - L.cam.num + 12) % 12, (L.cam.num - c.num + 12) % 12);
      if (L.compat ? dist > 1 : (c.num !== L.cam.num || (L.cam.letter && c.letter !== L.cam.letter))) return false;
    }
    if (!isNaN(lo) || !isNaN(hi)) {
      if (s.bpm == null) return false;
      if (!(inRange(s.bpm) || (L.halfDouble && (inRange(s.bpm * 2) || inRange(s.bpm / 2))))) return false;
    }
    return true;
  });
  const { col, dir } = L.sort;
  const val = s => {
    if (col === 'match') return L.harm ? T.keyRelation(L.harm, s).score : 0;
    if (col === 'key') { const c = camOf(s); return c ? c.num * 2 + (c.letter === 'B' ? 1 : 0) : 99; }
    if (col === 'title' || col === 'artist') return (s[col] || '').toLowerCase();
    if (col === 'added') return s.created_at || '';
    return s[col] ?? -1;
  };
  return list.sort((a, b) => { const x = val(a), y = val(b); return x < y ? -dir : x > y ? dir : 0; });
}

function renderLibrary() {
  const L = state.lib;
  const chip = $('#lib-key-chip');
  if (L.cam) {
    const k = T.camelotToKey(L.cam.num, L.cam.letter || 'B');
    chip.innerHTML = `<span class="filter-chip">${keyChip({ tonic: k.tonic, mode: L.cam.letter === 'A' ? 'minor' : 'major' }, { short: true })}
      <span>${L.cam.letter ? `${L.cam.num}${L.cam.letter}` : `${L.cam.num}A + ${L.cam.num}B`}</span>
      <label class="check" style="font-size:13px"><input type="checkbox" id="lib-compat" ${L.compat ? 'checked' : ''}> + neighbors</label>
      <button title="Remove key filter" id="lib-cam-x">✕</button></span>`;
    $('#lib-compat').onchange = e => { L.compat = e.target.checked; renderLibrary(); };
    $('#lib-cam-x').onclick = () => { L.cam = null; L.compat = false; renderLibrary(); };
  } else chip.innerHTML = '';
  const counts = keyCounts();
  renderHarmSelect(counts);
  renderHarmPanel(counts);

  const list = filteredSongs();
  $('#lib-count').textContent = `${list.length} of ${state.songs.length} songs`;
  if (!state.songs.length) {
    $('#lib-table').innerHTML = `<div class="empty">Your library is empty. Add a song above, or batch-import on the Import tab.</div>`;
    return renderBulk();
  }
  if (!list.length) { $('#lib-table').innerHTML = `<div class="empty">No songs match these filters.</div>`; return renderBulk(); }

  const th = (col, label, cls = '') => {
    const ind = L.sort.col === col ? `<span class="ind">${L.sort.dir > 0 ? ' ▲' : ' ▼'}</span>` : '';
    return `<th class="sortable ${cls}" data-sort="${col}">${label}${ind}</th>`;
  };
  const allSel = list.every(s => state.selected.has(s.id));
  $('#lib-table').innerHTML = `<table class="songs"><thead><tr>
      <th style="width:36px"><input type="checkbox" id="sel-all" title="Select all shown" ${allSel ? 'checked' : ''}></th>
      ${th('title', 'Title')}${th('artist', 'Artist')}${th('bpm', 'BPM')}${th('key', 'Key')}${L.harm ? th('match', 'Match') : ''}
      ${th('energy', 'Energy', 'hide-sm')}${th('rating', 'Rating', 'hide-sm')}<th class="hide-sm">Tags &amp; notes</th><th></th>
    </tr></thead><tbody>
    ${list.map(s => `<tr data-id="${s.id}" class="${state.selected.has(s.id) ? 'selected' : ''}">
      <td><input type="checkbox" class="sel" ${state.selected.has(s.id) ? 'checked' : ''} aria-label="Select ${esc(s.title)}"></td>
      <td class="t-title">${esc(s.title)}</td>
      <td class="t-artist">${esc(s.artist)}</td>
      <td class="t-bpm">${fmtBpm(s.bpm)}</td>
      <td>${keyChip(s, { clickable: true })}</td>
      ${L.harm ? `<td>${relBadge(T.keyRelation(L.harm, s))}</td>` : ''}
      <td class="hide-sm">${energyBars(s.energy)}</td>
      <td class="hide-sm">${stars(s.rating)}</td>
      <td class="hide-sm"><div class="t-notes" title="${esc(s.notes)}">${s.tags ? s.tags.split(',').filter(t => t.trim()).map(t => `<span class="tag">${esc(t.trim())}</span>`).join('') : ''}${esc(s.notes)}</div></td>
      <td class="t-actions">
        <button class="btn btn-sm" data-act="mix" title="Find songs that mix well after this one">Mix from</button>
        <button class="icon-btn" data-act="set" title="Add to current set">＋</button>
        <button class="icon-btn" data-act="edit" title="Edit">✎</button>
        <button class="icon-btn danger" data-act="del" title="Delete">🗑</button>
      </td></tr>`).join('')}
    </tbody></table>`;

  $$('#lib-table th.sortable').forEach(h => h.onclick = () => {
    const col = h.dataset.sort;
    L.sort = { col, dir: L.sort.col === col ? -L.sort.dir : (['rating', 'energy', 'added'].includes(col) ? -1 : 1) };
    renderLibrary();
  });
  $('#sel-all').onchange = e => { list.forEach(s => e.target.checked ? state.selected.add(s.id) : state.selected.delete(s.id)); renderLibrary(); };
  renderBulk();
}

$('#lib-table').addEventListener('click', e => {
  const camEl = e.target.closest('[data-filter-cam]');
  if (camEl) { const v = camEl.dataset.filterCam; return setCamFilter(parseInt(v), v.slice(-1)); }
  const tr = e.target.closest('tr[data-id]');
  if (!tr) return;
  const id = +tr.dataset.id;
  if (e.target.classList.contains('sel')) {
    e.target.checked ? state.selected.add(id) : state.selected.delete(id);
    tr.classList.toggle('selected', e.target.checked);
    return renderBulk();
  }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'mix') { state.builder.current = id; saveBuilder(); switchTab('builder'); }
  if (act === 'set') addToSet(id);
  if (act === 'edit') editSong(id);
  if (act === 'del') deleteSongs([id]);
});
$('#lib-table').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.dataset.filterCam) e.target.click();
});

function renderBulk() {
  const n = state.selected.size;
  $('#bulk-bar').classList.toggle('hidden', !n);
  $('#bulk-count').textContent = `${n} selected`;
}
$('#bulk-clear').onclick = () => { state.selected.clear(); renderLibrary(); };
$('#bulk-delete').onclick = () => deleteSongs([...state.selected]);
$('#bulk-to-set').onclick = () => { [...state.selected].forEach(id => addToSet(id, true)); toast(`Added ${state.selected.size} songs to the set`); };
$('#bulk-new-pl').onclick = () => namePrompt('New playlist', 'New set', async name => {
  const r = await api('POST', '/api/playlists', { name, song_ids: [...state.selected] });
  setPlaylists(r.playlists); state.selected.clear(); renderAll();
  toast(`Created “${name}”`, { label: 'Open', fn: () => openPlaylist(r.id) });
});
$('#bulk-to-pl').onclick = () => {
  if (!state.playlists.length) return toast('No playlists yet — create one first');
  openModal(`<h3>Add ${state.selected.size} songs to…</h3>
    <div class="picker" style="max-height:340px">${state.playlists.map(p => `<div class="picker-row" data-pl="${p.id}"><span class="pt">${esc(p.name)}</span><span class="pa">${p.song_ids.length} songs</span></div>`).join('')}</div>
    <div class="modal-actions"><button class="btn" data-close>Cancel</button></div>`, m => {
    $('[data-close]', m).onclick = closeModal;
    $$('[data-pl]', m).forEach(row => row.onclick = async () => {
      const pl = state.playlists.find(p => p.id === +row.dataset.pl);
      const ids = [...pl.song_ids, ...[...state.selected].filter(id => !pl.song_ids.includes(id))];
      const r = await api('PUT', `/api/playlists/${pl.id}`, { song_ids: ids });
      setPlaylists(r.playlists); state.selected.clear(); closeModal(); renderAll();
      toast(`Added to “${pl.name}”`);
    });
  });
};

function deleteSongs(ids) {
  const what = ids.length === 1 ? `“${esc(state.byId.get(ids[0])?.title)}”` : `${ids.length} songs`;
  confirmModal('Delete from library?', `${what} will be removed from your library and from any playlists. A daily backup is kept in the backups folder.`, 'Delete', async () => {
    await api('POST', '/api/songs/delete', { ids });
    const r = await fetch('/api/state').then(r => r.json());
    setSongs(r.songs); setPlaylists(r.playlists);
    ids.forEach(id => state.selected.delete(id));
    renderAll();
    toast(`Deleted ${ids.length === 1 ? 'song' : ids.length + ' songs'}`);
  });
}

function namePrompt(title, initial, onOk) {
  openModal(`<h3>${esc(title)}</h3><form id="np-form"><input id="np-input" value="${esc(initial)}" autofocus>
    <div class="modal-actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn btn-primary">Save</button></div></form>`, m => {
    $('[data-close]', m).onclick = closeModal;
    const inp = $('#np-input', m); setTimeout(() => inp.select(), 30);
    $('#np-form', m).onsubmit = e => { e.preventDefault(); const v = inp.value.trim(); if (!v) return; closeModal(); onOk(v); };
  });
}

/* ---------- edit song ---------- */

function editSong(id) {
  const s = state.byId.get(id);
  if (!s) return;
  openModal(`<h3>Edit song</h3><form id="ed-form" autocomplete="off">
    <div class="row"><label class="field">Title</label><input id="ed-title" value="${esc(s.title)}" required autofocus></div>
    <div class="row"><label class="field">Artist</label><input id="ed-artist" value="${esc(s.artist)}"></div>
    <div class="grid2 row">
      <div><label class="field">BPM</label><div class="bpm-wrap"><input id="ed-bpm" class="num" type="number" step="0.1" min="30" max="300" value="${s.bpm ?? ''}"><button type="button" class="btn btn-sm" id="ed-tap">Tap</button></div></div>
      <div><label class="field">Key</label><input id="ed-key" value="${T.hasKey(s) ? esc(T.keyName(s.tonic, s.mode)) : ''}"><div class="key-preview" id="ed-key-preview"></div></div>
    </div>
    <div class="grid3 row">
      <div><label class="field">Energy 1–5</label><input id="ed-energy" type="number" min="1" max="5" value="${s.energy ?? ''}"></div>
      <div><label class="field">Rating 1–5</label><input id="ed-rating" type="number" min="1" max="5" value="${s.rating ?? ''}"></div>
      <div><label class="field">Length</label><input id="ed-duration" value="${fmtDur(s.duration)}" placeholder="4:32"></div>
    </div>
    <div class="row"><label class="field">Tags</label><input id="ed-tags" value="${esc(s.tags)}" placeholder="comma, separated"></div>
    <div class="row"><label class="field">Notes</label><textarea id="ed-notes" rows="3" style="font-family:var(--sans);font-size:15px">${esc(s.notes)}</textarea></div>
    ${T.hasKey(s) ? `<p class="hint">Key reference: <a href="${T.hooktheoryUrl(s.tonic, s.mode)}" target="_blank" rel="noopener">${esc(T.keyName(s.tonic, s.mode))} on Hooktheory ↗</a></p>` : ''}
    <div class="modal-actions"><button type="button" class="btn btn-danger" id="ed-del" style="margin-right:auto">Delete</button>
      <button type="button" class="btn" data-close>Cancel</button><button class="btn btn-primary">Save changes</button></div></form>`, m => {
    const kp = () => updateKeyPreview($('#ed-key', m), $('#ed-key-preview', m));
    kp(); $('#ed-key', m).oninput = kp;
    inlineTap($('#ed-tap', m), $('#ed-bpm', m));
    $('[data-close]', m).onclick = closeModal;
    $('#ed-del', m).onclick = () => { closeModal(); deleteSongs([id]); };
    $('#ed-form', m).onsubmit = async e => {
      e.preventDefault();
      const keyText = $('#ed-key', m).value.trim();
      const k = keyText ? T.parseKey(keyText) : null;
      if (keyText && !k) return toast('That key wasn\'t recognised');
      const body = {
        title: $('#ed-title', m).value.trim(), artist: $('#ed-artist', m).value.trim(),
        bpm: numOrNull($('#ed-bpm', m).value, 30, 300), tonic: k?.tonic ?? null, mode: k?.mode ?? null,
        energy: numOrNull($('#ed-energy', m).value, 1, 5, true), rating: numOrNull($('#ed-rating', m).value, 1, 5, true),
        duration: parseDur($('#ed-duration', m).value), tags: $('#ed-tags', m).value.trim(), notes: $('#ed-notes', m).value.trim(),
      };
      const r = await api('PUT', `/api/songs/${id}`, body);
      Object.assign(s, r.song);
      closeModal(); renderAll(); toast('Saved');
    };
  });
}
// Tap button that writes the tempo straight into a field (used inside dialogs).
function inlineTap(btn, input) {
  let times = [];
  btn.title = 'Click along to the beat — the BPM fills in as you tap';
  btn.onclick = () => {
    const t = performance.now();
    if (times.length && t - times.at(-1) > 2000) times = [];
    times.push(t);
    if (times.length > 12) times.shift();
    if (times.length > 1) input.value = Math.round(60000 / ((times.at(-1) - times[0]) / (times.length - 1)));
    btn.textContent = `Tap ${times.length}`;
  };
}

/* ================================================================ mix builder */

function saveBuilder() { store.set('tonal:builder', state.builder); }
function setOpts() { store.set('tonal:opts', state.opts); }

function addToSet(id, quiet) {
  const b = state.builder;
  if (b.ids.includes(id)) { if (!quiet) toast('Already in the set'); return; }
  const at = b.current != null && b.ids.includes(b.current) ? b.ids.indexOf(b.current) + 1 : b.ids.length;
  b.ids.splice(at, 0, id);
  b.current = id;
  saveBuilder();
  renderBuilder();
  if (!quiet) toast(`Added “${state.byId.get(id).title}” to the set`);
}

const STRICT_HINTS = [
  'Same key or relative modes only — the same seven notes.',
  'Adds ±1 on the Camelot wheel — the DJ standard.',
  'Adds parallel keys, ±2 steps and key-change lifts.',
];

function bindSeg(id, key, cast = v => v) {
  $$(`#${id} button`).forEach(btn => btn.onclick = () => {
    state.opts[key] = cast(btn.dataset.v);
    setOpts(); renderBuilder();
  });
}
bindSeg('opt-strict', 'strict', Number);
bindSeg('opt-window', 'window', Number);
bindSeg('opt-energy', 'energy');
$('#opt-halfdouble').onchange = e => { state.opts.halfDouble = e.target.checked; setOpts(); renderBuilder(); };
$('#picker-search').addEventListener('input', renderPicker);

function renderBuilder() {
  const b = state.builder, o = state.opts;
  $$('#opt-strict button').forEach(x => x.classList.toggle('active', +x.dataset.v === o.strict));
  $$('#opt-window button').forEach(x => x.classList.toggle('active', +x.dataset.v === o.window));
  $$('#opt-energy button').forEach(x => x.classList.toggle('active', x.dataset.v === o.energy));
  $('#opt-halfdouble').checked = o.halfDouble;
  $('#strict-hint').textContent = STRICT_HINTS[o.strict];

  // Set chain
  const songs = b.ids.map(id => state.byId.get(id)).filter(Boolean);
  const editing = b.editingId && state.playlists.some(p => p.id === b.editingId);
  $('#set-name').textContent = b.name;
  $('#set-save').textContent = editing ? 'Update playlist' : 'Save as playlist';
  const total = songs.reduce((a, s) => a + (s.duration || 0), 0);
  const scores = songs.slice(1).map((s, i) => T.transition(songs[i], s, o).score);
  $('#set-meta').textContent = songs.length
    ? `${songs.length} songs${total ? ' · ' + fmtTotal(total) : ''}${scores.length ? ` · average flow ${Math.round(scores.reduce((a, x) => a + x, 0) / scores.length)}` : ''}`
    : 'Pick a starting song, then add suggestions one by one.';
  $('#set-chain').innerHTML = songs.length ? songs.map((s, i) => {
    const link = i ? (() => { const t = T.transition(songs[i - 1], s, o); return `<div class="chain-link" title="${esc(t.key.label)} · ${esc(t.tempo.label)} · flow ${t.score}"><span style="border-color:${gradeColor(t.grade)}"></span></div>`; })() : '';
    return `${link}<div class="chain-item ${s.id === b.current ? 'current' : ''}" data-id="${s.id}">
      <button class="icon-btn x" data-x="${s.id}" title="Remove from set">✕</button>
      <div class="ci-t">${esc(s.title)}</div><div class="ci-a">${esc(s.artist)}</div>
      <div style="display:flex;justify-content:space-between;align-items:center">${keyChip(s, { short: true })}<span class="t-bpm">${fmtBpm(s.bpm)}</span></div></div>`;
  }).join('') : `<div class="muted">The set is empty.</div>`;
  $$('#set-chain .chain-item').forEach(el => el.onclick = e => {
    const x = e.target.closest('[data-x]');
    if (x) { b.ids = b.ids.filter(id => id !== +x.dataset.x); if (b.current === +x.dataset.x) b.current = b.ids.at(-1) ?? null; }
    else b.current = +el.dataset.id;
    saveBuilder(); renderBuilder();
  });

  // Now playing
  const cur = state.byId.get(b.current);
  $('#now-card').innerHTML = cur ? `
    <div class="np-title">${esc(cur.title)}</div><div class="np-artist">${esc(cur.artist)}</div>
    <div class="np-meta">
      <div>BPM<strong class="num">${fmtBpm(cur.bpm)}</strong></div>
      <div>Camelot<strong>${camOf(cur)?.code ?? '—'}</strong></div>
      <div>Energy<strong>${cur.energy ?? '—'}</strong></div>
    </div>
    <div style="margin-top:12px">${keyChip(cur)}</div>
    ${b.ids.includes(cur.id) ? '' : `<button class="btn btn-primary btn-sm" style="margin-top:14px" id="np-add">Add to set</button>`}`
    : `<div class="empty" style="padding:24px 0;font-size:17px">Choose a song below to start.</div>`;
  $('#np-add')?.addEventListener('click', () => addToSet(cur.id));

  renderPicker();
  renderSuggestions(cur);
}

function renderPicker() {
  const q = $('#picker-search').value.trim().toLowerCase();
  const list = state.songs.filter(s => !q || `${s.title} ${s.artist}`.toLowerCase().includes(q)).slice(0, 200);
  $('#picker').innerHTML = list.map(s => `<div class="picker-row" data-id="${s.id}">
      <div style="min-width:0"><div class="pt">${esc(s.title)}</div><div class="pa">${esc(s.artist)}</div></div>
      <div style="display:flex;gap:10px;align-items:center;flex:none"><span class="t-bpm">${fmtBpm(s.bpm)}</span>${keyChip(s, { short: true })}</div></div>`).join('')
    || '<div class="muted" style="padding:12px">No matches</div>';
  $$('#picker .picker-row').forEach(r => r.onclick = () => { state.builder.current = +r.dataset.id; saveBuilder(); renderBuilder(); });
}

function renderSuggestions(cur) {
  const box = $('#suggest');
  if (!cur) { $('#sug-title').textContent = 'Best next songs'; box.innerHTML = `<div class="empty">Suggestions appear once you pick a song.</div>`; return; }
  const o = state.opts, inSet = new Set(state.builder.ids);
  const scored = state.songs.filter(s => s.id !== cur.id && !inSet.has(s.id)).map(s => ({ s, t: T.transition(cur, s, o) }));
  const ok = scored.filter(({ t }) => t.key.tier <= o.strict && (!t.tempo.known || Math.abs(t.tempo.pct) <= o.window))
    .sort((a, b) => b.t.score - a.t.score);
  $('#sug-title').textContent = `Best next songs after “${cur.title}” — ${ok.length} match${ok.length === 1 ? '' : 'es'}`;
  if (!ok.length) {
    box.innerHTML = `<div class="empty">Nothing fits these rules. Try a wider tempo window, Adventurous keys, or allow half/double time.</div>`;
    return;
  }
  box.innerHTML = ok.slice(0, 60).map(({ s, t }) => `<div class="sug" data-id="${s.id}">
    <div class="score grade-${t.grade}" title="Flow score: key ${t.key.score} · tempo ${t.tempo.score}">${t.score}</div>
    <div style="min-width:0">
      <div class="st">${esc(s.title)}</div><div class="sa">${esc(s.artist)}</div>
      <div class="meta">${relBadge(t.key)} ${keyChip(s)} <span class="t-bpm">${fmtBpm(s.bpm)} BPM</span> ${tempoBadge(t.tempo, cur.bpm)} ${energyBars(s.energy)}</div>
      <div class="why">${esc(t.key.detail)}</div>
    </div>
    <div class="acts"><button class="btn btn-primary btn-sm" data-act="next">Add next</button><button class="btn btn-sm" data-act="jump" title="Make this the current song without adding it">Preview</button></div>
  </div>`).join('');
  $$('#suggest .sug').forEach(el => el.onclick = e => {
    const act = e.target.closest('[data-act]')?.dataset.act, id = +el.dataset.id;
    if (act === 'next') {
      if (!state.builder.ids.includes(cur.id)) addToSet(cur.id, true);
      addToSet(id);
    } else if (act === 'jump') { state.builder.current = id; saveBuilder(); renderBuilder(); }
  });
}

$('#set-rename').onclick = () => namePrompt('Name this set', state.builder.name, v => { state.builder.name = v; saveBuilder(); renderBuilder(); });
$('#set-clear').onclick = () => {
  if (!state.builder.ids.length) return;
  const prev = structuredClone(state.builder);
  state.builder = { name: 'Untitled set', ids: [], current: null, editingId: null };
  saveBuilder(); renderBuilder();
  toast('Set cleared', { label: 'Undo', fn: () => { state.builder = prev; saveBuilder(); renderBuilder(); } });
};
$('#set-order').onclick = () => {
  const b = state.builder;
  if (b.ids.length < 3) return toast('Add at least three songs first');
  const prev = b.ids.slice();
  b.ids = T.smartOrder(b.ids.map(id => state.byId.get(id)), state.opts).map(s => s.id);
  saveBuilder(); renderBuilder();
  toast('Reordered for the smoothest flow from your first song', { label: 'Undo', fn: () => { b.ids = prev; saveBuilder(); renderBuilder(); } });
};
$('#set-save').onclick = async () => {
  const b = state.builder;
  if (!b.ids.length) return toast('The set is empty');
  if (b.editingId && state.playlists.some(p => p.id === b.editingId)) {
    const r = await api('PUT', `/api/playlists/${b.editingId}`, { name: b.name, song_ids: b.ids });
    setPlaylists(r.playlists); renderAll(); toast(`Updated “${b.name}”`);
    return;
  }
  namePrompt('Save set as playlist', b.name === 'Untitled set' ? '' : b.name, async name => {
    const r = await api('POST', '/api/playlists', { name, song_ids: b.ids });
    b.name = name; b.editingId = r.id; saveBuilder();
    setPlaylists(r.playlists); renderAll();
    toast(`Saved “${name}”`, { label: 'Open', fn: () => openPlaylist(r.id) });
  });
};

/* ================================================================ playlists */

function openPlaylist(id) { state.plView = id; state.plUndo = null; switchTab('playlists'); renderPlaylists(); }

function setStats(songs) {
  const total = songs.reduce((a, s) => a + (s.duration || 0), 0);
  const bpms = songs.map(s => s.bpm).filter(Boolean);
  const trans = songs.slice(1).map((s, i) => T.transition(songs[i], s, { halfDouble: true }));
  const avg = trans.length ? Math.round(trans.reduce((a, t) => a + t.score, 0) / trans.length) : null;
  return { total, bpmLo: bpms.length ? Math.min(...bpms) : null, bpmHi: bpms.length ? Math.max(...bpms) : null, trans, avg };
}

function renderPlaylists() {
  const root = $('#pl-root');
  const pl = state.plView != null && state.playlists.find(p => p.id === state.plView);
  if (!pl) { state.plView = null; return renderPlaylistGrid(root); }
  renderPlaylistDetail(root, pl);
}

function renderPlaylistGrid(root) {
  if (!state.playlists.length) {
    root.innerHTML = `<div class="empty">No playlists yet. Build one in the Mix Builder, or select songs in the Library and choose “New playlist from selection”.
      <div style="margin-top:16px"><button class="btn btn-primary" id="pl-new">New empty playlist</button></div></div>`;
  } else {
    root.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h2 class="view-title">Playlists</h2><button class="btn btn-primary" id="pl-new">New playlist</button></div>
      <div class="pl-grid">${state.playlists.map(p => {
        const songs = p.song_ids.map(id => state.byId.get(id)).filter(Boolean);
        const st = setStats(songs);
        return `<div class="card pl-card" data-id="${p.id}">
          <h3>${esc(p.name)}</h3>
          <div class="meta">${songs.length} songs${st.total ? ' · ' + fmtTotal(st.total) : ''}${st.bpmLo ? ` · ${st.bpmLo === st.bpmHi ? fmtBpm(st.bpmLo) : `${fmtBpm(st.bpmLo)}–${fmtBpm(st.bpmHi)}`} BPM` : ''}${st.avg != null ? ` · flow ${st.avg}` : ''}</div>
          ${st.trans.length ? `<div class="flow-bar" title="Transition quality, start to end">${st.trans.map(t => `<i style="background:${gradeColor(t.grade)}"></i>`).join('')}</div>` : ''}
          <div class="pl-preview">${songs.slice(0, 4).map(s => `${esc(s.title)} <span class="muted">— ${esc(s.artist)}</span>`).join('<br>') || '<span class="muted">Empty</span>'}${songs.length > 4 ? `<br><span class="muted">+ ${songs.length - 4} more</span>` : ''}</div>
        </div>`;
      }).join('')}</div>`;
    $$('.pl-card', root).forEach(c => c.onclick = () => openPlaylist(+c.dataset.id));
  }
  $('#pl-new', root).onclick = () => namePrompt('New playlist', '', async name => {
    const r = await api('POST', '/api/playlists', { name, song_ids: [] });
    setPlaylists(r.playlists); renderStats(); openPlaylist(r.id);
  });
}

async function savePlaylistOrder(pl, ids, msg) {
  const r = await api('PUT', `/api/playlists/${pl.id}`, { song_ids: ids });
  setPlaylists(r.playlists); renderPlaylists(); renderStats();
  if (msg) toast(msg);
}

function curveSvg(songs) {
  const known = songs.map((s, i) => ({ s, i, b: s.bpm })).filter(p => p.b);
  if (known.length < 2) return '';
  const W = 1000, H = 190, L = 56, R = 20, TOP = 20, BOT = 34;
  const bpms = known.map(p => p.b), lo = Math.min(...bpms), hi = Math.max(...bpms);
  const span = Math.max(hi - lo, 8), mid = (hi + lo) / 2, yLo = mid - span / 2 - 2, yHi = mid + span / 2 + 2;
  const x = i => L + (songs.length === 1 ? 0 : i * (W - L - R) / (songs.length - 1));
  const y = b => TOP + (yHi - b) / (yHi - yLo) * (H - TOP - BOT);
  const ticks = lo === hi ? [lo] : [hi, lo];
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="BPM across the set, dots coloured by Camelot key">
    ${ticks.map(t => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="var(--border)" stroke-dasharray="4 6"/>
      <text x="${L - 10}" y="${y(t) + 5}" text-anchor="end" font-size="15" fill="var(--text-muted)">${fmtBpm(t)}</text>`).join('')}
    <polyline fill="none" stroke="var(--accent)" stroke-width="3" stroke-linejoin="round" points="${known.map(p => `${x(p.i)},${y(p.b)}`).join(' ')}"/>
    ${known.map(p => { const c = camOf(p.s); return `<circle cx="${x(p.i)}" cy="${y(p.b)}" r="9" fill="${c ? `var(--c${c.num})` : 'var(--slate)'}" stroke="var(--surface)" stroke-width="3"><title>${p.i + 1}. ${esc(p.s.title)} · ${fmtBpm(p.b)} BPM${c ? ' · ' + c.code : ''}</title></circle>
      <text x="${x(p.i)}" y="${H - 10}" text-anchor="middle" font-size="14" fill="var(--text-dim)">${c ? c.code : '?'}</text>`; }).join('')}
  </svg>`;
}

function renderPlaylistDetail(root, pl) {
  const songs = pl.song_ids.map(id => state.byId.get(id)).filter(Boolean);
  const st = setStats(songs);
  root.innerHTML = `
    <div class="pl-head">
      <div style="flex:1;min-width:260px">
        <button class="btn btn-ghost btn-sm" id="pl-back">← All playlists</button>
        <div><input class="pl-name-input" id="pl-name" value="${esc(pl.name)}" aria-label="Playlist name"></div>
        <div class="pl-summary"><span><strong>${songs.length}</strong> songs</span>${st.total ? `<span><strong>${fmtTotal(st.total)}</strong></span>` : ''}
          ${st.bpmLo ? `<span><strong>${st.bpmLo === st.bpmHi ? fmtBpm(st.bpmLo) : `${fmtBpm(st.bpmLo)}–${fmtBpm(st.bpmHi)}`}</strong> BPM</span>` : ''}
          ${st.avg != null ? `<span>Average flow <strong>${st.avg}</strong></span>` : ''}</div>
      </div>
      <div class="acts">
        <button class="btn btn-sm" id="pl-add">＋ Add songs</button>
        <button class="btn btn-sm" id="pl-order" title="Reorder for the smoothest key and tempo flow, keeping the first song">Smart order</button>
        ${state.plUndo ? '<button class="btn btn-sm" id="pl-undo">Undo reorder</button>' : ''}
        <button class="btn btn-sm" id="pl-build">Open in Mix Builder</button>
        <button class="btn btn-sm" id="pl-copy">Copy as text</button>
        <button class="btn btn-sm" id="pl-csv">Download CSV</button>
        <button class="btn btn-sm btn-danger" id="pl-del">Delete</button>
      </div>
    </div>
    ${songs.length > 1 ? `<div class="card curve"><div class="section-title">Tempo &amp; key journey</div>${curveSvg(songs)}</div>` : ''}
    <div class="seq" id="pl-seq">${songs.length ? songs.map((s, i) => {
      const t = i ? st.trans[i - 1] : null;
      const trans = t ? `<div class="trans"><span class="line" style="background:${gradeColor(t.grade)}"></span>
          <b style="color:var(--text-dim)">Flow ${t.score}</b> ${relBadge(t.key)} ${tempoBadge(t.tempo, songs[i - 1].bpm)} <span>${esc(t.key.detail)}</span></div>` : '';
      return `${trans}<div class="trk" draggable="true" data-i="${i}">
        <span class="grip" title="Drag to reorder">⋮⋮</span><span class="n">${i + 1}</span>
        <div style="min-width:0"><div class="tt">${esc(s.title)}</div><div class="ta">${esc(s.artist)}</div></div>
        <span class="tk">${keyChip(s)}</span>
        <span class="tb">${fmtBpm(s.bpm)}</span>
        <span><button class="icon-btn" data-up="${i}" title="Move up">↑</button><button class="icon-btn" data-down="${i}" title="Move down">↓</button><button class="icon-btn danger" data-rm="${i}" title="Remove from playlist">✕</button></span>
      </div>`;
    }).join('') : '<div class="empty">This playlist is empty — use “Add songs”.</div>'}</div>`;

  const ids = songs.map(s => s.id);
  $('#pl-back').onclick = () => { state.plView = null; renderPlaylists(); };
  $('#pl-name').onchange = async e => {
    const name = e.target.value.trim(); if (!name) return;
    const r = await api('PUT', `/api/playlists/${pl.id}`, { name }); setPlaylists(r.playlists); toast('Renamed');
  };
  $('#pl-order').onclick = () => {
    if (ids.length < 3) return toast('Needs at least three songs');
    state.plUndo = ids.slice();
    savePlaylistOrder(pl, T.smartOrder(songs, { halfDouble: true }).map(s => s.id), 'Reordered for smoothest flow');
  };
  $('#pl-undo')?.addEventListener('click', () => { const prev = state.plUndo; state.plUndo = null; savePlaylistOrder(pl, prev, 'Order restored'); });
  $('#pl-build').onclick = () => {
    state.builder = { name: pl.name, ids: ids.slice(), current: ids.at(-1) ?? null, editingId: pl.id };
    saveBuilder(); switchTab('builder');
  };
  $('#pl-copy').onclick = async () => {
    const text = songs.map((s, i) => `${i + 1}. ${s.artist} – ${s.title}  (${fmtBpm(s.bpm)} BPM, ${T.hasKey(s) ? `${T.keyName(s.tonic, s.mode)} / ${camOf(s).code}` : 'key ?'})`).join('\n');
    try { await navigator.clipboard.writeText(`${pl.name}\n\n${text}`); toast('Copied tracklist'); } catch (e) { toast('Clipboard not available'); }
  };
  $('#pl-csv').onclick = () => {
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = ['#,Title,Artist,BPM,Key,Camelot,Transition score',
      ...songs.map((s, i) => [i + 1, q(s.title), q(s.artist), s.bpm ?? '', q(T.hasKey(s) ? T.keyName(s.tonic, s.mode) : ''), camOf(s)?.code ?? '', i ? st.trans[i - 1].score : ''].join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `${pl.name.replace(/[^\w\- ]+/g, '').trim() || 'playlist'}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  };
  $('#pl-del').onclick = () => confirmModal('Delete playlist?', `“${esc(pl.name)}” will be deleted. The songs stay in your library.`, 'Delete playlist', async () => {
    await api('DELETE', `/api/playlists/${pl.id}`);
    setPlaylists(state.playlists.filter(p => p.id !== pl.id)); state.plView = null; renderAll(); toast('Playlist deleted');
  });
  $('#pl-add').onclick = () => addSongsModal(pl);

  const seq = $('#pl-seq');
  seq.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    const next = ids.slice();
    if (b.dataset.rm != null) { next.splice(+b.dataset.rm, 1); return savePlaylistOrder(pl, next); }
    const i = +(b.dataset.up ?? b.dataset.down), j = b.dataset.up != null ? i - 1 : i + 1;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    savePlaylistOrder(pl, next);
  };
  let dragFrom = null;
  $$('.trk', seq).forEach(row => {
    row.addEventListener('dragstart', e => { dragFrom = +row.dataset.i; row.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    row.addEventListener('dragend', () => { row.classList.remove('dragging'); $$('.drop-before', seq).forEach(r => r.classList.remove('drop-before')); });
    row.addEventListener('dragover', e => { e.preventDefault(); $$('.drop-before', seq).forEach(r => r.classList.remove('drop-before')); row.classList.add('drop-before'); });
    row.addEventListener('drop', e => {
      e.preventDefault();
      const to = +row.dataset.i;
      if (dragFrom == null || dragFrom === to) return;
      const next = ids.slice();
      const [moved] = next.splice(dragFrom, 1);
      next.splice(dragFrom < to ? to - 1 : to, 0, moved);
      dragFrom = null;
      savePlaylistOrder(pl, next);
    });
  });
}

function addSongsModal(pl) {
  const last = state.byId.get(pl.song_ids.at(-1));
  openModal(`<h3>Add to “${esc(pl.name)}”</h3>
    <input type="search" id="as-q" placeholder="Search library…" autofocus>
    ${last ? `<p class="hint">Sorted by how well each song follows “${esc(last.title)}”.</p>` : ''}
    <div class="picker" id="as-list" style="max-height:420px"></div>
    <div class="modal-actions"><button class="btn btn-primary" data-close>Done</button></div>`, m => {
    $('[data-close]', m).onclick = () => { closeModal(); renderPlaylists(); };
    const draw = () => {
      const cur = state.playlists.find(p => p.id === pl.id);
      const tail = state.byId.get(cur.song_ids.at(-1));
      const q = $('#as-q', m).value.trim().toLowerCase();
      let list = state.songs.filter(s => !cur.song_ids.includes(s.id) && (!q || `${s.title} ${s.artist}`.toLowerCase().includes(q)));
      const sc = new Map(list.map(s => [s.id, tail ? T.transition(tail, s, { halfDouble: true }) : null]));
      if (tail) list.sort((a, b) => sc.get(b.id).score - sc.get(a.id).score);
      $('#as-list', m).innerHTML = list.slice(0, 150).map(s => {
        const t = sc.get(s.id);
        return `<div class="picker-row" data-id="${s.id}"><div style="min-width:0"><div class="pt">${esc(s.title)}</div><div class="pa">${esc(s.artist)}</div></div>
          <div style="display:flex;gap:8px;align-items:center;flex:none">${t ? `<span class="badge ${t.key.cls}">${t.score}</span>` : ''}<span class="t-bpm">${fmtBpm(s.bpm)}</span>${keyChip(s, { short: true })}</div></div>`;
      }).join('') || '<div class="muted" style="padding:12px">Nothing to add</div>';
      $$('[data-id]', $('#as-list', m)).forEach(r => r.onclick = async () => {
        const c = state.playlists.find(p => p.id === pl.id);
        const res = await api('PUT', `/api/playlists/${pl.id}`, { song_ids: [...c.song_ids, +r.dataset.id] });
        setPlaylists(res.playlists); toast(`Added “${state.byId.get(+r.dataset.id).title}”`); draw();
      });
    };
    $('#as-q', m).oninput = draw;
    draw();
  });
}

/* ================================================================ key wheel */

function renderWheel() {
  const counts = {};
  for (const s of state.songs) { const c = camOf(s); if (c) counts[c.code] = (counts[c.code] || 0) + 1; }
  const cx = 300, cy = 300;
  const ring = (r0, r1, a0, a1) => {
    const p = (r, a) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
    const [x0, y0] = p(r1, a0), [x1, y1] = p(r1, a1), [x2, y2] = p(r0, a1), [x3, y3] = p(r0, a0);
    return `M${x0},${y0} A${r1},${r1} 0 0 1 ${x1},${y1} L${x2},${y2} A${r0},${r0} 0 0 0 ${x3},${y3} Z`;
  };
  const sel = state.wheelSel;
  let svg = '';
  for (let n = 1; n <= 12; n++) {
    const mid = (n % 12) * Math.PI / 6, a0 = mid - Math.PI / 12, a1 = mid + Math.PI / 12;
    for (const [letter, r0, r1] of [['B', 200, 290], ['A', 112, 198]]) {
      const code = `${n}${letter}`, cnt = counts[code] || 0;
      const k = T.camelotToKey(n, letter);
      const label = letter === 'B' ? T.tonicName(k.tonic, 'major') : T.tonicName(k.tonic, 'minor') + 'm';
      const rm = (r0 + r1) / 2;
      const tx = cx + rm * Math.sin(mid), ty = cy - rm * Math.cos(mid);
      const isSel = sel.num === n && sel.letter === letter;
      const fill = cnt ? `var(--c${n})` : 'var(--surface-2)';
      const ink = cnt ? '#1b120c' : 'var(--text-muted)';
      svg += `<path class="seg-path${isSel ? ' sel' : ''}" d="${ring(r0, r1, a0, a1)}" fill="${fill}" data-n="${n}" data-l="${letter}"><title>${code} · ${esc(T.keyName(k.tonic, letter === 'B' ? 'major' : 'minor'))} family · ${cnt} songs</title></path>
        <text x="${tx}" y="${ty - 12}" text-anchor="middle" font-size="22" font-weight="700" fill="${ink}">${code}</text>
        <text x="${tx}" y="${ty + 10}" text-anchor="middle" font-size="19" font-weight="600" fill="${ink}">${label}</text>
        <text x="${tx}" y="${ty + 31}" text-anchor="middle" font-size="17" font-weight="600" fill="${ink}">${cnt || ''}</text>`;
    }
  }
  const sig = T.signatureOf(sel.num);
  $('#wheel').innerHTML = `<svg viewBox="0 0 600 600" role="img" aria-label="Camelot wheel of your library">${svg}
    <circle cx="${cx}" cy="${cy}" r="108" fill="var(--surface)" stroke="var(--border)"/>
    <text x="${cx}" y="${cy - 12}" text-anchor="middle" font-size="52" font-family="var(--serif)" fill="var(--text)">${sel.num}${sel.letter}</text>
    <text x="${cx}" y="${cy + 24}" text-anchor="middle" font-size="20" fill="var(--text-dim)">${sig.text}</text>
    <text x="${cx}" y="${cy + 50}" text-anchor="middle" font-size="16" fill="var(--text-muted)">song counts in rings</text></svg>`;
  $$('#wheel .seg-path').forEach(p => p.onclick = () => { state.wheelSel = { num: +p.dataset.n, letter: p.dataset.l }; renderWheel(); });
  renderWheelDetail(counts);
}

function renderWheelDetail(counts) {
  const { num, letter } = state.wheelSel;
  const sig = T.signatureOf(num);
  const fam = T.family(num);
  const modeCount = {};
  for (const s of state.songs) if (T.hasKey(s) && T.camelot(s.tonic, s.mode).num === num) modeCount[s.mode] = (modeCount[s.mode] || 0) + 1;
  const parent = T.camelotToKey(num, 'B');
  const notes = T.scaleNotes(parent.tonic, 'major');
  const neighbor = d => {
    const n = ((num - 1 + d + 12) % 12) + 1;
    const pk = T.camelotToKey(n, 'B');
    const other = T.scaleNotes(pk.tonic, 'major');
    const pcOf = name => { let pc = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[name[0]]; for (const ch of name.slice(1)) pc += ch === '♯' ? 1 : ch === '♭' ? -1 : ch === '𝄪' ? 2 : ch === '𝄫' ? -2 : 0; return (pc + 12) % 12; };
    const otherPcs = new Set(other.map(pcOf)), myPcs = new Set(notes.map(pcOf));
    const out = notes.find(x => !otherPcs.has(pcOf(x))), inn = other.find(x => !myPcs.has(pcOf(x)));
    const cnt = (counts[`${n}A`] || 0) + (counts[`${n}B`] || 0);
    return `<div class="nbr" data-n="${n}"><div class="nh"><strong>${n}A / ${n}B · ${esc(T.tonicName(pk.tonic, 'major'))} family</strong><span class="muted">${cnt} songs</span></div>
      <div class="nd">${d > 0 ? 'Energy up (+1)' : 'Calmer (−1)'} — one note changes: <b style="color:var(--text)">${out} → ${inn}</b></div></div>`;
  };
  $('#wheel-detail').innerHTML = `
    <h2 class="view-title">Family ${num} · ${serifAcc(T.tonicName(parent.tonic, 'major'))} major scale</h2>
    <p class="dim" style="margin-top:0">${sig.text}${sig.notes.length ? ': ' + sig.notes.join(' ') : ''}. Every key below uses these same seven notes,
      so songs in any of them blend smoothly — Hooktheory calls these <em>relative keys</em>.</p>
    <div class="notes-row">${notes.map(n => `<span class="${/[♭♯]/.test(n) ? 'alt' : ''}">${n}</span>`).join('')}</div>
    <div class="bright-scale"><span>☀ Brighter</span><span>Darker ☾</span></div>
    <div class="family-list">${fam.map(k => {
      const m = T.MODE[k.mode], c = T.camelot(k.tonic, k.mode), cnt = modeCount[k.mode] || 0;
      return `<div class="fam-row">
        <div class="fk">${keyChip(k)}</div>
        <div class="fc">${cnt ? `<button class="btn btn-sm" data-show="${k.mode}">${cnt} song${cnt === 1 ? '' : 's'}</button>` : '<span class="muted">0 songs</span>'}
          <a href="${T.hooktheoryUrl(k.tonic, k.mode)}" target="_blank" rel="noopener">Hooktheory ↗</a></div>
        <div class="fm">${esc(m.mood)}</div>
      </div>`;
    }).join('')}</div>
    <div class="section-title">Neighboring families</div>
    <div class="nbr-grid">${neighbor(-1)}${neighbor(1)}</div>
    <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn" id="wd-show">Show all ${num}A + ${num}B songs</button>
      <button class="btn" id="wd-compat">Show ${num} and its neighbors</button>
    </div>`;
  $$('#wheel-detail [data-show]').forEach(b => b.onclick = () => setCamFilter(num, T.MODE[b.dataset.show].side, b.dataset.show));
  $$('#wheel-detail .nbr').forEach(b => b.onclick = () => { state.wheelSel = { num: +b.dataset.n, letter }; renderWheel(); });
  $('#wd-show').onclick = () => { state.lib.compat = false; setCamFilter(num, null); };
  $('#wd-compat').onclick = () => { state.lib.compat = true; setCamFilter(num, null); };
}

/* ================================================================ import */

const HEADERS = {
  title: ['title', 'song', 'song title', 'track', 'track title', 'name'],
  artist: ['artist', 'artists', 'by'],
  bpm: ['bpm', 'tempo'],
  key: ['key', 'key & mode', 'key & modal center', 'musical key', 'keyinput', 'camelot', 'key/mode', 'initial key'],
  notes: ['notes', 'note', 'comments', 'comment', 'mixing notes', 'harmonic / mixing notes'],
  duration: ['duration', 'length', 'time'],
  tags: ['tags', 'genre', 'genres'],
  energy: ['energy'],
  rating: ['rating', 'stars'],
};

function parseDelimited(text, delim) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"' && field === '') q = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(x => x.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(x => x.trim() !== '')) rows.push(row);
  return rows;
}

function fromObject(o) {
  const low = {}; for (const [k, v] of Object.entries(o)) low[k.trim().toLowerCase()] = v;
  const pick = f => { for (const n of HEADERS[f]) if (low[n] != null && low[n] !== '') return low[n]; return null; };
  let key = null, keyRaw = pick('key');
  if (Number.isInteger(low.tonic) && T.MODE[low.mode]) { key = { tonic: low.tonic, mode: low.mode }; keyRaw = T.keyName(low.tonic, low.mode); }
  else if (keyRaw != null) key = T.parseKey(keyRaw);
  const tags = pick('tags');
  return {
    ref: o.id ?? null,
    title: String(pick('title') ?? '').trim(), artist: String(pick('artist') ?? '').trim(),
    bpm: numOrNull(pick('bpm'), 30, 300), keyRaw: keyRaw == null ? '' : String(keyRaw), key,
    duration: parseDur(pick('duration')), energy: numOrNull(pick('energy'), 1, 5, true), rating: numOrNull(pick('rating'), 0, 5, true),
    tags: Array.isArray(tags) ? tags.join(', ') : String(tags ?? '').trim(), notes: String(pick('notes') ?? '').trim(),
  };
}

function parseFreeLine(line, swap) {
  let parts = line.split(/\t|\s\|\s|\||;/).map(x => x.trim()).filter(Boolean);
  if (parts.length === 1) parts = line.split(',').map(x => x.trim()).filter(Boolean);
  const r = { title: '', artist: '', bpm: null, keyRaw: '', key: null, duration: null, energy: null, rating: null, tags: '', notes: '', ref: null };
  const text = [];
  // "Artist - Title 109 Ab mixolydian" with no separators
  if (parts.length === 1) {
    const m = parts[0].match(/^(.*?)\s+(\d{2,3}(?:\.\d+)?)\s*(?:bpm)?(?:\s+(.+))?$/i);
    if (m && +m[2] >= 40 && +m[2] <= 250) { parts = [m[1], m[2]]; if (m[3]) parts.push(m[3]); }
  }
  parts.forEach((p, i) => {
    const bpm = p.match(/^(\d{2,3}(?:\.\d+)?)\s*(?:bpm)?$/i);
    if (i > 0 && bpm && +bpm[1] >= 40 && +bpm[1] <= 250 && r.bpm == null) { r.bpm = +bpm[1]; return; }
    if (i > 0 && /^\d{1,2}:\d{2}$/.test(p) && r.duration == null) { r.duration = parseDur(p); return; }
    if (i > 0 && p.length <= 22 && !r.key) { const k = T.parseKey(p); if (k) { r.key = k; r.keyRaw = p; return; } }
    // Looks like a key but isn't one we know (e.g. "Hm") — keep it visible so the preview flags it.
    if (i > 0 && !r.keyRaw && /^([a-h][#b♭♯]?m?|\d{1,2}\s*[a-z])$/i.test(p)) { r.keyRaw = p; return; }
    text.push(p);
  });
  let a = '', t = '';
  const dash = text[0]?.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  const by = text[0]?.match(/^(.+?)\s+by\s+(.+)$/i);
  if (dash) { [a, t] = [dash[1], dash[2]]; if (swap) [a, t] = [t, a]; r.notes = text.slice(1).join(' · '); }
  else if (by) { [t, a] = [by[1], by[2]]; r.notes = text.slice(1).join(' · '); }
  else if (text.length >= 2) { [t, a] = [text[0], text[1]]; if (swap) [a, t] = [t, a]; r.notes = text.slice(2).join(' · '); }
  else t = text[0] || '';
  r.title = t.trim(); r.artist = a.trim();
  return r;
}

function parseImport(text, swap) {
  text = text.replace(/^﻿/, '').trim();
  if (!text) return { rows: [], playlists: [] };
  if (text[0] === '[' || text[0] === '{') {
    const data = JSON.parse(text);
    const arr = Array.isArray(data) ? data : data.songs || [];
    const rows = arr.map(fromObject);
    const pls = (Array.isArray(data) ? [] : data.playlists || []).map(p => ({ name: p.name || 'Imported set', notes: p.notes || '', refs: p.song_ids || p.songIds || [] }));
    return { rows, playlists: pls };
  }
  const first = text.split(/\r?\n/)[0];
  const delim = first.includes('\t') ? '\t' : ',';
  const header = parseDelimited(first, delim)[0].map(h => h.trim().toLowerCase());
  const knownHeaders = Object.values(HEADERS).flat();
  if (header.filter(h => knownHeaders.includes(h)).length >= 2) {
    const rows = parseDelimited(text, delim).slice(1).map(cols => fromObject(Object.fromEntries(header.map((h, i) => [h, cols[i] ?? '']))));
    return { rows, playlists: [] };
  }
  return { rows: text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => parseFreeLine(l, swap)), playlists: [] };
}

function runImportPreview() {
  let parsed;
  try { parsed = parseImport($('#imp-text').value, $('#imp-swap').checked); }
  catch (e) { $('#imp-preview').innerHTML = `<p class="st-err" style="margin-top:14px">Couldn't read that: ${esc(e.message)}</p>`; return; }
  state.importRows = parsed.rows.map(r => ({ ...r, include: true }));
  state.importPlaylists = parsed.playlists;
  renderImportPreview();
}
$('#imp-parse').onclick = runImportPreview;
$('#imp-swap').onchange = () => { if (state.importRows) runImportPreview(); };

function importStatus(r, seen) {
  if (!r.title) return { cls: 'st-err', text: 'Needs a title' };
  const k = normKey(r.title, r.artist);
  if (seen.has(k)) return { cls: 'st-dup', text: 'Repeated in this list' };
  seen.add(k);
  if (state.songs.some(s => normKey(s.title, s.artist) === k)) return { cls: 'st-dup', text: 'Already in library', dup: true };
  if (r.keyRaw && !r.key) return { cls: 'st-err', text: 'Key not recognised', soft: true };
  return { cls: 'st-new', text: 'New' };
}

function importSummary(st) {
  const n = { new: st.filter(s => s.cls === 'st-new').length, dup: st.filter(s => s.dup).length, err: st.filter(s => s.cls === 'st-err').length };
  return `<b>${st.length}</b> rows &nbsp; <span class="st-new">${n.new} new</span> &nbsp; <span class="st-dup">${n.dup} already in library</span>${n.err ? ` &nbsp; <span class="st-err">${n.err} need attention</span>` : ''}`;
}

function refreshImportStatus() {
  const seen = new Set();
  const st = state.importRows.map(r => importStatus(r, seen));
  $$('#imp-preview tbody tr').forEach((tr, i) => { const td = tr.querySelector('.st'); td.className = `st ${st[i].cls}`; td.textContent = st[i].text; });
  $('#imp-sum').innerHTML = importSummary(st);
}

function renderImportPreview() {
  const rows = state.importRows;
  if (!rows) return;
  if (!rows.length) { $('#imp-preview').innerHTML = `<p class="muted" style="margin-top:14px">Nothing to import.</p>`; return; }
  const seen = new Set();
  const st = rows.map(r => importStatus(r, seen));
  const prevDup = $('#imp-dup')?.value || 'skip';
  $('#imp-preview').innerHTML = `
    <div class="preview-summary"><span id="imp-sum">${importSummary(st)}</span>
      ${state.importPlaylists.length ? `<span><b>${state.importPlaylists.length}</b> playlists will be imported too</span>` : ''}</div>
    <div class="toolbar">
      <label class="field" style="margin:0" for="imp-dup">Songs already in library:</label>
      <select id="imp-dup"><option value="skip">Skip them</option><option value="update">Update them with these values</option></select>
      <button class="btn btn-primary" id="imp-go" style="margin-left:auto">Import</button>
    </div>
    <p class="hint" style="margin-top:-6px">You can fix any cell below before importing. Rows without a title are skipped.</p>
    <div class="table-wrap"><table class="songs"><thead><tr><th style="width:36px"></th><th>Status</th><th>Title</th><th>Artist</th><th>BPM</th><th>Key</th><th class="hide-sm">Notes</th></tr></thead><tbody>
    ${rows.map((r, i) => `<tr data-i="${i}">
      <td><input type="checkbox" data-f="include" ${r.include ? 'checked' : ''}></td>
      <td class="st ${st[i].cls}" style="white-space:nowrap">${st[i].text}</td>
      <td><input class="cell" data-f="title" value="${esc(r.title)}"></td>
      <td><input class="cell" data-f="artist" value="${esc(r.artist)}"></td>
      <td><input class="cell num" data-f="bpm" value="${r.bpm ?? ''}" style="width:80px"></td>
      <td><input class="cell" data-f="keyRaw" value="${esc(r.key ? T.keyName(r.key.tonic, r.key.mode) : r.keyRaw)}"><div class="kc" style="margin-top:4px">${r.key ? keyChip(r.key, { short: true }) : ''}</div></td>
      <td class="hide-sm"><input class="cell" data-f="notes" value="${esc(r.notes)}"></td></tr>`).join('')}
    </tbody></table></div>`;
  $('#imp-dup').value = prevDup;
  $('#imp-preview tbody').onchange = e => {
    const tr = e.target.closest('tr'), r = rows[+tr.dataset.i], f = e.target.dataset.f;
    if (f === 'include') r.include = e.target.checked;
    else if (f === 'bpm') r.bpm = numOrNull(e.target.value, 30, 300);
    else if (f === 'keyRaw') { r.keyRaw = e.target.value.trim(); r.key = T.parseKey(r.keyRaw); }
    else r[f] = e.target.value.trim();
    if (f === 'keyRaw') tr.querySelector('.kc').innerHTML = r.key ? keyChip(r.key, { short: true }) : '';
    refreshImportStatus();
  };
  $('#imp-go').onclick = async () => {
    const chosen = rows.filter(r => r.include && r.title);
    if (!chosen.length) return toast('Nothing selected to import');
    const body = {
      on_duplicate: $('#imp-dup').value,
      songs: chosen.map((r, i) => ({
        ref: r.ref ?? `row${i}`, title: r.title, artist: r.artist, bpm: r.bpm,
        tonic: r.key?.tonic ?? null, mode: r.key?.mode ?? null, duration: r.duration, energy: r.energy,
        rating: r.rating || null, tags: r.tags, notes: r.notes,
      })),
      playlists: state.importPlaylists,
    };
    const res = await api('POST', '/api/import', body);
    setSongs(res.songs); setPlaylists(res.playlists);
    state.importRows = null; state.importPlaylists = [];
    $('#imp-text').value = ''; $('#imp-preview').innerHTML = '';
    renderAll();
    toast(`Imported: ${res.added} new, ${res.updated} updated, ${res.skipped} skipped${res.playlists_added ? `, ${res.playlists_added} playlists` : ''}`);
  };
}

async function readFileInto(file) {
  const text = await file.text();
  const box = $('#imp-text');
  box.value = box.value.trim() ? box.value.trimEnd() + '\n' + text : text;
  runImportPreview();
}
$('#imp-file').onchange = e => { if (e.target.files[0]) readFileInto(e.target.files[0]); e.target.value = ''; };
const drop = $('#drop');
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) readFileInto(f); });

$('#restore-file').onchange = async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  let data;
  try { data = JSON.parse(await f.text()); } catch (err) { return toast('That file isn\'t valid JSON'); }
  if (data.format !== 'tonal-backup') return toast('Not a Tonal backup — use Batch import for other files');
  confirmModal('Replace everything with this backup?', `Your current library (${state.songs.length} songs, ${state.playlists.length} playlists) will be replaced by the backup (${data.songs.length} songs, ${(data.playlists || []).length} playlists). A safety copy of the current database is saved in backups/ first.`, 'Restore backup', async () => {
    const r = await api('POST', '/api/restore', data);
    setSongs(r.songs); setPlaylists(r.playlists); renderAll(); toast('Backup restored');
  });
};

/* ================================================================ keyboard shortcuts */

document.addEventListener('keydown', e => {
  if ($('#backdrop').classList.contains('open') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
  if (e.key === '/') { e.preventDefault(); switchTab('library'); $('#lib-search').focus(); }
  if (e.key === 'n') { e.preventDefault(); switchTab('library'); qa('title').focus(); }
});

/* ================================================================ boot */

async function boot() {
  applyTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  const savedOpts = store.get('tonal:opts'); if (savedOpts) Object.assign(state.opts, savedOpts);
  const savedBuilder = store.get('tonal:builder'); if (savedBuilder?.ids) state.builder = { ...state.builder, ...savedBuilder };
  try {
    const data = await fetch('/api/state').then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); });
    setSongs(data.songs); setPlaylists(data.playlists);
    $('#db-path').textContent = data.db_path;
    setSave('ok', 'Saved to tonal.db');
  } catch (e) {
    setSave('error', 'Offline');
    $('.app').insertAdjacentHTML('afterbegin', `<div class="card offline"><h2 class="view-title">Tonal isn't running</h2>
      <p class="dim">This page needs the little Tonal engine that saves your library to disk. Open the <b>Tonal_Database</b> folder and double-click <b>Tonal.app</b> (or <b>Start Tonal.command</b>), then reload.</p></div>`);
    $$('.panel, nav.tabs').forEach(el => el.classList.add('hidden'));
    return;
  }
  const first = state.songs.find(T.hasKey);
  if (first) state.wheelSel = { num: T.camelot(first.tonic, first.mode).num, letter: T.camelot(first.tonic, first.mode).letter };
  renderAll();
  const tab = store.get('tonal:tab');
  if (tab && $(`#panel-${tab}`)) switchTab(tab);
}
boot();
