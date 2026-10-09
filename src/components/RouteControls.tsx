import React from 'react';
import { ActivityMode, GreeneryPreference, SolarInfo } from '../types';
import { Compass, Sparkles, Footprints, Trees, SunMedium } from 'lucide-react';

interface RouteControlsProps {
  activity: ActivityMode;
  onActivityChange: (act: ActivityMode) => void;
  targetDistance: number;
  onDistanceChange: (dist: number) => void;
  preference: GreeneryPreference;
  onPreferenceChange: (pref: GreeneryPreference) => void;
  solar: SolarInfo;
  isGenerating: boolean;
  onGenerate: () => void;
  onUseCurrentLocation: () => void;
  isLocating: boolean;
}

export const RouteControls: React.FC<RouteControlsProps> = ({
  activity,
  onActivityChange,
  targetDistance,
  onDistanceChange,
  preference,
  onPreferenceChange,
  solar,
  isGenerating,
  onGenerate,
  onUseCurrentLocation,
  isLocating,
}) => {
  return (
    <div className="bg-stone-900/95 backdrop-blur-md border border-stone-800 rounded-3xl p-4 shadow-2xl flex flex-col gap-3.5">
      {/* Activity selector & GPS pill */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex bg-stone-950 p-1 rounded-2xl border border-stone-800/80">
          <button
            onClick={() => onActivityChange('run')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
              activity === 'run' ? 'bg-emerald-600 text-white shadow' : 'text-stone-400 hover:text-stone-200'
            }`}
          >
            🏃 Run
          </button>
          <button
            onClick={() => onActivityChange('walk')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
              activity === 'walk' ? 'bg-emerald-600 text-white shadow' : 'text-stone-400 hover:text-stone-200'
            }`}
          >
            🚶 Walk
          </button>
          <button
            onClick={() => onActivityChange('hike')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
              activity === 'hike' ? 'bg-emerald-600 text-white shadow' : 'text-stone-400 hover:text-stone-200'
            }`}
          >
            🥾 Hike
          </button>
        </div>

        <button
          onClick={onUseCurrentLocation}
          disabled={isLocating}
          className="bg-stone-850 hover:bg-stone-800 border border-stone-700/80 text-stone-300 text-xs px-3 py-1.5 rounded-2xl flex items-center gap-1.5 active:scale-95 transition-all"
          title="Use Phone GPS"
        >
          <Compass className={`w-3.5 h-3.5 text-emerald-400 ${isLocating ? 'animate-spin' : ''}`} />
          <span>{isLocating ? 'Locating...' : 'My GPS'}</span>
        </button>
      </div>

      {/* Distance slider & quick buttons */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-stone-400 font-medium">Target Distance Loop</span>
          <span className="text-emerald-400 font-bold text-sm tracking-tight">{targetDistance.toFixed(1)} km</span>
        </div>
        <input
          type="range"
          min="1"
          max="15"
          step="0.5"
          value={targetDistance}
          onChange={(e) => onDistanceChange(parseFloat(e.target.value))}
          className="w-full accent-emerald-500 bg-stone-950 h-2 rounded-lg cursor-pointer"
        />
        <div className="flex gap-2 pt-1">
          {[3, 5, 8, 10].map((d) => (
            <button
              key={d}
              onClick={() => onDistanceChange(d)}
              className={`flex-1 py-1 rounded-lg text-[11px] font-semibold transition-all border ${
                targetDistance === d
                  ? 'bg-emerald-950/80 border-emerald-500/80 text-emerald-300'
                  : 'bg-stone-950/60 border-stone-800 text-stone-400 hover:text-stone-200'
              }`}
            >
              {d}k
            </button>
          ))}
        </div>
      </div>

      {/* Greenery / Scenery preferences */}
      <div className="flex flex-col gap-1.5">
        <span className="text-stone-400 font-medium text-xs">Scenery & Canopy Bias</span>
        <div className="grid grid-cols-3 gap-1.5">
          <button
            onClick={() => onPreferenceChange('max_canopy')}
            className={`p-2 rounded-xl text-left border flex flex-col gap-1 transition-all ${
              preference === 'max_canopy'
                ? 'bg-emerald-950/60 border-emerald-500/80 text-emerald-200'
                : 'bg-stone-950/60 border-stone-800 text-stone-400 hover:text-stone-200'
            }`}
          >
            <Trees className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-[11px] font-semibold leading-tight">Dense Canopy</span>
          </button>

          <button
            onClick={() => onPreferenceChange('park_hopper')}
            className={`p-2 rounded-xl text-left border flex flex-col gap-1 transition-all ${
              preference === 'park_hopper'
                ? 'bg-emerald-950/60 border-emerald-500/80 text-emerald-200'
                : 'bg-stone-950/60 border-stone-800 text-stone-400 hover:text-stone-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-[11px] font-semibold leading-tight">Park Hopper</span>
          </button>

          <button
            onClick={() => onPreferenceChange('quiet_trail')}
            className={`p-2 rounded-xl text-left border flex flex-col gap-1 transition-all ${
              preference === 'quiet_trail'
                ? 'bg-emerald-950/60 border-emerald-500/80 text-emerald-200'
                : 'bg-stone-950/60 border-stone-800 text-stone-400 hover:text-stone-200'
            }`}
          >
            <Footprints className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-[11px] font-semibold leading-tight">Dirt & Trail</span>
          </button>
        </div>
      </div>

      {/* Solar angle banner */}
      <div className="bg-stone-950/70 border border-stone-800/80 rounded-xl px-2.5 py-1.5 flex items-center justify-between text-[11px] text-stone-300">
        <div className="flex items-center gap-1.5">
          <SunMedium className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="truncate">{solar.advisory}</span>
        </div>
        <span className="text-stone-400 text-[10px] font-mono shrink-0 pl-1">{solar.elevationDeg}° el</span>
      </div>

      {/* Main Synthesize Trail CTA */}
      <button
        onClick={onGenerate}
        disabled={isGenerating}
        className="w-full bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] disabled:opacity-60 text-white font-bold py-3 px-4 rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/30 transition-all text-sm tracking-wide"
      >
        {isGenerating ? (
          <>
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
            <span>Synthesizing Scenic Loop...</span>
          </>
        ) : (
          <>
            <span>🍃 Synthesize Trail</span>
            <span className="text-xs bg-emerald-700/80 px-2 py-0.5 rounded-full font-mono font-normal">
              OSM + WebGPU
            </span>
          </>
        )}
      </button>
    </div>
  );
};
