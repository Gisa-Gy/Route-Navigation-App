// Map components: basemap switcher, scale bar, coordinate readout, compass/reset,
// current-location, and fullscreen. Runs after map.js (which creates `map` and
// adds the default Esri Light Gray base). This file only ADDS controls and extra
// selectable basemaps — it does not touch the existing default layer or any tool.

(function () {
  // --- Extra selectable basemaps -------------------------------------------
  // The default Esri Light Gray base+labels is already on the map (from map.js).
  // We wrap it as one logical "Light" option and offer Topographic + Street too.
  //
  // NOTE: OpenTopoMap is a small volunteer project with a strict tile-usage
  // policy and aggressive rate-limiting. It is offered here as a *selectable*
  // option, NOT the default, to stay within acceptable casual-use limits. For
  // production/high-traffic use, host your own topo tiles or use a keyed provider.
  // Reuse the "Light" group that map.js already created and added — avoids
  // loading the Esri tiles twice and keeps the switcher's radio state honest.
  const lightGray = window.__esriLightGray;

  const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 17,
    attribution:
      'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, ' +
      'SRTM | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
  });

  const street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  });

  const baseLayers = {
    'Light': lightGray,
    'Topographic': topo,
    'Street': street,
  };

  L.control.layers(baseLayers, null, { position: 'bottomright', collapsed: true }).addTo(map);

  // --- Scale bar ------------------------------------------------------------
  L.control.scale({ position: 'bottomleft', imperial: false, maxWidth: 180 }).addTo(map);

  // --- Custom control base helper ------------------------------------------
  function makeControl(position, buildFn) {
    const Ctl = L.Control.extend({
      options: { position },
      onAdd: function () {
        const container = L.DomUtil.create('div', 'leaflet-bar map-ctl');
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);
        buildFn(container);
        return container;
      },
    });
    return new Ctl();
  }

  function ctlButton(container, title, svg, onClick) {
    const a = L.DomUtil.create('a', 'map-ctl-btn', container);
    a.href = '#';
    a.title = title;
    a.setAttribute('role', 'button');
    a.setAttribute('aria-label', title);
    a.innerHTML = svg;
    L.DomEvent.on(a, 'click', (e) => {
      L.DomEvent.preventDefault(e);
      onClick(a);
    });
    return a;
  }

  const ICON = {
    locate:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
    compass:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z" fill="currentColor" stroke="none"/></svg>',
    expand:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
  };

  // Remember the initial view so the compass/reset can return to it.
  const HOME_CENTER = map.getCenter();
  const HOME_ZOOM = map.getZoom();

  // --- Current location -----------------------------------------------------
  let locationMarker = null;
  let accuracyCircle = null;

  const locateControl = makeControl('bottomright', (container) => {
    ctlButton(container, 'Show my location', ICON.locate, (btn) => {
      if (!navigator.geolocation) {
        alert('Geolocation is not supported by your browser.');
        return;
      }
      btn.classList.add('loading');
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          btn.classList.remove('loading');
          const { latitude, longitude, accuracy } = pos.coords;
          const latlng = [latitude, longitude];
          if (locationMarker) map.removeLayer(locationMarker);
          if (accuracyCircle) map.removeLayer(accuracyCircle);
          accuracyCircle = L.circle(latlng, {
            radius: accuracy,
            color: '#4f46e5',
            weight: 1,
            fillColor: '#4f46e5',
            fillOpacity: 0.12,
          }).addTo(map);
          locationMarker = L.circleMarker(latlng, {
            radius: 7,
            color: '#fff',
            weight: 2.5,
            fillColor: '#4f46e5',
            fillOpacity: 1,
          }).addTo(map);
          map.fitBounds(accuracyCircle.getBounds(), { maxZoom: 16 });
        },
        (err) => {
          btn.classList.remove('loading');
          alert('Could not get your location: ' + err.message);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    });
  });
  locateControl.addTo(map);

  // --- Compass / reset north + home view -----------------------------------
  // Leaflet doesn't rotate, so "compass" here resets to the home extent and
  // north-up (which is always the case). Kept as a familiar GIS affordance.
  const compassControl = makeControl('bottomright', (container) => {
    ctlButton(container, 'Reset view (north up)', ICON.compass, () => {
      map.setView(HOME_CENTER, HOME_ZOOM, { animate: true });
    });
  });
  compassControl.addTo(map);

  // --- Fullscreen -----------------------------------------------------------
  const fsControl = makeControl('bottomright', (container) => {
    ctlButton(container, 'Toggle fullscreen', ICON.expand, () => {
      const el = document.documentElement;
      if (!document.fullscreenElement) {
        (el.requestFullscreen || el.webkitRequestFullscreen || function () {}).call(el);
      } else {
        (document.exitFullscreen || document.webkitExitFullscreen || function () {}).call(document);
      }
    });
  });
  fsControl.addTo(map);

  // --- Coordinate readout ---------------------------------------------------
  const CoordDisplay = L.Control.extend({
    options: { position: 'bottomleft' },
    onAdd: function () {
      const el = L.DomUtil.create('div', 'coord-readout');
      el.innerHTML = 'Lat —, Lng —';
      this._el = el;
      return el;
    },
  });
  const coordDisplay = new CoordDisplay();
  coordDisplay.addTo(map);
  map.on('mousemove', (e) => {
    coordDisplay._el.innerHTML =
      'Lat ' + e.latlng.lat.toFixed(5) + ', Lng ' + e.latlng.lng.toFixed(5);
  });
  map.on('mouseout', () => {
    coordDisplay._el.innerHTML = 'Lat —, Lng —';
  });
})();
