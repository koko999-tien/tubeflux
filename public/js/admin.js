'use strict';

// ---- auth --------------------------------------------------------------------

async function checkAuth() {
  try {
    await api('/api/admin/me');
    showDash();
  } catch {
    showLogin();
  }
}

function showLogin() {
  document.getElementById('login-view').classList.remove('hidden');
  document.getElementById('dash-view').classList.add('hidden');
}

function showDash() {
  document.getElementById('login-view').classList.add('hidden');
  document.getElementById('dash-view').classList.remove('hidden');
  loadStats();
  loadVideos();
  loadCategories();
}

// ---- stats -------------------------------------------------------------------

async function loadStats() {
  try {
    const s = await api('/api/admin/stats');
    document.getElementById('stats').innerHTML = [
      ['Videos', s.videos], ['Published', s.published], ['Views', fmtCount(s.views)],
      ['Likes', fmtCount(s.likes)], ['Comments', s.comments], ['Categories', s.categories],
    ].map(([l, n]) => `<div class="stat"><div class="n">${n}</div><div class="l">${l}</div></div>`).join('');
  } catch (err) { toast(err.message); }
}

// ---- videos ------------------------------------------------------------------

async function loadVideos() {
  try {
    const { items } = await api('/api/admin/videos');
    const rows = document.getElementById('video-rows');
    if (!items.length) {
      rows.innerHTML = '<tr><td colspan="7" style="color:var(--muted)">No videos yet.</td></tr>';
      return;
    }
    rows.innerHTML = items.map((v) => `
      <tr>
        <td>${v.thumb
          ? `<img class="thumb-sm" src="/thumbs/${encodeURIComponent(v.thumb)}">`
          : '<div class="thumb-sm"></div>'}</td>
        <td><a href="/watch.html?v=${encodeURIComponent(v.slug)}" target="_blank">${escapeHtml(v.title)}</a></td>
        <td>${v.category ? escapeHtml(v.category) : '—'}</td>
        <td>${v.views}</td>
        <td>${v.likes}</td>
        <td>${v.published ? 'Live' : 'Hidden'}</td>
        <td style="white-space:nowrap">
          <button class="btn small" data-toggle="${v.id}" data-pub="${v.published}">${v.published ? 'Hide' : 'Publish'}</button>
          <button class="btn small danger" data-del="${v.id}">Delete</button>
        </td>
      </tr>`).join('');

    rows.querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener('click', () => deleteVideo(b.dataset.del)));
    rows.querySelectorAll('[data-toggle]').forEach((b) =>
      b.addEventListener('click', () => toggleVideo(b.dataset.toggle, b.dataset.pub === '1')));
  } catch (err) { toast(err.message); }
}

async function deleteVideo(id) {
  if (!confirm('Delete this video and its files? This cannot be undone.')) return;
  try {
    await api(`/api/admin/videos/${id}`, { method: 'DELETE' });
    toast('Video deleted');
    loadVideos();
    loadStats();
  } catch (err) { toast(err.message); }
}

async function toggleVideo(id, isPublished) {
  try {
    await api(`/api/admin/videos/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ published: !isPublished }),
    });
    loadVideos();
  } catch (err) { toast(err.message); }
}

// ---- upload ------------------------------------------------------------------

function initUpload() {
  const form = document.getElementById('upload-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const btn = document.getElementById('upload-btn');
    const wrap = document.getElementById('progress');
    const bar = document.getElementById('progress-bar');

    if (!fd.get('video') || !fd.get('video').name) return toast('Pick a video file first');

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/admin/videos');
    btn.disabled = true;
    wrap.classList.add('show');
    bar.style.width = '0%';

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) bar.style.width = `${(ev.loaded / ev.total * 100).toFixed(1)}%`;
    };
    xhr.onload = () => {
      btn.disabled = false;
      wrap.classList.remove('show');
      if (xhr.status >= 200 && xhr.status < 300) {
        toast('Upload complete');
        form.reset();
        loadVideos();
        loadStats();
      } else {
        let msg = `Upload failed (${xhr.status})`;
        try { msg = JSON.parse(xhr.responseText).error || msg; } catch {}
        toast(msg);
      }
    };
    xhr.onerror = () => {
      btn.disabled = false;
      wrap.classList.remove('show');
      toast('Upload error — connection dropped');
    };
    xhr.send(fd);
  });
}

// ---- categories --------------------------------------------------------------

async function loadCategories() {
  try {
    const { items } = await api('/api/admin/categories');
    document.getElementById('cat-options').innerHTML =
      items.map((c) => `<option value="${escapeHtml(c.name)}">`).join('');
    const rows = document.getElementById('cat-rows');
    rows.innerHTML = items.map((c) => `
      <tr>
        <td>${escapeHtml(c.name)}</td>
        <td>${c.slug}</td>
        <td>${c.count}</td>
        <td><button class="btn small danger" data-cat="${c.id}">Delete</button></td>
      </tr>`).join('');
    rows.querySelectorAll('[data-cat]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirm('Delete category? Videos keep existing but lose the label.')) return;
        try { await api(`/api/admin/categories/${b.dataset.cat}`, { method: 'DELETE' }); loadCategories(); }
        catch (err) { toast(err.message); }
      }));
  } catch (err) { toast(err.message); }
}

// ---- boot --------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({
          username: document.getElementById('login-user').value,
          password: document.getElementById('login-pass').value,
        }),
      });
      showDash();
    } catch (err) { toast(err.message); }
  });

  document.getElementById('logout-link').addEventListener('click', async (e) => {
    e.preventDefault();
    await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
    showLogin();
  });

  document.getElementById('cat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('cat-name').value.trim();
    if (!name) return;
    try {
      await api('/api/admin/categories', { method: 'POST', body: JSON.stringify({ name }) });
      document.getElementById('cat-name').value = '';
      loadCategories();
    } catch (err) { toast(err.message); }
  });

  document.getElementById('pass-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/admin/password', {
        method: 'POST',
        body: JSON.stringify({
          current: document.getElementById('pass-cur').value,
          next: document.getElementById('pass-new').value,
        }),
      });
      toast('Password updated');
      e.target.reset();
    } catch (err) { toast(err.message); }
  });

  initUpload();
  checkAuth();
});
