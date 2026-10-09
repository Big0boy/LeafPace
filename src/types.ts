export type ActivityMode = 'run' | 'walk' | 'hike';

export type GreeneryPreference = 'max_canopy' | 'park_hopper' | 'quiet_trail' | 'sunlit_meadow';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface GreenSpace {
  name: string;
  type: string;
  lat: number;
  lng: number;
  distanceKm: number;
}

export interface RouteData {
  coordinates: LatLng[];
  distanceKm: number;
  estimatedDurationMin: number;
  greeneryScorePercent: number;
  elevationGainMeters: number;
  greenSpacesEncountered: string[];
  surfaceSummary: {
    trail: number; // percentage
    paved: number; // percentage
  };
}

export interface SolarInfo {
  azimuthDeg: number;
  elevationDeg: number;
  goldenHour: boolean;
  advisory: string;
}

export interface TrailBriefingData {
  foliageHighlights: string;
  surfaceAdvice: string;
  outdoorMindset: string;
  fullMarkdown?: string;
  modelUsed: string;
  inferenceTimeSec: number;
  onDevice: boolean;
}
