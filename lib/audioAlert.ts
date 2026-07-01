// Beep gerado por código via Web Audio API — sem arquivo de áudio.
// Autoplay pode ser bloqueado pelo navegador se nenhuma interação do
// usuário aconteceu ainda; o catch silencioso é intencional — o toast
// visual continua funcionando de qualquer forma.

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  return ctx;
}

function tone(audioCtx: AudioContext, freq: number, startOffset: number, duration: number) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.frequency.value = freq;
  osc.type = 'sine';
  const t0 = audioCtx.currentTime + startOffset;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.2, t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

export function playPreparingAlert() {
  try {
    const audioCtx = getContext();
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    tone(audioCtx, 660, 0, 0.15);
  } catch {
    // autoplay bloqueado ou API indisponível
  }
}

export function playReadyAlert() {
  try {
    const audioCtx = getContext();
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    tone(audioCtx, 880, 0, 0.15);
    tone(audioCtx, 1175, 0.18, 0.2);
  } catch {
    // autoplay bloqueado ou API indisponível
  }
}

export function vibrateAlert(pattern: number[]) {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try { navigator.vibrate(pattern); } catch {}
  }
}
