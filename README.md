# RouteNavigator

A lightweight web GIS route-planning application. Interactive Leaflet map with
three tools that share one map:

- **Planner** — drop 2–5 waypoints, get a route, and optimize the stop order (TSP).
- **Alternatives** — set a start and end, compare parallel route options.
- **Elevation** — walking/cycling profile with an elevation chart synced to map hover.

Plus shareable URLs that encode the current route state.

## Architecture

```
Browser (Leaflet + Chart.js, vanilla JS)
   |  same-origin fetch: /api/route, /api/trip, /api/elevation
   v
Express server (server.js)
   |  proxies to upstream services (keeps rate limits / keys server-side)
   v
OSRM (routing + trip optimization)  +  Open-Elevation (point elevations)
```

The browser never calls the upstream map services directly — the Express
layer owns those calls. That keeps third-party URLs and any future API keys
off the client and gives one place to normalize errors and handle rate limits.

### API contract (server ↔ client)

| Endpoint | Request body | Response |
| --- | --- | --- |
| `POST /api/route` | `{ coordinates: [[lng,lat],...], profile? }` | `{ routes: [{ geometry, distanceMeters, durationSeconds }, ...] }` |
| `POST /api/trip` | `{ coordinates: [[lng,lat],...], profile? }` | `{ optimizedOrder, geometry, distanceMeters, durationSeconds }` |
| `POST /api/elevation` | `{ points: [[lat,lng],...] }` | `{ elevations: [{ elevationMeters }, ...] }` |

Note the coordinate order differs by endpoint (`[lng,lat]` for routing,
`[lat,lng]` for elevation) — this matches what the client sends.

## Local development

Requires Node 18+.

```bash
npm install
npm start
# open http://localhost:3000
```

## Configuration

All upstream URLs are overridable via environment variables (defaults in
`server.js`):

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on (Render sets this automatically) |
| `OSRM_DRIVING_URL` | `https://router.project-osrm.org` | Driving routing/trip |
| `OSRM_FOOT_URL` | `https://routing.openstreetmap.de/routed-foot` | Walking routing |
| `OSRM_BIKE_URL` | `https://routing.openstreetmap.de/routed-bike` | Cycling routing |
| `ELEVATION_URL` | `https://api.open-elevation.com/api/v1/lookup` | Point elevations |

## ⚠️ On the default upstream servers

The defaults are **public demo servers** (OSRM's `router.project-osrm.org`,
the FOSSGIS `routing.openstreetmap.de` instances, and Open-Elevation). They
are rate-limited and their usage policies forbid heavy/production traffic.
They are fine for a portfolio demo you walk people through.

For anything under real load, stand up your own OSRM instance(s) and elevation
source and point the environment variables above at them — no code change is
needed.

## Deployment (Render)

This repo includes `render.yaml`, so you can deploy as a **Node web service**
either via Render's Blueprint flow or by configuring manually:

- Build command: `npm install`
- Start command: `npm start`

Render provides `PORT` automatically. See the deployment walkthrough for
step-by-step instructions.
