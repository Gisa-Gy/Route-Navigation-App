// Analysis: line-of-sight between an observer and a target.
//
// This is a real terrain calculation, not a placeholder:
//   1. Sample points along the straight line between observer and target.
//   2. Fetch ground elevation for each sample (/api/elevation -> Open-Elevation,
//      backed by SRTM at roughly 30 m posting).
//   3. Correct each sample for Earth curvature and standard atmospheric
//      refraction, relative to the observer.
//   4. Compare the corrected terrain against the straight sight line from the
//      observer's eye to the target's ground point.
//
// Limits, stated rather than hidden: SRTM is a terrain model, so vegetation and
// buildings are absent. A "clear" result means clear *terrain*, and the tool
// says so in the UI.

(function () {
  const EARTH_RADIUS_M = 6371000;
  // Combined curvature + refraction: drop = (1 - k) * d^2 / (2R), k ~= 0.13
  // is the standard coefficient for visible-light refraction near the surface.
  const REFRACTION_K = 0.13;
  const TARGET_SPACING_M = 50; // aim for a sample roughly every 50 m
  const MAX_SAMPLES = 120; // server caps /api/elevation at 200 points

  const observerLabelEl = document.getElementById('los-observer-label');
  const targetLabelEl = document.getElementById('los-target-label');
  const heightEl = document.getElementById('los-observer-height');
  const verdictEl = document.getElementById('los-verdict');
  const statusEl = document.getElementById('los-status');
  const clearBtn = document.getElementById('clear-los-btn');
  const chartCanvas = document.getElementById('los-chart');

  let requestId = 0;

  const LOS = {
    observer: null,
    target: null,
    observerMarker: null,
    targetMarker: null,
    line: null,
    blockMarker: null,
    chart: null,
    lastVerdict: null, // true = visible, false = blocked; read by export.js
  };

  // Exposed so the GeoJSON exporter can include the current analysis.
  window.Sightline = LOS;

  function haversineMeters(a, b) {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
  }

  function curvatureDrop(distanceM) {
    return ((1 - REFRACTION_K) * distanceM * distanceM) / (2 * EARTH_RADIUS_M);
  }

  function onMapClick(latlng) {
    statusEl.textContent = '';
    if (!LOS.observer) {
      LOS.observer = latlng;
      if (LOS.observerMarker) map.removeLayer(LOS.observerMarker);
      LOS.observerMarker = L.marker(latlng, {
        icon: createPinIcon('O', 'var(--color-observer)', 24),
      }).addTo(map);
      Naming.renderEndpoint(observerLabelEl, LOS.observer, 'Observer', LOS.observerMarker);
    } else if (!LOS.target) {
      LOS.target = latlng;
      if (LOS.targetMarker) map.removeLayer(LOS.targetMarker);
      LOS.targetMarker = L.marker(latlng, {
        icon: createPinIcon('T', 'var(--color-target)', 24),
      }).addTo(map);
      Naming.renderEndpoint(targetLabelEl, LOS.target, 'Target', LOS.targetMarker);
      runAnalysis();
    }
    // Both set: further clicks ignored until Clear, matching the other tools.
  }

  function buildSamples(a, b) {
    const total = haversineMeters(a, b);
    const count = Math.max(
      3,
      Math.min(MAX_SAMPLES, Math.round(total / TARGET_SPACING_M) + 1)
    );
    const samples = [];
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      samples.push({
        lat: a.lat + (b.lat - a.lat) * t,
        lng: a.lng + (b.lng - a.lng) * t,
        distanceM: total * t,
      });
    }
    return { samples, total };
  }

  async function runAnalysis() {
    const id = ++requestId;
    clearResultLayers();
    statusEl.textContent = 'Sampling terrain along the sight line…';
    verdictEl.classList.add('hidden');

    const { samples, total } = buildSamples(LOS.observer, LOS.target);

    if (total < 1) {
      statusEl.textContent = 'Observer and target are at the same place.';
      return;
    }

    try {
      const res = await fetch('/api/elevation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points: samples.map((s) => [s.lat, s.lng]) }),
      });
      const data = await res.json();
      if (id !== requestId) return; // superseded by a newer run or a Clear
      if (!res.ok) {
        statusEl.textContent = data.error || 'Elevation data is unavailable right now.';
        return;
      }

      data.elevations.forEach((e, i) => {
        samples[i].elevationM = e.elevationMeters;
      });

      const observerHeight = Math.max(0, parseFloat(heightEl.value) || 0);
      const result = evaluate(samples, total, observerHeight);

      statusEl.textContent = '';
      drawLine(result);
      renderVerdict(result, total);
      renderChart(result);
    } catch (err) {
      if (id !== requestId) return;
      statusEl.textContent = 'Could not reach the elevation service.';
    }
  }

  // Core visibility test.
  function evaluate(samples, total, observerHeight) {
    const eyeElev = samples[0].elevationM + observerHeight;
    const targetGround = samples[samples.length - 1].elevationM;
    const targetAdj = targetGround - curvatureDrop(total);

    let blockedAt = null;
    let minClearance = Infinity;

    const points = samples.map((s, i) => {
      const terrainAdj = s.elevationM - curvatureDrop(s.distanceM);
      // Straight sight line from eye to the (curvature-adjusted) target ground.
      const lineElev = eyeElev + (targetAdj - eyeElev) * (s.distanceM / total);
      const clearance = lineElev - terrainAdj;

      // Endpoints are the observer and target themselves — they can't block.
      const isIntermediate = i > 0 && i < samples.length - 1;
      if (isIntermediate) {
        if (clearance < minClearance) minClearance = clearance;
        if (clearance < 0 && blockedAt === null) blockedAt = s;
      }
      return { ...s, terrainAdj, lineElev, clearance };
    });

    return {
      points,
      visible: blockedAt === null,
      blockedAt,
      minClearance: minClearance === Infinity ? null : minClearance,
      eyeElev,
      targetGround,
      observerHeight,
    };
  }

  function drawLine(result) {
    const a = [LOS.observer.lat, LOS.observer.lng];
    const b = [LOS.target.lat, LOS.target.lng];
    const color = result.visible ? '#0f8a5f' : '#c2410c';

    LOS.line = L.polyline([a, b], {
      color,
      weight: 4,
      opacity: 0.9,
      dashArray: result.visible ? null : '7 6',
    }).addTo(map);

    if (result.blockedAt) {
      LOS.blockMarker = L.circleMarker(
        [result.blockedAt.lat, result.blockedAt.lng],
        { radius: 7, color: '#fff', weight: 2.5, fillColor: '#c2410c', fillOpacity: 1 }
      )
        .addTo(map)
        .bindTooltip('Terrain blocks the view here', { direction: 'top' });
    }

    map.fitBounds(L.latLngBounds([a, b]), { padding: [50, 50] });
  }

  function renderVerdict(result, total) {
    const km = (total / 1000).toFixed(2);
    LOS.lastVerdict = result.visible;
    verdictEl.classList.remove('hidden');
    verdictEl.classList.toggle('is-visible', result.visible);
    verdictEl.classList.toggle('is-blocked', !result.visible);

    if (result.visible) {
      const clr =
        result.minClearance === null ? '—' : result.minClearance.toFixed(0) + ' m';
      verdictEl.innerHTML =
        '<strong>Target is visible</strong>' +
        '<span>Over ' + km + ' km, the sight line clears the terrain by ' + clr + ' at its tightest point.</span>';
    } else {
      const d = (result.blockedAt.distanceM / 1000).toFixed(2);
      verdictEl.innerHTML =
        '<strong>Target is hidden</strong>' +
        '<span>Terrain first blocks the view ' + d + ' km from the observer, over a total distance of ' + km + ' km.</span>';
    }
  }

  function renderChart(result) {
    if (LOS.chart) {
      LOS.chart.destroy();
      LOS.chart = null;
    }
    const labels = result.points.map((p) => (p.distanceM / 1000).toFixed(2));
    LOS.chart = new Chart(chartCanvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Terrain',
            data: result.points.map((p) => p.terrainAdj),
            borderColor: '#8a6d4b',
            backgroundColor: 'rgba(138, 109, 75, 0.18)',
            fill: true,
            pointRadius: 0,
            tension: 0.15,
            borderWidth: 1.5,
          },
          {
            label: 'Sight line',
            data: result.points.map((p) => p.lineElev),
            borderColor: result.visible ? '#0f8a5f' : '#c2410c',
            borderDash: [6, 4],
            fill: false,
            pointRadius: 0,
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            title: { display: true, text: 'Distance (km)', font: { size: 10 }, color: '#7b8794' },
            ticks: { font: { size: 9 }, color: '#7b8794', maxTicksLimit: 7 },
            grid: { color: 'rgba(15, 23, 42, 0.05)' },
          },
          y: {
            title: { display: true, text: 'Elevation (m)', font: { size: 10 }, color: '#7b8794' },
            ticks: { font: { size: 9 }, color: '#7b8794' },
            grid: { color: 'rgba(15, 23, 42, 0.05)' },
          },
        },
        plugins: {
          legend: {
            display: true,
            labels: { boxWidth: 10, font: { size: 10 }, color: '#4a5561' },
          },
          tooltip: { padding: 8, cornerRadius: 8, displayColors: false },
        },
      },
    });
  }

  function clearResultLayers() {
    if (LOS.line) {
      map.removeLayer(LOS.line);
      LOS.line = null;
    }
    if (LOS.blockMarker) {
      map.removeLayer(LOS.blockMarker);
      LOS.blockMarker = null;
    }
    if (LOS.chart) {
      LOS.chart.destroy();
      LOS.chart = null;
    }
  }

  function clearAll() {
    requestId++; // invalidate any in-flight run
    clearResultLayers();
    if (LOS.observerMarker) map.removeLayer(LOS.observerMarker);
    if (LOS.targetMarker) map.removeLayer(LOS.targetMarker);
    LOS.observer = null;
    LOS.target = null;
    LOS.observerMarker = null;
    LOS.targetMarker = null;
    observerLabelEl.textContent = 'not set';
    targetLabelEl.textContent = 'not set';
    verdictEl.classList.add('hidden');
    verdictEl.innerHTML = '';
    statusEl.textContent = '';
  }

  clearBtn.addEventListener('click', clearAll);

  // Re-run when the observer height changes and both points are already set.
  heightEl.addEventListener('change', () => {
    if (LOS.observer && LOS.target) runAnalysis();
  });

  window.registerModeHandler('sightline', onMapClick);
})();
