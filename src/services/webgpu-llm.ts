/**
 * On-device WebGPU LLM service for LeafPace.
 *
 * Uses @mlc-ai/web-llm to execute a quantized open-weight model entirely
 * inside the browser's WebGPU pipeline.  When the model is unavailable
 * (unsupported device, download pending, or inference failure) the service
 * gracefully falls back to a deterministic template generator so the user
 * is never blocked.
 */

import type { MLCEngine, InitProgressReport } from '@mlc-ai/web-llm';
import { RouteData, SolarInfo, TrailBriefingData, ActivityMode, GreeneryPreference } from '../types';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Lightweight, ultra-fast model ideal for mobile WebGPU */
export const SELECTED_MODEL = 'SmolLM2-360M-Instruct-q4f16_1-MLC';

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let engineInstance: MLCEngine | null = null;
let isInitializing = false;

// ---------------------------------------------------------------------------
// Capability checks
// ---------------------------------------------------------------------------

/**
 * Returns `true` when the current browser / device exposes the WebGPU API.
 */
export function checkWebGPUSupport(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

/**
 * Returns `true` when the on-device model has been successfully loaded and
 * is ready to generate text.  Use this in the UI to conditionally show the
 * "powered by local WebGPU" badge.
 */
export function isModelReady(): boolean {
  return engineInstance !== null;
}

// ---------------------------------------------------------------------------
// Model lifecycle
// ---------------------------------------------------------------------------

/**
 * Dynamically imports `@mlc-ai/web-llm` (code-split) and initialises the
 * on-device model.  This is intentionally lazy so the ~6 MB WebLLM chunk is
 * only fetched when the user explicitly requests local AI generation.
 *
 * @param onProgress – Optional callback that receives download / compile
 *   progress updates from the engine.
 * @returns The ready engine instance, or `null` if the device does not
 *   support WebGPU or initialisation fails.
 */
export async function initWebGPUModel(
  onProgress?: (progress: InitProgressReport) => void
): Promise<MLCEngine | null> {
  if (engineInstance) return engineInstance;
  if (!checkWebGPUSupport()) {
    console.warn('WebGPU not supported in this browser. Fallback local engine will be used.');
    return null;
  }

  if (isInitializing) return null;
  isInitializing = true;

  try {
    // Dynamic import keeps the heavy WebLLM runtime out of the initial bundle
    const { CreateMLCEngine } = await import('@mlc-ai/web-llm');

    engineInstance = await CreateMLCEngine(SELECTED_MODEL, {
      initProgressCallback: onProgress,
    });
    return engineInstance;
  } catch (err) {
    console.warn('WebGPU model initialisation error — switching to instant edge synthesis:', err);
    return null;
  } finally {
    isInitializing = false;
  }
}

// ---------------------------------------------------------------------------
// Trail briefing generation
// ---------------------------------------------------------------------------

/**
 * Generates a concise, sensory trail briefing.
 *
 * 1. If the WebGPU engine is loaded it streams tokens from the on-device
 *    model, producing a naturalist-style micro-essay.
 * 2. Otherwise it falls back to a **deterministic template generator** that
 *    returns instantly and still provides useful foliage / surface / mindset
 *    cues.
 *
 * @param route     – The generated scenic loop data.
 * @param solar     – Current solar position and shade advisory.
 * @param activity  – Run, walk, or hike.
 * @param preference – Greenery preference selected by the user.
 * @param onToken   – Optional streaming callback; receives the full
 *                     accumulated text after each new token.
 */
export async function generateTrailBriefing(
  route: RouteData,
  solar: SolarInfo,
  activity: ActivityMode,
  preference: GreeneryPreference,
  onToken?: (text: string) => void
): Promise<TrailBriefingData> {
  const startTime = performance.now();
  const parks = route.greenSpacesEncountered.join(', ');
  const modeLabel = activity === 'run' ? 'run' : activity === 'hike' ? 'hike' : 'walk';

  const systemPrompt = `You are LeafPace, a minimalist outdoor trail whisperer. Your purpose is to get the user off their phone and into nature immediately.
Output exactly 3 short bullet points:
1. 🌲 Foliage & Corridor: Highlight the green spaces (${parks}) and canopy cover.
2. 👟 Footing & Light: Note surface conditions (${route.surfaceSummary.trail}% trail, ${route.surfaceSummary.paved}% paved) and sun angle (${solar.azimuthDeg}°).
3. 🍃 Mindset: A grounding 1-sentence thought to inspire leaving the phone in their pocket.
Keep total response under 60 words. No intro, no filler.`;

  const userPrompt = `Generate a quick trail briefing for a ${route.distanceKm} km ${modeLabel}. Solar note: ${solar.advisory}.`;

  // ── Attempt on-device WebGPU inference ──────────────────────────────────
  if (engineInstance) {
    try {
      const messages = [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: userPrompt },
      ];

      const completion = await engineInstance.chat.completions.create({
        messages,
        temperature: 0.6,
        max_tokens: 150,
        stream: true,
      });

      let fullText = '';
      for await (const chunk of completion) {
        const delta = chunk.choices[0]?.delta?.content || '';
        fullText += delta;
        if (onToken) onToken(fullText);
      }

      const elapsed = Number(((performance.now() - startTime) / 1000).toFixed(2));
      return parseBriefingResponse(fullText, 'SmolLM2 (Local WebGPU)', elapsed, true);
    } catch (e) {
      console.warn('WebGPU inference failed, using deterministic local generator:', e);
    }
  }

  // ── Instant deterministic fallback ──────────────────────────────────────
  const simulated = generateDeterministicBriefing(route, solar, activity, preference);
  const elapsed = Number(((performance.now() - startTime) / 1000).toFixed(2));
  if (onToken) onToken(simulated.fullMarkdown || '');
  return { ...simulated, inferenceTimeSec: elapsed };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function parseBriefingResponse(
  text: string,
  modelUsed: string,
  inferenceTimeSec: number,
  onDevice: boolean
): TrailBriefingData {
  const lines = text.split('\n').filter(l => l.trim().length > 0);
  return {
    foliageHighlights: lines[0]?.replace(/^[-*•\d.]+\s*/, '') || `Lush foliage around ${lines[0] || 'nearby parks'}.`,
    surfaceAdvice: lines[1]?.replace(/^[-*•\d.]+\s*/, '') || 'Steady mixed trail and quiet path surfaces.',
    outdoorMindset: lines[2]?.replace(/^[-*•\d.]+\s*/, '') || 'Screen away, laces tied. Listen to the wind.',
    fullMarkdown: text,
    modelUsed,
    inferenceTimeSec,
    onDevice,
  };
}

function generateDeterministicBriefing(
  route: RouteData,
  solar: SolarInfo,
  activity: ActivityMode,
  preference: GreeneryPreference
): TrailBriefingData {
  const parkNames = route.greenSpacesEncountered.slice(0, 2).join(' & ');
  const mode = activity === 'run' ? 'stride' : 'cadence';

  const foliage = preference === 'max_canopy'
    ? `Loop weaves through ${parkNames} under ${route.greeneryScorePercent}% canopy cover with dappled autumn light.`
    : `Open greenway traversing ${parkNames} with wide skyline views and seasonal leaf foliage.`;

  const surface = `${route.surfaceSummary.trail}% unpaved dirt path, ${route.surfaceSummary.paved}% quiet pavement. Sun at ${solar.azimuthDeg}° (${solar.elevationDeg}° elevation).`;

  const mindset = `Find your natural ${mode}. Laces tied, phone locked in pocket—go touch grass.`;

  const fullMarkdown = `🌲 **Foliage:** ${foliage}\n\n👟 **Footing & Light:** ${surface}\n\n🍃 **Mindset:** ${mindset}`;

  return {
    foliageHighlights: foliage,
    surfaceAdvice: surface,
    outdoorMindset: mindset,
    fullMarkdown,
    modelUsed: 'Open-Edge Trail Synthesizer (Instant)',
    inferenceTimeSec: 0.05,
    onDevice: true,
  };
}
