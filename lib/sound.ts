import { Move } from "@/lib/engine";

let ctx: AudioContext | null = null;

function beep(freq: number, dur: number, type: OscillatorType = "triangle", vol = 0.12) {
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AC();
    }
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + dur);
  } catch {
    /* ignore audio errors */
  }
}

export function playMoveSound(m: Move, isCheck: boolean, isOver: boolean, enabled: boolean) {
  if (!enabled) return;
  if (isOver) {
    beep(392, 0.18, "triangle");
    setTimeout(() => beep(523, 0.28, "triangle"), 120);
    return;
  }
  if (isCheck) {
    beep(660, 0.16, "square", 0.08);
    return;
  }
  if (m.castle) {
    beep(300, 0.09);
    setTimeout(() => beep(300, 0.09), 70);
    return;
  }
  if (m.captured || m.enpassant) {
    beep(200, 0.11, "sawtooth", 0.13);
    return;
  }
  beep(340, 0.07, "triangle", 0.11);
}

export function tick(enabled: boolean) {
  if (enabled) beep(440, 0.08);
}

export function playChat(enabled: boolean) {
  if (!enabled) return;
  beep(520, 0.06, "sine", 0.09);
  setTimeout(() => beep(760, 0.07, "sine", 0.08), 55);
}

export function speak(text: string, lang: string, enabled: boolean) {
  if (!enabled) return;
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = 1; u.pitch = 1; u.volume = 1;
    synth.cancel();
    synth.speak(u);
  } catch { /* ignore */ }
}
