// Output: export what's on the map to GIS interchange formats.
//
// GeoJSON  — RFC 7946, opens anywhere (QGIS, ArcGIS, geojson.io).
// KML/KMZ  — Google Earth. KMZ is just a zipped KML.
// Shapefile— still the lingua franca in a lot of GIS shops.
//
// All coordinates are WGS 84 (EPSG:4326) in lng,lat order, which is what
// GeoJSON requires and what KML expects.

(function () {
  const statusEl = document.getElementById('export-status');

  function feature(geometry, properties) {
    return { type: 'Feature', geometry, properties: properties || {} };
  }

  function pointFeature(lat, lng, properties) {
    return feature({ type: 'Point', coordinates: [lng, lat] }, properties);
  }

  // Leaflet holds [lat,lng]; GeoJSON needs [lng,lat].
  function lineFromLatLngs(latlngs, properties) {
    return feature(
      { type: 'LineString', coordinates: latlngs.map((p) => [p.lng, p.lat]) },
      properties
    );
  }

  // Gather from whichever tools currently have something on the map. Each
  // block is guarded because a tool's state only exists once it's been used.
  function collectFeatures() {
    const features = [];

    if (typeof Planner !== 'undefined' && Planner.waypoints && Planner.waypoints.length) {
      Planner.waypoints.forEach((wp, i) => {
        features.push(
          pointFeature(wp.lat, wp.lng, {
            name: Naming.labelFor(wp, 'Stop ' + (i + 1)),
            tool: 'planner',
            role: 'waypoint',
            stop: i + 1,
          })
        );
      });
    }
    if (typeof plannerPolyline !== 'undefined' && plannerPolyline) {
      features.push(
        lineFromLatLngs(plannerPolyline.getLatLngs(), {
          name: 'Planned route',
          tool: 'planner',
          role: 'route',
        })
      );
    }

    if (typeof Alternatives !== 'undefined' && Alternatives.routes && Alternatives.routes.length) {
      if (Alternatives.start) {
        features.push(
          pointFeature(Alternatives.start.lat, Alternatives.start.lng, {
            name: Naming.labelFor(Alternatives.start, 'Start'),
            tool: 'alternatives',
            role: 'start',
          })
        );
      }
      if (Alternatives.end) {
        features.push(
          pointFeature(Alternatives.end.lat, Alternatives.end.lng, {
            name: Naming.labelFor(Alternatives.end, 'End'),
            tool: 'alternatives',
            role: 'end',
          })
        );
      }
      Alternatives.routes.forEach((r) => {
        if (!r.polyline) return;
        features.push(
          lineFromLatLngs(r.polyline.getLatLngs(), {
            name: 'Route option ' + (r.id + 1),
            tool: 'alternatives',
            role: 'route',
            option: r.id + 1,
            dist_m: Math.round(r.distanceMeters),
            dur_s: Math.round(r.durationSeconds),
          })
        );
      });
    }

    if (typeof Elevation !== 'undefined' && Elevation.routePolyline) {
      features.push(
        lineFromLatLngs(Elevation.routePolyline.getLatLngs(), {
          name: 'Elevation route',
          tool: 'elevation',
          role: 'route',
        })
      );
      (Elevation.sampledPoints || []).forEach((p, i) => {
        if (typeof p.elevationMeters !== 'number') return;
        features.push(
          pointFeature(p.lat, p.lng, {
            name: 'Sample ' + (i + 1),
            tool: 'elevation',
            role: 'sample',
            dist_km: Number(p.distanceKm.toFixed(4)),
            elev_m: p.elevationMeters,
          })
        );
      });
    }

    if (window.Sightline && Sightline.observer && Sightline.target) {
      features.push(
        pointFeature(Sightline.observer.lat, Sightline.observer.lng, {
          name: Naming.labelFor(Sightline.observer, 'Observer'),
          tool: 'sightline',
          role: 'observer',
        })
      );
      features.push(
        pointFeature(Sightline.target.lat, Sightline.target.lng, {
          name: Naming.labelFor(Sightline.target, 'Target'),
          tool: 'sightline',
          role: 'target',
        })
      );
      features.push(
        feature(
          {
            type: 'LineString',
            coordinates: [
              [Sightline.observer.lng, Sightline.observer.lat],
              [Sightline.target.lng, Sightline.target.lat],
            ],
          },
          {
            name: 'Sight line',
            tool: 'sightline',
            role: 'sight-line',
            visible: Sightline.lastVerdict === null ? 'unknown' : String(Sightline.lastVerdict),
          }
        )
      );
    }

    if (window.POI && POI.results && POI.results.length) {
      POI.results.forEach((r) => {
        features.push(
          pointFeature(r.lat, r.lng, { name: r.name, tool: 'poi', kind: r.kind || '' })
        );
      });
    }

    return features;
  }

  function collection() {
    return {
      type: 'FeatureCollection',
      // RFC 7946 dropped the "crs" member (all GeoJSON is WGS 84), so the note
      // lives in metadata instead of pretending to be a spec field.
      metadata: {
        source: 'RouteNavigator',
        exported: new Date().toISOString(),
        crs: 'EPSG:4326',
      },
      features: collectFeatures(),
    };
  }

  // ---- KML ----------------------------------------------------------------
  function xmlEscape(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function kmlFor(fc, docName) {
    const placemarks = fc.features
      .map((f) => {
        const props = f.properties || {};
        const name = xmlEscape(props.name || 'Feature');
        const desc = Object.keys(props)
          .filter((k) => k !== 'name')
          .map((k) => k + ': ' + props[k])
          .join('\n');

        let geom = '';
        if (f.geometry.type === 'Point') {
          geom =
            '<Point><coordinates>' +
            f.geometry.coordinates[0] + ',' + f.geometry.coordinates[1] + ',0' +
            '</coordinates></Point>';
        } else if (f.geometry.type === 'LineString') {
          const coords = f.geometry.coordinates
            .map((c) => c[0] + ',' + c[1] + ',0')
            .join(' ');
          geom =
            '<LineString><tessellate>1</tessellate><coordinates>' +
            coords +
            '</coordinates></LineString>';
        }

        return (
          '  <Placemark>\n' +
          '    <name>' + name + '</name>\n' +
          (desc ? '    <description>' + xmlEscape(desc) + '</description>\n' : '') +
          '    ' + geom + '\n' +
          '  </Placemark>'
        );
      })
      .join('\n');

    return (
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<kml xmlns="http://www.opengis.net/kml/2.2">\n' +
      '<Document>\n' +
      '  <name>' + xmlEscape(docName) + '</name>\n' +
      placemarks + '\n' +
      '</Document>\n</kml>\n'
    );
  }

  // ---- Download helpers ---------------------------------------------------
  function saveBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function stamp() {
    return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  }

  function say(message, isError) {
    statusEl.textContent = message;
    statusEl.classList.toggle('is-error', !!isError);
    if (!isError) setTimeout(() => { statusEl.textContent = ''; }, 2600);
  }

  // Loads a script once, on demand — KMZ and Shapefile each need a library,
  // and there's no reason to make every visitor download them up front.
  const loaded = {};
  function loadScript(url) {
    if (loaded[url]) return loaded[url];
    loaded[url] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load ' + url));
      document.head.appendChild(s);
    });
    return loaded[url];
  }

  const JSZIP_URL = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
  const SHPWRITE_URL = 'https://cdn.jsdelivr.net/npm/@mapbox/shp-write@0.4.3/shpwrite.js';

  // ---- Format handlers ----------------------------------------------------
  async function exportAs(format) {
    const fc = collection();
    if (fc.features.length === 0) {
      say('Nothing on the map to export yet.', true);
      return;
    }
    const base = 'routenavigator-' + stamp();

    try {
      if (format === 'geojson') {
        saveBlob(
          base + '.geojson',
          new Blob([JSON.stringify(fc, null, 2)], { type: 'application/geo+json' })
        );
        say('GeoJSON downloaded.');
        return;
      }

      if (format === 'kml') {
        saveBlob(
          base + '.kml',
          new Blob([kmlFor(fc, base)], {
            type: 'application/vnd.google-earth.kml+xml',
          })
        );
        say('KML downloaded.');
        return;
      }

      if (format === 'kmz') {
        say('Preparing KMZ…');
        await loadScript(JSZIP_URL);
        const zip = new JSZip();
        // KMZ convention: the main document is doc.kml at the archive root.
        zip.file('doc.kml', kmlFor(fc, base));
        const blob = await zip.generateAsync({
          type: 'blob',
          mimeType: 'application/vnd.google-earth.kmz',
        });
        saveBlob(base + '.kmz', blob);
        say('KMZ downloaded.');
        return;
      }

      if (format === 'shp') {
        say('Preparing shapefile…');
        await loadScript(SHPWRITE_URL);
        // A shapefile holds ONE geometry type, so shp-write emits a separate
        // layer per type inside the zip. Attribute names are truncated to 10
        // characters by the DBF format — that's the spec, not a bug here.
        const options = {
          folder: base,
          types: { point: 'points', polyline: 'lines', polygon: 'polygons' },
        };
        const result = shpwrite.zip(fc, options);
        // 0.4.x returns a base64 string; newer builds return a Blob/Promise.
        const blob =
          result instanceof Blob
            ? result
            : result && typeof result.then === 'function'
            ? await result
            : new Blob([Uint8Array.from(atob(result), (c) => c.charCodeAt(0))], {
                type: 'application/zip',
              });
        saveBlob(base + '-shapefile.zip', blob);
        say('Shapefile (zipped) downloaded.');
        return;
      }
    } catch (err) {
      say((err && err.message) || 'Export failed.', true);
    }
  }

  document.getElementById('export-formats').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-format]');
    if (!btn) return;
    exportAs(btn.dataset.format);
  });
})();
