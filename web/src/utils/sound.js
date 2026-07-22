// sound.js
//
// Plays a short bell sound file on every successful delivery submission,
// and a short synthesized click/tick for general button interactions
// app-wide (wired up via a single delegated listener in main.jsx).

const SUBMIT_SOUND_URL = '/sounds/submit-bell.mp3';

let submitAudio = null;

function getSubmitAudio() {
  if (!submitAudio) {
    submitAudio = new Audio(SUBMIT_SOUND_URL);
  }
  return submitAudio;
}

/**
 * Plays the submission confirmation bell — confirmed explicitly: every
 * successful delivery submission (runs, wides, no-balls, wickets all
 * the same sound), triggered right after the backend confirms the
 * delivery was recorded. Wrapped in a try/catch and never throws — a
 * sound effect is a non-critical nicety, and should never be able to
 * interrupt or block actual scoring if something about audio playback
 * goes wrong on a given device/browser.
 */
export function playDingSound() {
  try {
    const base = getSubmitAudio();
    // Clone rather than replay the same element so rapid consecutive
    // submissions (quick taps) overlap instead of cutting each other off.
    const audio = base.currentTime === 0 || base.ended || base.paused ? base : base.cloneNode();
    audio.currentTime = 0;
    audio.play().catch(() => {
      // Autoplay/gesture restrictions or a decoding failure — never let
      // a sound-effect failure interrupt scoring.
    });
  } catch {
    // Never let a sound-effect failure interrupt scoring.
  }
}

let clickAudioContext = null;

function getClickAudioContext() {
  if (!clickAudioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null; // unsupported browser — fail silently
    clickAudioContext = new AudioContextClass();
  }
  if (clickAudioContext.state === 'suspended') {
    clickAudioContext.resume();
  }
  return clickAudioContext;
}

/**
 * Short click/tick for general button interactions (menu, setup screens,
 * numpad, etc.) — distinct from the Submit bell above. Wrapped in a
 * try/catch and never throws for the same reason as playDingSound.
 */
export function playClickSound() {
  try {
    const ctx = getClickAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 800; // Hz — a crisp mid-tone
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.03, ctx.currentTime + 0.1); // fade out quickly
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.1); // 100ms beep
  } catch {
    // Never let a sound-effect failure interrupt scoring.
  }
}
