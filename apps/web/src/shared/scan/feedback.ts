let audio: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  audio ??= new AudioContext();
  return audio;
}

/**
 * Prepara el audio. iOS solo permite sonar si el `AudioContext` se crea o reanuda en un gesto del
 * usuario, así que se llama al tocar el botón de la cámara.
 */
export function primeScanFeedback(): void {
  try {
    void audioContext()?.resume();
  } catch {
    // Sin audio: queda la vibración.
  }
}

/** Vibración corta y un beep con Web Audio (sin archivos de audio). Nunca lanza. */
export function scanFeedback(): void {
  try {
    navigator.vibrate?.(100);
  } catch {
    // Sin vibración (iOS).
  }
  try {
    const context = audioContext();
    if (!context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'square';
    oscillator.frequency.value = 1800;
    gain.gain.value = 0.05;
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.08);
  } catch {
    // Sin audio.
  }
}
