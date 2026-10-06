/* Unravel — chorus is not a louder verse. Audio-clock desk. Samples pinned to commit SHAs. */
const PIANO = "https://cdn.jsdelivr.net/gh/workinwithai-create/PreEight@d58301e4a494555f411a2afbc448b724136eee76/public/samples";
const GM = "https://cdn.jsdelivr.net/gh/gleitz/midi-js-soundfonts@044fab8e1456bfafc5776e86dfd6bb8697149aef/FluidR3_GM";
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.12;
const SR = 48000;
const NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const CHAIRS = ["piano", "bass", "nylon", "flute", "kit"];

const SAMPLE_NOTES = {
  piano: ["C3", "E3", "G3", "A3", "C4", "E4", "G4", "A4", "C5", "E5"],
  bass: ["E1", "G1", "A1", "C2", "E2", "G2", "A2", "C3", "E3"],
  nylon: ["C3", "E3", "G3", "A3", "C4", "E4", "G4", "A4", "C5"],
  flute: ["C4", "E4", "G4", "A4", "C5", "E5", "G5", "A5", "C6"]
};

const RECIPES = [
  { id: "open-hold", name: "Open hold", blurb: "Piano holds the bar with a real swell. Hats leave. Flute answers on beat 3. The chorus is weight, not chatter." },
  { id: "straight-floor", name: "Straight floor", blurb: "Verse 16ths become straight 2 and 4. Nylon strums. Bass walks half notes. The grid itself changes." },
  { id: "flute-color", name: "Flute color", blurb: "A flute line that was not in the verse. Piano stays wide and quiet so the new color is the information." },
  { id: "half-grid", name: "Half grid", blurb: "Kick on 1, snare on 3. Sustained piano. The hook gets room the verse never had." },
  { id: "answer-window", name: "Answer window", blurb: "Piano states beats 1–2, then rests. Flute answers in the hole. Call and reply, not a stack." },
  { id: "wide-voice", name: "Wide voice", blurb: "No close cluster. Root, fifth, tenth. Flute takes the third so the chorus voicing is not the verse voicing." }
];

const state = {
  bpm: 92,
  key: "A minor",
  chords: "Am F C G",
  bars: 8,
  side: "B",
  recipe: "open-hold",
  mutes: { piano: false, bass: false, nylon: false, flute: false, kit: false }
};

let ctx = null;
let chairGain = {};
let buffers = {};
let raw = {};
let missing = [];
let timerId = null;
let nextStepTime = 0;
let step = 0;
let anchorTime = 0;
let anchorStep = 0;
let raf = 0;
let active = [];
let started = false;

const $ = (id) => document.getElementById(id);

function midiOf(name) {
  const m = name.match(/^([A-G]b?)(-?\d)$/);
  return NAMES.indexOf(m[1]) + (Number(m[2]) + 1) * 12;
}

function parseChord(token) {
  const t = token.trim();
  const m = t.match(/^([A-G]b?)(.*)$/);
  if (!m) return { root: 0, minor: false, label: "C" };
  const root = NAMES.indexOf(m[1]);
  const minor = /m/.test(m[2]) && !/maj/i.test(m[2]);
  return { root: root < 0 ? 0 : root, minor, label: t };
}

function progression(local) {
  return local.chords.split(/\s+/).filter(Boolean).map(parseChord);
}

function keyRoot(local) {
  const m = local.key.match(/^([A-G]b?)/);
  return NAMES.indexOf(m ? m[1] : "A");
}

function third(ch, base) {
  return base + (ch.minor ? 3 : 4);
}

function nearest(chair, midi) {
  const list = SAMPLE_NOTES[chair];
  let best = list[0];
  let bestD = 99;
  for (const n of list) {
    const d = Math.abs(midiOf(n) - midi);
    if (d < bestD) { bestD = d; best = n; }
  }
  const sampleMidi = midiOf(best);
  let target = midi;
  if (target - sampleMidi > 4) target = sampleMidi + 4;
  if (sampleMidi - target > 4) target = sampleMidi - 4;
  return { key: chair + ":" + best, rate: Math.pow(2, (target - sampleMidi) / 12), midi: target };
}

function eventsFor(local) {
  const events = [];
  const stepDur = 60 / local.bpm / 4;
  const kr = keyRoot(local);
  const chords = progression(local);
  const chord = (bar) => chords[bar % chords.length] || { root: 0, minor: false, label: "C" };
  const add = (chair, midi, stepIndex, durSteps, gain, swell) => {
    if (local.mutes[chair]) return;
    events.push({
      chair, midi, time: stepIndex * stepDur, dur: durSteps * stepDur,
      gain, step: stepIndex, swell: !!swell
    });
  };
  for (let bar = 0; bar < local.bars; bar++) {
    const ch = chord(bar);
    const root = 60 + ((ch.root - kr + 12) % 12);
    const b0 = bar * 16;
    if (local.side !== "B") {
      add("piano", root, b0, 2, 0.16);
      add("piano", third(ch, root), b0 + 2, 2, 0.12);
      add("piano", root + 7, b0 + 4, 2, 0.12);
      add("piano", third(ch, root), b0 + 10, 2, 0.11);
      add("bass", root - 24, b0, 4, 0.3);
      add("bass", third(ch, root) - 24, b0 + 8, 4, 0.24);
      add("nylon", root, b0 + 2, 2, 0.12);
      add("nylon", root + 7, b0 + 6, 2, 0.1);
      add("kit", 36, b0, 1, 0.4);
      add("kit", 38, b0 + 4, 1, 0.3);
      add("kit", 36, b0 + 8, 1, 0.34);
      add("kit", 38, b0 + 12, 1, 0.3);
      for (let s = 0; s < 16; s += 2) add("kit", 42, b0 + s, 1, 0.1);
      continue;
    }
    const rec = local.recipe;
    if (rec === "straight-floor") {
      add("piano", root, b0, 8, 0.16, true);
      add("piano", root + 7, b0, 8, 0.12, true);
      add("bass", root - 24, b0, 8, 0.3);
      add("bass", root - 17, b0 + 8, 8, 0.26);
      add("nylon", root, b0 + 4, 4, 0.16);
      add("nylon", third(ch, root), b0 + 12, 4, 0.14);
      add("kit", 36, b0, 2, 0.36);
      add("kit", 38, b0 + 8, 2, 0.3);
    } else if (rec === "flute-color") {
      add("piano", root - 12, b0, 16, 0.12, true);
      add("piano", root + 7, b0, 16, 0.1, true);
      add("bass", root - 24, b0, 16, 0.28);
      add("flute", third(ch, root) + 12, b0 + 4, 8, 0.2, true);
      add("flute", root + 12, b0 + 12, 4, 0.16);
      add("kit", 36, b0, 2, 0.32);
      add("kit", 38, b0 + 8, 2, 0.26);
    } else if (rec === "half-grid") {
      add("piano", root, b0, 16, 0.16, true);
      add("piano", third(ch, root), b0, 16, 0.12, true);
      add("piano", root + 7, b0, 16, 0.1, true);
      add("bass", root - 24, b0, 16, 0.3);
      add("flute", root + 12, b0 + 8, 8, 0.14, true);
      add("kit", 36, b0, 2, 0.38);
      add("kit", 38, b0 + 8, 2, 0.28);
    } else if (rec === "answer-window") {
      add("piano", root, b0, 6, 0.18);
      add("piano", root + 7, b0, 6, 0.12);
      add("bass", root - 24, b0, 8, 0.3);
      add("flute", third(ch, root) + 12, b0 + 8, 4, 0.2);
      add("flute", root + 12, b0 + 12, 3, 0.16);
      add("nylon", root, b0 + 8, 3, 0.1);
      add("kit", 36, b0, 2, 0.34);
      add("kit", 38, b0 + 8, 1, 0.22);
    } else if (rec === "wide-voice") {
      add("piano", root - 12, b0, 16, 0.14, true);
      add("piano", root + 7, b0, 16, 0.12, true);
      add("piano", root + 16, b0, 16, 0.08, true);
      add("flute", third(ch, root) + 12, b0 + 4, 10, 0.18, true);
      add("bass", root - 24, b0, 16, 0.3);
      add("kit", 36, b0, 2, 0.32);
      add("kit", 38, b0 + 8, 2, 0.24);
    } else {
      add("piano", root, b0, 16, 0.16, true);
      add("piano", root + 7, b0, 16, 0.12, true);
      add("bass", root - 24, b0, 16, 0.3);
      add("flute", third(ch, root) + 12, b0 + 8, 8, 0.2, true);
      add("kit", 36, b0, 2, 0.36);
      add("kit", 38, b0 + 8, 2, 0.28);
    }
  }
  return events;
}

function track(node, audioCtx) {
  if (audioCtx !== ctx) return;
  active.push(node);
  node.onended = () => { active = active.filter((n) => n !== node); };
}

function sideScale(local) {
  return local && local.side === "A" ? 0.62 : 1;
}

function playNote(audioCtx, when, ev, dest, bag) {
  if (ev.chair === "kit") {
    const map = { 36: "kit:kick", 38: "kit:snare", 42: "kit:hat" };
    const buf = bag[map[ev.midi] || "kit:kick"];
    if (!buf) return;
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    const g = audioCtx.createGain();
    const peak = Math.max(0.04, ev.gain) * (ev.scale || 1);
    g.gain.setValueAtTime(peak, when);
    const rel = Math.max(0.05, Math.min(ev.dur, 0.28));
    g.gain.setValueAtTime(peak, when + Math.max(0.01, rel - 0.012));
    g.gain.linearRampToValueAtTime(0.0001, when + rel);
    src.connect(g);
    g.connect(dest);
    src.start(when);
    src.stop(when + rel + 0.02);
    track(src, audioCtx);
    return;
  }
  const pick = nearest(ev.chair, ev.midi);
  const buf = bag[pick.key];
  if (!buf) return;
  const hold = Math.max(0.2, ev.dur);
  const slice = 0.45;
  const n = Math.max(1, Math.ceil(hold / (slice * 0.8)));
  for (let i = 0; i < n; i++) {
    const t = when + i * slice * 0.8;
    if (t >= when + hold - 0.01) break;
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.setValueAtTime(pick.rate, t);
    const g = audioCtx.createGain();
    const peak = ev.gain * (ev.scale || 1);
    const attack = ev.swell ? Math.min(0.35, hold * 0.35) : 0.012;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    const end = Math.min(when + hold, t + slice);
    const releaseAt = Math.max(t + attack + 0.02, end - 0.012);
    g.gain.setValueAtTime(Math.max(0.001, peak * 0.85), releaseAt);
    g.gain.linearRampToValueAtTime(0.0001, end + 0.014);
    src.connect(g);
    g.connect(dest);
    src.start(t);
    src.stop(end + 0.04);
    track(src, audioCtx);
  }
}

function scheduleStep(stepIndex, when) {
  const total = state.bars * 16;
  const s = stepIndex % total;
  const local = {
    bpm: state.bpm, side: state.side, recipe: state.recipe, bars: state.bars,
    mutes: state.mutes, chords: state.chords, key: state.key
  };
  const scale = sideScale(local);
  eventsFor(local).forEach((e) => {
    if (e.step === s) playNote(ctx, when, Object.assign({}, e, { scale }), chairGain[e.chair], buffers);
  });
}

function scheduler() {
  if (!ctx) return;
  while (nextStepTime < ctx.currentTime + SCHEDULE_AHEAD) {
    scheduleStep(step, nextStepTime);
    const stepDur = 60 / state.bpm / 4;
    nextStepTime += stepDur;
    step = (step + 1) % (state.bars * 16);
  }
}

function stopAll() {
  if (timerId) clearInterval(timerId);
  timerId = null;
  active.forEach((n) => { try { n.stop(0); } catch (e) { /* ended */ } });
  active = [];
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  document.querySelectorAll(".bar").forEach((el) => el.classList.remove("now"));
  $("play").textContent = "Play";
}

function paintHead() {
  if (!ctx || !timerId) return;
  const stepDur = 60 / state.bpm / 4;
  const elapsed = ctx.currentTime - anchorTime;
  const pos = anchorStep + elapsed / stepDur;
  const s = ((Math.floor(pos) % (state.bars * 16)) + state.bars * 16) % (state.bars * 16);
  const bar = Math.floor(s / 16);
  document.querySelectorAll(".bar").forEach((el, i) => el.classList.toggle("now", i === bar));
}

function start() {
  if (!ctx || missing.length) return;
  if (ctx.state === "suspended") ctx.resume();
  stopAll();
  nextStepTime = ctx.currentTime + 0.1;
  step = 0;
  anchorTime = nextStepTime;
  anchorStep = 0;
  timerId = setInterval(scheduler, LOOKAHEAD_MS);
  $("play").textContent = "Playing";
  const loop = () => {
    if (!timerId) return;
    paintHead();
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
}

function wireBus(audioCtx, dest, live) {
  const out = audioCtx.createGain();
  out.gain.value = 0.7;
  out.connect(dest);
  let bus = out;
  if (live) {
    const comp = audioCtx.createDynamicsCompressor();
    comp.threshold.value = -8;
    comp.knee.value = 6;
    comp.ratio.value = 12;
    comp.attack.value = 0.003;
    comp.release.value = 0.12;
    comp.connect(out);
    bus = comp;
  }
  const gains = {};
  CHAIRS.forEach((c) => {
    const g = audioCtx.createGain();
    g.gain.value = 0.9;
    g.connect(bus);
    gains[c] = g;
  });
  return gains;
}

function trimHit(audioCtx, buf) {
  const ch = buf.getChannelData(0);
  let i = 0;
  while (i < ch.length - 64 && Math.abs(ch[i]) < 0.02) i++;
  if (i < 8) return buf;
  const out = audioCtx.createBuffer(buf.numberOfChannels, buf.length - i, buf.sampleRate);
  for (let c = 0; c < buf.numberOfChannels; c++) out.getChannelData(c).set(buf.getChannelData(c).subarray(i));
  return out;
}

function sampleUrl(chair, note) {
  if (chair === "piano" || chair === "bass") return PIANO + "/" + chair + "/" + note + ".mp3";
  if (chair === "nylon") return GM + "/acoustic_guitar_nylon-mp3/" + note + ".mp3";
  if (chair === "flute") return GM + "/flute-mp3/" + note + ".mp3";
  return "";
}

async function ensureCtx() {
  if (!ctx) {
    ctx = new AudioContext();
    chairGain = wireBus(ctx, ctx.destination, true);
    await loadSamples();
  }
  if (ctx.state === "suspended") await ctx.resume();
  started = true;
  $("tap").classList.add("hide");
}

async function loadSamples() {
  missing = [];
  const files = [];
  Object.keys(SAMPLE_NOTES).forEach((chair) => {
    SAMPLE_NOTES[chair].forEach((n) => files.push([chair + ":" + n, chair, sampleUrl(chair, n)]));
  });
  [
    ["kit:kick", "kit", PIANO + "/drums/kick.mp3"],
    ["kit:snare", "kit", PIANO + "/drums/snare.mp3"],
    ["kit:hat", "kit", PIANO + "/drums/hihat.mp3"]
  ].forEach((f) => files.push(f));
  let done = 0;
  $("status").textContent = "Loading 0/" + files.length;
  for (const [key, chair, url] of files) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const ab = await r.arrayBuffer();
      raw[key] = ab;
      const decoded = await ctx.decodeAudioData(ab.slice(0));
      buffers[key] = chair === "kit" ? trimHit(ctx, decoded) : decoded;
    } catch (err) {
      missing.push(chair + " (" + key + ")");
    }
    done += 1;
    $("status").textContent = "Loading " + done + "/" + files.length;
  }
  if (missing.length) {
    const names = [...new Set(missing.map((m) => m.split(" ")[0]))];
    $("status").textContent = "Missing instruments: " + names.join(", ");
  } else {
    $("status").textContent = "Ready · " + files.length + " samples";
  }
}

function persist() {
  localStorage.setItem("unravel-v1", JSON.stringify(state));
}

function readForm() {
  state.bpm = Math.min(180, Math.max(60, Number($("bpm").value) || 92));
  state.key = $("key").value;
  state.chords = $("chords").value.trim() || "Am F C G";
  state.bars = Number($("bars").value) || 8;
  persist();
  paintBars();
}

function paintBars() {
  const host = $("barsView");
  host.innerHTML = "";
  host.style.gridTemplateColumns = "repeat(" + state.bars + ", 1fr)";
  const chords = progression(state);
  for (let i = 0; i < state.bars; i++) {
    const el = document.createElement("div");
    el.className = "bar";
    el.textContent = (chords[i % chords.length] || { label: "—" }).label;
    host.appendChild(el);
  }
}

function fileBase() {
  const key = state.key.replace(/\s+/g, "");
  const rec = state.recipe;
  return "unravel-" + rec + "-" + state.bpm + "bpm-" + key;
}

function encodeWav24(left, right) {
  const n = left.length;
  const buf = new ArrayBuffer(44 + n * 6);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF");
  v.setUint32(4, 36 + n * 6, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, SR, true);
  v.setUint32(28, SR * 6, true);
  v.setUint16(32, 6, true);
  v.setUint16(34, 24, true);
  str(36, "data");
  v.setUint32(40, n * 6, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    const l = Math.max(-1, Math.min(1, left[i]));
    const r = Math.max(-1, Math.min(1, right[i]));
    const li = (l < 0 ? l * 8388608 : l * 8388607) | 0;
    const ri = (r < 0 ? r * 8388608 : r * 8388607) | 0;
    v.setUint8(o, li & 255); v.setUint8(o + 1, (li >> 8) & 255); v.setUint8(o + 2, (li >> 16) & 255);
    v.setUint8(o + 3, ri & 255); v.setUint8(o + 4, (ri >> 8) & 255); v.setUint8(o + 5, (ri >> 16) & 255);
    o += 6;
  }
  return new Blob([buf], { type: "audio/wav" });
}

function peakLimit(left, right) {
  let peak = 0;
  for (let i = 0; i < left.length; i++) {
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
  const limit = Math.pow(10, -1 / 20);
  if (peak > limit) {
    const g = limit / peak;
    for (let i = 0; i < left.length; i++) { left[i] *= g; right[i] *= g; }
  }
}

async function renderWav(withTail) {
  if (!ctx || missing.length) {
    $("status").textContent = missing.length ? "Missing instruments: " + [...new Set(missing.map((m) => m.split(" ")[0]))].join(", ") : "Tap to start audio";
    return;
  }
  readForm();
  const bars = state.bars;
  const length = Math.round(bars * 4 * 60 / state.bpm * SR);
  const tail = Math.round(0.45 * SR);
  const offline = new OfflineAudioContext(2, length + tail, SR);
  const gains = wireBus(offline, offline.destination, false);
  const bag = {};
  for (const key of Object.keys(raw)) {
    bag[key] = await offline.decodeAudioData(raw[key].slice(0));
    if (key.startsWith("kit:")) bag[key] = trimHit(offline, bag[key]);
  }
  const local = Object.assign({}, state, { mutes: Object.assign({}, state.mutes) });
  const scale = sideScale(local);
  eventsFor(local).forEach((e) => playNote(offline, e.time, Object.assign({}, e, { scale }), gains[e.chair], bag));
  const rendered = await offline.startRendering();
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  const L = rendered.getChannelData(0);
  const R = rendered.getChannelData(1);
  if (!withTail) {
    for (let i = 0; i < length; i++) { left[i] = L[i]; right[i] = R[i]; }
    for (let i = 0; i < tail && i < length; i++) { left[i] += L[length + i]; right[i] += R[length + i]; }
  } else {
    const fullL = new Float32Array(length + tail);
    const fullR = new Float32Array(length + tail);
    fullL.set(L.subarray(0, length + tail));
    fullR.set(R.subarray(0, length + tail));
    peakLimit(fullL, fullR);
    download(encodeWav24(fullL, fullR), fileBase() + "-with-tail.wav");
    $("status").textContent = "With-tail WAV " + (length + tail) + " samples";
    return;
  }
  peakLimit(left, right);
  download(encodeWav24(left, right), fileBase() + ".wav");
  let first = 0;
  while (first < left.length && Math.abs(left[first]) < 0.02 && Math.abs(right[first]) < 0.02) first++;
  $("status").textContent = "WAV " + length + " samples · first transient sample " + first;
}

function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function vlq(n) {
  let v = n >>> 0;
  const bytes = [v & 0x7f];
  v >>= 7;
  while (v) { bytes.unshift((v & 0x7f) | 0x80); v >>= 7; }
  return bytes;
}

function midiFile() {
  readForm();
  const local = Object.assign({}, state, { mutes: Object.assign({}, state.mutes) });
  const ppq = 480;
  const tempo = Math.round(60000000 / local.bpm);
  const tracks = [];
  const conductor = [];
  const push = (arr, delta, bytes) => { arr.push(...vlq(delta), ...bytes); };
  push(conductor, 0, [0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08]);
  push(conductor, 0, [0xff, 0x51, 0x03, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255]);
  push(conductor, local.bars * ppq * 4, [0xff, 0x2f, 0x00]);
  tracks.push(conductor);
  const byChair = {};
  CHAIRS.forEach((c) => { byChair[c] = []; });
  eventsFor(local).forEach((e) => byChair[e.chair].push(e));
  CHAIRS.forEach((chair) => {
    const evs = byChair[chair].slice().sort((a, b) => a.time - b.time);
    const bytes = [];
    const named = chair;
    push(bytes, 0, [0xff, 0x03, named.length, ...named.split("").map((c) => c.charCodeAt(0))]);
    let last = 0;
    evs.forEach((e) => {
      const tick = Math.round(e.time / (60 / local.bpm) * ppq);
      const dur = Math.max(1, Math.round(e.dur / (60 / local.bpm) * ppq));
      const note = e.chair === "kit" ? e.midi : nearest(e.chair, e.midi).midi;
      const vel = Math.max(1, Math.min(127, Math.round(e.gain * 280)));
      push(bytes, tick - last, [0x90, note & 127, vel]);
      push(bytes, dur, [0x80, note & 127, 0]);
      last = tick + dur;
    });
    push(bytes, 0, [0xff, 0x2f, 0x00]);
    tracks.push(bytes);
  });
  const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, tracks.length, (ppq >> 8) & 255, ppq & 255];
  const body = [];
  tracks.forEach((t) => {
    body.push(0x4d, 0x54, 0x72, 0x6b, (t.length >> 24) & 255, (t.length >> 16) & 255, (t.length >> 8) & 255, t.length & 255, ...t);
  });
  return new Blob([new Uint8Array([...head, ...body])], { type: "audio/midi" });
}

function paintRecipes() {
  const host = $("recipes");
  host.innerHTML = "";
  RECIPES.forEach((r) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "recipe" + (r.id === state.recipe ? " on" : "");
    b.textContent = r.name;
    b.onclick = () => { state.recipe = r.id; persist(); paintRecipes(); };
    host.appendChild(b);
  });
  const meta = RECIPES.find((r) => r.id === state.recipe) || RECIPES[0];
  $("blurb").textContent = meta.blurb;
}

function paintMutes() {
  const host = $("mutes");
  host.innerHTML = "";
  CHAIRS.forEach((c) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = state.mutes[c] ? c + " muted" : c;
    b.className = state.mutes[c] ? "" : "on";
    b.onclick = () => { state.mutes[c] = !state.mutes[c]; persist(); paintMutes(); };
    host.appendChild(b);
  });
}

function boot() {
  try {
    const saved = JSON.parse(localStorage.getItem("unravel-v1") || "null");
    if (saved) Object.assign(state, saved, { mutes: Object.assign(state.mutes, saved.mutes || {}) });
  } catch (e) { /* ignore */ }
  $("bpm").value = state.bpm;
  $("key").value = state.key;
  $("chords").value = state.chords;
  $("bars").value = String(state.bars);
  ["bpm", "key", "chords", "bars"].forEach((id) => $(id).addEventListener("change", readForm));
  $("sideA").onclick = () => { state.side = "A"; persist(); $("sideA").classList.add("on"); $("sideB").classList.remove("on"); };
  $("sideB").onclick = () => { state.side = "B"; persist(); $("sideB").classList.add("on"); $("sideA").classList.remove("on"); };
  if (state.side === "A") { $("sideA").classList.add("on"); $("sideB").classList.remove("on"); }
  $("tapBtn").onclick = () => ensureCtx();
  $("play").onclick = async () => { await ensureCtx(); if (!missing.length) start(); };
  $("stop").onclick = () => stopAll();
  $("wav").onclick = () => renderWav(false);
  $("wavTail").onclick = () => renderWav(true);
  $("mid").onclick = () => download(midiFile(), fileBase() + ".mid");
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") stopAll();
  });
  paintRecipes();
  paintMutes();
  paintBars();
}

boot();
