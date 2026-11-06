// Sons synthétisés (Web Audio), aucun fichier à charger : relais qui claquent, bips du compte à rebours, tic de l'horloge,
// bouton éjecté, coup de marteau du commissaire-priseur.
import { useStore } from '../store';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (!useStore.getState().prefs.sound) return null;
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; delay?: number; slide?: number; attack?: number } = {}): void {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + (opts.delay ?? 0);
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  if (opts.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * opts.slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.1, t0 + (opts.attack ?? 0.006));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noise(dur: number, opts: { gain?: number; delay?: number; freq?: number; type?: BiquadFilterType; q?: number; fade?: number; sweep?: number } = {}): void {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + (opts.delay ?? 0);
  const buffer = a.createBuffer(1, Math.max(1, Math.floor(a.sampleRate * dur)), a.sampleRate);
  const data = buffer.getChannelData(0);
  const fade = opts.fade ?? 2;
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** fade;
  const src = a.createBufferSource();
  src.buffer = buffer;
  const filter = a.createBiquadFilter();
  filter.type = opts.type ?? 'bandpass';
  filter.frequency.setValueAtTime(opts.freq ?? 2400, t0);
  if (opts.sweep) filter.frequency.exponentialRampToValueAtTime(opts.sweep, t0 + dur);
  if (opts.q) filter.Q.value = opts.q;
  const g = a.createGain();
  g.gain.value = opts.gain ?? 0.25;
  src.connect(filter).connect(g).connect(a.destination);
  src.start(t0);
}

/** Un relais qui claque : un choc bref et métallique. */
function relay(pitch = 1, gain = 1, delay = 0): void {
  noise(0.03, { gain: 0.3 * gain, freq: 3200 * pitch, q: 3, fade: 6, delay });
  tone(180 * pitch, 0.05, { type: 'square', gain: 0.03 * gain, delay, slide: 0.6 });
}

export const sfx = {
  /** Le doigt se pose sur le bouton. */
  press: () => relay(0.8, 0.9),
  /** Le doigt se lève avant que le temps ne file. */
  lift: () => relay(1.2, 0.6),
  /** Un bip du compte à rebours, plus aigu au départ. */
  beep: (go: boolean) => tone(go ? 1318.5 : 880, go ? 0.42 : 0.12, { type: 'square', gain: go ? 0.045 : 0.03 }),
  /** Le tic de l'horloge, chaque seconde, tant que l'enchère dure. */
  tick: (loud: boolean) => noise(0.018, { gain: loud ? 0.18 : 0.09, freq: 4200, q: 4, fade: 8 }),
  /** Le doigt se lève pendant l'enchère : la mise est faite. */
  release: () => {
    relay(1, 1);
    tone(523.25, 0.18, { type: 'triangle', gain: 0.03, delay: 0.02 });
  },
  /** Le temps est épuisé : le bouton saute. */
  pushed: () => {
    tone(220, 0.45, { type: 'sawtooth', gain: 0.05, slide: 0.5 });
    noise(0.2, { gain: 0.2, freq: 600, sweep: 150, type: 'lowpass', fade: 1.5 });
  },
  /** Adjugé : deux coups de marteau, et une note claire si c'est pour moi. */
  gavel: (mine: boolean) => {
    for (const d of [0, 0.16]) {
      noise(0.07, { gain: 0.32, freq: 380, q: 1.4, fade: 4, delay: d });
      tone(140, 0.12, { type: 'sine', gain: 0.07, delay: d, slide: 0.7 });
    }
    if (mine) [784, 987.8, 1318.5].forEach((f, i) => tone(f, 0.5, { type: 'triangle', gain: 0.045, delay: 0.32 + i * 0.09 }));
  },
  /** Égalité au dixième : le jeton est perdu. */
  tie: () => {
    tone(466.2, 0.5, { type: 'triangle', gain: 0.04 });
    tone(493.9, 0.5, { type: 'triangle', gain: 0.04 });
  },
  /** Personne n'a enchéri. */
  nobody: () => tone(392, 0.4, { type: 'sine', gain: 0.035, slide: 0.75 }),
  /** Fin de partie : modeste ou triomphale. */
  fanfare: (good: boolean) => {
    const notes = good ? [523.25, 659.25, 783.99, 659.25, 783.99, 1046.5] : [392, 349.23, 311.13, 261.63];
    notes.forEach((f, i) => tone(f, i === notes.length - 1 ? 0.9 : 0.2, { type: 'triangle', gain: 0.06, delay: i * 0.13 }));
  },
  /** Début de partie : l'appareil qui chauffe. */
  start: () => {
    tone(60, 1.1, { type: 'sawtooth', gain: 0.025, slide: 2, attack: 0.3 });
    relay(0.9, 0.8, 0.5);
  },
};
