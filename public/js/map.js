// Shared map state used by both features.

const map = L.map('map', { zoomControl: false }).setView([51.505, -0.09], 13); // London default view

// Basemaps. Street (OpenStreetMap) is the default: it carries the road names,
// building footprints and POI labels that make a routing app legible. The
// muted Esri canvas and OpenTopoMap are offered as alternatives from the
// basemap switcher in map-components.js.
const OSM_STREET = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const ESRI_LIGHT_GRAY = 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}';
const ESRI_LIGHT_GRAY_LABELS = 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}';
const ESRI_ATTRIBUTION = '&copy; <a href="https://www.esri.com">Esri</a> &mdash; Esri, DeLorme, NAVTEQ';

const streetLayer = L.tileLayer(OSM_STREET, { maxZoom: 19, attribution: OSM_ATTRIBUTION });

// Base + labels grouped so the switcher toggles them as one option.
const lightGrayLayer = L.layerGroup([
  L.tileLayer(ESRI_LIGHT_GRAY, { maxZoom: 19, attribution: ESRI_ATTRIBUTION }),
  L.tileLayer(ESRI_LIGHT_GRAY_LABELS, { maxZoom: 19 }),
]);

streetLayer.addTo(map); // default

// Exposed for the basemap switcher.
window.__basemaps = { street: streetLayer, light: lightGrayLayer };

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

// Map-click handlers for tools added after the original three. Tools register
// themselves here instead of this file growing an if/else per tool.
window.__modeHandlers = {};
window.registerModeHandler = function (mode, handler) {
  window.__modeHandlers[mode] = handler;
};

const modeTabs = document.querySelectorAll('.mode-tab');
// Panels are matched by data-panel, so adding a tool means adding markup —
// no edit here.
const sidePanels = document.querySelectorAll('.side-panel');

modeTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    currentMode = tab.dataset.mode;
    modeTabs.forEach((t) => t.classList.toggle('active', t === tab));
    sidePanels.forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== currentMode));
  });
});

map.on('click', (e) => {
  if (currentMode === 'planner') {
    window.plannerOnMapClick(e.latlng);
  } else if (currentMode === 'alternatives') {
    window.alternativesOnMapClick(e.latlng);
  } else if (currentMode === 'elevation') {
    window.elevationOnMapClick(e.latlng);
  } else if (window.__modeHandlers[currentMode]) {
    window.__modeHandlers[currentMode](e.latlng);
  }
});
