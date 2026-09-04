// RouteNavigator backend proxy.
//
// The browser client (public/js/*.js) calls three same-origin endpoints:
//   POST /api/route      -> OSRM /route     (with alternatives)
//   POST /api/trip       -> OSRM /trip      (waypoint order optimization)
//   POST /api/elevation  -> Open-Elevation  (point elevations)
//
// This server owns those upstream calls so the frontend never talks to a
// third-party service directly: rate-limit handling, error normalization,
// and any future API keys stay server-side. The response shapes below are
// dictated by what the client already reads — do not change them without
// updating the client in lockstep.

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '256kb' }));

// A malformed body would otherwise fall through to Express's default handler,
// which returns an HTML stack trace. The client only ever parses JSON, so keep
// errors in that shape (and don't leak internals to the browser).
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body must be valid JSON.' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large.' });
  }
  next(err);
});

// ---------------------------------------------------------------------------
// Upstream configuration
// ---------------------------------------------------------------------------

// OSRM demo servers are split by profile (each host is a separate OSRM
// instance built with that profile's data). The client sends 'foot'/'bike'
// from the elevation tool, or omits profile for driving (planner/alternatives).
//
// NOTE: router.project-osrm.org is a DEMO server. Its usage policy forbids
// heavy/production traffic and it rate-limits. Fine for a portfolio demo.
// To productionize, set OSRM_DRIVING_URL/OSRM_FOOT_URL/OSRM_BIKE_URL to your
// own OSRM instances (or a keyed provider) via environment variables.
const OSRM_HOSTS = {
  driving: process.env.OSRM_DRIVING_URL || 'https://router.project-osrm.org',
  foot: process.env.OSRM_FOOT_URL || 'https://routing.openstreetmap.de/routed-foot',
  bike: process.env.OSRM_BIKE_URL || 'https://routing.openstreetmap.de/routed-bike',
};

// Map the client's profile strings to an upstream host + OSRM profile slug.
function resolveProfile(profile) {
  if (profile === 'foot') return { host: OSRM_HOSTS.foot, slug: 'foot' };
  if (profile === 'bike') return { host: OSRM_HOSTS.bike, slug: 'bike' };
  return { host: OSRM_HOSTS.driving, slug: 'driving' };
}

const ELEVATION_URL =
  process.env.ELEVATION_URL || 'https://api.open-elevation.com/api/v1/lookup';

// Node 18+ has global fetch. Guard so an old runtime fails loudly, not weirdly.
if (typeof fetch !== 'function') {
  console.error('This server requires Node 18+ (global fetch). Current: ' + process.version);
  process.exit(1);
}

// Wrap fetch with a timeout so a hung upstream can't hang our request forever.
async function fetchWithTimeout(url, options = {}, ms = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

// A valid coordinate is [lng, lat] with finite numbers in range.
function isValidLngLat(pair) {
  return (
    Array.isArray(pair) &&
    pair.length === 2 &&
    Number.isFinite(pair[0]) &&
    Number.isFinite(pair[1]) &&
    pair[0] >= -180 && pair[0] <= 180 &&
    pair[1] >= -90 && pair[1] <= 90
  );
}

function validateCoordinates(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    return 'Provide at least two coordinates.';
  }
  if (coordinates.length > 25) {
    return 'Too many coordinates (max 25).';
  }
  if (!coordinates.every(isValidLngLat)) {
    return 'Coordinates must be [lng, lat] pairs within valid ranges.';
  }
  return null;
}

// OSRM wants "lng,lat;lng,lat;..." in the URL path.
function toOsrmPath(coordinates) {
  return coordinates.map(([lng, lat]) => `${lng},${lat}`).join(';');
}

// Normalize one OSRM route object into the client's shape.
function toClientRoute(osrmRoute) {
  return {
    geometry: osrmRoute.geometry, // GeoJSON LineString: { type, coordinates:[[lng,lat],...] }
    distanceMeters: osrmRoute.distance,
    durationSeconds: osrmRoute.duration,
  };
}

// ---------------------------------------------------------------------------
// POST /api/route  — routing with alternatives
// ---------------------------------------------------------------------------
app.post('/api/route', async (req, res) => {
  const { coordinates, profile } = req.body || {};
  const err = validateCoordinates(coordinates);
  if (err) return res.status(400).json({ error: err });

  const { host, slug } = resolveProfile(profile);
  const url =
    `${host}/route/v1/${slug}/${toOsrmPath(coordinates)}` +
    `?overview=full&geometries=geojson&alternatives=true`;

  try {
    const upstream = await fetchWithTimeout(url);
    const data = await upstream.json().catch(() => null);

    if (!data || data.code !== 'Ok' || !Array.isArray(data.routes) || data.routes.length === 0) {
      const msg =
        data && data.code === 'NoRoute'
          ? 'No route found between those points.'
          : 'Routing service could not compute a route.';
      return res.status(502).json({ error: msg });
    }

    res.json({ routes: data.routes.map(toClientRoute) });
  } catch (e) {
    const aborted = e && e.name === 'AbortError';
    res.status(504).json({
      error: aborted ? 'Routing service timed out.' : 'Could not reach the routing service.',
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/trip  — waypoint order optimization (OSRM Trip / TSP)
// ---------------------------------------------------------------------------
app.post('/api/trip', async (req, res) => {
  const { coordinates, profile } = req.body || {};
  const err = validateCoordinates(coordinates);
  if (err) return res.status(400).json({ error: err });

  const { host, slug } = resolveProfile(profile);
  // roundtrip=false + fixed source/destination keeps the first and last stop
  // pinned; OSRM reorders only the intermediate waypoints.
  const url =
    `${host}/trip/v1/${slug}/${toOsrmPath(coordinates)}` +
    `?overview=full&geometries=geojson&roundtrip=false&source=first&destination=last`;

  try {
    const upstream = await fetchWithTimeout(url);
    const data = await upstream.json().catch(() => null);

    if (!data || data.code !== 'Ok' || !Array.isArray(data.trips) || data.trips.length === 0) {
      return res.status(502).json({ error: 'Could not optimize the waypoint order.' });
    }

    const trip = data.trips[0];
    // waypoints[i].waypoint_index = visiting position of the i-th input point.
    // This is exactly what the client calls optimizedOrder.
    const optimizedOrder = data.waypoints.map((w) => w.waypoint_index);

    res.json({
      optimizedOrder,
      geometry: trip.geometry,
      distanceMeters: trip.distance,
      durationSeconds: trip.duration,
    });
  } catch (e) {
    const aborted = e && e.name === 'AbortError';
    res.status(504).json({
      error: aborted ? 'Optimization service timed out.' : 'Could not reach the routing service.',
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/elevation  — point elevations
// ---------------------------------------------------------------------------
app.post('/api/elevation', async (req, res) => {
  const { points } = req.body || {};
  // Client sends [[lat, lng], ...] here (note: lat,lng — different from /route).
  if (!Array.isArray(points) || points.length === 0) {
    return res.status(400).json({ error: 'Provide at least one point.' });
  }
  if (points.length > 200) {
    return res.status(400).json({ error: 'Too many points (max 200).' });
  }
  const valid = points.every(
    (p) =>
      Array.isArray(p) &&
      p.length === 2 &&
      Number.isFinite(p[0]) && p[0] >= -90 && p[0] <= 90 &&
      Number.isFinite(p[1]) && p[1] >= -180 && p[1] <= 180
  );
  if (!valid) {
    return res.status(400).json({ error: 'Points must be [lat, lng] pairs within valid ranges.' });
  }

  const body = JSON.stringify({
    locations: points.map(([lat, lng]) => ({ latitude: lat, longitude: lng })),
  });

  try {
    const upstream = await fetchWithTimeout(
      ELEVATION_URL,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body },
      20000
    );
    const data = await upstream.json().catch(() => null);

    if (!data || !Array.isArray(data.results) || data.results.length !== points.length) {
      return res.status(502).json({ error: 'Elevation data is unavailable right now.' });
    }

    res.json({
      elevations: data.results.map((r) => ({ elevationMeters: r.elevation })),
    });
  } catch (e) {
    const aborted = e && e.name === 'AbortError';
    res.status(504).json({
      error: aborted ? 'Elevation service timed out.' : 'Could not reach the elevation service.',
    });
  }
});

// ---------------------------------------------------------------------------
// GET /api/geocode?q=...  — place search (Nominatim)
// ---------------------------------------------------------------------------
// Nominatim's usage policy REQUIRES a descriptive User-Agent identifying the
// application. A browser cannot set that header, which is one concrete reason
// this call belongs on the server rather than in the client.
const NOMINATIM_URL = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org/search';
const GEOCODER_UA =
  process.env.GEOCODER_USER_AGENT || 'RouteNavigator/1.0 (portfolio web GIS project)';

app.get('/api/geocode', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (q.length < 2) {
    return res.status(400).json({ error: 'Enter at least two characters to search.' });
  }

  const url =
    `${NOMINATIM_URL}?format=jsonv2&limit=6&addressdetails=1&q=${encodeURIComponent(q)}`;

  try {
    const upstream = await fetchWithTimeout(url, {
      headers: { 'User-Agent': GEOCODER_UA, 'Accept-Language': 'en' },
    }, 12000);

    if (upstream.status === 429) {
      return res.status(429).json({ error: 'Search is rate limited right now. Try again shortly.' });
    }

    const data = await upstream.json().catch(() => null);
    if (!Array.isArray(data)) {
      return res.status(502).json({ error: 'Search service is unavailable right now.' });
    }

    res.json({
      results: data.map((r) => ({
        name: r.display_name,
        lat: parseFloat(r.lat),
        lng: parseFloat(r.lon),
        category: r.category || null,
        type: r.type || null,
        // [south, north, west, east] -> pass through for map fitting
        boundingbox: Array.isArray(r.boundingbox) ? r.boundingbox.map(Number) : null,
      })),
    });
  } catch (e) {
    const aborted = e && e.name === 'AbortError';
    res.status(504).json({
      error: aborted ? 'Search timed out.' : 'Could not reach the search service.',
    });
  }
});

// ---------------------------------------------------------------------------
// Static client + health check
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// GET /api/poi?category=...&bbox=s,w,n,e  — OSM points of interest (Overpass)
// ---------------------------------------------------------------------------
// Categories are a fixed server-side whitelist rather than free-form tags, so a
// caller can't craft an arbitrary (and potentially very expensive) Overpass
// query through this endpoint.
const OVERPASS_URL = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';

const POI_CATEGORIES = {
  food: [['amenity', 'restaurant'], ['amenity', 'cafe'], ['amenity', 'fast_food']],
  lodging: [['tourism', 'hotel'], ['tourism', 'guest_house'], ['tourism', 'hostel']],
  fuel: [['amenity', 'fuel'], ['amenity', 'charging_station']],
  health: [['amenity', 'hospital'], ['amenity', 'clinic'], ['amenity', 'pharmacy']],
  education: [['amenity', 'school'], ['amenity', 'university'], ['amenity', 'college']],
  money: [['amenity', 'bank'], ['amenity', 'atm']],
  shops: [['shop', 'supermarket'], ['shop', 'convenience'], ['shop', 'mall']],
  transport: [['amenity', 'bus_station'], ['public_transport', 'station'], ['aeroway', 'aerodrome']],
};

app.get('/api/poi', async (req, res) => {
  const category = (req.query.category || '').toString();
  const tags = POI_CATEGORIES[category];
  if (!tags) {
    return res.status(400).json({ error: 'Unknown category.' });
  }

  const parts = (req.query.bbox || '').toString().split(',').map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite)) {
    return res.status(400).json({ error: 'A bbox of s,w,n,e is required.' });
  }
  const [s, w, n, e] = parts;
  if (s >= n || w >= e || s < -90 || n > 90 || w < -180 || e > 180) {
    return res.status(400).json({ error: 'bbox values are out of range.' });
  }
  // Overpass bills by area; refuse absurd extents rather than hammering it.
  if ((n - s) * (e - w) > 4) {
    return res.status(400).json({ error: 'Zoom in further to search for places here.' });
  }

  const bbox = `${s},${w},${n},${e}`;
  // nwr = nodes, ways and relations, so POIs mapped as buildings are included.
  const clauses = tags.map(([k, v]) => `nwr["${k}"="${v}"](${bbox});`).join('');
  const query = `[out:json][timeout:20];(${clauses});out center 60;`;

  try {
    const upstream = await fetchWithTimeout(
      OVERPASS_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': GEOCODER_UA,
        },
        body: 'data=' + encodeURIComponent(query),
      },
      25000
    );

    if (upstream.status === 429 || upstream.status === 504) {
      return res.status(429).json({ error: 'The places service is busy. Try again shortly.' });
    }

    const data = await upstream.json().catch(() => null);
    if (!data || !Array.isArray(data.elements)) {
      return res.status(502).json({ error: 'The places service is unavailable right now.' });
    }

    const results = data.elements
      .map((el) => {
        // Ways/relations carry their centroid in `center`; nodes have lat/lon.
        const lat = el.lat != null ? el.lat : el.center && el.center.lat;
        const lng = el.lon != null ? el.lon : el.center && el.center.lon;
        const t = el.tags || {};
        if (lat == null || lng == null || !t.name) return null;
        return {
          name: t.name,
          lat,
          lng,
          kind: t.amenity || t.tourism || t.shop || t.public_transport || t.aeroway || null,
        };
      })
      .filter(Boolean);

    res.json({ results });
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    res.status(504).json({
      error: aborted ? 'The places search timed out.' : 'Could not reach the places service.',
    });
  }
});

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`RouteNavigator running on http://localhost:${PORT}`);
});
