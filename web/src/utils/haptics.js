// haptics.js
//
// A short vibration pulse on each delivery submission, alongside the
// existing "ding" sound (see sound.js) — NOT a replacement for it.
//
// Real, confirmed constraint as of this writing: the Vibration API
// (navigator.vibrate) has NO equivalent in Safari or iOS Safari at
// all — WebKit doesn't expose any public haptics/vibration API to web
// pages, full stop, not even as an unsupported-but-present method.
// Since this app is scored from a real mix of iPhone and Android
// devices, this utility is written to be a genuine no-op on iOS: it
// feature-detects, and if navigator.vibrate doesn't exist, it simply
// does nothing — no error, no fallback sound, no visible difference
// from today. Android scorers get the vibration; iPhone scorers
// continue exactly as before (ding sound only).
//
// Same defensive shape as playDingSound() in sound.js: wrapped in
// try/catch, never throws, never allowed to interrupt or block actual
// scoring if anything about it misbehaves on a given device/browser.

/**
 * Triggers a short vibration pulse — confirmed explicitly: every
 * successful delivery submission, same trigger point as the ding
 * sound. A single short pulse (not a pattern) — clearly different in
 * character from a longer "error" or "alert" style vibration, so it
 * reads as a normal confirmation tap rather than a warning.
 */
export function triggerSubmitHaptic() {
  try {
    if (!('vibrate' in navigator)) return; // iOS Safari and any other unsupported browser — silently no-op
    navigator.vibrate(40);
  } catch {
    // Never let a haptics failure interrupt scoring.
  }
}
