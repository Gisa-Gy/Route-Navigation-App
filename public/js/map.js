// Shared map state used by both features.

const map = L.map('map', { zoomControl: false }).setView([51.505, -0.09], 13); // London default view

// Esri World Light Gray Canvas — a free, no-key-required, unlimited-quota
// basemap with the same muted/minimal look CARTO Positron had. Switched
// away from CARTO's basemaps.cartocdn.com because its anonymous tier is
// quota-limited and starts watermarking tiles once real public traffic
// (e.g. after deploying) crosses its shared free threshold.
const ESRI_LIGHT_GRAY = 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}';
const ESRI_LIGHT_GRAY_LABELS = 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}';
const ESRI_ATTRIBUTION = '&copy; <a href="https://www.esri.com">Esri</a> &mdash; Esri, DeLorme, NAVTEQ';

L.tileLayer(ESRI_LIGHT_GRAY, { maxZoom: 19, attribution: ESRI_ATTRIBUTION }).addTo(map);
// Labels layer stacks on top of the base tiles (both in the default tile
// pane, added-order determines stacking) but still sits below route
// polylines/markers, which live in Leaflet's higher-z overlay/marker panes.
L.tileLayer(ESRI_LIGHT_GRAY_LABELS, { maxZoom: 19 }).addTo(map);

// Default top-left zoom control would collide with the floating brand/tabs bar.
L.control.zoom({ position: 'bottomleft' }).addTo(map);

// Shared numbered/lettered pin marker used by all three tools, styled via the
// --pin-color CSS custom property (inherited from :root, so plain color
// tokens work without duplicating hex values here).
function createPinIcon(label, colorVar, size = 26) {
  return L.divIcon({
    className: 'map-pin',
    html: `<div class="map-pin-inner" style="--pin-color:${colorVar}; font-size:${size * 0.46}px;">${label}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

let currentMode = 'planner';

const modeTabs = document.querySelectorAll('.mode-tab');
const plannerPanel = document.getElementById('planner-panel');
const alternativesPanel = document.getElementById('alternatives-panel');
const elevationPanel = document.getElementById('elevation-panel');

modeTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    currentMode = tab.dataset.mode;
    modeTabs.forEach((t) => t.classList.toggle('active', t === tab));
    plannerPanel.classList.toggle('hidden', currentMode !== 'planner');
    alternativesPanel.classList.toggle('hidden', currentMode !== 'alternatives');
    elevationPanel.classList.toggle('hidden', currentMode !== 'elevation');
  });
});

map.on('click', (e) => {
  if (currentMode === 'planner') {
    window.plannerOnMapClick(e.latlng);
  } else if (currentMode === 'alternatives') {
    window.alternativesOnMapClick(e.latlng);
  } else if (currentMode === 'elevation') {
    window.elevationOnMapClick(e.latlng);
  }
});
