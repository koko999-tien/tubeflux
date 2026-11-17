'use strict';

// ---- shared helpers ----------------------------------------------------------

const $ = (sel, root = document) => root.querySelector(sel);

function toast(msg) {
  const el = $('#toast');
  if (!el) return alert(msg);
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 3200);
}

function fmtDuration(sec) {
  sec = Math.max(0, Math.round(Number(sec) || 0));
  if (!sec) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
           : `${m}:${String(s).padStart(2, '0')}`;
}

function fmtCount(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function api(path, opts) {
  const res = await fetch(path, {
    headers: opts && opts.body ? { 'Content-Type': 'application/json' } : {},
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ---- age gate ----------------------------------------------------------------

function initAgeGate() {
  const gate = $('#age-gate');
  if (!gate) return;
  if (localStorage.getItem('tf_age_ok') === '1') {
    gate.classList.add('hidden');
  } else {
    gate.classList.remove('hidden');
    $('#gate-enter').addEventListener('click', () => {
      localStorage.setItem('tf_age_ok', '1');
      gate.classList.add('hidden');
    });
  }
}

// ---- browse page -------------------------------------------------------------

function cardHtml(v) {
  const dur = fmtDuration(v.duration);
  const thumb = v.thumbUrl
    ? `<img loading="lazy" src="${v.thumbUrl}" alt="">`
    : `<div class="no-thumb">▶</div>`;
  return `
    <a class="card" href="/watch.html?v=${encodeURIComponent(v.slug)}">
      <div class="thumb">${thumb}${dur ? `<span class="duration">${dur}</span>` : ''}</div>
      <div class="meta">
        <div class="title">${escapeHtml(v.title)}</div>
        <div class="sub">
          <span>${fmtCount(v.views)} views</span>
          <span>♥ ${fmtCount(v.likes)}</span>
          ${v.category ? `<span>${escapeHtml(v.category.name)}</span>` : ''}
        </div>
      </div>
    </a>`;
}

function state() {
  const p = new URLSearchParams(location.search);
  return {
    page: Number(p.get('page') || 1),
    sort: p.get('sort') || 'new',
    q: p.get('q') || '',
    category: p.get('category') || '',
    tag: p.get('tag') || '',
  };
}

function setState(patch) {
  const s = { ...state(), ...patch };
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(s)) {
    if (v && !(k === 'page' && v === 1) && !(k === 'sort' && v === 'new')) p.set(k, v);
  }
  history.pushState(null, '', p.toString() ? `/?${p}` : '/');
  render();
}

function titleFor(s) {
  if (s.q) return `Search: "${s.q}"`;
  if (s.tag) return `Tag: ${s.tag}`;
  if (s.category) return `Category: ${s.category.replace(/-/g, ' ')}`;
  return { new: 'Newest videos', top: 'Top rated', views: 'Most viewed' }[s.sort] || 'Newest videos';
}

async function render() {
  const s = state();
  $('#page-title').textContent = titleFor(s);
  $('#sort-select').value = s.sort;
  $('#search-input').value = s.q;

  const grid = $('#grid');
  grid.innerHTML = '<div class="empty">Loading…</div>';

  try {
    const params = new URLSearchParams({ page: s.page, sort: s.sort });
    if (s.q) params.set('q', s.q);
    if (s.category) params.set('category', s.category);
    if (s.tag) params.set('tag', s.tag);

    const data = await api(`/api/videos?${params}`);
    if (!data.items.length) {
      grid.innerHTML = '<div class="empty">No videos here yet. Upload one from the admin panel.</div>';
      $('#pagination').innerHTML = '';
      return;
    }
    grid.innerHTML = data.items.map(cardHtml).join('');
    renderPagination(data);
  } catch (err) {
    grid.innerHTML = `<div class="empty">Could not load: ${escapeHtml(err.message)}</div>`;
  }
}

function renderPagination(data) {
  const el = $('#pagination');
  if (data.pages <= 1) { el.innerHTML = ''; return; }
  const s = state();
  const mk = (label, page, active, disabled) =>
    `<button data-page="${page}" class="${active ? 'active' : ''}" ${disabled ? 'disabled' : ''}>${label}</button>`;
  const parts = [mk('‹ Prev', s.page - 1, false, s.page <= 1)];
  const from = Math.max(1, s.page - 2);
  const to = Math.min(data.pages, from + 4);
  for (let i = from; i <= to; i++) parts.push(mk(String(i), i, i === s.page, false));
  parts.push(mk('Next ›', s.page + 1, false, s.page >= data.pages));
  el.innerHTML = parts.join('');
  el.querySelectorAll('button[data-page]').forEach((b) =>
    b.addEventListener('click', () => setState({ page: Number(b.dataset.page) })));
}

async function renderSidebar() {
  try {
    const [{ items: cats }, { items: tags }] = await Promise.all([
      api('/api/categories'),
      api('/api/tags'),
    ]);
    const s = state();
    $('#cat-list').innerHTML =
      `<li><a href="/" class="${!s.category ? 'active' : ''}">All</a></li>` +
      cats.map((c) =>
        `<li><a href="/?category=${c.slug}" class="${s.category === c.slug ? 'active' : ''}">
           ${escapeHtml(c.name)} <span class="count">${c.count}</span></a></li>`).join('');
    $('#tag-cloud').innerHTML = tags.slice(0, 40).map((t) =>
      `<a href="/?tag=${t.slug}">${escapeHtml(t.name)}</a>`).join('');
  } catch { /* sidebar is optional */ }
}

function boot() {
  initAgeGate();
  if (!$('#grid')) return;

  $('#search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    setState({ q: $('#search-input').value.trim(), page: 1 });
  });
  $('#sort-select').addEventListener('change', (e) => setState({ sort: e.target.value, page: 1 }));
  window.addEventListener('popstate', render);

  renderSidebar();
  render();
}

document.addEventListener('DOMContentLoaded', boot);
