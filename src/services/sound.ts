/**
 * Confirmation sound for a settled payment.
 *
 * Two sides of the same event need to be acknowledged: the payer signs and
 * the collector sees the charge land. A short chime says "it happened"
 * without either side having to read the screen.
 *
 * Synthesised with the Web Audio API rather than shipped as an audio file:
 * no asset to load, no licence, and it cannot be cached stale. The tone is a
 * rising perfect fifth — two notes, unmistakable, not alarming.
 *
 * Browsers only allow audio after a user gesture on the page, so
 * {@link unlockAudio} is called from the click that starts the flow. Every
 * entry point is fail-soft: a browser that refuses to play must never break
 * a payment.
 */

type AudioContextCtor = new () => AudioContext;

let context: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;

  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
  if (!Ctor) return null;

  if (!context) {
    try {
      context = new Ctor();
    } catch {
      return null;
    }
  }
  return context;
}

/**
 * Prepare the audio context for playback.
 *
 * Call this from a user gesture — a click that starts the payment flow —
 * so the browser allows the confirmation chime later, when the payment
 * settles without any interaction of its own.
 */
export function unlockAudio(): void {
  const ctx = getAudioContext();
  if (ctx && ctx.state === 'suspended') {
    void ctx.resume().catch(() => undefined);
  }
}

/**
 * Play the "payment confirmed" chime.
 *
 * Fail-soft by design: if the context cannot be created or resumed, the
 * payment still happened and the UI still shows it.
 */
export function playPaymentConfirmed(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => undefined);
  }

  const now = ctx.currentTime;
  // E5 then A5 — a rising perfect fifth.
  const notes = [
    { at: 0, frequency: 659.25 },
    { at: 0.11, frequency: 880 },
  ];

  try {
    for (const note of notes) {
      const start = now + note.at;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(note.frequency, start);

      // A short attack and a soft decay: audible, never harsh.
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.16, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);

      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.34);
    }
  } catch {
    // Audio is a nicety. Never let it interrupt a payment.
  }
}
