// Feature 2: click-to-set start/end, fetch route alternatives, render + compare.

const ROUTE_COLORS = ['#4f46e5', '#f59e0b', '#a855f7']; // colorblind-safe, matches --color-route-* tokens
// Bumped on every fetch/clear so a Clear during an in-flight request can't
// have that request's routes reappear on the map after it resolves.
let alternativesRequestId = 0;

const Alternatives = {
  start: null,
  end: null,
  startMarker: null,
  endMarker: null,
  routes: [], // { id, distanceMeters, durationSeconds, geometry, polyline, color }
  selectedId: null,
};

const startLabelEl = document.getElementById('start-label');
const endLabelEl = document.getElementById('end-label');
const routeCardsEl = document.getElementById('route-cards');
const clearAlternativesBtn = document.getElementById('clear-alternatives-btn');
const alternativesStatusEl = document.getElementById('alternatives-status');

function formatAltSummary(distanceMeters, durationSeconds) {
  const km = (distanceMeters / 1000).toFixed(1);
  const min = Math.round(durationSeconds / 60);
  return `${km} km &middot; ${min} min`;
}

function alternativesOnMapClick(latlng) {
  alternativesStatusEl.textContent = '';
  if (!Alternatives.start) {
    Alternatives.start = latlng;
    if (Alternatives.startMarker) map.removeLayer(Alternatives.startMarker);
    Alternatives.startMarker = L.marker(latlng, { icon: createPinIcon('S', 'var(--color-start)', 24) }).addTo(map);
    startLabelEl.textContent = `${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`;
  } else if (!Alternatives.end) {
    Alternatives.end = latlng;
    if (Alternatives.endMarker) map.removeLayer(Alternatives.endMarker);
    Alternatives.endMarker = L.marker(latlng, { icon: createPinIcon('E', 'var(--color-end)', 24) }).addTo(map);
    endLabelEl.textContent = `${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`;
    fetchAlternatives();
  } else {
    // Both already set and map clicked again: reset selection to default view.
    selectRoute(null);
  }
}

function clearRoutePolylines() {
  Alternatives.routes.forEach((r) => {
    if (r.polyline) map.removeLayer(r.polyline);
  });
}

async function fetchAlternatives() {
  const requestId = ++alternativesRequestId;
  alternativesStatusEl.textContent = '';
  routeCardsEl.innerHTML = '';
  clearRoutePolylines();
  Alternatives.routes = [];
  Alternatives.selectedId = null;

  const coordinates = [
    [Alternatives.start.lng, Alternatives.start.lat],
    [Alternatives.end.lng, Alternatives.end.lat],
  ];

  try {
    const res = await fetch('/api/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates }),
    });
    const data = await res.json();
    if (requestId !== alternativesRequestId) return; // superseded by a Clear
    if (!res.ok) {
      alternativesStatusEl.textContent = data.error || 'Failed to fetch routes.';
      return;
    }

    if (data.routes.length === 1) {
      alternativesStatusEl.textContent = 'No alternative route found for this pair.';
    }

    Alternatives.routes = data.routes.map((route, i) => {
      const latlngs = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
      const color = ROUTE_COLORS[i % ROUTE_COLORS.length];
      const polyline = L.polyline(latlngs, {
        color,
        weight: i === 0 ? 6 : 4,
        opacity: 0.85,
      }).addTo(map);
      // Stop propagation so this click doesn't also reach the map's click
      // handler, which would immediately reset the selection right back to
      // null (start/end are already set once routes exist).
      polyline.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        selectRoute(route.id);
      });
      return { ...route, polyline, color };
    });

    map.fitBounds(L.featureGroup(Alternatives.routes.map((r) => r.polyline)).getBounds(), { padding: [30, 30] });
    renderRouteCards();
    document.getElementById('share-alternatives-btn').disabled = false;
  } catch (err) {
    if (requestId !== alternativesRequestId) return;
    alternativesStatusEl.textContent = 'Could not reach the server.';
  }
}

function renderRouteCards() {
  routeCardsEl.innerHTML = '';
  Alternatives.routes.forEach((route) => {
    const li = document.createElement('li');
    li.className = 'route-card' + (Alternatives.selectedId === route.id ? ' selected' : '');
    li.style.setProperty('--card-color', route.color);
    li.innerHTML = `
      <span class="swatch" style="background:${route.color}"></span>
      <strong>Route ${route.id + 1}</strong>
      <div class="metrics">${formatAltSummary(route.distanceMeters, route.durationSeconds)}</div>
    `;
    li.addEventListener('click', () => selectRoute(Alternatives.selectedId === route.id ? null : route.id));
    routeCardsEl.appendChild(li);
  });
}

function selectRoute(id) {
  Alternatives.selectedId = id;
  Alternatives.routes.forEach((route) => {
    const isSelected = id === null ? false : route.id === id;
    const isDimmed = id !== null && !isSelected;
    route.polyline.setStyle({
      weight: isSelected ? 7 : (id === null && route.id === 0 ? 6 : 4),
      opacity: isDimmed ? 0.3 : 0.85,
    });
    if (isSelected) route.polyline.bringToFront();
  });
  renderRouteCards();
}

function clearAlternatives() {
  alternativesRequestId++; // invalidate any in-flight fetch
  if (Alternatives.startMarker) map.removeLayer(Alternatives.startMarker);
  if (Alternatives.endMarker) map.removeLayer(Alternatives.endMarker);
  clearRoutePolylines();
  Alternatives.start = null;
  Alternatives.end = null;
  Alternatives.startMarker = null;
  Alternatives.endMarker = null;
  Alternatives.routes = [];
  Alternatives.selectedId = null;
  startLabelEl.textContent = 'not set';
  endLabelEl.textContent = 'not set';
  routeCardsEl.innerHTML = '';
  alternativesStatusEl.textContent = '';
  document.getElementById('share-alternatives-btn').disabled = true;
  document.getElementById('alternatives-share-box').classList.add('hidden');
}

clearAlternativesBtn.addEventListener('click', clearAlternatives);

window.alternativesOnMapClick = alternativesOnMapClick;
