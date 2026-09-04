// Explore: OSM points of interest by category, within the current map view.
//
// Complements search.js (which geocodes a typed name). Here the user picks a
// category and gets everything of that kind in view — the way a navigation app
// offers "restaurants near me".

(function () {
  const chipsEl = document.getElementById('poi-chips');
  const statusEl = document.getElementById('poi-status');
  const countEl = document.getElementById('poi-count');

  if (!chipsEl) return;

  let requestId = 0;
  let layer = null;
  let activeCategory = null;

  const POI = { results: [] };
  window.POI = POI;

  function clearLayer() {
    if (layer) {
      map.removeLayer(layer);
      layer = null;
    }
    POI.results = [];
    countEl.textContent = '';
  }

  function setActive(category) {
    activeCategory = category;
    chipsEl.querySelectorAll('.chip').forEach((c) => {
      c.classList.toggle('active', c.dataset.category === category);
    });
  }

  function render(results) {
    clearLayer();
    POI.results = results;
    layer = L.layerGroup().addTo(map);

    results.forEach((r) => {
      const m = L.circleMarker([r.lat, r.lng], {
        radius: 6,
        color: '#fff',
        weight: 2,
        fillColor: 'var(--color-accent)',
        fillOpacity: 1,
      });
      // circleMarker doesn't read CSS variables, so set the resolved colour.
      m.setStyle({ fillColor: '#0369a1' });

      const kind = r.kind ? r.kind.replace(/_/g, ' ') : 'place';
      m.bindPopup(
        '<div class="poi-popup">' +
          '<strong></strong>' +
          '<span class="poi-kind"></span>' +
          '<button class="poi-add" type="button">Add as stop</button>' +
        '</div>'
      );

      m.on('popupopen', (e) => {
        const el = e.popup.getElement();
        el.querySelector('strong').textContent = r.name;
        el.querySelector('.poi-kind').textContent = kind;
        el.querySelector('.poi-add').addEventListener('click', () => {
          window.plannerOnMapClick(L.latLng(r.lat, r.lng));
          // Carry the POI's name onto the new stop so it isn't just "Stop 3".
          const last = Planner.waypoints[Planner.waypoints.length - 1];
          if (last) {
            last.name = r.name;
            renderWaypointList();
          }
          map.closePopup();
          const tab = document.querySelector('.mode-tab[data-mode="planner"]');
          if (tab) tab.click();
        });
      });

      layer.addLayer(m);
    });

    countEl.textContent = results.length
      ? results.length + (results.length === 1 ? ' place found' : ' places found')
      : '';
  }

  async function search(category) {
    const id = ++requestId;
    statusEl.textContent = '';
    setActive(category);

    const b = map.getBounds();
    const bbox = [
      b.getSouth().toFixed(5),
      b.getWest().toFixed(5),
      b.getNorth().toFixed(5),
      b.getEast().toFixed(5),
    ].join(',');

    statusEl.textContent = 'Searching this area…';
    try {
      const res = await fetch(
        '/api/poi?category=' + encodeURIComponent(category) + '&bbox=' + bbox
      );
      const data = await res.json();
      if (id !== requestId) return; // superseded by a newer category or a clear
      if (!res.ok) {
        statusEl.textContent = data.error || 'Could not load places.';
        clearLayer();
        return;
      }
      statusEl.textContent = data.results.length
        ? ''
        : 'No places of that kind are mapped in this view.';
      render(data.results);
    } catch (err) {
      if (id !== requestId) return;
      statusEl.textContent = 'Could not reach the places service.';
      clearLayer();
    }
  }

  chipsEl.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const category = chip.dataset.category;
    if (category === activeCategory) {
      // Clicking the active chip switches the layer off again.
      requestId++;
      setActive(null);
      clearLayer();
      statusEl.textContent = '';
      return;
    }
    search(category);
  });
})();
