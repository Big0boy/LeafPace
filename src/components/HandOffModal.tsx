import React, { useState } from 'react';
import { RouteData } from '../types';
import { downloadGpxFile, generateGpxString } from '../services/gpx';
import { Download, ExternalLink, X, Compass, EyeOff, Sparkles, Share2 } from 'lucide-react';

interface HandOffModalProps {
  route: RouteData;
  onClose: () => void;
}

export const HandOffModal: React.FC<HandOffModalProps> = ({ route, onClose }) => {
  const [screenDimmed, setScreenDimmed] = useState(false);

  const handleDownload = () => {
    downloadGpxFile(route, `leafpace_${route.distanceKm.toFixed(1)}k_trail.gpx`);
  };

  const handleShare = async () => {
    if (!navigator.share) return;
    try {
      const gpxContent = generateGpxString(route);
      const file = new File([gpxContent], `leafpace_${route.distanceKm.toFixed(1)}k_trail.gpx`, {
        type: 'application/gpx+xml',
      });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `LeafPace ${route.distanceKm.toFixed(1)}k Trail`,
          text: `Check out this ${route.greeneryScorePercent}% greenery trail loop!`,
        });
      } else {
        await navigator.share({
          title: `LeafPace ${route.distanceKm.toFixed(1)}k Trail`,
          text: `Run/walk this ${route.distanceKm.toFixed(1)}k scenic loop (${route.greeneryScorePercent}% greenery)!`,
          url: window.location.href,
        });
      }
    } catch (e) {
      console.warn('Share cancelled or not supported:', e);
    }
  };

  const startPt = route.coordinates[0];
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${startPt?.lat},${startPt?.lng}&travelmode=walking`;

  if (screenDimmed) {
    return (
      <div
        onClick={() => setScreenDimmed(false)}
        className="fixed inset-0 z-[1000] bg-black text-stone-600 flex flex-col items-center justify-center p-6 text-center cursor-pointer select-none transition-all duration-700"
      >
        <div className="flex flex-col items-center gap-4 max-w-xs animate-pulse">
          <EyeOff className="w-12 h-12 text-emerald-900" />
          <h2 className="text-xl font-bold text-stone-500 tracking-tight">Screen in Pocket</h2>
          <p className="text-xs text-stone-600 leading-relaxed">
            Your trail is loaded. Feel the morning air, watch the canopy, and enjoy your time outside.
          </p>
          <span className="text-[10px] text-stone-700 pt-8 border-t border-stone-900">
            Tap anywhere to wake screen
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[900] bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center p-3 sm:p-4">
      <div className="bg-stone-900 border border-stone-800 rounded-3xl w-full max-w-sm p-5 shadow-2xl flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-8 duration-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-emerald-950 border border-emerald-800 flex items-center justify-center">
              <Compass className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-stone-100">Trail Handoff</h3>
              <p className="text-[11px] text-stone-400">Put the screen away</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-stone-800 text-stone-400 flex items-center justify-center hover:text-stone-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 1. GPX Download */}
        <div className="bg-stone-950 p-3.5 rounded-2xl border border-stone-800 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-stone-200">1. Watch / GPS File</span>
            <span className="text-[10px] font-mono text-emerald-400">.GPX 1.1</span>
          </div>
          <p className="text-[11px] text-stone-400">
            Open with Garmin Connect, Apple Fitness, Strava, Organic Maps, or OsmAnd.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleDownload}
              className="flex-1 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-semibold py-2.5 px-3 rounded-xl text-xs flex items-center justify-center gap-2 transition-all shadow"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download .GPX</span>
            </button>
            {'share' in navigator && (
              <button
                onClick={handleShare}
                className="bg-stone-850 hover:bg-stone-800 active:scale-95 border border-stone-700/80 text-emerald-300 font-semibold py-2.5 px-3 rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all"
                title="Share to Garmin, Apple Watch, or Friends"
              >
                <Share2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Share</span>
              </button>
            )}
          </div>
        </div>

        {/* 2. Open in Maps */}
        <div className="bg-stone-950 p-3.5 rounded-2xl border border-stone-800 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-stone-200">2. Trailhead Navigation</span>
            <span className="text-[10px] text-stone-400">Turn-by-turn</span>
          </div>
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full bg-stone-850 hover:bg-stone-800 active:scale-95 border border-stone-700/80 text-stone-200 font-semibold py-2.5 px-3 rounded-xl text-xs flex items-center justify-center gap-2 transition-all"
          >
            <ExternalLink className="w-3.5 h-3.5 text-emerald-400" />
            <span>Navigate to Trailhead</span>
          </a>
        </div>

        {/* 3. Screen Off Trigger */}
        <button
          onClick={() => setScreenDimmed(true)}
          className="w-full bg-stone-800 hover:bg-stone-700 active:scale-95 text-emerald-300 font-bold py-3 px-4 rounded-2xl text-xs flex items-center justify-center gap-2 transition-all border border-emerald-900/50"
        >
          <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
          <span>Dim Screen & Touch Grass</span>
        </button>
      </div>
    </div>
  );
};
