/**
 * Helper utilities for selecting the most relevant green space from a list.
 * These functions are deliberately pure – they receive plain data structures
 * and return a deterministic result, making them straightforward to unit‑test.
 */
import { GreenSpace, LatLng } from '../types';

/**
 * Returns the green space that is closest to the supplied origin point.
 * If the list is empty the function returns `null`.
 */
export function choosePrimaryGreenSpace(
  _origin: LatLng,
  spaces: GreenSpace[]
): GreenSpace | null {
  if (spaces.length === 0) return null;
  let best: GreenSpace = spaces[0];
  let bestDist = best.distanceKm;
  for (const s of spaces) {
    if (s.distanceKm < bestDist) {
      best = s;
      bestDist = s.distanceKm;
    }
  }
  return best;
}

/**
 * Sorts the provided green spaces by distance from the origin (nearest first).
 */
export function sortGreenSpacesByDistance(
  _origin: LatLng,
  spaces: GreenSpace[]
): GreenSpace[] {
  // The distance is already pre‑computed in `GreenSpace.distanceKm`.
  return [...spaces].sort((a, b) => a.distanceKm - b.distanceKm);
}
