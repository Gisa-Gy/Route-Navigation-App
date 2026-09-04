// Explore: saved places. Persisted in localStorage so they survive reloads.
// Storage is per-browser and never leaves the device.

(function () {
  const STORAGE_KEY = 'routenav.bookmarks.v1';

  const listEl = document.getElementById('bookmark-list');
  const addBtn = document.getElementById('bookmark-add-btn');
  const statusEl = document.getElementById('bookmark-status');

  const TRASH_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>';

  let bookmarks = [];

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      bookmarks = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(bookmarks)) bookmarks = [];
    } catch (err) {
      // Corrupt or unavailable storage (e.g. private mode) shouldn't break the
      // rest of the app — fall back to an in-memory list for this session.
      bookmarks = [];
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
      statusEl.textContent = '';
    } catch (err) {
      statusEl.textContent = 'Saved for this session only — browser storage is unavailable.';
    }
  }

  function render() {
    listEl.innerHTML = '';
    bookmarks.forEach((b, i) => {
      const li = document.createElement('li');
      li.className = 'bookmark-row';
      li.innerHTML = `
        <button class="bookmark-go" type="button">
          <span class="bookmark-name"></span>
          <span class="bookmark-coords"></span>
        </button>
        <button class="bookmark-del" type="button" title="Delete">${TRASH_SVG}</button>`;
      li.querySelector('.bookmark-name').textContent = b.name;
      li.querySelector('.bookmark-coords').textContent =
        b.lat.toFixed(4) + ', ' + b.lng.toFixed(4);
      li.querySelector('.bookmark-go').addEventListener('click', () => {
        map.setView([b.lat, b.lng], b.zoom || 15, { animate: true });
      });
      li.querySelector('.bookmark-del').addEventListener('click', () => {
        bookmarks.splice(i, 1);
        save();
        render();
      });
      listEl.appendChild(li);
    });
  }

  function addBookmark(name, lat, lng, zoom) {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    bookmarks.unshift({ name: trimmed, lat, lng, zoom });
    save();
    render();
  }

  addBtn.addEventListener('click', () => {
    const c = map.getCenter();
    const suggested = 'View at ' + c.lat.toFixed(3) + ', ' + c.lng.toFixed(3);
    const name = prompt('Name this place:', suggested);
    if (name === null) return; // user cancelled
    addBookmark(name || suggested, c.lat, c.lng, map.getZoom());
  });

  // Called by search.js when the user saves a geocoded result.
  window.Bookmarks = {
    savePlace: function (name, lat, lng) {
      addBookmark(name, lat, lng, 16);
    },
  };

  load();
  render();
})();
