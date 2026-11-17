'use strict';

function slug() {
  return new URLSearchParams(location.search).get('v') || '';
}

function fmtDate(s) {
  const d = new Date((s || '').replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

async function loadVideo() {
  const s = slug();
  if (!s) { location.href = '/'; return; }

  try {
    const v = await api(`/api/videos/${encodeURIComponent(s)}`);
    document.title = `${v.title} — Tubeflux`;

    const player = document.getElementById('player');
    player.src = v.videoUrl;
    player.poster = v.thumbUrl || '';
    player.addEventListener('play', () => {
      if (player._counted) return;
      player._counted = true;
      api(`/api/videos/${encodeURIComponent(s)}/view`, { method: 'POST' }).catch(() => {});
    }, { once: true });

    document.getElementById('v-title').textContent = v.title;
    document.getElementById('v-views').textContent = `${fmtCount(v.views)} views`;
    document.getElementById('v-likes').textContent = fmtCount(v.likes);
    document.getElementById('v-desc').textContent = v.description || '';

    const cat = document.getElementById('v-cat');
    cat.innerHTML = v.category
      ? `<a href="/?category=${v.category.slug}">${escapeHtml(v.category.name)}</a>` : '';
    document.getElementById('v-date').textContent = fmtDate(v.createdAt);

    document.getElementById('v-tags').innerHTML = (v.tags || []).map((t) =>
      `<a href="/?tag=${encodeURIComponent(t.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}">#${escapeHtml(t)}</a>`
    ).join('');

    document.getElementById('like-btn').addEventListener('click', async (e) => {
      e.currentTarget.classList.add('liked');
      try {
        const r = await api(`/api/videos/${encodeURIComponent(s)}/like`, { method: 'POST' });
        document.getElementById('v-likes').textContent = fmtCount(r.likes);
      } catch { /* ignore */ }
    });

    loadRelated(s);
  } catch (err) {
    document.getElementById('v-title').textContent = 'Video not found';
    document.querySelector('.player-wrap').innerHTML =
      `<div class="empty">${escapeHtml(err.message)}</div>`;
  }
}

async function loadRelated(s) {
  try {
    const { items } = await api(`/api/videos/${encodeURIComponent(s)}/related`);
    document.getElementById('related').innerHTML = items.map(cardHtml).join('');
  } catch { /* ignore */ }
}

async function loadComments() {
  const s = slug();
  try {
    const { items } = await api(`/api/comments/${encodeURIComponent(s)}`);
    const el = document.getElementById('comments');
    if (!items.length) { el.innerHTML = '<div class="empty">No comments yet.</div>'; return; }
    el.innerHTML = items.map((c) => `
      <div class="comment">
        <div class="head">
          <span class="author">${escapeHtml(c.author)}</span>
          <span class="time">${fmtDate(c.created_at)}</span>
        </div>
        <div class="body">${escapeHtml(c.body)}</div>
      </div>`).join('');
  } catch { /* ignore */ }
}

function initForm() {
  document.getElementById('comment-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const author = document.getElementById('c-author').value.trim();
    const body = document.getElementById('c-body').value.trim();
    if (!body) return;
    try {
      await api(`/api/comments/${encodeURIComponent(slug())}`, {
        method: 'POST',
        body: JSON.stringify({ author, body }),
      });
      document.getElementById('c-body').value = '';
      loadComments();
    } catch (err) {
      toast(err.message);
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initAgeGate();
  document.getElementById('search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = document.getElementById('search-input').value.trim();
    location.href = q ? `/?q=${encodeURIComponent(q)}` : '/';
  });
  initForm();
  loadVideo();
  loadComments();
});
