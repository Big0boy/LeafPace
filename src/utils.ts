/**
 * General-purpose utility functions for LeafPace.
 * Kept deliberately small and dependency-free so they run anywhere.
 */

import { ActivityMode, GreeneryPreference } from './types';

/**
 * Determines whether shade-seeking is preferred for a given activity
 * and greenery preference combination.
 *
 * Shade is preferred when the user explicitly picks "max_canopy" or
 * "quiet_trail", or when they are hiking (slower pace, more sun exposure).
 */
export function isShadePreferred(
  activity: ActivityMode,
  preference: GreeneryPreference
): boolean {
  if (preference === 'max_canopy' || preference === 'quiet_trail') return true;
  if (preference === 'sunlit_meadow') return false;
  // For "park_hopper" the decision depends on the activity:
  // hikers move slowly and are exposed longer, so they benefit from shade.
  return activity === 'hike';
}

/**
 * Clamps a number between a minimum and maximum value.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Formats a distance in km to a human-friendly string.
 * e.g. 5.123 → "5.1 km", 0.452 → "452 m"
 */
export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

/**
 * Formats a duration in minutes to a human-friendly string.
 * e.g. 65 → "1h 5m", 25 → "25 min"
 */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
}
