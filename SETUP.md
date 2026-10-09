# LeafPace (Week 1 — Touch Grass) Setup Guide

This document contains full details for setting up, running, testing, and
deploying the **LeafPace** PWA both on a local machine and on mobile devices.

---

## 1. Project Overview

- **Name:** LeafPace (🍃)
- **Theme:** Week 1 — *Touch Grass*
- **Goal:** Get runners, walkers, and hikers outside and off their screens in under 30 seconds.
- **AI Core:** On-device open-weight LLM inference via **WebGPU** (e.g. `SmolLM2` / `Qwen2.5-Instruct`), running 100% inside the browser on phone/laptop hardware.
- **Geospatial Engine:** OpenStreetMap (OSM) Overpass API + OSRM foot routing engine for nature-biased circular loops.
- **Export:** Instant GPX 1.1 download / share for Garmin, Apple Watch, Strava, and offline maps.

---

## 2. Directory Structure

```
Hacktoberfest/
├── designweek1.md               # Full architecture & design spec
├── week1-leafpace/              # Project workspace
│   ├── SETUP.md                 # This file
│   ├── package.json             # NPM dependencies & scripts
│   ├── tsconfig.json            # TypeScript configuration
│   ├── vite.config.ts           # Vite + PWA + code-split configuration
│   ├── tailwind.config.js       # Outdoor-themed Tailwind tokens
│   ├── index.html               # Mobile-optimized entry HTML
│   ├── public/
│   │   ├── manifest.json        # PWA Web App Manifest
│   │   └── icon.svg             # LeafPace brand icon
│   └── src/
│       ├── main.tsx             # Application bootstrap
│       ├── App.tsx              # Main mobile container
│       ├── types.ts             # TypeScript interfaces
│       ├── utils.ts             # Pure utility helpers (clamp, format, shade)
│       ├── __tests__/
│       │   └── core.test.ts     # Unit tests (vitest)
│       ├── components/
│       │   ├── MapView.tsx      # Leaflet map with route layer
│       │   ├── RouteControls.tsx# Distance, activity & greenery controls
│       │   ├── TrailBriefing.tsx# Local WebGPU AI briefing card
│       │   └── HandOffModal.tsx # GPX export & "Touch Grass" screen-off
│       ├── services/
│       │   ├── routing.ts       # OSM Overpass + OSRM loop generator
│       │   ├── greenSpaceHelper.ts # Green space selection & sorting
│       │   ├── solar.ts         # Sun azimuth & elevation calculator
│       │   ├── webgpu-llm.ts    # On-device WebGPU model runner (lazy-loaded)
│       │   └── gpx.ts           # GPX 1.1 file builder
│       └── styles/
│           └── index.css        # Tailwind & mobile CSS styles
```

---

## 3. Tech Stack & Dependencies

| Tool | Purpose |
| :--- | :--- |
| **Vite + React + TypeScript** | Blazing-fast development server and optimized production build |
| **Tailwind CSS** | Outdoor-friendly, high-contrast responsive styling |
| **Lucide React** | Clean, minimalist outdoor icons |
| **Leaflet** | Interactive open-source mapping |
| **@mlc-ai/web-llm** | Client-side on-device WebGPU open model execution (lazy-loaded) |
| **SunCalc** | Local astronomical calculation for sun position & shade |
| **Vitest** | Unit test runner |

---

## 4. How to Install & Run

### Step 1: Install Dependencies
```bash
cd week1-leafpace
npm install
```

### Step 2: Start Local Dev Server
```bash
npm run dev
```
This starts the dev server at `http://localhost:5173` with hot module replacement.

### Step 3: Accessing from Your Phone
The dev server binds to all network interfaces by default (`host: true`
in `vite.config.ts`).  Open the network URL printed in the terminal
(e.g. `http://192.168.1.X:5173`) in **Safari (iOS)** or **Chrome (Android)**.

### Step 4: Run Tests
```bash
npm test          # Single run
npm run test:watch  # Watch mode
```

### Step 5: Production Build
```bash
npm run build
npm run preview   # Serve the production bundle locally
```

---

## 5. Enabling WebGPU on Your Device

WebGPU is required for on-device open-weight model inference.  When
WebGPU is unavailable LeafPace falls back to a **deterministic instant
template generator** — the app never blocks.

| Platform | Status |
| :--- | :--- |
| **Chrome 121+** (Desktop / Android) | Enabled by default on supported GPUs. |
| **Edge 121+** | Enabled by default. |
| **Safari 18+ / iOS 17.4+** | Available behind a feature flag (Settings → Safari → Advanced → Feature Flags → WebGPU). |
| **Firefox Nightly** | `dom.webgpu.enabled` in `about:config`. |

If your browser does not expose `navigator.gpu` the header badge will
show **"Local WebGPU"** (ready but not loaded); when the model has been
downloaded and compiled it switches to **"WebGPU Active"**.

---

## 6. Offline Behaviour

| Scenario | What happens |
| :--- | :--- |
| **Overpass mirrors down / rate-limited** | The public mirrors are raced in parallel; if none answers within ~2.5s LeafPace also queries **Nominatim** (a separate OSM service with independent infrastructure) so the loop is still seeded with *real* parks. Synthetic parks are used only when both services fail. |
| **No internet at all** | Every green-space lookup fails and LeafPace generates a synthetic green-loop fallback using nearby simulated parks. OSRM also falls back to a smooth geometric spline (or the Valhalla pedestrian engine). The header shows an **Offline** badge. |
| **Internet available → loses signal mid-session** | Routes already generated remain in memory. GPX export works offline. The WebGPU model weights, once cached in IndexedDB, execute fully offline. |
| **PWA installed to Home Screen** | The service worker caches the application shell. On subsequent launches the app loads instantly even without a network connection. |

---

## 7. Swapping the Open-Weight Model

LeafPace is designed to let you swap models without changing any UI code.

1. Open [`src/services/webgpu-llm.ts`](src/services/webgpu-llm.ts).
2. Change the `SELECTED_MODEL` constant to any model ID supported by
   [WebLLM's model list](https://webllm.mlc.ai/#702):

   ```ts
   export const SELECTED_MODEL = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';
   ```

3. Restart the dev server.  The new model weights will be downloaded and
   cached automatically on first use.

---

## 8. FAQ

**Q: The map is grey / tiles are not loading.**
A: LeafPace uses the keyless `tile.openstreetmap.org` tile server (CARTO's
free basemaps now answer every request with an "API key required" placeholder
image).  If the map is grey, a firewall or your network is blocking OSM
tiles — try a different network, or swap in any other XYZ tile URL in
`MapView.tsx`.

**Q: Can I use a different mapping provider?**
A: Yes — replace the `L.tileLayer(...)` URL in
[`MapView.tsx`](src/components/MapView.tsx) with any Leaflet-compatible
XYZ tile URL.

**Q: My GPS isn't working / the "My GPS" button does nothing.**
A: Three things to check:
1. **Secure origin** — browsers block geolocation on plain-http addresses
   like `http://192.168.x.x`. Use `https://` (or `localhost`) — on a phone
   that usually means deploying the PWA somewhere with TLS.
2. **Permission** — allow Location for the site (padlock icon → Site
   settings → Location → Allow), then tap "My GPS" again.
3. **OS location services** — make sure your system's location is enabled.

LeafPace shows the exact reason in an amber banner above the controls, and
you can always **tap the map** to place the start point manually.

**Q: The route distance doesn't match my target exactly.**
A: The OSRM foot engine snaps waypoints to real walkable roads, which
may lengthen or shorten the loop slightly.  The displayed distance is
always the **actual routed distance**, not the requested target.

**Q: How much storage does the WebGPU model use?**
A: `SmolLM2-360M-Instruct-q4f16_1-MLC` weighs ~250 MB in IndexedDB.
Larger models like `Qwen2.5-1.5B-Instruct` are ~1.2 GB.
