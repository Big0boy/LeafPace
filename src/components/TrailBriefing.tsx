import React, { useState, useEffect, useRef } from 'react';
import { RouteData, TrailBriefingData } from '../types';
import { ShieldCheck, Cpu, Leaf, Mountain, Clock, Volume2, VolumeX } from 'lucide-react';

interface TrailBriefingProps {
  route: RouteData;
  briefing: TrailBriefingData | null;
  onOpenHandOff: () => void;
  webGpuSupported: boolean;
  onInitWebGpu?: () => void;
  webGpuProgress?: string;
}

export const TrailBriefing: React.FC<TrailBriefingProps> = ({
  route,
  briefing,
  onOpenHandOff,
  webGpuSupported,
  onInitWebGpu,
  webGpuProgress,
}) => {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [audioError, setAudioError] = useState<string | null>(null);
  const keepAliveRef = useRef<number | null>(null);
  const startCheckRef = useRef<number | null>(null);
  const finishedRef = useRef(true);
  const hasSpeech = typeof window !== 'undefined' && 'speechSynthesis' in window;

  // Load system voices. Chrome/Safari populate this list asynchronously and
  // some browsers never emit `voiceschanged`, so we poll briefly as well.
  useEffect(() => {
    if (!hasSpeech) return;
    const synth = window.speechSynthesis;

    const loadVoices = () => {
      const list = synth.getVoices();
      if (list.length > 0) setVoices(list);
    };

    loadVoices();
    synth.addEventListener('voiceschanged', loadVoices);

    let polls = 0;
    const pollId = window.setInterval(() => {
      loadVoices();
      if (++polls >= 25 || synth.getVoices().length > 0) window.clearInterval(pollId);
    }, 200);

    return () => {
      window.clearInterval(pollId);
      synth.removeEventListener('voiceschanged', loadVoices);
      if (keepAliveRef.current !== null) window.clearInterval(keepAliveRef.current);
      if (startCheckRef.current !== null) window.clearTimeout(startCheckRef.current);
      synth.cancel();
    };
  }, [hasSpeech]);

  /** Ends narration state and clears both watchdog timers (idempotent). */
  const finish = () => {
    if (keepAliveRef.current !== null) {
      window.clearInterval(keepAliveRef.current);
      keepAliveRef.current = null;
    }
    if (startCheckRef.current !== null) {
      window.clearTimeout(startCheckRef.current);
      startCheckRef.current = null;
    }
    finishedRef.current = true;
    setIsSpeaking(false);
  };

  /** Stops narration and the Chrome pause-watchdog, from anywhere. */
  const stopNarration = () => {
    if (hasSpeech) window.speechSynthesis.cancel();
    finish();
  };

  /** Best-effort voice pick: exact locale → English → whatever exists. */
  const pickVoice = (): SpeechSynthesisVoice | null => {
    if (voices.length === 0) return null;
    const locale = (navigator.language || 'en').replace('_', '-');
    return (
      voices.find((v) => v.lang.replace('_', '-') === locale && v.localService) ||
      voices.find((v) => v.lang.replace('_', '-') === locale) ||
      voices.find((v) => v.lang.toLowerCase().startsWith('en') && v.localService) ||
      voices.find((v) => v.lang.toLowerCase().startsWith('en')) ||
      voices[0]
    );
  };

  /** Human-readable explanation for a Web Speech API error code. */
  const describeSpeechError = (code: string): string => {
    const isLinuxDesktop =
      /Linux|X11/i.test(navigator.userAgent) && !/Android/i.test(navigator.userAgent);
    switch (code) {
      case 'synthesis-unavailable':
      case 'synthesis-failed':
        return isLinuxDesktop
          ? 'No text-to-speech engine on this Linux system – install speech-dispatcher + espeak-ng, then restart the browser.'
          : 'No working text-to-speech engine. Enable one in your system accessibility settings.';
      case 'not-allowed':
        return 'Speech was blocked – tap Listen again to allow audio.';
      case 'language-not-supported':
        return 'No installed voice supports this language.';
      default:
        return `Speech unavailable (${code}). Check system volume & TTS settings.`;
    }
  };

  const handleToggleAudio = () => {
    if (!hasSpeech || !briefing) return;
    const synth = window.speechSynthesis;

    if (isSpeaking || synth.speaking || synth.pending) {
      stopNarration();
      return;
    }

    // Split into short queued utterances: long single narrations are cut off
    // after ~15s by Chrome and Safari, which is why audio seemed to "stop".
    const segments = [
      `Trail briefing for your ${route.distanceKm.toFixed(1)} kilometer, ${route.greeneryScorePercent} percent nature loop.`,
      briefing.foliageHighlights,
      `Footing note: ${briefing.surfaceAdvice}.`,
      `Mindset: ${briefing.outdoorMindset}`,
    ];

    const voice = pickVoice();
    segments.forEach((text, idx) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.95;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;
      if (voice) utterance.voice = voice;
      if (idx === segments.length - 1) utterance.onend = finish;
      utterance.onerror = (e) => {
        // `canceled`/`interrupted` are fired by our own stopNarration()
        if (e.error !== 'canceled' && e.error !== 'interrupted') {
          setAudioError(describeSpeechError(e.error || 'error'));
        }
        finish();
      };
      synth.speak(utterance);
    });

    setAudioError(null);
    finishedRef.current = false;
    setIsSpeaking(true);

    // Some devices have no TTS voices at all: speak() is silently ignored and
    // the button would stay on "Stop" forever.  Verify speech actually began.
    startCheckRef.current = window.setTimeout(() => {
      startCheckRef.current = null;
      if (finishedRef.current || synth.speaking || synth.pending) return;
      setAudioError(
        voices.length === 0
          ? 'No speech voices found on this device – enable a system text-to-speech voice to hear briefings.'
          : 'Speech did not start. Check system volume and text-to-speech settings.'
      );
      finish();
    }, 2000);

    // Chrome silently pauses speech after ~15s; nudge it awake every 8s.
    keepAliveRef.current = window.setInterval(() => {
      if (!synth.speaking && !synth.pending) {
        finish();
        return;
      }
      synth.resume();
    }, 8000);
  };
  return (
    <div className="bg-stone-900/95 backdrop-blur-md border border-stone-800 rounded-3xl p-4 shadow-2xl flex flex-col gap-3.5 animate-in fade-in slide-in-from-bottom-4 duration-300">
      {/* Route Quick Stats Bar */}
      <div className="grid grid-cols-4 gap-2 bg-stone-950 p-2.5 rounded-2xl border border-stone-800/80 text-center">
        <div>
          <div className="text-[10px] text-stone-400 font-medium">Distance</div>
          <div className="text-emerald-400 font-bold text-sm">{route.distanceKm.toFixed(1)} km</div>
        </div>
        <div>
          <div className="text-[10px] text-stone-400 font-medium">Est. Time</div>
          <div className="text-stone-200 font-bold text-sm flex items-center justify-center gap-0.5">
            <Clock className="w-3 h-3 text-stone-400" />
            {route.estimatedDurationMin}m
          </div>
        </div>
        <div>
          <div className="text-[10px] text-stone-400 font-medium">Greenery</div>
          <div className="text-emerald-300 font-bold text-sm flex items-center justify-center gap-0.5">
            <Leaf className="w-3 h-3 text-emerald-400" />
            {route.greeneryScorePercent}%
          </div>
        </div>
        <div>
          <div className="text-[10px] text-stone-400 font-medium">Elev. Gain</div>
          <div className="text-stone-300 font-bold text-sm flex items-center justify-center gap-0.5">
            <Mountain className="w-3 h-3 text-stone-400" />
            +{route.elevationGainMeters}m
          </div>
        </div>
      </div>

      {/* Surface composition bar */}
      <div className="flex flex-col gap-1">
        <div className="flex justify-between text-[11px] text-stone-400">
          <span>Trail: {route.surfaceSummary.trail}%</span>
          <span>Paved: {route.surfaceSummary.paved}%</span>
        </div>
        <div className="h-1.5 w-full bg-stone-800 rounded-full overflow-hidden flex">
          <div
            className="h-full bg-emerald-500 rounded-l-full transition-all duration-500"
            style={{ width: `${route.surfaceSummary.trail}%` }}
          />
          <div
            className="h-full bg-stone-600 rounded-r-full transition-all duration-500"
            style={{ width: `${route.surfaceSummary.paved}%` }}
          />
        </div>
      </div>

      {/* AI Trail Briefing Box */}
      {briefing && (
        <div className="bg-emerald-950/20 border border-emerald-900/40 rounded-2xl p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-emerald-300 flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-emerald-400" />
              Naturalist Trail Briefing
            </span>
            <div className="flex items-center gap-1.5">
              {'speechSynthesis' in window && (
                <button
                  onClick={handleToggleAudio}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold flex items-center gap-1 transition-all border ${
                    isSpeaking
                      ? 'bg-emerald-500 text-stone-950 border-emerald-400 animate-pulse'
                      : 'bg-stone-900/90 text-emerald-300 border-emerald-800/40 hover:bg-stone-850'
                  }`}
                  title="Listen to briefing via earphones"
                >
                  {isSpeaking ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3 text-emerald-400" />}
                  <span>{isSpeaking ? 'Stop' : 'Listen'}</span>
                </button>
              )}
              <span className="text-[10px] font-mono bg-stone-900/90 border border-emerald-800/40 px-2 py-0.5 rounded-full text-emerald-400 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-emerald-400" />
                {briefing.modelUsed}
              </span>
            </div>
          </div>

          {audioError && (
            <p className="text-[10px] text-amber-400 bg-amber-950/40 border border-amber-900/60 px-2 py-1 rounded-lg">
              {audioError}
            </p>
          )}

          <div className="space-y-1.5 text-xs text-stone-200 leading-relaxed">
            <p className="flex items-start gap-1.5">
              <span className="shrink-0">🌲</span>
              <span>{briefing.foliageHighlights}</span>
            </p>
            <p className="flex items-start gap-1.5">
              <span className="shrink-0">👟</span>
              <span>{briefing.surfaceAdvice}</span>
            </p>
            <p className="flex items-start gap-1.5 italic text-emerald-300 font-medium">
              <span className="shrink-0">🍃</span>
              <span>"{briefing.outdoorMindset}"</span>
            </p>
          </div>
        </div>
      )}

      {/* Optional WebGPU status or download progress */}
      {webGpuProgress && (
        <div className="text-[11px] text-emerald-400 bg-emerald-950/40 border border-emerald-900/60 p-2 rounded-xl flex items-center gap-2">
          <span className="w-3 h-3 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin"></span>
          <span>{webGpuProgress}</span>
        </div>
      )}

      {/* Bottom CTA to hand-off & touch grass */}
      <button
        onClick={onOpenHandOff}
        className="w-full bg-emerald-500 hover:bg-emerald-400 active:scale-[0.98] text-stone-950 font-extrabold py-3 px-4 rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 text-sm tracking-wide transition-all"
      >
        <span>📱 Lock Phone & Touch Grass</span>
        <span className="text-xs opacity-75">→</span>
      </button>

      {/* Model toggle helper */}
      {webGpuSupported && !webGpuProgress && onInitWebGpu && (
        <button
          onClick={onInitWebGpu}
          className="text-[10px] text-stone-500 hover:text-stone-300 underline text-center pt-0.5"
        >
          Enable offline WebGPU in-browser weights (SmolLM2-360M)
        </button>
      )}
    </div>
  );
};
