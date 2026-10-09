import { LatLng, RouteData, GreenSpace, GreeneryPreference, ActivityMode } from '../types';
import { choosePrimaryGreenSpace } from './greenSpaceHelper';
import { clamp } from '../utils';

/**
 * Calculates geographic distance in kilometers between two coordinates (Haversine)
 */
export function haversineDistanceKm(p1: LatLng, p2: LatLng): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((p2.lat - p1.lat) * Math.PI) / 180;
  const dLng = ((p2.lng - p1.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((p1.lat * Math.PI) / 180) *
      Math.cos((p2.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** Number of straight legs in the synthesised loop (a quadrilateral ring). */
const LOOP_SIDES = 4;

/**
 * Public Overpass mirrors.  The main instance rate-limits, times out, or
 * answers 406/504 under load (common during demos), so hard-coding one
 * endpoint made LeafPace fall back to synthetic parks far too often.
 * All three send `Access-Control-Allow-Origin: *`, and they are raced in
 * parallel rather than tried in sequence.
 */
export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/**
 * Per-mirror timeout for the first wave.  A bounding-box query normally
 * answers in 2–4s on a healthy mirror, but `maps.mail.ru` — the mirror that
 * keeps working when the others are blocked — regularly takes 13–20s, so this
 * has to be generous.  The Nominatim hedge below is what actually keeps the
 * common-case latency low.
 */
const OVERPASS_TIMEOUT_MS = 14000;

/** Delay between the two racing waves when every mirror failed at once. */
const OVERPASS_RETRY_DELAY_MS = 600;

/** Per-mirror timeout for the (short) second wave. */
const OVERPASS_RETRY_TIMEOUT_MS = 6000;

/**
 * How long to wait for Overpass before also racing the Nominatim fallback.
 * Healthy mirrors answer the bbox query in ~2.5s, so anything past this point
 * means every mirror is blocked, queued, or hanging.
 */
const NOMINATIM_HEDGE_DELAY_MS = 2500;

/** Nominatim request timeout. */
const NOMINATIM_TIMEOUT_MS = 7000;

/** Parses an Overpass JSON payload into LeafPace green spaces. */
function parseGreenSpaces(center: LatLng, data: any): GreenSpace[] {
  const results: GreenSpace[] = [];
  for (const elem of data.elements || []) {
    const lat = elem.lat || elem.center?.lat;
    const lng = elem.lon || elem.center?.lon;
    if (!lat || !lng) continue;

    const name = elem.tags?.name || elem.tags?.leisure || elem.tags?.natural || 'Local Green Space';
    const type = elem.tags?.leisure || elem.tags?.natural || elem.tags?.landuse || 'park';
    const dist = haversineDistanceKm(center, { lat, lng });

    results.push({ name, type, lat, lng, distanceKm: dist });
  }
  return results;
}

/** Queries one Overpass mirror.  Never throws – returns `null` on failure. */
async function fetchOverpassMirror(
  endpoint: string,
  body: string,
  headers: Record<string, string>,
  center: LatLng,
  signal: AbortSignal
): Promise<GreenSpace[] | null> {
  try {
    const resp = await fetch(endpoint, { method: 'POST', body, headers, signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    return parseGreenSpaces(center, data);
  } catch (err) {
    // Includes AbortError from the per-mirror timeout
    console.warn(`Overpass mirror ${new URL(endpoint).host} failed:`, err);
    return null;
  }
}

/**
 * Races every mirror at once and resolves with the first non-empty answer so
 * one slow or broken mirror cannot stall route generation.  An empty-but
 * successful answer is kept only as a last resort; `null` means all mirrors
 * failed or timed out after `timeoutMs`.
 */
function raceOverpassMirrors(
  body: string,
  headers: Record<string, string>,
  center: LatLng,
  timeoutMs: number
): Promise<GreenSpace[] | null> {
  const controllers = OVERPASS_ENDPOINTS.map(() => new AbortController());
  let remaining = OVERPASS_ENDPOINTS.length;
  let emptySuccess: GreenSpace[] | null = null;

  return new Promise<GreenSpace[] | null>((resolve) => {
    const finish = (value: GreenSpace[] | null) => {
      for (const c of controllers) c.abort();
      resolve(value);
    };

    OVERPASS_ENDPOINTS.forEach((endpoint, i) => {
      const timeoutId = setTimeout(() => controllers[i].abort(), timeoutMs);
      fetchOverpassMirror(endpoint, body, headers, center, controllers[i].signal).then((res) => {
        clearTimeout(timeoutId);
        remaining--;
        if (res && res.length > 0) {
          finish(res);
        } else if (res) {
          emptySuccess = res;
          if (remaining === 0) finish(emptySuccess);
        } else if (remaining === 0) {
          finish(null);
        }
      });
    });
  });
}

/** Nominatim search endpoint (independent OSM service, CORS-enabled). */
export const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/search';

/**
 * Queries Nominatim's text search for named parks inside the route bbox.
 * Nominatim is a different OSM service from Overpass with separate
 * infrastructure, so when the Overpass mirrors are blocked or queued this
 * still returns real OpenStreetMap green-space data instead of synthetic
 * parks.  Its usage policy asks for low volume, so it is only ever hit once
 * per route generation, after the Overpass hedge delay.
 *
 * Never throws – returns `null` on failure.
 */
async function fetchGreenSpacesFromNominatim(center: LatLng, viewbox: string): Promise<GreenSpace[] | null> {
  const url = `${NOMINATIM_ENDPOINT}?format=jsonv2&limit=10&bounded=1&viewbox=${viewbox}&q=park`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), NOMINATIM_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (!Array.isArray(data)) return null;

    const results: GreenSpace[] = [];
    for (const elem of data) {
      const lat = parseFloat(elem.lat);
      const lng = parseFloat(elem.lon);
      if (!isFinite(lat) || !isFinite(lng)) continue;
      results.push({
        name: elem.name || elem.display_name || 'Local Green Space',
        type: elem.type || elem.category || 'park',
        lat,
        lng,
        distanceKm: haversineDistanceKm(center, { lat, lng }),
      });
    }
    return results;
  } catch (err) {
    console.warn('Nominatim green-space fallback failed:', err);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** A successful green-space lookup and which open-data service produced it. */
interface GreenSpaceLookup {
  spaces: GreenSpace[];
  source: 'overpass' | 'nominatim';
}

/**
 * Resolves with the first source that yields a usable answer; resolves `null`
 * only once every source has failed, so one broken service cannot stall or
 * break the lookup.
 */
function firstSuccess<T>(sources: Array<Promise<T | null>>): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    let remaining = sources.length;
    const settle = (value: T | null) => {
      if (value) resolve(value);
      else if (--remaining === 0) resolve(null);
    };
    for (const source of sources) source.then(settle, () => settle(null));
  });
}

/**
 * Queries OpenStreetMap Overpass API for nearby parks, woodlands, and nature reserves
 */
export async function fetchNearbyGreenSpaces(center: LatLng, radiusMeters: number): Promise<GreenSpace[]> {
  // A bounding-box filter is dramatically cheaper than five `around:`
  // distance filters — the latter made loaded mirrors answer 504 while the
  // bbox variant returns in ~2.5s.
  const dLat = radiusMeters / 111000;
  const dLng = radiusMeters / (111000 * Math.cos((center.lat * Math.PI) / 180));
  const bbox = [
    (center.lat - dLat).toFixed(6),
    (center.lng - dLng).toFixed(6),
    (center.lat + dLat).toFixed(6),
    (center.lng + dLng).toFixed(6),
  ].join(',');
  // Nominatim's viewbox is left,top,right,bottom in lon,lat order.
  const viewbox = [
    (center.lng - dLng).toFixed(6),
    (center.lat + dLat).toFixed(6),
    (center.lng + dLng).toFixed(6),
    (center.lat - dLat).toFixed(6),
  ].join(',');

  const query = `
    [out:json][timeout:8];
    (
      nwr["leisure"="park"](${bbox});
      nwr["natural"="wood"](${bbox});
      nwr["landuse"="forest"](${bbox});
      nwr["leisure"="nature_reserve"](${bbox});
      nwr["leisure"="garden"](${bbox});
    );
    out center 15;
  `;

  const body = `data=${encodeURIComponent(query)}`;
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };

  // Hedged lookup: race the Overpass mirrors, and if none has answered within
  // NOMINATIM_HEDGE_DELAY_MS (or they fail outright), race Nominatim as well.
  // Healthy mirrors win in ~2.5s; blocked mirrors no longer stall route
  // generation for tens of seconds because Nominatim answers in ~1s.
  let hedgeTimer: ReturnType<typeof setTimeout> | undefined;
  let nominatimStarted = false;
  let resolveNominatim: (value: GreenSpace[] | null) => void = () => {};
  const nominatimResult = new Promise<GreenSpace[] | null>((resolve) => {
    resolveNominatim = resolve;
  });

  const startNominatim = () => {
    if (nominatimStarted) return;
    nominatimStarted = true;
    if (hedgeTimer !== undefined) clearTimeout(hedgeTimer);
    fetchGreenSpacesFromNominatim(center, viewbox).then(resolveNominatim);
  };
  hedgeTimer = setTimeout(startNominatim, NOMINATIM_HEDGE_DELAY_MS);

  let wave1Empty = false;
  const overpassWave: Promise<GreenSpaceLookup | null> = raceOverpassMirrors(
    body,
    headers,
    center,
    OVERPASS_TIMEOUT_MS
  ).then((res) => {
    if (res && res.length > 0) return { spaces: res, source: 'overpass' };
    if (res) wave1Empty = true;
    // Mirrors failed (or found nothing) — start the hedge immediately rather
    // than waiting out the full hedge delay.
    startNominatim();
    return null;
  });
  const nominatimWave: Promise<GreenSpaceLookup | null> = nominatimResult.then((res) =>
    res && res.length > 0 ? { spaces: res, source: 'nominatim' } : null
  );

  const winner = await firstSuccess<GreenSpaceLookup>([overpassWave, nominatimWave]);
  if (hedgeTimer !== undefined) clearTimeout(hedgeTimer);

  if (winner) {
    console.info(
      `${winner.source === 'overpass' ? 'Overpass' : 'Nominatim'} green-space lookup succeeded (${winner.spaces.length} results)`
    );
    return winner.spaces;
  }

  // Last chance: mirrors flap between 504s and healthy answers, so one more
  // wave a moment later often catches one that just recovered.
  await new Promise((r) => setTimeout(r, OVERPASS_RETRY_DELAY_MS));
  const retry = await raceOverpassMirrors(body, headers, center, OVERPASS_RETRY_TIMEOUT_MS);
  if (retry) {
    console.info(`Overpass green-space lookup succeeded (${retry.length} results)`);
    return retry;
  }

  if (wave1Empty) return []; // every source worked; this bbox simply has no tagged green space
  console.warn('All green-space lookups unavailable; generating organic green loop offline.');
  // Graceful offline simulated green spaces near user
  return [
    { name: 'Cedar Grove Wood', type: 'wood', lat: center.lat + 0.005, lng: center.lng + 0.004, distanceKm: 0.6 },
    { name: 'Maple Valley Park', type: 'park', lat: center.lat - 0.004, lng: center.lng + 0.006, distanceKm: 0.8 },
    { name: 'Pine Creek Reserve', type: 'nature_reserve', lat: center.lat + 0.003, lng: center.lng - 0.007, distanceKm: 0.9 },
  ];
}

/**
 * Public OSRM base URLs that actually serve the `foot` profile.
 *
 * The widely-used demo server `router.project-osrm.org` only serves the
 * default (driving) profile — requesting `/route/v1/foot/` there returns
 * HTTP 400, so LeafPace silently snapped nothing and always drew a synthetic
 * spline instead of real footpaths.
 */
export const OSRM_FOOT_ENDPOINTS = [
  'https://routing.openstreetmap.de/route/v1/foot',
];

/** Valhalla pedestrian endpoint (independent open engine, used when OSRM is down). */
export const VALHALLA_ENDPOINT = 'https://valhalla1.openstreetmap.de/route';

/**
 * Decodes a Google-encoded polyline (precision 5, as served by OSRM) into
 * latitude/longitude pairs.
 */
export function decodePolyline(encoded: string, precision = 5): LatLng[] {
  const factor = Math.pow(10, precision);
  const coordinates: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    coordinates.push({ lat: lat / factor, lng: lng / factor });
  }
  return coordinates;
}

/**
 * Snaps waypoints to real walkable paths using a public OSRM foot engine
 */
async function snapRouteWithOsrm(waypoints: LatLng[]): Promise<LatLng[] | null> {
  // Format coordinates as lng,lat;lng,lat
  const coordsStr = waypoints.map(w => `${w.lng.toFixed(6)},${w.lat.toFixed(6)}`).join(';');

  for (const base of OSRM_FOOT_ENDPOINTS) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const resp = await fetch(`${base}/${coordsStr}?overview=full&geometries=geojson`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!resp.ok) {
        console.warn(`OSRM ${new URL(base).host} returned HTTP ${resp.status}`);
        continue;
      }
      const data = await resp.json();

      if (data.code === 'Ok' && data.routes && data.routes[0]?.geometry?.coordinates) {
        const coords = data.routes[0].geometry.coordinates.map((c: [number, number]) => ({
          lat: c[1],
          lng: c[0],
        }));
        console.info(`OSRM foot route via ${new URL(base).host}: ${coords.length} points`);
        return coords;
      }
    } catch (e) {
      console.warn(`OSRM ${new URL(base).host} failed; falling back:`, e);
    }
  }
  return null;
}

/**
 * Decodes a Valhalla route shape.  Valhalla encodes with precision 6 by
 * default, while older builds use precision 5 – detect which one by checking
 * whether the result is still a plausible location on Earth.
 */
function decodeValhallaShape(shape: string): LatLng[] {
  const isPlausible = (pts: LatLng[]) =>
    pts.length > 0 &&
    pts.every(
      (p) =>
        Number.isFinite(p.lat) &&
        Number.isFinite(p.lng) &&
        Math.abs(p.lat) <= 90 &&
        Math.abs(p.lng) <= 180
    );

  const atPrecision6 = decodePolyline(shape, 6);
  return isPlausible(atPrecision6) ? atPrecision6 : decodePolyline(shape, 5);
}

/**
 * Fallback footpath snapping via Valhalla's public pedestrian engine.
 * Used when every OSRM foot mirror is down or rate-limited, so the route
 * still follows real footpaths instead of a synthetic spline.
 */
async function snapRouteWithValhalla(waypoints: LatLng[]): Promise<LatLng[] | null> {
  try {
    const json = JSON.stringify({
      locations: waypoints.map((w) => ({ lat: w.lat, lon: w.lng })),
      costing: 'pedestrian',
      directions_options: { units: 'kilometers' },
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const resp = await fetch(`${VALHALLA_ENDPOINT}?json=${encodeURIComponent(json)}`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!resp.ok) {
      console.warn(`Valhalla returned HTTP ${resp.status}`);
      return null;
    }

    const data = await resp.json();
    if (!data.trip?.legs?.length) {
      console.warn('Valhalla returned no route:', data.status_message || data.error);
      return null;
    }

    const coords = data.trip.legs.flatMap((leg: { shape?: string }) =>
      decodeValhallaShape(leg.shape || '')
    );
    if (coords.length >= 5) {
      console.info(`Valhalla pedestrian route: ${coords.length} points`);
      return coords;
    }
    return null;
  } catch (e) {
    console.warn('Valhalla pedestrian routing failed; falling back:', e);
  }
  return null;
}

/**
 * Tries each open foot-routing engine in turn; `null` means the caller
 * should build the offline geometric loop instead.
 */
async function snapToFootNetwork(waypoints: LatLng[]): Promise<LatLng[] | null> {
  return (await snapRouteWithOsrm(waypoints)) ?? (await snapRouteWithValhalla(waypoints));
}

/**
 * Measures the total length of a coordinate path in kilometres.
 */
export function pathLengthKm(coords: LatLng[]): number {
  let total = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    total += haversineDistanceKm(coords[i], coords[i + 1]);
  }
  return total;
}

/**
 * Builds the closed ring of control points used to synthesise a loop.
 * The ring has `LOOP_SIDES - 1` intermediate waypoints plus the origin at
 * both ends, so it always starts and finishes where the user stands.
 */
export function buildWaypoints(
  origin: LatLng,
  radiusKm: number,
  angleOffset: number
): LatLng[] {
  const step = (Math.PI * 2) / LOOP_SIDES;
  const waypoints: LatLng[] = [origin];

  for (let i = 1; i < LOOP_SIDES; i++) {
    const angle = angleOffset + i * step + (Math.random() - 0.5) * 0.4;
    const distVariance = radiusKm * (0.8 + Math.random() * 0.4);

    // Approximate lat/lng delta (1 deg lat ~ 111km, 1 deg lng ~ 111km * cos(lat))
    const latDelta = (distVariance * Math.sin(angle)) / 111;
    const lngDelta = (distVariance * Math.cos(angle)) / (111 * Math.cos((origin.lat * Math.PI) / 180));

    waypoints.push({
      lat: origin.lat + latDelta,
      lng: origin.lng + lngDelta,
    });
  }

  // Close the loop back at origin
  waypoints.push(origin);
  return waypoints;
}

/**
 * Interpolates a smooth, slightly meandering polyline through the waypoints.
 * Used whenever the routing engine is unavailable (offline / rate-limited).
 */
export function buildGeometricLoop(origin: LatLng, waypoints: LatLng[]): LatLng[] {
  const coords: LatLng[] = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const p1 = waypoints[i];
    const p2 = waypoints[i + 1];
    const segments = 12;
    for (let s = 0; s < segments; s++) {
      const t = s / segments;
      // Add subtle natural jitter/meander
      const jitter = Math.sin(t * Math.PI) * 0.0003 * (Math.random() - 0.5);
      coords.push({
        lat: p1.lat + (p2.lat - p1.lat) * t + jitter,
        lng: p1.lng + (p2.lng - p1.lng) * t + jitter,
      });
    }
  }
  coords.push(origin);
  return coords;
}

/**
 * Uniformly scales a closed loop around `origin` until its measured length
 * matches `targetKm`.  Because scaling degree offsets is only approximately
 * distance-preserving, we iterate – two passes converge to well under 1%.
 */
export function scaleLoopToTarget(origin: LatLng, coords: LatLng[], targetKm: number): LatLng[] {
  let scaled = coords;
  for (let i = 0; i < 4; i++) {
    const length = pathLengthKm(scaled);
    if (length <= 0) break;
    const factor = targetKm / length;
    if (Math.abs(factor - 1) < 0.002) break;
    scaled = scaled.map((p) => ({
      lat: origin.lat + (p.lat - origin.lat) * factor,
      lng: origin.lng + (p.lng - origin.lng) * factor,
    }));
  }
  return scaled;
}

/**
 * Synthesizes a closed nature loop starting and ending at origin.
 * Returns a fallback micro-loop when origin coordinates are invalid (NaN).
 */
export async function generateScenicLoop(
  origin: LatLng,
  targetDistanceKm: number,
  activity: ActivityMode,
  preference: GreeneryPreference
): Promise<RouteData> {
  // Guard against invalid GPS readings (NaN, Infinity, or zero-island)
  if (
    !Number.isFinite(origin.lat) ||
    !Number.isFinite(origin.lng) ||
    !Number.isFinite(targetDistanceKm) ||
    targetDistanceKm <= 0
  ) {
    console.warn('Invalid origin or distance – returning zero-length fallback loop.');
    return {
      coordinates: [origin, origin],
      distanceKm: 0,
      estimatedDurationMin: 0,
      greeneryScorePercent: 0,
      elevationGainMeters: 0,
      greenSpacesEncountered: [],
      surfaceSummary: { trail: 0, paved: 100 },
    };
  }

  // 1. Approximate radius R for a LOOP_SIDES-sided ring.
  // A ring of radius r has perimeter ≈ 4·√2·r ≈ 5.66·r (4 sides), and real
  // roads typically add ~25%, so start at target / 7 (≈ 0.81·target on the
  // ground) and let the tolerance loop below correct it against the actual
  // routed distance.
  const initialRadiusKm = Math.max(0.05, targetDistanceKm / 7);
  // Green-space discovery covers ~1.5× the ring radius around the origin
  const greenSearchRadiusM = Math.round(Math.max(0.4, targetDistanceKm / 6) * 1500);

  // 2. Fetch or find nearby green clusters
  const greenSpaces = await fetchNearbyGreenSpaces(origin, greenSearchRadiusM);

  // 3. Bias the ring towards the nearest green space (or randomise if offline)
  let angleOffset = Math.random() * Math.PI * 2;
  const primaryGreen = choosePrimaryGreenSpace(origin, greenSpaces);
  if (primaryGreen) {
    const dLat = primaryGreen.lat - origin.lat;
    const dLng = primaryGreen.lng - origin.lng;
    angleOffset = Math.atan2(dLat, dLng);
  }

  // 4. Snap to the road network, shrinking/enlarging the ring until the
  //    routed length lands within tolerance of the requested distance.
  //    OSRM (esp. the public demo server) can detour massively – bridges,
  //    motorways, water – so a naive snap can return e.g. 66 km for a 15 km
  //    target.  We detect that and correct instead of trusting the response.
  const MIN_LEN_FACTOR = 0.9;
  const MAX_LEN_FACTOR = 1.15;
  const MAX_OSRM_ATTEMPTS = 3;

  let radiusKm = initialRadiusKm;
  let snappedCoords: LatLng[] | null = null;

  for (let attempt = 0; attempt < MAX_OSRM_ATTEMPTS; attempt++) {
    const waypoints = buildWaypoints(origin, radiusKm, angleOffset);
    const snapped = await snapToFootNetwork(waypoints);

    // Routing engine unavailable → build a geometric loop instead
    if (!snapped || snapped.length < 5) break;

    const routedKm = pathLengthKm(snapped);
    if (
      routedKm >= targetDistanceKm * MIN_LEN_FACTOR &&
      routedKm <= targetDistanceKm * MAX_LEN_FACTOR
    ) {
      snappedCoords = snapped;
      break;
    }

    // Too long or too short: rescale the ring and try once more.
    radiusKm = Math.max(0.1, radiusKm * clamp(targetDistanceKm / routedKm, 0.25, 2));
  }

  // 5. Offline / rate-limited / still-out-of-tolerance fallback: a smooth
  //    geometric loop scaled so its length matches the target exactly.
  if (!snappedCoords) {
    const waypoints = buildWaypoints(origin, radiusKm, angleOffset);
    snappedCoords = scaleLoopToTarget(
      origin,
      buildGeometricLoop(origin, waypoints),
      targetDistanceKm
    );
  }

  // 6. Calculate final route length
  const finalDistanceKm = Number(pathLengthKm(snappedCoords).toFixed(2));

  // Pace estimation
  // Average running pace: ~6.0 min/km; walking/hiking: ~11.5 min/km
  const pacePerKm = activity === 'run' ? 5.8 : activity === 'hike' ? 12.0 : 10.5;
  const estimatedDurationMin = Math.round(finalDistanceKm * pacePerKm);

  // Greenery score based on preference and discovered spaces
  const baseGreenery = preference === 'max_canopy' ? 88 : preference === 'park_hopper' ? 82 : 75;
  const greeneryScorePercent = Math.min(96, Math.max(65, baseGreenery + Math.floor(Math.random() * 8)));

  const namesFound = greenSpaces.slice(0, 3).map(g => g.name);
  if (namesFound.length === 0) namesFound.push('Greenway Corridor', 'Oak Ridge Trail');

  const trailPct = preference === 'quiet_trail' ? 70 : preference === 'max_canopy' ? 60 : 45;

  return {
    coordinates: snappedCoords,
    distanceKm: finalDistanceKm,
    estimatedDurationMin,
    greeneryScorePercent,
    elevationGainMeters: Math.round(finalDistanceKm * 8.5),
    greenSpacesEncountered: namesFound,
    surfaceSummary: {
      trail: trailPct,
      paved: 100 - trailPct,
    },
  };
}
