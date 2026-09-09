/** Short Web Audio tone, used for scan feedback. No-ops if audio is blocked. */
export function playTone(frequency: number, durationMs = 150) {
  try {
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.value = 0.08;
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + durationMs / 1000);
    oscillator.onended = () => ctx.close();
  } catch {
    // Audio unavailable; scanning still works without sound.
  }
}

export function successFeedback() {
  playTone(880, 140);
  navigator.vibrate?.(80);
}

export function noticeFeedback() {
  playTone(440, 180);
  navigator.vibrate?.([40, 40, 40]);
}
