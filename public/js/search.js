// Explore: place search via the /api/geocode proxy (Nominatim upstream).
// Typing is debounced and each request carries an id, so a slow response for
// an older query can't overwrite results for what the user has since typed.

(function () {
  const inputEl = document.getElementById('search-input');
  const clearEl = document.getElementById('search-clear');
  const resultsEl = document.getElementById('search-results');
  const detailEl = document.getElementById('search-detail');
  const statusEl = document.getElementById('search-status');

  let requestId = 0;
  let debounceTimer = null;
  let marker = null;
  let lastResults = [];

  const Search = { selected: null };
  window.Search = Search;

  function clearMarker() {
    if (marker) {
      map.removeLayer(marker);
      marker = null;
    }
  }

  function hideResults() {
    resultsEl.classList.add('hidden');
    resultsEl.innerHTML = '';
  }

  // Nominatim returns long comma-joined names. Split into a bold primary line
  // and a quieter remainder so the list is scannable.
  function splitName(displayName) {
    const parts = displayName.split(',');
    return { primary: parts[0].trim(), rest: parts.slice(1).join(',').trim() };
  }

  function renderResults(results) {
    resultsEl.innerHTML = '';
    if (results.length === 0) {
      resultsEl.innerHTML = '<div class="search-empty">No places match that search.</div>';
      resultsEl.classList.remove('hidden');
      return;
    }
    results.forEach((r, i) => {
      const { primary, rest } = splitName(r.name);
      const row = document.createElement('button');
      row.className = 'search-result';
      row.type = 'button';
      row.innerHTML =
        '<span class="search-result-primary"></span>' +
        '<span class="search-result-rest"></span>';
      row.querySelector('.search-result-primary').textContent = primary;
      row.querySelector('.search-result-rest').textContent = rest;
      row.addEventListener('click', () => selectResult(i));
      resultsEl.appendChild(row);
    });
    resultsEl.classList.remove('hidden');
  }

  function selectResult(index) {
    const r = lastResults[index];
    if (!r) return;
    Search.selected = r;
    hideResults();
    inputEl.value = splitName(r.name).primary;

    clearMarker();
    marker = L.marker([r.lat, r.lng], {
      icon: createPinIcon('', 'var(--color-accent)', 24),
    }).addTo(map);

    if (r.boundingbox && r.boundingbox.length === 4) {
      const [s, n, w, e] = r.boundingbox;
      map.fitBounds([[s, w], [n, e]], { padding: [40, 40], maxZoom: 17 });
    } else {
      map.setView([r.lat, r.lng], 16);
    }

    renderDetail(r);
    // Reveal the Search panel so the actions are visible.
    const tab = document.querySelector('.mode-tab[data-mode="search"]');
    if (tab) tab.click();
  }

  function renderDetail(r) {
    const { primary, rest } = splitName(r.name);
    detailEl.innerHTML = `
      <div class="place-card">
        <div class="place-name"></div>
        <div class="place-sub"></div>
        <div class="place-coords"></div>
        <div class="place-actions">
          <button class="btn btn-ghost" data-act="planner">Add as stop</button>
          <button class="btn btn-ghost" data-act="save">Save place</button>
        </div>
      </div>`;
    detailEl.querySelector('.place-name').textContent = primary;
    detailEl.querySelector('.place-sub').textContent = rest;
    detailEl.querySelector('.place-coords').textContent =
      r.lat.toFixed(5) + ', ' + r.lng.toFixed(5);

    detailEl.querySelector('[data-act="planner"]').addEventListener('click', () => {
      // Reuse the planner's own entry point so all its rules (max stops,
      // renumbering, route refresh) apply unchanged.
      window.plannerOnMapClick(L.latLng(r.lat, r.lng));
      const t = document.querySelector('.mode-tab[data-mode="planner"]');
      if (t) t.click();
    });

    detailEl.querySelector('[data-act="save"]').addEventListener('click', () => {
      if (window.Bookmarks && window.Bookmarks.savePlace) {
        window.Bookmarks.savePlace(primary, r.lat, r.lng);
        const t = document.querySelector('.mode-tab[data-mode="bookmarks"]');
        if (t) t.click();
      }
    });
  }

  async function runSearch(q) {
    const id = ++requestId;
    statusEl.textContent = '';
    try {
      const res = await fetch('/api/geocode?q=' + encodeURIComponent(q));
      const data = await res.json();
      if (id !== requestId) return; // a newer keystroke already superseded this
      if (!res.ok) {
        statusEl.textContent = data.error || 'Search failed.';
        hideResults();
        return;
      }
      lastResults = data.results;
      renderResults(data.results);
    } catch (err) {
      if (id !== requestId) return;
      statusEl.textContent = 'Could not reach the search service.';
      hideResults();
    }
  }

  inputEl.addEventListener('input', () => {
    const q = inputEl.value.trim();
    clearEl.classList.toggle('hidden', q.length === 0);
    clearTimeout(debounceTimer);
    if (q.length < 2) {
      hideResults();
      return;
    }
    // Debounced so typing doesn't fire a request per keystroke — this also
    // keeps us inside Nominatim's rate limits.
    debounceTimer = setTimeout(() => runSearch(q), 350);
  });

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      clearTimeout(debounceTimer);
      const q = inputEl.value.trim();
      if (q.length >= 2) runSearch(q);
    } else if (e.key === 'Escape') {
      hideResults();
      inputEl.blur();
    }
  });

  clearEl.addEventListener('click', () => {
    inputEl.value = '';
    clearEl.classList.add('hidden');
    hideResults();
    clearMarker();
    Search.selected = null;
    detailEl.innerHTML = '';
    statusEl.textContent = '';
    inputEl.focus();
  });

  // Clicking outside the search box closes the dropdown.
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.searchbar')) hideResults();
  });
})();
