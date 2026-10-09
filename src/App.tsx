import React, { useState, useEffect, useCallback } from 'react';
import { LatLng, RouteData, ActivityMode, GreeneryPreference, TrailBriefingData, SolarInfo } from './types';
import { MapView } from './components/MapView';
import { RouteControls } from './components/RouteControls';
import { TrailBriefing } from './components/TrailBriefing';
import { HandOffModal } from './components/HandOffModal';
import { calculateSolarInfo } from './services/solar';
import { generateScenicLoop } from './services/routing';
import { generateTrailBriefing, checkWebGPUSupport, initWebGPUModel, isModelReady } from './services/webgpu-llm';
import { Leaf, ShieldCheck, Sparkles, WifiOff, RefreshCw } from 'lucide-react';

// Default scenic fallback: Golden Gate Park, SF
const DEFAULT_LOCATION: LatLng = { lat: 37.7694, lng: -122.4862 };

export const App: React.FC = () => {
  const [userLocation, setUserLocation] = useState<LatLng>(DEFAULT_LOCATION);
  const [activity, setActivity] = useState<ActivityMode>('run');
  const [targetDistance, setTargetDistance] = useState<number>(5.0);
  const [preference, setPreference] = useState<GreeneryPreference>('max_canopy');

  const [route, setRoute] = useState<RouteData | null>(null);
  const [briefing, setBriefing] = useState<TrailBriefingData | null>(null);
  const [solar, setSolar] = useState<SolarInfo>(() => calculateSolarInfo(DEFAULT_LOCATION));

  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isLocating, setIsLocating] = useState<boolean>(false);
  const [isHandOffOpen, setIsHandOffOpen] = useState<boolean>(false);
  const [isOffline, setIsOffline] = useState<boolean>(!navigator.onLine);

  const [webGpuSupported, setWebGpuSupported] = useState<boolean>(false);
  const [webGpuProgress, setWebGpuProgress] = useState<string>('');

  // Visible GPS status.  Geolocation failures used to be console-only, so a
  // denied permission or an insecure origin (browsers block geolocation on
  // plain-http LAN addresses) made the "My GPS" button look broken.
  const [geoNotice, setGeoNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  // ── Lifecycle ──────────────────────────────────────────────────────────
  useEffect(() => {
    setWebGpuSupported(checkWebGPUSupport());
    handleGetGps(false);

    // Track online / offline transitions
    const goOffline = () => setIsOffline(true);
    const goOnline = () => setIsOffline(false);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  // Recompute solar position whenever location changes
  useEffect(() => {
    setSolar(calculateSolarInfo(userLocation));
  }, [userLocation]);

  // ── GPS ────────────────────────────────────────────────────────────────
  const handleGetGps = useCallback((userTriggered = true) => {
    const tapHint = 'or tap the map to set your start point';

    // A manual retry clears any stale banner while "Locating..." runs
    if (userTriggered) setGeoNotice(null);

    // Geolocation only exists in a secure context (HTTPS or localhost).
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      setGeoNotice({
        kind: 'error',
        text: `Location is blocked on insecure origins — you're on ${window.location.host}. Open the app via https:// or localhost, ${tapHint}.`,
      });
      return;
    }
    if (!navigator.geolocation) {
      setGeoNotice({
        kind: 'error',
        text: `Geolocation is not supported by this browser — ${tapHint}.`,
      });
      return;
    }

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setUserLocation({ lat, lng });
        setIsLocating(false);
        setGeoNotice({ kind: 'ok', text: `📍 GPS locked — ${lat.toFixed(5)}, ${lng.toFixed(5)} — routes start here.` });
      },
      (err) => {
        console.warn('Geolocation lookup notice:', err.message);
        setIsLocating(false);
        const text =
          err.code === err.PERMISSION_DENIED
            ? `Location permission denied — allow location for this site from the padlock icon, ${tapHint}.`
            : err.code === err.TIMEOUT
              ? `Location timed out — check your OS location services, ${tapHint}.`
              : `Location unavailable — check your connection and OS location services, ${tapHint}.`;
        setGeoNotice({ kind: 'error', text });
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }, []);

  // ── Route generation ───────────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    setIsGenerating(true);
    setBriefing(null);
    try {
      // 1. Synthesize scenic loop through OpenStreetMap
      const newRoute = await generateScenicLoop(userLocation, targetDistance, activity, preference);
      setRoute(newRoute);

      // 2. Generate on-device AI trail briefing
      const currentSolar = calculateSolarInfo(userLocation);
      setSolar(currentSolar);

      const newBriefing = await generateTrailBriefing(newRoute, currentSolar, activity, preference);
      setBriefing(newBriefing);
    } catch (err) {
      console.error('Failed to generate trail loop:', err);
    } finally {
      setIsGenerating(false);
    }
  }, [userLocation, targetDistance, activity, preference]);

  // ── Regenerate with current params ─────────────────────────────────────
  const handleRegenerate = useCallback(() => {
    setRoute(null);
    setBriefing(null);
    // Small delay so the controls panel re-renders before auto-generating
    setTimeout(() => handleGenerate(), 50);
  }, [handleGenerate]);

  // ── WebGPU model download ──────────────────────────────────────────────
  const handleInitWebGpu = useCallback(async () => {
    setWebGpuProgress('Loading on-device SmolLM2 weights…');
    await initWebGPUModel((report) => {
      setWebGpuProgress(report.text);
    });
    setWebGpuProgress('');
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen w-screen bg-stone-950 text-stone-100 overflow-hidden font-sans">
      {/* Mobile Top Navigation */}
      <header className="shrink-0 bg-stone-950/90 backdrop-blur-md border-b border-stone-850 px-4 py-2.5 flex items-center justify-between z-10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-emerald-600/20 border border-emerald-500/40 flex items-center justify-center">
            <Leaf className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-sm font-black tracking-tight text-white flex items-center gap-1.5">
              LeafPace
              <span className="text-[10px] bg-emerald-950 text-emerald-300 border border-emerald-800/60 font-semibold px-1.5 py-0.2 rounded-full">
                Week 1
              </span>
            </h1>
            <p className="text-[10px] text-stone-400 font-medium">Touch Grass • Open AI Core</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Offline indicator */}
          {isOffline && (
            <div className="flex items-center gap-1 bg-amber-950/60 border border-amber-800/60 px-2 py-1 rounded-full text-[10px] font-medium text-amber-400">
              <WifiOff className="w-3 h-3" />
              <span>Offline</span>
            </div>
          )}

          {/* WebGPU / AI status badge */}
          <div className="flex items-center gap-1.5 bg-stone-900 border border-stone-800 px-2.5 py-1 rounded-full text-[10px] font-mono text-emerald-400">
            <ShieldCheck className="w-3 h-3 text-emerald-400" />
            <span>{isModelReady() ? 'WebGPU Active' : 'Local WebGPU'}</span>
          </div>
        </div>
      </header>

      {/* Main Content Area: Map + Bottom Sheet Controls */}
      <main className="relative flex-1 flex flex-col min-h-0">
        {/* Interactive Map */}
        <div className="flex-1 w-full relative">
          <MapView
            userLocation={userLocation}
            route={route}
            onLocationChange={(newLoc) => {
              setUserLocation(newLoc);
              setGeoNotice({
                kind: 'ok',
                text: `📍 Start point set — ${newLoc.lat.toFixed(5)}, ${newLoc.lng.toFixed(5)} — routes start here.`,
              });
            }}
          />
        </div>

        {/* Floating Mobile Controls Bottom Area */}
        <div className="shrink-0 p-3 max-h-[50vh] overflow-y-auto space-y-3 pointer-events-auto">
          {/* GPS status / error banner */}
          {geoNotice && (
            <div
              role="status"
              className={`flex items-start justify-between gap-2 px-3 py-2 rounded-2xl text-[11px] leading-snug border ${
                geoNotice.kind === 'ok'
                  ? 'bg-emerald-950/50 border-emerald-800/60 text-emerald-300'
                  : 'bg-amber-950/50 border-amber-800/60 text-amber-300'
              }`}
            >
              <span>{geoNotice.text}</span>
              <button
                onClick={() => setGeoNotice(null)}
                className="shrink-0 font-bold opacity-70 hover:opacity-100"
                aria-label="Dismiss location message"
              >
                ×
              </button>
            </div>
          )}
          {!route ? (
            <RouteControls
              activity={activity}
              onActivityChange={setActivity}
              targetDistance={targetDistance}
              onDistanceChange={setTargetDistance}
              preference={preference}
              onPreferenceChange={setPreference}
              solar={solar}
              isGenerating={isGenerating}
              onGenerate={handleGenerate}
              onUseCurrentLocation={() => handleGetGps(true)}
              isLocating={isLocating}
            />
          ) : (
            <div className="space-y-2.5">
              <div className="flex justify-between items-center px-1">
                <span className="text-xs font-semibold text-stone-300 flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                  Generated Scenic Loop
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleRegenerate}
                    className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
                    title="Regenerate with different randomisation"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Shuffle
                  </button>
                  <button
                    onClick={() => { setRoute(null); setBriefing(null); }}
                    className="text-xs text-stone-400 hover:text-stone-200 underline"
                  >
                    Edit
                  </button>
                </div>
              </div>

              <TrailBriefing
                route={route}
                briefing={briefing}
                onOpenHandOff={() => setIsHandOffOpen(true)}
                webGpuSupported={webGpuSupported}
                onInitWebGpu={handleInitWebGpu}
                webGpuProgress={webGpuProgress}
              />
            </div>
          )}
        </div>
      </main>

      {/* GPX & Screen Dimmer Modal */}
      {isHandOffOpen && route && (
        <HandOffModal route={route} onClose={() => setIsHandOffOpen(false)} />
      )}
    </div>
  );
};
