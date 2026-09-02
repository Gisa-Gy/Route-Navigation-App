// Feature 1: waypoint list state, map markers, and SortableJS wiring.

const MAX_WAYPOINTS = 5;
const MIN_WAYPOINTS = 2;

const Planner = {
  waypoints: [], // { lat, lng, marker }
  mode: 'manual', // 'manual' | 'optimized'
  onWaypointsChanged: null, // set by route-planner.js
};

const waypointListEl = document.getElementById('waypoint-list');
const optimizeBtn = document.getElementById('optimize-btn');
const clearPlannerBtn = document.getElementById('clear-planner-btn');
const plannerStatusEl = document.getElementById('planner-status');

const REMOVE_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const DRAG_HANDLE_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="8" cy="6" r="1.5"/><circle cx="16" cy="6" r="1.5"/><circle cx="8" cy="12" r="1.5"/><circle cx="16" cy="12" r="1.5"/><circle cx="8" cy="18" r="1.5"/><circle cx="16" cy="18" r="1.5"/></svg>';

function makeNumberedIcon(number) {
  return createPinIcon(number, 'var(--color-primary)');
}

function renumberMarkers() {
  Planner.waypoints.forEach((wp, i) => {
    wp.marker.setIcon(makeNumberedIcon(i + 1));
  });
}

function renderWaypointList() {
  waypointListEl.innerHTML = '';
  Planner.waypoints.forEach((wp, i) => {
    const li = document.createElement('li');
    li.className = 'waypoint-row';
    li.dataset.index = i;
    li.innerHTML = `
      <span class="badge">${i + 1}</span>
      <span class="label">Stop ${i + 1} (${wp.lat.toFixed(4)}, ${wp.lng.toFixed(4)})</span>
      <button class="remove-btn" title="Remove">${REMOVE_ICON_SVG}</button>
      <span class="drag-handle">${DRAG_HANDLE_SVG}</span>
    `;
    li.querySelector('.remove-btn').addEventListener('click', () => removeWaypoint(i));
    waypointListEl.appendChild(li);
  });

  optimizeBtn.disabled = Planner.waypoints.length < MIN_WAYPOINTS;
  document.getElementById('share-planner-btn').disabled = Planner.waypoints.length < MIN_WAYPOINTS;
  document.getElementById('planner-share-box').classList.add('hidden');
}

function addWaypoint(latlng) {
  if (Planner.waypoints.length >= MAX_WAYPOINTS) {
    plannerStatusEl.textContent = `Maximum of ${MAX_WAYPOINTS} waypoints reached.`;
    return;
  }
  plannerStatusEl.textContent = '';

  const marker = L.marker(latlng, { icon: makeNumberedIcon(Planner.waypoints.length + 1) }).addTo(map);
  Planner.waypoints.push({ lat: latlng.lat, lng: latlng.lng, marker });
  Planner.mode = 'manual';
  renderWaypointList();
  if (Planner.onWaypointsChanged) Planner.onWaypointsChanged();
}

function removeWaypoint(index) {
  const [removed] = Planner.waypoints.splice(index, 1);
  if (removed) map.removeLayer(removed.marker);
  Planner.mode = 'manual';
  renumberMarkers();
  renderWaypointList();
  if (Planner.onWaypointsChanged) Planner.onWaypointsChanged();
}

function clearWaypoints() {
  Planner.waypoints.forEach((wp) => map.removeLayer(wp.marker));
  Planner.waypoints = [];
  Planner.mode = 'manual';
  renderWaypointList();
  plannerStatusEl.textContent = '';
  if (Planner.onWaypointsChanged) Planner.onWaypointsChanged();
}

Sortable.create(waypointListEl, {
  handle: '.drag-handle',
  animation: 150,
  onEnd: (evt) => {
    const { oldIndex, newIndex } = evt;
    if (oldIndex === newIndex) return;
    const [moved] = Planner.waypoints.splice(oldIndex, 1);
    Planner.waypoints.splice(newIndex, 0, moved);
    Planner.mode = 'manual';
    renumberMarkers();
    renderWaypointList();
    if (Planner.onWaypointsChanged) Planner.onWaypointsChanged();
  },
});

clearPlannerBtn.addEventListener('click', clearWaypoints);

window.plannerOnMapClick = addWaypoint;
