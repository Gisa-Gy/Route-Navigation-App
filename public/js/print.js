// Output: printable map layout.
//
// A screenshot of the map isn't a map — a printed sheet needs a title block,
// a legend keyed to what's actually drawn, a scale, a north arrow, and the
// analysis numbers alongside. This module assembles that layout from live
// state, prints it, then tears it down again.

(function () {
  const titleInput = document.getElementById('print-title');
  const subtitleInput = document.getElementById('print-subtitle');
  const printBtn = document.getElementById('do-print-btn');
  const optsEl = document.getElementById('print-options');

  if (!printBtn) return;

  function opt(name) {
    const el = optsEl.querySelector('input[name="' + name + '"]');
    return el ? el.checked : false;
  }

  function fmtKm(m) {
    return (m / 1000).toFixed(2) + ' km';
  }

  function fmtMin(s) {
    return Math.round(s / 60) + ' min';
  }

  // ---- Legend, built only from layers that are actually on the map ---------
  function buildLegend() {
    const items = [];

    if (typeof Planner !== 'undefined' && Planner.waypoints.length) {
      items.push({ swatch: '#0b6e4f', shape: 'dot', label: 'Route stops' });
      if (typeof plannerPolyline !== 'undefined' && plannerPolyline) {
        items.push({ swatch: '#0b6e4f', shape: 'line', label: 'Planned route' });
      }
    }
    if (typeof Alternatives !== 'undefined' && Alternatives.routes.length) {
      Alternatives.routes.forEach((r) => {
        items.push({
          swatch: r.color,
          shape: 'line',
          label: 'Route option ' + (r.id + 1),
        });
      });
    }
    if (typeof Elevation !== 'undefined' && Elevation.routePolyline) {
      items.push({ swatch: '#0f766e', shape: 'line', label: 'Elevation route' });
    }
    if (window.Sightline && Sightline.observer && Sightline.target) {
      items.push({ swatch: '#6d28d9', shape: 'dot', label: 'Observer' });
      items.push({ swatch: '#c2410c', shape: 'dot', label: 'Target' });
    }
    if (window.POI && POI.results.length) {
      items.push({ swatch: '#0369a1', shape: 'dot', label: 'Points of interest' });
    }
    return items;
  }

  // ---- Analysis tables, one per tool that has results ----------------------
  function buildAnalysis() {
    const blocks = [];

    if (opt('planner') && typeof Planner !== 'undefined' && Planner.waypoints.length) {
      const rows = Planner.waypoints.map((wp, i) => [
        Naming.labelFor(wp, 'Stop ' + (i + 1)),
        wp.lat.toFixed(5) + ', ' + wp.lng.toFixed(5),
      ]);
      blocks.push({
        heading: 'Route stops',
        columns: ['Stop', 'Coordinates'],
        rows,
        note:
          Planner.mode === 'optimized'
            ? 'Stop order optimized by travelling-salesman solve.'
            : 'Stops in the order they were added.',
      });
    }

    if (opt('alternatives') && typeof Alternatives !== 'undefined' && Alternatives.routes.length) {
      const rows = Alternatives.routes.map((r) => [
        'Option ' + (r.id + 1),
        fmtKm(r.distanceMeters),
        fmtMin(r.durationSeconds),
      ]);
      blocks.push({
        heading: 'Route comparison',
        columns: ['Option', 'Distance', 'Duration'],
        rows,
      });
    }

    if (opt('elevation') && typeof Elevation !== 'undefined' && Elevation.sampledPoints.length) {
      const pts = Elevation.sampledPoints.filter(
        (p) => typeof p.elevationMeters === 'number'
      );
      if (pts.length) {
        const elevs = pts.map((p) => p.elevationMeters);
        let gain = 0;
        for (let i = 1; i < pts.length; i++) {
          const d = pts[i].elevationMeters - pts[i - 1].elevationMeters;
          if (d > 0) gain += d;
        }
        blocks.push({
          heading: 'Elevation profile',
          columns: ['Measure', 'Value'],
          rows: [
            ['Route length', fmtKm(pts[pts.length - 1].distanceKm * 1000)],
            ['Minimum elevation', Math.round(Math.min.apply(null, elevs)) + ' m'],
            ['Maximum elevation', Math.round(Math.max.apply(null, elevs)) + ' m'],
            ['Total ascent', Math.round(gain) + ' m'],
            ['Samples', String(pts.length)],
          ],
          note: 'Elevations sampled from SRTM (about 30 m posting).',
        });
      }
    }

    if (opt('sightline') && window.Sightline && Sightline.observer && Sightline.target) {
      const verdictEl = document.getElementById('los-verdict');
      blocks.push({
        heading: 'Line-of-sight analysis',
        columns: ['Measure', 'Value'],
        rows: [
          [
            'Observer',
            Naming.labelFor(Sightline.observer, 'Observer') +
              ' (' + Sightline.observer.lat.toFixed(5) + ', ' + Sightline.observer.lng.toFixed(5) + ')',
          ],
          [
            'Target',
            Naming.labelFor(Sightline.target, 'Target') +
              ' (' + Sightline.target.lat.toFixed(5) + ', ' + Sightline.target.lng.toFixed(5) + ')',
          ],
          [
            'Result',
            Sightline.lastVerdict === null
              ? 'not calculated'
              : Sightline.lastVerdict
              ? 'Target is visible'
              : 'View is blocked by terrain',
          ],
        ],
        note:
          (verdictEl ? verdictEl.textContent.trim().replace(/\s+/g, ' ') + ' ' : '') +
          'Ground surface only; buildings and vegetation are not modelled.',
      });
    }

    return blocks;
  }

  // ---- Layout assembly -----------------------------------------------------
  function scaleText() {
    // Leaflet's own scale control already computes a rounded distance for the
    // current zoom; reuse its text rather than recomputing it differently.
    const el = document.querySelector('.leaflet-control-scale-line');
    return el ? el.textContent : '';
  }

  function buildSheet() {
    const sheet = document.createElement('div');
    sheet.id = 'print-sheet';

    const title = (titleInput.value || '').trim() || 'RouteNavigator map';
    const subtitle = (subtitleInput.value || '').trim();
    const now = new Date();

    const legend = buildLegend();
    const analysis = buildAnalysis();
    const centre = map.getCenter();

    const head = document.createElement('header');
    head.className = 'sheet-head';
    head.innerHTML =
      '<div class="sheet-titles"><h1></h1><p class="sheet-sub"></p></div>' +
      '<div class="sheet-meta"></div>';
    head.querySelector('h1').textContent = title;
    if (subtitle) {
      head.querySelector('.sheet-sub').textContent = subtitle;
    } else {
      head.querySelector('.sheet-sub').remove();
    }
    head.querySelector('.sheet-meta').innerHTML =
      '<div>' + now.toLocaleDateString() + ' ' + now.toLocaleTimeString() + '</div>' +
      '<div>Centre ' + centre.lat.toFixed(5) + ', ' + centre.lng.toFixed(5) + '</div>' +
      '<div>Zoom ' + map.getZoom() + ' · WGS 84 (EPSG:4326)</div>';
    sheet.appendChild(head);

    // The map itself stays where it is in the DOM; the print stylesheet sizes
    // and positions it. This placeholder reserves its box in the flow.
    const mapSlot = document.createElement('div');
    mapSlot.className = 'sheet-map-slot';
    sheet.appendChild(mapSlot);

    const furniture = document.createElement('div');
    furniture.className = 'sheet-furniture';
    furniture.innerHTML =
      '<div class="sheet-north">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">' +
          '<path d="M12 2l3.2 8.4L12 8.9l-3.2 1.5z" fill="currentColor"/>' +
          '<path d="M12 8.9V22"/>' +
        '</svg><span>N</span>' +
      '</div>' +
      '<div class="sheet-scale"><span class="scale-bar"></span><span class="scale-text"></span></div>';
    furniture.querySelector('.scale-text').textContent = scaleText();
    sheet.appendChild(furniture);

    if (legend.length) {
      const leg = document.createElement('section');
      leg.className = 'sheet-legend';
      leg.innerHTML = '<h2>Legend</h2><ul></ul>';
      const ul = leg.querySelector('ul');
      legend.forEach((item) => {
        const li = document.createElement('li');
        const mark = document.createElement('span');
        mark.className = 'legend-mark legend-' + item.shape;
        mark.style.background = item.swatch;
        const text = document.createElement('span');
        text.textContent = item.label;
        li.appendChild(mark);
        li.appendChild(text);
        ul.appendChild(li);
      });
      sheet.appendChild(leg);
    }

    if (analysis.length) {
      const sec = document.createElement('section');
      sec.className = 'sheet-analysis';
      analysis.forEach((block) => {
        const h = document.createElement('h2');
        h.textContent = block.heading;
        sec.appendChild(h);

        const table = document.createElement('table');
        const thead = document.createElement('thead');
        const htr = document.createElement('tr');
        block.columns.forEach((c) => {
          const th = document.createElement('th');
          th.textContent = c;
          htr.appendChild(th);
        });
        thead.appendChild(htr);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        block.rows.forEach((r) => {
          const tr = document.createElement('tr');
          r.forEach((cell) => {
            const td = document.createElement('td');
            td.textContent = cell;
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        sec.appendChild(table);

        if (block.note) {
          const p = document.createElement('p');
          p.className = 'sheet-note';
          p.textContent = block.note;
          sec.appendChild(p);
        }
      });
      sheet.appendChild(sec);
    }

    const foot = document.createElement('footer');
    foot.className = 'sheet-foot';
    foot.textContent =
      'Produced with RouteNavigator. Basemap and routing data © OpenStreetMap ' +
      'contributors and their respective providers. Elevation: SRTM.';
    sheet.appendChild(foot);

    return sheet;
  }

  // Where the map lives normally, so it can be put back after printing.
  let mapHome = null;

  function run() {
    const existing = document.getElementById('print-sheet');
    if (existing) existing.remove();

    const sheet = buildSheet();
    document.body.appendChild(sheet);
    document.body.classList.add('printing');

    // Physically relocate the live map into the sheet's slot. Doing this in
    // the DOM is far more reliable than trying to reposition a fixed-position
    // map with print-only CSS.
    const mapEl = document.getElementById('map');
    if (!mapHome) mapHome = { parent: mapEl.parentNode, next: mapEl.nextSibling };
    sheet.querySelector('.sheet-map-slot').appendChild(mapEl);

    // Let the print layout apply, then tell Leaflet its container resized so
    // tiles fill the new map box instead of printing with gaps.
    setTimeout(() => {
      map.invalidateSize();
      setTimeout(() => window.print(), 350);
    }, 60);
  }

  function teardown() {
    document.body.classList.remove('printing');
    // Put the map back exactly where it was before removing the sheet.
    const mapEl = document.getElementById('map');
    if (mapHome && mapEl) {
      mapHome.parent.insertBefore(mapEl, mapHome.next);
    }
    const sheet = document.getElementById('print-sheet');
    if (sheet) sheet.remove();
    map.invalidateSize();
  }

  window.addEventListener('afterprint', teardown);
  printBtn.addEventListener('click', run);
})();
