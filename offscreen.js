// Offscreen audio engine. Sounds synthesized with Web Audio — no audio files,
// fully offline. `variant` nudges pitch: "rest" (entering a break) is lower/softer,
// "go" (back to focus) is brighter.

let ctx;
function audio() {
  if (!ctx) ctx = new (self.AudioContext || self.webkitAudioContext)();
  return ctx;
}

function tone(ac, { freq, start, dur, type = "sine", gain = 0.5, glideTo = null }) {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, start + dur);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(start);
  osc.stop(start + dur + 0.05);
}

function playGong(ac, t, v, p) {
  tone(ac, { freq: 196 * p, start: t, dur: 2.6, type: "sine", gain: v });
  tone(ac, { freq: 294 * p, start: t, dur: 2.2, type: "sine", gain: v * 0.5 });
  tone(ac, { freq: 440 * p, start: t + 0.02, dur: 1.6, type: "sine", gain: v * 0.25 });
}
function playBell(ac, t, v, p) {
  tone(ac, { freq: 880 * p, start: t, dur: 0.9, type: "triangle", gain: v });
  tone(ac, { freq: 1318 * p, start: t, dur: 0.7, type: "triangle", gain: v * 0.6 });
  tone(ac, { freq: 660 * p, start: t + 0.28, dur: 1.0, type: "triangle", gain: v * 0.7 });
}
function playBeep(ac, t, v, p) {
  tone(ac, { freq: 1046 * p, start: t, dur: 0.12, type: "square", gain: v });
  tone(ac, { freq: 1046 * p, start: t + 0.18, dur: 0.12, type: "square", gain: v });
  tone(ac, { freq: 1318 * p, start: t + 0.36, dur: 0.18, type: "square", gain: v });
}

function play(sound, volume, variant) {
  const ac = audio();
  if (ac.state === "suspended") ac.resume();
  const t = ac.currentTime;
  const v = (typeof volume === "number" ? Math.max(0, Math.min(1, volume)) : 0.7) * 0.85;
  const p = variant === "rest" ? 0.84 : variant === "go" ? 1.0 : 0.92;
  if (sound === "gong") playGong(ac, t, v, p);
  else if (sound === "bell") playBell(ac, t, v, p);
  else if (sound === "beep") playBeep(ac, t, v, p);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.target !== "offscreen") return;
  if (msg.type === "play") play(msg.sound, msg.volume, msg.variant);
});
