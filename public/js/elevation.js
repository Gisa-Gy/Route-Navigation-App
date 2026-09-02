// Feature 3: elevation profile for walking/cycling routes, chart <-> map hover sync.

const ELEVATION_SAMPLE_COUNT = 50;
// Bumped on every fetch/clear so a slow, superseded response (e.g. from
// rapidly toggling Walking/Cycling, or a Clear mid-fetch) can't overwrite
// newer state.
let elevationRequestId = 0;

const Elevation = {
  start: null,
  end: null,
  startMarker: null,
  endMarker: null,
  routePolyline: null,
  hoverMarker: null,
  sampledPoints: [], // { lat, lng, distanceKm, elevationMeters }
  chart: null,
};

const elevStartLabelEl = document.getElementById('elev-start-label');
const elevEndLabelEl = document.getElementById('elev-end-label');
const elevationSummaryEl = document.getElementById('elevation-summary');
const elevationStatusEl = document.getElementById('elevation-status');
const clearElevationBtn = document.getElementById('clear-elevation-btn');
const elevationChartCanvas = document.getElementById('elevation-chart');

function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function sampleGeometry(coordinates) {
  // coordinates are [lng, lat] pairs from OSRM; compute cumulative distance
  // along the full path, then pick evenly spaced indices for sampling.
  const points = coordinates.map(([lng, lat]) => ({ lat, lng }));
  const cumulativeKm = [0];
  for (let i = 1; i < points.length; i++) {
    cumulativeKm.push(cumulativeKm[i - 1] + haversineMeters(points[i - 1], points[i]) / 1000);
  }

  const sampleCount = Math.min(ELEVATION_SAMPLE_COUNT, points.length);
  const sampled = [];
  for (let i = 0; i < sampleCount; i++) {
    const idx = Math.round((i * (points.length - 1)) / (sampleCount - 1 || 1));
    sampled.push({ lat: points[idx].lat, lng: points[idx].lng, distanceKm: cumulativeKm[idx] });
  }
  return sampled;
}

function elevationOnMapClick(latlng) {
  elevationStatusEl.textContent = '';
  if (!Elevation.start) {
    Elevation.start = latlng;
    if (Elevation.startMarker) map.removeLayer(Elevation.startMarker);
    Elevation.startMarker = L.marker(latlng, { icon: createPinIcon('S', 'var(--color-start)', 24) }).addTo(map);
    elevStartLabelEl.textContent = `${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`;
  } else if (!Elevation.end) {
    Elevation.end = latlng;
    if (Elevation.endMarker) map.removeLayer(Elevation.endMarker);
    Elevation.endMarker = L.marker(latlng, { icon: createPinIcon('E', 'var(--color-end)', 24) }).addTo(map);
    elevEndLabelEl.textContent = `${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`;
    fetchElevationProfile();
  }
  // Both already set: ignore further clicks until Clear (matches planner/alternatives pattern).
}

async function fetchElevationProfile() {
  const requestId = ++elevationRequestId;

  // Clear any previous route/chart up front (e.g. when switching profile)
  // so a failed fetch below can't leave a stale chart mismatched with the
  // new profile and the error message.
  if (Elevation.routePolyline) {
    map.removeLayer(Elevation.routePolyline);
    Elevation.routePolyline = null;
  }
  hideHoverMarker();
  if (Elevation.chart) {
    Elevation.chart.destroy();
    Elevation.chart = null;
  }
  Elevation.sampledPoints = [];
  document.getElementById('share-elevation-btn').disabled = true;

  elevationStatusEl.textContent = 'Loading route and elevation data...';
  elevationSummaryEl.textContent = '';

  const profile = document.querySelector('input[name="elevation-profile"]:checked').value;
  const coordinates = [
    [Elevation.start.lng, Elevation.start.lat],
    [Elevation.end.lng, Elevation.end.lat],
  ];

  try {
    const routeRes = await fetch('/api/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates, profile }),
    });
    const routeData = await routeRes.json();
    if (requestId !== elevationRequestId) return; // superseded by a newer request or a Clear
    if (!routeRes.ok) {
      elevationStatusEl.textContent = routeData.error || 'Failed to fetch route.';
      return;
    }

    const route = routeData.routes[0];
    drawElevationRoute(route.geometry.coordinates);
    renderSummary(route, null);
    // A valid route is on the map at this point — sharing only needs
    // start/end/profile (the share link recomputes everything), so it
    // shouldn't stay disabled just because the elevation lookup below fails.
    document.getElementById('share-elevation-btn').disabled = false;

    Elevation.sampledPoints = sampleGeometry(route.geometry.coordinates);

    const elevRes = await fetch('/api/elevation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points: Elevation.sampledPoints.map((p) => [p.lat, p.lng]) }),
    });
    const elevData = await elevRes.json();
    if (requestId !== elevationRequestId) return;
    if (!elevRes.ok) {
      elevationStatusEl.textContent = elevData.error || 'Route loaded, but elevation data is unavailable right now.';
      return;
    }

    elevData.elevations.forEach((e, i) => {
      Elevation.sampledPoints[i].elevationMeters = e.elevationMeters;
    });

    elevationStatusEl.textContent = '';
    renderSummary(route, Elevation.sampledPoints);
    renderChart(Elevation.sampledPoints);
  } catch (err) {
    if (requestId !== elevationRequestId) return;
    elevationStatusEl.textContent = 'Could not reach the server.';
  }
}

function renderSummary(route, sampledPoints) {
  const km = (route.distanceMeters / 1000).toFixed(1);
  const min = Math.round(route.durationSeconds / 60);
  let html = `${km} km &middot; ${min} min`;
  if (sampledPoints) {
    let gain = 0;
    for (let i = 1; i < sampledPoints.length; i++) {
      const diff = sampledPoints[i].elevationMeters - sampledPoints[i - 1].elevationMeters;
      if (diff > 0) gain += diff;
    }
    html += ` &middot; ${Math.round(gain)} m elevation gain`;
  }
  elevationSummaryEl.innerHTML = html;
}

function drawElevationRoute(coordinates) {
  if (Elevation.routePolyline) map.removeLayer(Elevation.routePolyline);
  const latlngs = coordinates.map(([lng, lat]) => [lat, lng]);
  Elevation.routePolyline = L.polyline(latlngs, { color: '#0d9488', weight: 5 }).addTo(map);
  map.fitBounds(Elevation.routePolyline.getBounds(), { padding: [30, 30] });

  Elevation.routePolyline.on('mousemove', onRouteHover);
  Elevation.routePolyline.on('mouseout', onRouteHoverEnd);
}

function nearestSampledIndex(latlng) {
  let bestIdx = 0;
  let bestDist = Infinity;
  Elevation.sampledPoints.forEach((p, i) => {
    const d = haversineMeters(p, latlng);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  });
  return bestIdx;
}

function onRouteHover(e) {
  if (!Elevation.chart || Elevation.sampledPoints.length === 0) return;
  const idx = nearestSampledIndex(e.latlng);
  showHoverMarker(Elevation.sampledPoints[idx]);
  Elevation.chart.setActiveElements([{ datasetIndex: 0, index: idx }]);
  Elevation.chart.tooltip.setActiveElements([{ datasetIndex: 0, index: idx }], { x: 0, y: 0 });
  Elevation.chart.update();
}

function onRouteHoverEnd() {
  hideHoverMarker();
  if (!Elevation.chart) return;
  Elevation.chart.setActiveElements([]);
  Elevation.chart.tooltip.setActiveElements([], { x: 0, y: 0 });
  Elevation.chart.update();
}

function showHoverMarker(point) {
  if (!Elevation.hoverMarker) {
    Elevation.hoverMarker = L.circleMarker([point.lat, point.lng], {
      radius: 7,
      color: '#fff',
      weight: 2,
      fillColor: '#0d9488',
      fillOpacity: 1,
    }).addTo(map);
  } else {
    Elevation.hoverMarker.setLatLng([point.lat, point.lng]);
  }
}

function hideHoverMarker() {
  if (Elevation.hoverMarker) {
    map.removeLayer(Elevation.hoverMarker);
    Elevation.hoverMarker = null;
  }
}

function renderChart(sampledPoints) {
  if (Elevation.chart) {
    Elevation.chart.destroy();
    Elevation.chart = null;
  }

  Elevation.chart = new Chart(elevationChartCanvas, {
    type: 'line',
    data: {
      labels: sampledPoints.map((p) => p.distanceKm.toFixed(1)),
      datasets: [{
        label: 'Elevation (m)',
        data: sampledPoints.map((p) => p.elevationMeters),
        borderColor: '#0d9488',
        backgroundColor: 'rgba(13, 148, 136, 0.14)',
        fill: true,
        pointRadius: 0,
        tension: 0.2,
      }],
    },
    options: {
      responsive: true,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      font: { family: "'Inter', sans-serif" },
      scales: {
        x: {
          title: { display: true, text: 'Distance (km)', font: { family: "'Inter', sans-serif", size: 11 }, color: '#98a2b3' },
          ticks: { font: { family: "'Inter', sans-serif", size: 10 }, color: '#98a2b3' },
          grid: { color: 'rgba(15, 23, 42, 0.06)' },
        },
        y: {
          title: { display: true, text: 'Elevation (m)', font: { family: "'Inter', sans-serif", size: 11 }, color: '#98a2b3' },
          ticks: { font: { family: "'Inter', sans-serif", size: 10 }, color: '#98a2b3' },
          grid: { color: 'rgba(15, 23, 42, 0.06)' },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#10162a',
          titleFont: { family: "'Inter', sans-serif", weight: '600' },
          bodyFont: { family: "'Inter', sans-serif" },
          padding: 8,
          cornerRadius: 8,
          displayColors: false,
        },
      },
      onHover: (event, elements) => {
        if (elements.length > 0) {
          showHoverMarker(sampledPoints[elements[0].index]);
        } else {
          hideHoverMarker();
        }
      },
    },
  });

  elevationChartCanvas.addEventListener('mouseleave', hideHoverMarker);
}

function clearElevation() {
  elevationRequestId++; // invalidate any in-flight fetch
  if (Elevation.startMarker) map.removeLayer(Elevation.startMarker);
  if (Elevation.endMarker) map.removeLayer(Elevation.endMarker);
  if (Elevation.routePolyline) map.removeLayer(Elevation.routePolyline);
  hideHoverMarker();
  if (Elevation.chart) {
    Elevation.chart.destroy();
    Elevation.chart = null;
  }
  Elevation.start = null;
  Elevation.end = null;
  Elevation.startMarker = null;
  Elevation.endMarker = null;
  Elevation.routePolyline = null;
  Elevation.sampledPoints = [];
  elevStartLabelEl.textContent = 'not set';
  elevEndLabelEl.textContent = 'not set';
  elevationSummaryEl.textContent = '';
  elevationStatusEl.textContent = '';
  document.getElementById('share-elevation-btn').disabled = true;
  document.getElementById('elevation-share-box').classList.add('hidden');
}

clearElevationBtn.addEventListener('click', clearElevation);
document.querySelectorAll('input[name="elevation-profile"]').forEach((input) => {
  input.addEventListener('change', () => {
    if (Elevation.start && Elevation.end) fetchElevationProfile();
  });
});

window.elevationOnMapClick = elevationOnMapClick;
