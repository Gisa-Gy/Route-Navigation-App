// Output: export the current map contents as GeoJSON, and print the map.
//
// GeoJSON is the interchange format a GIS audience expects — the download opens
// directly in QGIS, ArcGIS Pro, or geojson.io. Everything is written in WGS84
// (EPSG:4326) lng,lat order, which is what the GeoJSON spec requires.

(function () {
  const exportBtn = document.getElementById('export-btn');
  const printBtn = document.getElementById('print-btn');

  function feature(geometry, properties) {
    return { type: 'Feature', geometry, properties: properties || {} };
  }

  function pointFeature(lat, lng, properties) {
    return feature({ type: 'Point', coordinates: [lng, lat] }, properties);
  }

  // Leaflet polylines hold [lat,lng]; GeoJSON needs [lng,lat].
  function lineFromLatLngs(latlngs, properties) {
    return feature(
      { type: 'LineString', coordinates: latlngs.map((p) => [p.lng, p.lat]) },
      properties
    );
  }

  // Collect from whichever tools currently have something on the map. Each
  // block is guarded because a tool's globals only exist once its script ran
  // and the user has actually used it.
  function collectFeatures() {
    const features = [];

    if (typeof Planner !== 'undefined' && Planner.waypoints && Planner.waypoints.length) {
      Planner.waypoints.forEach((wp, i) => {
        features.push(
          pointFeature(wp.lat, wp.lng, { tool: 'planner', role: 'waypoint', stop: i + 1 })
        );
      });
    }
    // plannerPolyline is a top-level binding in route-planner.js, which is
    // reachable from here in classic (non-module) scripts.
    if (typeof plannerPolyline !== 'undefined' && plannerPolyline) {
      features.push(
        lineFromLatLngs(plannerPolyline.getLatLngs(), { tool: 'planner', role: 'route' })
      );
    }

    if (typeof Alternatives !== 'undefined' && Alternatives.routes && Alternatives.routes.length) {
      if (Alternatives.start) {
        features.push(
          pointFeature(Alternatives.start.lat, Alternatives.start.lng, {
            tool: 'alternatives', role: 'start',
          })
        );
      }
      if (Alternatives.end) {
        features.push(
          pointFeature(Alternatives.end.lat, Alternatives.end.lng, {
            tool: 'alternatives', role: 'end',
          })
        );
      }
      Alternatives.routes.forEach((r) => {
        if (!r.polyline) return;
        features.push(
          lineFromLatLngs(r.polyline.getLatLngs(), {
            tool: 'alternatives',
            role: 'route',
            option: r.id + 1,
            distance_m: Math.round(r.distanceMeters),
            duration_s: Math.round(r.durationSeconds),
          })
        );
      });
    }

    if (typeof Elevation !== 'undefined' && Elevation.routePolyline) {
      features.push(
        lineFromLatLngs(Elevation.routePolyline.getLatLngs(), {
          tool: 'elevation', role: 'route',
        })
      );
      (Elevation.sampledPoints || []).forEach((p, i) => {
        if (typeof p.elevationMeters !== 'number') return;
        features.push(
          pointFeature(p.lat, p.lng, {
            tool: 'elevation',
            role: 'sample',
            index: i,
            distance_km: Number(p.distanceKm.toFixed(4)),
            elevation_m: p.elevationMeters,
          })
        );
      });
    }

    if (window.Sightline && Sightline.observer && Sightline.target) {
      features.push(
        pointFeature(Sightline.observer.lat, Sightline.observer.lng, {
          tool: 'sightline', role: 'observer',
        })
      );
      features.push(
        pointFeature(Sightline.target.lat, Sightline.target.lng, {
          tool: 'sightline', role: 'target',
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
          { tool: 'sightline', role: 'sight-line', visible: Sightline.lastVerdict || null }
        )
      );
    }

    return features;
  }

  function download(filename, text) {
    const blob = new Blob([text], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoke on the next tick so the click has definitely been handled.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function flash(button, message) {
    const label = button.querySelector('span');
    if (!label) return;
    const original = label.textContent;
    label.textContent = message;
    button.classList.add('flash');
    setTimeout(() => {
      label.textContent = original;
      button.classList.remove('flash');
    }, 1600);
  }

  exportBtn.addEventListener('click', () => {
    const features = collectFeatures();
    if (features.length === 0) {
      flash(exportBtn, 'Nothing yet');
      return;
    }
    const fc = {
      type: 'FeatureCollection',
      // Name the CRS in metadata rather than the deprecated GeoJSON "crs"
      // member, which RFC 7946 removed (all GeoJSON is WGS84 by definition).
      metadata: {
        source: 'RouteNavigator',
        exported: new Date().toISOString(),
        crs: 'EPSG:4326',
      },
      features,
    };
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    download('routenavigator-' + stamp + '.geojson', JSON.stringify(fc, null, 2));
    flash(exportBtn, 'Downloaded');
  });

  printBtn.addEventListener('click', () => {
    // Leaflet needs a resize nudge after the print stylesheet changes the map
    // box, otherwise tiles can print with gaps.
    map.invalidateSize();
    setTimeout(() => window.print(), 150);
  });
})();
