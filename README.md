# RouteNavigator

A web GIS route-planning and terrain-analysis application. Leaflet client,
Node/Express backend that proxies routing, elevation and geocoding services.

## Tools

**Explore**
- **Search** — place/address search (Nominatim), with results usable as routing stops
- **Saved places** — bookmark map views and places, stored in the browser

**Routing**
- **Plan** — 2–5 waypoints, drag to reorder, optimize stop order (TSP via OSRM Trip)
- **Compare** — alternative routes between two points, ranked by distance and time
- **Profile** — walking/cycling elevation profile with chart-to-map hover sync

**Analysis**
- **Line of sight** — terrain-based visibility between an observer and a target,
  corrected for Earth curvature and atmospheric refraction

Route state can be encoded into a shareable URL.

## Architecture

```
Browser (Leaflet, Chart.js, vanilla JS — one module per tool)
   |  same-origin fetch
   v
Express (server.js)
   |  /api/route  /api/trip  /api/elevation  /api/geocode
   v
OSRM (routing, TSP) | Open-Elevation (SRTM) | Nominatim (geocoding)
```

The browser never calls upstream services directly. Beyond keeping rate-limit
handling and future API keys server-side, it is required: Nominatim's usage
policy mandates a descriptive `User-Agent`, which a browser cannot set.

### API contract

| Endpoint | Request | Response |
| --- | --- | --- |
| `POST /api/route` | `{ coordinates: [[lng,lat],...], profile? }` | `{ routes: [{ geometry, distanceMeters, durationSeconds }] }` |
| `POST /api/trip` | `{ coordinates: [[lng,lat],...] }` | `{ optimizedOrder, geometry, distanceMeters, durationSeconds }` |
| `POST /api/elevation` | `{ points: [[lat,lng],...] }` | `{ elevations: [{ elevationMeters }] }` |
| `GET /api/geocode?q=` | query string | `{ results: [{ name, lat, lng, boundingbox }] }` |

Coordinate order differs by endpoint (`[lng,lat]` for routing, `[lat,lng]` for
elevation) — this matches OSRM and the client respectively.

## Line-of-sight method

Terrain is sampled roughly every 50 m along the sight line (capped at 120
samples) and each sample is corrected for curvature and refraction using
`drop = (1 - k)·d² / 2R` with `k = 0.13`. The target is visible when no
intermediate sample rises above the straight line from the observer's eye to
the target's ground point.

**Data limitation, stated plainly:** Open-Elevation serves SRTM, a bare-earth
*terrain* model at roughly 30 m posting. Vegetation and buildings are not
represented, so a "visible" result means the *terrain* is clear — not that the
line is physically unobstructed. The interface says this too.

## Not implemented

Viewshed and least-cost path are deliberately absent. Both need a real DEM
raster and server-side grid processing; neither can be done honestly from
sampled point elevations, so no placeholder is shipped.

## Local development

Node 18+.

```bash
npm install
npm start   # http://localhost:3000
```

## Configuration

| Variable | Default |
| --- | --- |
| `PORT` | `3000` |
| `OSRM_DRIVING_URL` | `https://router.project-osrm.org` |
| `OSRM_FOOT_URL` | `https://routing.openstreetmap.de/routed-foot` |
| `OSRM_BIKE_URL` | `https://routing.openstreetmap.de/routed-bike` |
| `ELEVATION_URL` | `https://api.open-elevation.com/api/v1/lookup` |
| `NOMINATIM_URL` | `https://nominatim.openstreetmap.org/search` |
| `GEOCODER_USER_AGENT` | `RouteNavigator/1.0 (portfolio web GIS project)` |

## Upstream services

Defaults are public demo endpoints (OSRM, FOSSGIS, Open-Elevation, Nominatim).
They are rate-limited and their policies forbid heavy traffic — fine for a
portfolio demo, not for production load. Point the variables above at your own
instances to scale; no code change needed. OpenTopoMap is offered as a
selectable basemap rather than the default for the same reason.

## Deployment

Node **web service** on Render (`render.yaml` included):
build `npm install`, start `npm start`. `PORT` is provided by Render.
