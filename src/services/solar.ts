import SunCalc from 'suncalc';
import { LatLng, SolarInfo } from '../types';

export function calculateSolarInfo(location: LatLng, date: Date = new Date()): SolarInfo {
  const sunPos = SunCalc.getPosition(date, location.lat, location.lng);
  
  // Convert radians to degrees
  const elevationDeg = Math.round((sunPos.altitude * 180) / Math.PI);
  // Azimuth in SunCalc is South = 0, West = PI/2, North = PI, East = -PI/2
  // Convert to compass degrees (North = 0, East = 90, South = 180, West = 270)
  const compassDeg = Math.round(((sunPos.azimuth * 180) / Math.PI + 180) % 360);

  const times = SunCalc.getTimes(date, location.lat, location.lng);
  const now = date.getTime();
  
  // Check if within golden hour or near sunset/sunrise
  const goldenHourStart = times.goldenHour?.getTime() || 0;
  const sunset = times.sunset?.getTime() || 0;
  const goldenHourEnd = times.goldenHourEnd?.getTime() || 0;
  const sunrise = times.sunrise?.getTime() || 0;

  const isGoldenHour = 
    (now >= goldenHourStart && now <= sunset) || 
    (now >= sunrise && now <= goldenHourEnd);

  let advisory = 'Moderate overhead sun. Tree canopy will provide gentle dappled light.';
  if (elevationDeg < 0) {
    advisory = 'Dusk or night conditions. Stick to known well-trodden paths or bring a headlamp.';
  } else if (elevationDeg < 15) {
    advisory = `Low sun angle (${elevationDeg}° at ${compassDeg}°). Heading east/west will meet direct eye-level glare. Canopy trails recommended.`;
  } else if (isGoldenHour) {
    advisory = 'Golden hour lighting! Ideal for open meadow perimeters and scenic foliage views.';
  } else if (elevationDeg > 55) {
    advisory = 'High midday sun. Prioritize shaded forest corridors to avoid direct heat.';
  }

  return {
    azimuthDeg: compassDeg,
    elevationDeg,
    goldenHour: isGoldenHour,
    advisory,
  };
}
