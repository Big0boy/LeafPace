# LeafPace 🍃

*This is a submission for the [Hacktoberfest Open-Source AI Challenge Week 1: Touch Grass](https://dev.to/challenges/hacktoberfest-week1-2026-10-05)*

> **The screen must be the shortest part of the experience.** 30 seconds on your phone → 45 minutes on the trail.

---

## What I Built

**LeafPace** is a zero-backend progressive web app that gets runners, walkers, and hikers off the screen and into the wild — in under 30 seconds:

1. **Nature-biased loop synthesis** — pick 🏃 Run / 🚶 Walk / 🥾 Hike, a distance (1–15 km), and a greenery bias (Dense Canopy / Park Hopper / Dirt Trail). LeafPace queries **OpenStreetMap** for real parks, woods, and nature reserves around you, projects a loop through them, and snaps it to the actual pedestrian network (OSRM foot, with the Valhalla open engine as fallback). Standard nav apps route you down the noisiest asphalt; LeafPace routes you under the trees.
2. **Solar & shade advisory** — computes the sun's azimuth/elevation for your exact coordinates and time, and flags when you'll be running into blinding low sun versus cool canopy.
3. **GPX hand-off** — one tap exports a GPX 1.1 file (200–300 trackpoints) for Garmin, Apple Watch, Strava, Organic Maps — or share it straight to your watch.
4. **Screen off. Touch grass.** — after export, the screen dims and simply says: pocket your phone.

**Who it's for:** anyone who wants their run or hike to happen *outside* the algorithm — and whose home address shouldn't be uploaded to a fitness social network to do it.

**Privacy by architecture:** there is no backend. Your GPS coordinates never leave your device — every network call LeafPace makes (OSM Overpass, Nominatim, OSRM/Valhalla) is a *location-independent* public API query, and the AI runs 100% on-device.

---

## Demo

🔗 **Live app: https://big0boy.github.io/LeafPace/** (GitHub Pages, zero hosting cost)

Try it on your phone: open the link, tap **🍃 Synthesize Trail**, then **📱 Lock Phone & Touch Grass**.

<!-- Add your 30-second "walk outside and run the loop" video/GIF here -->

---

## Code

📦 **Repo: https://github.com/Big0boy/LeafPace** — every dependency is open source, every data source is an open commons.

Stack: **React 18 + TypeScript + Vite + Tailwind**, **Leaflet**, **@mlc-ai/web-llm** (lazy-loaded), **SunCalc**, **Vitest**, plus a dependency-free **CDP smoke-test harness** (`scripts/smoke.mjs`) that drives the real app in headless Chromium — fake GPS lock, route synthesis, GPX download and XML validation included.

The part I'm proudest of is the green-space lookup, because public open infrastructure is *flaky* and the app must never fail — it races three Overpass mirrors in parallel, hedges to Nominatim (a completely separate OSM service) if none answers in 2.5 s, retries, and only then falls back to synthetic parks:

```ts
// First usable answer wins; a broken mirror can never stall route generation.
const winner = await firstSuccess<GreenSpaceLookup>([overpassWave, nominatimWave]);
if (winner) {
  console.info(`${winner.source === 'overpass' ? 'Overpass' : 'Nominatim'} green-space lookup succeeded (${winner.spaces.length} results)`);
  return winner.spaces;
}
```

---

## How I Built It

The AI core is **open-weight models running natively on the phone's GPU** via [WebLLM](https://webllm.mlc.ai/) (WebGPU):

- **Model:** `SmolLM2-360M-Instruct` (quantized, ~250 MB cached in the browser) — swappable to `Qwen2.5-0.5B/1.5B-Instruct` by changing one constant in `src/services/webgpu-llm.ts`.
- **Prompt architecture:** the app builds a structured JSON digest (activity, distance, green spaces traversed, surface mix, sun angle, time of day) and the on-device model turns it into a 3-part naturalist briefing: *foliage highlight*, *surface & footing advice*, *mindset cue* ("leave the earbuds behind…").
- **Never blocks:** if WebGPU is unavailable or the model isn't downloaded yet, a deterministic template generator produces the briefing instantly — the 30-second budget is sacred. Once weights are cached in IndexedDB, briefings work **fully offline** on the trail.

Around the model sits the open geospatial pipeline: **Overpass API + Nominatim** (green-space discovery), **OSRM foot + Valhalla** (pedestrian snapping), **SunCalc** (solar geometry), and a hand-rolled **GPX 1.1 serializer**. All of it is a static PWA with a service worker — deployable anywhere, free forever.

Testing: 29 vitest unit tests (loop geometry, polyline decoding, GPX, mirror-race fallbacks) plus the headless-browser smoke test, both run in CI on every push.

---

## Why Does Open Innovation Matter?

Because **both halves of LeafPace only exist because of open infrastructure**, and each has a closed-API twin that would be *worse for the user*:

- **Open geospatial commons:** proprietary map APIs bill per request and optimize for cars. OpenStreetMap has the unpaved path through the woods that Google never ranked. When the main Overpass mirror rate-limited me mid-build, I could race two community mirrors and a second open service (Nominatim) instead of reading a credit-card bill — resilience built *by* the commons, *from* the commons.
- **Open-weight models:** your running route starts at your front door. Sending that prompt to a closed LLM API means uploading a precise home-coordinate fingerprint with it. WebGPU + open weights keep the entire inference — and the entire location history — physically on your phone, and keep working when you're already out of cell range.
- **Zero server, zero cost:** no database of user tracks to leak, no bill to shut down. An open-source PWA on free static hosting is a complete product.

---

## Prize Categories

Entering every category this touches — please verify final category names against the [challenge page](https://dev.to/challenges/hacktoberfest-week1-2026-10-05):

- **Open-Weight AI** — SmolLM2 / Qwen2.5 run via WebLLM, fully on-device
- **Edge / Local Inference** — WebGPU in the mobile browser, offline-capable after first model download
- **Privacy & Data Sovereignty** — zero backend; location never leaves the device
- **Open Geospatial Commons** — OpenStreetMap Overpass/Nominatim + OSRM/Valhalla

<!-- Team Submissions: pick one member to publish and credit teammates by listing their DEV usernames here -->

---

## Use of AI

AI was used to create this project. The on-device briefing model (`SmolLM2-360M-Instruct`) is an open-weight model distributed by its creators — no closed or proprietary LLM API was used at any point, since the app's premise is that location data must never leave the device.

---

## Local dev

```bash
npm install
npm run dev      # http://localhost:5173 (phone: use the printed Network URL, same Wi-Fi)
npm test         # 29 unit tests
npm run build    # production build → dist/
```

Full setup, model-swapping, and offline behavior: see [SETUP.md](SETUP.md). Design spec: `designweek1.md` in the project archive.
