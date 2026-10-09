/**
 * Unit tests for LeafPace core services.
 *
 * Run with:  npx vitest run
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  haversineDistanceKm,
  pathLengthKm,
  buildWaypoints,
  buildGeometricLoop,
  scaleLoopToTarget,
  decodePolyline,
  fetchNearbyGreenSpaces,
} from '../services/routing';
import { choosePrimaryGreenSpace, sortGreenSpacesByDistance } from '../services/greenSpaceHelper';
import { isShadePreferred, clamp, formatDistance, formatDuration } from '../utils';

// ─────────────────────────────────────────────────────────────────────────────
// Haversine distance
// ─────────────────────────────────────────────────────────────────────────────

describe('haversineDistanceKm', () => {
  it('returns 0 for identical points', () => {
    const pt = { lat: 37.7749, lng: -122.4194 };
    expect(haversineDistanceKm(pt, pt)).toBe(0);
  });

  it('computes roughly correct distance between SF and LA (~559 km)', () => {
    const sf = { lat: 37.7749, lng: -122.4194 };
    const la = { lat: 34.0522, lng: -118.2437 };
    const dist = haversineDistanceKm(sf, la);
    expect(dist).toBeGreaterThan(540);
    expect(dist).toBeLessThan(580);
  });

  it('computes a short walking-scale distance (~0.1 km)', () => {
    const a = { lat: 37.7749, lng: -122.4194 };
    const b = { lat: 37.7759, lng: -122.4194 }; // ~0.11 km north
    const dist = haversineDistanceKm(a, b);
    expect(dist).toBeGreaterThan(0.09);
    expect(dist).toBeLessThan(0.15);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Loop geometry (offline fallback path must match the requested distance)
// ─────────────────────────────────────────────────────────────────────────────

describe('loop geometry', () => {
  const origin = { lat: 37.7694, lng: -122.4862 };

  it('buildWaypoints starts and ends at the origin', () => {
    const wps = buildWaypoints(origin, 1.5, 0.7);
    expect(wps).toHaveLength(5); // origin + 3 ring points + origin
    expect(wps[0]).toEqual(origin);
    expect(wps[wps.length - 1]).toEqual(origin);
  });

  it('buildGeometricLoop closes the loop at the origin', () => {
    const coords = buildGeometricLoop(origin, buildWaypoints(origin, 1.5, 0.7));
    expect(coords.length).toBeGreaterThan(20);
    expect(coords[coords.length - 1]).toEqual(origin);
    expect(pathLengthKm(coords)).toBeGreaterThan(0);
  });

  it('scaleLoopToTarget hits the requested distance within 1%', () => {
    for (const target of [1, 3, 5, 10, 15]) {
      const loop = buildGeometricLoop(origin, buildWaypoints(origin, 4, 1.2));
      const scaled = scaleLoopToTarget(origin, loop, target);
      const actual = pathLengthKm(scaled);
      expect(actual).toBeGreaterThan(target * 0.99);
      expect(actual).toBeLessThan(target * 1.01);
    }
  });

  it('scaleLoopToTarget keeps the loop centred on the origin', () => {
    const loop = buildGeometricLoop(origin, buildWaypoints(origin, 4, 1.2));
    const scaled = scaleLoopToTarget(origin, loop, 5);
    // Every point stays within a few km of the origin
    for (const p of scaled) {
      expect(haversineDistanceKm(origin, p)).toBeLessThan(5);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Polyline decoding (Valhalla foot-routing responses)
// ─────────────────────────────────────────────────────────────────────────────

describe('decodePolyline', () => {
  it('decodes the canonical Google polyline example', () => {
    const decoded = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(decoded).toHaveLength(3);
    expect(decoded[0].lat).toBeCloseTo(38.5, 5);
    expect(decoded[0].lng).toBeCloseTo(-120.2, 5);
    expect(decoded[1].lat).toBeCloseTo(40.7, 5);
    expect(decoded[1].lng).toBeCloseTo(-120.95, 5);
    // The docs round these for display; the wire values are milli-degrees.
    expect(decoded[2].lat).toBeCloseTo(43.252, 5);
    expect(decoded[2].lng).toBeCloseTo(-126.453, 5);
  });

  it('returns an empty list for an empty string', () => {
    expect(decodePolyline('')).toEqual([]);
  });

  it('round-trips coordinates at OSRM precision 5 and Valhalla precision 6', () => {
    // Standard polyline encoder written out here so the decoder is checked
    // against real wire data rather than a hand-made string.
    const encodeValue = (value: number) => {
      let v = value < 0 ? ~(value << 1) : value << 1;
      let out = '';
      while (v >= 0x20) {
        out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
        v >>>= 5;
      }
      return out + String.fromCharCode(v + 63);
    };
    const encode = (points: { lat: number; lng: number }[], precision: number) => {
      const factor = Math.pow(10, precision);
      let prevLat = 0;
      let prevLng = 0;
      let out = '';
      for (const p of points) {
        const lat = Math.round(p.lat * factor);
        const lng = Math.round(p.lng * factor);
        out += encodeValue(lat - prevLat) + encodeValue(lng - prevLng);
        prevLat = lat;
        prevLng = lng;
      }
      return out;
    };

    const points = [
      { lat: 37.7694, lng: -122.4862 },
      { lat: 37.7712, lng: -122.4801 },
      { lat: 37.7655, lng: -122.477 },
      { lat: 37.7694, lng: -122.4862 },
    ];

    for (const precision of [5, 6]) {
      const decoded = decodePolyline(encode(points, precision), precision);
      expect(decoded).toHaveLength(points.length);
      decoded.forEach((p, i) => {
        expect(p.lat).toBeCloseTo(points[i].lat, precision - 1);
        expect(p.lng).toBeCloseTo(points[i].lng, precision - 1);
      });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Overpass mirror racing / Nominatim hedge / offline fallback
// ─────────────────────────────────────────────────────────────────────────────

describe('fetchNearbyGreenSpaces', () => {
  afterEach(() => vi.unstubAllGlobals());

  const center = { lat: 37.7694, lng: -122.4862 };
  const element = {
    lat: 37.77,
    lon: -122.42,
    tags: { name: 'Alamo Square', leisure: 'park' },
  };

  it('uses the first mirror that answers with real green spaces', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: unknown) => {
        if (String(url).includes('overpass-api.de')) {
          return Promise.reject(new Error('mirror down'));
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ elements: [element] }),
        });
      })
    );

    const spaces = await fetchNearbyGreenSpaces(center, 1500);
    expect(spaces).toHaveLength(1);
    expect(spaces[0].name).toBe('Alamo Square');
    expect(spaces[0].type).toBe('park');
    expect(spaces[0].distanceKm).toBeGreaterThan(0);
  });

  it('falls back to synthetic green spaces when every mirror fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network unreachable')))
    );

    const spaces = await fetchNearbyGreenSpaces(center, 1500);
    expect(spaces).toHaveLength(3);
    expect(spaces.map((s) => s.name)).toContain('Cedar Grove Wood');
    // Synthetic spaces must still sit near the requested origin
    for (const s of spaces) {
      expect(haversineDistanceKm(center, s)).toBeLessThan(2);
    }
  });

  it('skips elements without coordinates', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            elements: [{ tags: { name: 'No coords' } }, element],
          }),
        })
      )
    );

    const spaces = await fetchNearbyGreenSpaces(center, 1500);
    expect(spaces).toHaveLength(1);
    expect(spaces[0].name).toBe('Alamo Square');
  });

  it('falls back to Nominatim when every Overpass mirror fails', async () => {
    const nominatimHit = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn((url: unknown) => {
        if (String(url).includes('nominatim')) {
          nominatimHit();
          return Promise.resolve({
            ok: true,
            json: async () => [
              {
                lat: '37.7693681',
                lon: '-122.4821837',
                name: 'Golden Gate Park',
                category: 'leisure',
                type: 'park',
              },
            ],
          });
        }
        return Promise.reject(new Error('mirror down'));
      })
    );

    const spaces = await fetchNearbyGreenSpaces(center, 1500);
    expect(nominatimHit).toHaveBeenCalledOnce();
    expect(spaces.map((s) => s.name)).toContain('Golden Gate Park');
    // Real OSM data, not the synthetic offline parks
    expect(spaces.map((s) => s.name)).not.toContain('Cedar Grove Wood');
    expect(spaces[0].type).toBe('park');
    expect(spaces[0].distanceKm).toBeGreaterThan(0);
  });

  it('does not hit Nominatim when an Overpass mirror answers quickly', async () => {
    const fetchMock = vi.fn((url: unknown) => {
      if (String(url).includes('nominatim')) {
        return Promise.resolve({
          ok: true,
          json: async () => [{ lat: '37.7', lon: '-122.4', name: 'Should Not Win' }],
        });
      }
      if (String(url).includes('overpass-api.de')) {
        return Promise.reject(new Error('mirror down'));
      }
      return Promise.resolve({ ok: true, json: async () => ({ elements: [element] }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    const spaces = await fetchNearbyGreenSpaces(center, 1500);
    expect(spaces).toHaveLength(1);
    expect(spaces[0].name).toBe('Alamo Square');
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('nominatim'))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Green space helper
// ─────────────────────────────────────────────────────────────────────────────

describe('choosePrimaryGreenSpace', () => {
  const origin = { lat: 37.77, lng: -122.42 };

  it('returns null for an empty array', () => {
    expect(choosePrimaryGreenSpace(origin, [])).toBeNull();
  });

  it('returns the nearest green space by distanceKm', () => {
    const spaces = [
      { name: 'Far Park', type: 'park', lat: 37.80, lng: -122.40, distanceKm: 3.5 },
      { name: 'Near Garden', type: 'garden', lat: 37.771, lng: -122.421, distanceKm: 0.2 },
      { name: 'Mid Wood', type: 'wood', lat: 37.78, lng: -122.43, distanceKm: 1.2 },
    ];
    const best = choosePrimaryGreenSpace(origin, spaces);
    expect(best).not.toBeNull();
    expect(best!.name).toBe('Near Garden');
  });
});

describe('sortGreenSpacesByDistance', () => {
  const origin = { lat: 0, lng: 0 };

  it('sorts spaces nearest-first without mutating the original array', () => {
    const spaces = [
      { name: 'C', type: 'park', lat: 0, lng: 0, distanceKm: 5 },
      { name: 'A', type: 'park', lat: 0, lng: 0, distanceKm: 1 },
      { name: 'B', type: 'park', lat: 0, lng: 0, distanceKm: 3 },
    ];
    const sorted = sortGreenSpacesByDistance(origin, spaces);
    expect(sorted.map(s => s.name)).toEqual(['A', 'B', 'C']);
    // Original unchanged
    expect(spaces[0].name).toBe('C');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Utils
// ─────────────────────────────────────────────────────────────────────────────

describe('isShadePreferred', () => {
  it('always prefers shade for max_canopy regardless of activity', () => {
    expect(isShadePreferred('run', 'max_canopy')).toBe(true);
    expect(isShadePreferred('walk', 'max_canopy')).toBe(true);
    expect(isShadePreferred('hike', 'max_canopy')).toBe(true);
  });

  it('never prefers shade for sunlit_meadow', () => {
    expect(isShadePreferred('run', 'sunlit_meadow')).toBe(false);
    expect(isShadePreferred('hike', 'sunlit_meadow')).toBe(false);
  });

  it('prefers shade for park_hopper + hike but not park_hopper + run', () => {
    expect(isShadePreferred('hike', 'park_hopper')).toBe(true);
    expect(isShadePreferred('run', 'park_hopper')).toBe(false);
  });
});

describe('clamp', () => {
  it('clamps below-minimum values', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it('clamps above-maximum values', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('passes through in-range values', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });
});

describe('formatDistance', () => {
  it('formats distances < 1 km in meters', () => {
    expect(formatDistance(0.452)).toBe('452 m');
  });

  it('formats distances >= 1 km with one decimal', () => {
    expect(formatDistance(5.123)).toBe('5.1 km');
  });
});

describe('formatDuration', () => {
  it('formats short durations in minutes', () => {
    expect(formatDuration(25)).toBe('25 min');
  });

  it('formats durations >= 60 min with hours and minutes', () => {
    expect(formatDuration(65)).toBe('1h 5m');
  });

  it('formats exact hours without trailing zero minutes', () => {
    expect(formatDuration(120)).toBe('2h');
  });
});
