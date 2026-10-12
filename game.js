/* Dream in Dream — game.js
   index.html (通常版) と debug.html (デバッグ版) で共有。
   debug.html は読み込み前に window.DD_DEBUG = true をセットする。 */
(function(){
'use strict';
const $ = id => document.getElementById(id);
if(!window.THREE){ $('err').style.display = 'flex'; return; }
const T3 = THREE;
const DEBUG = !!window.DD_DEBUG;

/* ============================================================
   1990s look: vertex snapping (頂点を粗い格子に吸着させる)
   テクスチャはパースペクティブ補正のまま(ゆがませない)。
   ============================================================ */
const PV_PLAIN = T3.ShaderChunk.project_vertex;   // 吸着なし(鮮明な場面用)
T3.ShaderChunk.project_vertex += `
gl_Position.xy = floor(gl_Position.xy / gl_Position.w * vec2(256.0, 192.0) + 0.5) / vec2(256.0, 192.0) * gl_Position.w;
`;
const PV_SNAP = T3.ShaderChunk.project_vertex;

/* ============================================================
   run control (lets the debug panel jump anywhere safely)
   ============================================================ */
let RUN = 0;
class Cancel extends Error {}
addEventListener('unhandledrejection', e => { if(e.reason instanceof Cancel) e.preventDefault(); });
let vt = 0, PAUSED = false, vtid = 1;
const vtimers = [], vtweens = [];
function vset(fn, ms){ const id = vtid++; vtimers.push({ id, at: vt + ms, fn }); return id; }
function vevery(fn, ms){ const id = vtid++; vtimers.push({ id, at: vt + ms, fn, iv: ms }); return id; }
function vclear(id){ const i = vtimers.findIndex(t => t.id === id); if(i >= 0) vtimers.splice(i, 1); }
function vstep(dt){
  if(PAUSED) return;
  vt += dt * 1000;
  for(const t of vtimers.slice()){
    const i = vtimers.indexOf(t);
    if(i < 0 || t.at > vt) continue;
    if(t.iv) t.at += t.iv; else vtimers.splice(i, 1);
    t.fn();
  }
  for(const w of vtweens.slice()) w.tick();
}
const sleep = ms => { const tok = RUN; return new Promise((res, rej) => vset(() => tok === RUN ? res() : rej(new Cancel()), ms)); };
let skipper = null, skippable = false;
function wait(ms){
  const tok = RUN;
  return new Promise((res, rej) => {
    let done = false;
    const fin = () => { if(done) return; done = true; vclear(id); if(skipper === fin) skipper = null; tok === RUN ? res() : rej(new Cancel()); };
    const id = vset(fin, ms);
    skipper = fin;
  });
}
function tween(ms, fn){
  const tok = RUN;
  return new Promise((res, rej) => {
    const s = vt;
    const w = { tick(){
      const rm = () => { const i = vtweens.indexOf(w); if(i >= 0) vtweens.splice(i, 1); };
      if(tok !== RUN){ rm(); rej(new Cancel()); return; }
      const k = Math.min(1, (vt - s) / ms);
      const e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      fn(e, k);
      if(k >= 1){ rm(); res(); }
    } };
    vtweens.push(w);
  });
}
function pauseAnims(on){ try{ document.getAnimations().forEach(a => on ? a.pause() : a.play()); }catch(_){} }
function setPause(on){
  if(on === PAUSED) return;
  PAUSED = on;
  $('pause').classList.toggle('on', on);
  pauseAnims(on);
  if(A.ctx) on ? A.ctx.suspend() : A.ctx.resume();
  if(on) endDrag();
}
function canPause(){ return ['play', 'memorize', 'trans', 'cut'].includes(S.mode) && !$('over').classList.contains('on') && !$('end').classList.contains('on'); }
addEventListener('keydown', e => {
  if(e.key !== 'Escape') return;
  if(PAUSED) setPause(false); else if(canPause()) setPause(true);
});
const pauseBtn = $('bPause');   // スマホ版の一時停止ボタン(通常版・デバッグ版には無い)
if(pauseBtn) pauseBtn.onclick = () => { if(PAUSED) setPause(false); else if(canPause()) setPause(true); };
function start(fn){ if(PAUSED) setPause(false); RUN++; cleanup(); return fn().catch(e => { if(!(e instanceof Cancel)) console.error(e); }); }
function trySkip(){ if(skippable && skipper) skipper(); }
addEventListener('pointerdown', e => { audioInit(); if(!e.target.closest('button,#dbg,#dbgBtn')) trySkip(); });
addEventListener('keydown', e => { if((e.key === ' ' || e.key === 'Enter') && !e.target.closest('#dbg')) trySkip(); });

function rng(seed){ return function(){ seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function cv(w, h){ const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function ctexMip(c){ const t = new T3.CanvasTexture(c); t.magFilter = T3.NearestFilter; t.minFilter = T3.NearestMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4; return t; }
function ctex(c){ const t = new T3.CanvasTexture(c); t.magFilter = T3.NearestFilter; t.minFilter = T3.NearestFilter; t.generateMipmaps = false; return t; }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pick = a => a[Math.floor(Math.random() * a.length)];

/* ============================================================
   overlay text / fades
   ============================================================ */
function fade(to, ms, color){
  const f = $('fade');
  f.style.transition = 'none';
  if(color) f.style.background = color;
  void f.offsetWidth;
  f.style.transition = `opacity ${ms}ms linear`;
  f.style.opacity = to;
  return sleep(ms);
}
function setFade(v, color){
  const f = $('fade');
  f.style.transition = 'none';
  if(color) f.style.background = color;
  f.style.opacity = v;
  void f.offsetWidth;
}
async function say(text, ms = 2400, dark = false){
  const el = $('sub');
  el.classList.toggle('dark', dark);
  el.textContent = text;
  el.style.opacity = 1;
  try{ await wait(ms); } finally { el.style.opacity = 0; }
  await sleep(380);
}
function sayNow(text, ms = 2200){
  const el = $('sub');
  el.classList.remove('dark');
  el.textContent = text;
  el.style.opacity = 1;
  vclear(sayNow.t);
  sayNow.t = vset(() => { if(el.textContent === text) el.style.opacity = 0; }, ms);
}
async function center(text, ms = 1600, dark = false){
  const el = $('center');
  el.style.color = dark ? '#111' : '#d8d8d8';
  el.textContent = text;
  el.style.opacity = 1;
  try{ await wait(ms); } finally { el.style.opacity = 0; }
  await sleep(650);
}
const hud = on => $('hud').classList.toggle('on', on);
const tools = on => $('tools').classList.toggle('on', on);
function show(id, on){ $(id).classList.toggle('on', on); }

/* ============================================================
   audio
   ============================================================ */
const A = { ctx: null, out: null, muted: false, vol: 1 };
const snd = {};
function stopSnd(name, fadeSec){ if(snd[name]){ const f = snd[name]; snd[name] = null; f(fadeSec); } }
function stopAllSnd(){ Object.keys(snd).forEach(k => stopSnd(k)); }
function audioInit(){
  if(A.ctx){ if(A.ctx.state === 'suspended') A.ctx.resume(); return; }
  try{
    const C = window.AudioContext || window.webkitAudioContext;
    A.ctx = new C();
    const comp = A.ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = .004; comp.release.value = .25;
    A.out = A.ctx.createGain(); A.out.gain.value = A.muted ? 0 : A.vol;
    const boost = A.ctx.createGain(); boost.gain.value = 1.6;
    A.out.connect(comp).connect(boost).connect(A.ctx.destination);
    const len = A.ctx.sampleRate * 2, b = A.ctx.createBuffer(1, len, A.ctx.sampleRate), d = b.getChannelData(0);
    for(let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    A.noise = b;
    const s = noiseSrc(true), f = A.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 170;
    A.hum = A.ctx.createGain(); A.hum.gain.value = 0;
    s.connect(f).connect(A.hum).connect(A.out); s.start();
    humTo(S.humLevel);
  }catch(e){ A.ctx = null; }
}
function setVolume(v){ A.vol = v; if(A.out) A.out.gain.value = A.muted ? 0 : v; }
function noiseSrc(loop){ const s = A.ctx.createBufferSource(); s.buffer = A.noise; s.loop = loop; return s; }
function humTo(v, sec = .5){ S.humLevel = v; if(!A.ctx) return; const t = A.ctx.currentTime; A.hum.gain.cancelScheduledValues(t); A.hum.gain.setTargetAtTime(v, t, sec / 3); }
function env(g, t, vol, atk, dur){ g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + atk); g.gain.exponentialRampToValueAtTime(.0001, t + dur); }
function tone(freq, dur, vol = .12, type = 'sine', when = 0){
  if(!A.ctx) return;
  const t = A.ctx.currentTime + when, o = A.ctx.createOscillator(), g = A.ctx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + .008);
  g.gain.setValueAtTime(vol, t + dur * .7); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  o.connect(g).connect(A.out); o.start(t); o.stop(t + dur + .02);
}
function ping(freq, dur, vol, type = 'sine', when = 0){
  if(!A.ctx) return;
  const t = A.ctx.currentTime + when, o = A.ctx.createOscillator(), g = A.ctx.createGain();
  o.type = type; o.frequency.value = freq; env(g, t, vol, .004, dur);
  o.connect(g).connect(A.out); o.start(t); o.stop(t + dur + .02);
}
function noiseHit(vol, dur, ftype, freq, Q = 1, when = 0){
  if(!A.ctx) return;
  const t = A.ctx.currentTime + when, s = noiseSrc(false), f = A.ctx.createBiquadFilter(), g = A.ctx.createGain();
  f.type = ftype; f.frequency.value = freq; f.Q.value = Q; env(g, t, vol, .005, dur);
  s.connect(f).connect(g).connect(A.out); s.start(t, Math.random()); s.stop(t + dur + .05);
}
function tick(){ const v = .16 * (1 - clamp((S.chaseK || 0) * 1.25, 0, 1)); if(v > .004) noiseHit(v, .035, 'bandpass', 3200, 2); }   // 心拍が大きくなるほど、時計の音は聞こえなくなる
function thud(vol = 1, when = 0){
  if(!A.ctx) return;
  const t = A.ctx.currentTime + when, o = A.ctx.createOscillator(), g = A.ctx.createGain();
  o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(30, t + .5);
  env(g, t, vol, .004, .7); o.connect(g).connect(A.out); o.start(t); o.stop(t + .75);
  noiseHit(vol * .7, .25, 'lowpass', 600, 1, when);
}
function step(vol = .35, when = 0){ if(!A.ctx) return; ping(80 + Math.random() * 20, .12, vol, 'sine', when); noiseHit(vol * .5, .07, 'lowpass', 900, 1, when); }
function breath(vol = .16){ noiseHit(vol, .55, 'bandpass', 900, .7); }
function creak(){
  if(!A.ctx) return;
  const t = A.ctx.currentTime, s = noiseSrc(false), f = A.ctx.createBiquadFilter(), g = A.ctx.createGain();
  f.type = 'bandpass'; f.Q.value = 6; f.frequency.setValueAtTime(260, t); f.frequency.linearRampToValueAtTime(520, t + 1.2);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.3, t + .3); g.gain.linearRampToValueAtTime(0, t + 1.3);
  s.connect(f).connect(g).connect(A.out); s.start(t); s.stop(t + 1.4);
}
function doorSlam(){ thud(.7); noiseHit(.4, .15, 'bandpass', 1500, 2); }
function whoosh(){
  if(!A.ctx) return;
  const t = A.ctx.currentTime, s = noiseSrc(false), f = A.ctx.createBiquadFilter(), g = A.ctx.createGain();
  f.type = 'bandpass'; f.Q.value = 1.2; f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(1800, t + .5);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.45, t + .35); g.gain.linearRampToValueAtTime(0, t + .55);
  s.connect(f).connect(g).connect(A.out); s.start(t); s.stop(t + .6);
}
/* continuous / looping sounds — each returns a stopper(fadeSec) */
function loopNoise(name, { type = 'lowpass', freq = 400, Q = 1, vol = .2, fadeIn = .5, lfo = 0, lfoDepth = 0 }){
  if(!A.ctx) return;
  stopSnd(name);
  const s = noiseSrc(true), f = A.ctx.createBiquadFilter(), g = A.ctx.createGain(), t = A.ctx.currentTime;
  f.type = type; f.frequency.value = freq; f.Q.value = Q;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + fadeIn);
  let l = null;
  if(lfo){ l = A.ctx.createOscillator(); const lg = A.ctx.createGain(); l.frequency.value = lfo; lg.gain.value = lfoDepth; l.connect(lg).connect(f.frequency); l.start(); }
  s.connect(f).connect(g).connect(A.out); s.start();
  snd[name] = (fs = 0) => { const n = A.ctx.currentTime; g.gain.cancelScheduledValues(n); g.gain.setValueAtTime(g.gain.value, n); g.gain.linearRampToValueAtTime(0, n + fs + .02); s.stop(n + fs + .05); if(l) l.stop(n + fs + .05); };
  return { g, f };
}
function every(name, ms, fn){ stopSnd(name); fn(); const id = vevery(fn, ms); snd[name] = () => vclear(id); }
function windStart(){ loopNoise('wind', { type: 'bandpass', freq: 500, Q: .6, vol: .5, fadeIn: 1.2, lfo: .25, lfoDepth: 220 }); }
/* 真エンディング(退院後の街並み)の環境音: 穏やかな風と、鳥のさえずり */
function chirp(base, when = 0){
  if(!A.ctx) return;
  const t = A.ctx.currentTime + when, o = A.ctx.createOscillator(), g = A.ctx.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(base, t);
  o.frequency.exponentialRampToValueAtTime(base * (1.3 + Math.random() * .5), t + .06); o.frequency.exponentialRampToValueAtTime(base * .9, t + .13);
  env(g, t, .05, .01, .14);
  o.connect(g).connect(A.out); o.start(t); o.stop(t + .17);
}
function birdsStart(){
  stopSnd('birds'); let id = 0;
  const f = () => {
    if(A.ctx){ const n = 2 + (Math.random() * 4 | 0), b = 2600 + Math.random() * 1800; for(let i = 0; i < n; i++) chirp(b * (1 + (Math.random() - .5) * .15), i * (.11 + Math.random() * .05)); }
    id = vset(f, 900 + Math.random() * 2800);
  };
  f(); snd.birds = () => vclear(id);
}
function townSoundsStart(){ loopNoise('windTown', { type: 'lowpass', freq: 380, Q: .4, vol: .04, fadeIn: 4, lfo: .07, lfoDepth: 80 }); birdsStart(); }
function alarmStart(vol = .3){ every('alarm', 1000, () => { for(let i = 0; i < 4; i++) tone(1760, .07, vol, 'square', i * .13); }); }
function breathingStart(){
  stopSnd('breath'); let iv = 1500, id = 0;
  const f = () => { breath(); iv = Math.max(520, iv * .93); id = vset(f, iv); }; f();
  snd.breath = () => vclear(id);
}
function bellStart(){ every('bell', 440, () => { ping(745, .42, .32, 'triangle'); ping(1118, .3, .12, 'sine'); }); }
function hazardStart(){
  let n = 0; every('hazard', 650, () => { noiseHit(.35, .03, 'bandpass', n++ % 2 ? 1500 : 1100, 3); });
  const o = A.ctx && A.ctx.createOscillator();
  if(!o) return;
  const f = A.ctx.createBiquadFilter(), g = A.ctx.createGain();
  o.type = 'sawtooth'; o.frequency.value = 34; f.type = 'lowpass'; f.frequency.value = 160; g.gain.value = .22;
  o.connect(f).connect(g).connect(A.out); o.start();
  snd.idle = () => o.stop();
}
function sirenStart(){
  if(!A.ctx) return;
  stopSnd('siren');
  const t = A.ctx.currentTime, o = A.ctx.createOscillator(), o2 = A.ctx.createOscillator(), f = A.ctx.createBiquadFilter(), g = A.ctx.createGain();
  o.type = 'square'; o2.type = 'sine';
  for(let i = 0; i < 60; i++){ const fr = i % 2 ? 770 : 960; o.frequency.setValueAtTime(fr, t + i * .65); o2.frequency.setValueAtTime(fr, t + i * .65); }
  f.type = 'lowpass'; f.frequency.setValueAtTime(350, t); f.frequency.linearRampToValueAtTime(2600, t + 14);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.05, t + 3); g.gain.linearRampToValueAtTime(.32, t + 14);
  const m = A.ctx.createGain(); m.gain.value = .35;
  o.connect(m).connect(f); o2.connect(f); f.connect(g).connect(A.out); o.start(t); o2.start(t);
  snd.siren = (fs = 0) => { const n = A.ctx.currentTime; g.gain.cancelScheduledValues(n); g.gain.setValueAtTime(g.gain.value, n); g.gain.linearRampToValueAtTime(0, n + fs + .02); o.stop(n + fs + .05); o2.stop(n + fs + .05); };
}
function heartbeatStart(){
  every('heart', 950, () => { ping(52, .22, .95, 'sine'); ping(104, .12, .32, 'triangle'); noiseHit(.12, .1, 'lowpass', 170, 1); ping(46, .2, .7, 'sine', .27); ping(92, .1, .22, 'triangle', .27); });
}
function slapSound(){ noiseHit(.9, .07, 'bandpass', 2600, 2); noiseHit(.5, .12, 'lowpass', 600, 1); ping(180, .1, .5, 'sine'); }
function crash(){ noiseHit(.8, .2, 'bandpass', 1800, 1.5); ping(1400, .25, .3, 'square'); ping(2100, .18, .2, 'square', .03); thud(.5); noiseHit(.4, .3, 'highpass', 3000, 1, .05); }
function crunch(){
  thud(1.3);
  noiseHit(.9, .22, 'lowpass', 700, 1);
  noiseHit(.5, .5, 'lowpass', 260, 1, .05);
  [.08, .16, .27, .41].forEach((w, i) => { noiseHit(.45 - i * .08, .09, 'bandpass', 500 + i * 140, 3, w); ping(70 - i * 8, .14, .3, 'sine', w); });
}
function trainHorn(when = 0, dur = 1.6){
  if(!A.ctx) return;
  const t = A.ctx.currentTime + when, f = A.ctx.createBiquadFilter(), g = A.ctx.createGain();
  f.type = 'lowpass'; f.frequency.value = 1400; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.32, t + .08); g.gain.setValueAtTime(.32, t + dur - .2); g.gain.linearRampToValueAtTime(0, t + dur);
  f.connect(g).connect(A.out);
  for(const fr of [311, 370, 466]){ const o = A.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; o.connect(f); o.start(t); o.stop(t + dur + .05); }
}
function carHorn(when = 0, dur = 1.1){
  if(!A.ctx) return;
  const t = A.ctx.currentTime + when, f = A.ctx.createBiquadFilter(), g = A.ctx.createGain();
  f.type = 'lowpass'; f.frequency.value = 2200; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.3, t + .03); g.gain.setValueAtTime(.3, t + dur - .05); g.gain.linearRampToValueAtTime(0, t + dur);
  f.connect(g).connect(A.out);
  for(const fr of [415, 523]){ const o = A.ctx.createOscillator(); o.type = 'square'; o.frequency.value = fr; o.connect(f); o.start(t); o.stop(t + dur + .05); }
}
function brakes(when = 0, dur = 1.3){
  if(!A.ctx) return;
  const t = A.ctx.currentTime + when, o = A.ctx.createOscillator(), g = A.ctx.createGain(), v = A.ctx.createOscillator(), vg = A.ctx.createGain();
  o.type = 'sawtooth'; o.frequency.value = 2900; v.frequency.value = 23; vg.gain.value = 140; v.connect(vg).connect(o.frequency);
  const f = A.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 3000; f.Q.value = 4;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.22, t + .1); g.gain.setValueAtTime(.22, t + dur - .1); g.gain.linearRampToValueAtTime(0, t + dur);
  o.connect(f).connect(g).connect(A.out); o.start(t); v.start(t); o.stop(t + dur + .05); v.stop(t + dur + .05);
  noiseHit(.3, dur, 'bandpass', 3400, 8, when);
}
function engineRise(sec){
  if(!A.ctx) return;
  stopSnd('engine');
  const t = A.ctx.currentTime, o = A.ctx.createOscillator(), f = A.ctx.createBiquadFilter(), g = A.ctx.createGain();
  o.type = 'sawtooth'; o.frequency.setValueAtTime(45, t); o.frequency.linearRampToValueAtTime(95, t + sec);
  f.type = 'lowpass'; f.frequency.setValueAtTime(200, t); f.frequency.linearRampToValueAtTime(900, t + sec);
  g.gain.setValueAtTime(.02, t); g.gain.exponentialRampToValueAtTime(.45, t + sec);
  o.connect(f).connect(g).connect(A.out); o.start(t);
  const n = loopNoise('engineN', { type: 'lowpass', freq: 500, vol: .3, fadeIn: sec });
  snd.engine = () => { o.stop(); stopSnd('engineN'); };
}

/* ============================================================
   renderer + post (90s console look)
   ============================================================ */
const glc = $('gl');
const renderer = new T3.WebGLRenderer({ canvas: glc, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
const camera = new T3.PerspectiveCamera(70, innerWidth / innerHeight, .1, 150);
camera.rotation.order = 'YXZ';
const rt = new T3.WebGLRenderTarget(4, 4, { minFilter: T3.NearestFilter, magFilter: T3.NearestFilter });
rt.depthTexture = new T3.DepthTexture(4, 4, T3.UnsignedIntType);
const post = new T3.ShaderMaterial({
  uniforms: {
    tDiffuse: { value: rt.texture }, uTime: { value: 0 }, uRes: { value: new T3.Vector2(1, 1) }, uLow: { value: new T3.Vector2(1, 1) },
    uNarrow: { value: 0 }, uBlur: { value: 0 }, uBright: { value: 1 }, uFilter: { value: 1 }, uRed: { value: 0 }, uVig: { value: 1 }, uGrit: { value: 0 }
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes; uniform vec2 uLow;
    uniform float uNarrow; uniform float uBlur; uniform float uBright; uniform float uFilter; uniform float uRed; uniform float uVig; uniform float uGrit;
    varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    float bayer2(vec2 a){ a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
    float bayer4(vec2 a){ return bayer2(0.5 * a) * 0.25 + bayer2(a); }
    vec3 tap(vec2 uv){
      vec3 c = texture2D(tDiffuse, uv).rgb;
      if(uBlur > 0.0){
        vec2 o = uBlur * 1.6 / uLow;
        c = c * 0.2 + 0.2 * (texture2D(tDiffuse, uv + vec2(o.x, 0.0)).rgb + texture2D(tDiffuse, uv - vec2(o.x, 0.0)).rgb
                          + texture2D(tDiffuse, uv + vec2(0.0, o.y)).rgb + texture2D(tDiffuse, uv - vec2(0.0, o.y)).rgb);
      }
      return c;
    }
    void main(){
      vec2 lp = floor(vUv * uLow);
      vec2 luv = (lp + 0.5) / uLow;
      if(uGrit > 0.0){ float jr = h(vec2(lp.y, floor(uTime * 5.0))); luv.x += (jr - 0.5) * 0.006 * uGrit + step(0.985, jr) * 0.03 * uGrit * (h(vec2(lp.y, 3.0)) - 0.5); }
      vec3 c = tap(luv);
      if(uFilter > 0.99){
        // composite-video colour bleed
        vec3 cl = tap(luv - vec2(1.0 / uLow.x, 0.0));
        c = mix(c, cl, 0.28 + 0.22 * uGrit);
        c = mix(vec3(dot(c, vec3(0.299, 0.587, 0.114))), c, 0.9);
        // light noise
        c += (h(lp + floor(uTime * 8.0) * 17.3) - 0.5) * (0.028 + 0.075 * uGrit);
        // 15-bit colour with ordered dithering
        c = floor(c * 31.0 + bayer4(lp)) / 31.0;
        // CRT scanlines + vignette
        float sl = fract(vUv.y * uLow.y);
        c *= (0.8 - 0.1 * uGrit) + (0.2 + 0.1 * uGrit) * sin(sl * 3.14159);
        float d = distance(vUv, vec2(0.5));
        c *= mix(1.0, mix(0.55, 1.0, smoothstep(0.85, 0.32, d)), uVig);
      }
      else if(uFilter > 0.0){
        // 鮮明な場面用の、弱いフィルター(少しだけ、ざらつき・走査線・にじみ・周辺減光)
        vec3 cl = tap(luv - vec2(1.0 / uLow.x, 0.0));
        c = mix(c, cl, 0.22 * uFilter);
        c = mix(vec3(dot(c, vec3(0.299, 0.587, 0.114))), c, 0.94);
        c += (h(lp + floor(uTime * 8.0) * 17.3) - 0.5) * 0.05 * uFilter;
        c = mix(c, floor(c * 31.0 + bayer4(lp)) / 31.0, 0.7 * uFilter);   // 元のフィルターと同じ、粗い色の階調(弱め)
        float sl = fract(vUv.y * uRes.y / 2.5);
        c *= 1.0 - 0.14 * uFilter * (1.0 - sin(sl * 3.14159));
        float d = distance(vUv, vec2(0.5));
        c *= mix(1.0, mix(1.0 - 0.3 * uFilter, 1.0, smoothstep(0.9, 0.3, d)), uVig);
      }
      if(uRed > 0.0){
        float dr = distance(vUv, vec2(0.5));
        c = mix(c, vec3(c.r * 1.55 + 0.05, c.g * 0.42, c.b * 0.38), clamp(uRed * 0.9, 0.0, 1.0));
        c.r += uRed * smoothstep(0.22, 0.78, dr) * 0.6;
        c *= 1.0 - uRed * 0.18 * smoothstep(0.3, 0.8, dr);
      }
      if(uNarrow > 0.0){
        vec2 q = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
        float dd = length(q * vec2(0.75, 1.45));
        float r = mix(1.4, 0.0, uNarrow);
        c *= mix(1.0, smoothstep(r, r * 0.35, dd), clamp(uNarrow * 6.0, 0.0, 1.0));
      }
      c *= uBright * (1.0 + 0.3 * uGrit);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
  depthTest: false, depthWrite: false
});
const postScene = new T3.Scene(), postCam = new T3.OrthographicCamera(-1, 1, 1, -1, 0, 1);
postScene.add(new T3.Mesh(new T3.PlaneGeometry(2, 2), post));
const VIEW = { lowH: 240, crisp: false, grit: false, prevFilter: 1 };
function resize(){
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  const lh = VIEW.crisp ? Math.min(h, 320) : VIEW.lowH > 0 ? (VIEW.grit ? 168 : VIEW.lowH) : Math.round(h / 2), lw = Math.max(1, Math.round(lh * w / h));
  rt.setSize(lw, lh); rt.depthTexture.image.width = lw; rt.depthTexture.image.height = lh;
  post.uniforms.uRes.value.set(w, h); post.uniforms.uLow.value.set(lw, lh);
}
addEventListener('resize', resize); resize();

/* ============================================================
   textures
   ============================================================ */
function texFloor(){
  const c = cv(256, 256), g = c.getContext('2d'), r = rng(3), n = 6, w = 256 / n;
  for(let i = 0; i < n; i++){
    const b = 112 + r() * 26;
    g.fillStyle = `rgb(${b | 0},${b * .74 | 0},${b * .52 | 0})`; g.fillRect(i * w, 0, w + 1, 256);
    for(let k = 0; k < 18; k++){
      g.strokeStyle = `rgba(45,28,12,${.05 + r() * .07})`; g.lineWidth = 1;
      const x = i * w + r() * w; g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + r() * 6 - 3, 85, x + r() * 6 - 3, 170, x + r() * 4 - 2, 256); g.stroke();
    }
    g.fillStyle = 'rgba(25,14,6,.7)'; g.fillRect(i * w, 0, 2, 256); g.fillRect(i * w, r() * 256, w, 2);
  }
  const t = ctexMip(c); t.wrapS = t.wrapT = T3.RepeatWrapping; t.repeat.set(1.6, 2.2); return t;
}
function texWall(base = '#d4cec2'){
  const c = cv(64, 64), g = c.getContext('2d'), r = rng(5);
  g.fillStyle = base; g.fillRect(0, 0, 64, 64);
  for(let i = 0; i < 300; i++){ g.fillStyle = r() < .5 ? 'rgba(0,0,0,.035)' : 'rgba(255,255,255,.04)'; g.fillRect(r() * 64 | 0, r() * 64 | 0, 1, 1); }
  const t = ctexMip(c); t.wrapS = t.wrapT = T3.RepeatWrapping; t.repeat.set(6, 4); return t;
}
function texRug(){
  const c = cv(128, 160), g = c.getContext('2d'), r = rng(9);
  g.fillStyle = '#6c6254'; g.fillRect(0, 0, 128, 160);
  for(let i = 0; i < 900; i++){ g.fillStyle = `rgba(${r() < .5 ? '0,0,0' : '255,255,255'},.06)`; g.fillRect(r() * 128 | 0, r() * 160 | 0, 1, 1); }
  g.strokeStyle = '#8b7f69'; g.lineWidth = 4; g.strokeRect(8, 8, 112, 144);
  g.lineWidth = 1; g.strokeRect(14, 14, 100, 132);
  for(let i = 0; i < 4; i++){ g.strokeRect(40 + i * 4, 56 + i * 4, 48 - i * 8, 48 - i * 8); }
  return ctexMip(c);
}
function texStripe(a, b, n = 8, vertical = false){
  const c = cv(64, 64), g = c.getContext('2d');
  for(let i = 0; i < n; i++){ g.fillStyle = i % 2 ? a : b; if(vertical) g.fillRect(i * 64 / n, 0, 64 / n, 64); else g.fillRect(0, i * 64 / n, 64, 64 / n); }
  const t = ctex(c); t.wrapS = t.wrapT = T3.RepeatWrapping; return t;
}
function texDiag(a, b){
  const c = cv(64, 16), g = c.getContext('2d');
  g.fillStyle = a; g.fillRect(0, 0, 64, 16); g.fillStyle = b;
  for(let i = -2; i < 6; i++){ g.beginPath(); g.moveTo(i * 16, 16); g.lineTo(i * 16 + 8, 16); g.lineTo(i * 16 + 16, 0); g.lineTo(i * 16 + 8, 0); g.fill(); }
  const t = ctex(c); t.wrapS = T3.RepeatWrapping; return t;
}
function drawCity(c, mode){
  const g = c.getContext('2d'), W = c.width, H = c.height, r = rng(77);
  const day = mode === 'day', dark = mode === 'dark', cloud = mode === 'cloud', dB = mode === 'dawnB', dR = mode === 'dawnR';
  const dawn = dB || dR, bright = day || dawn;
  const sky = g.createLinearGradient(0, 0, 0, H * .7);
  if(day){ sky.addColorStop(0, '#93b3cf'); sky.addColorStop(1, '#dde6ea'); }
  else if(dB){ sky.addColorStop(0, '#2c3f68'); sky.addColorStop(1, '#a8bad2'); }
  else if(dR){ sky.addColorStop(0, '#4a3558'); sky.addColorStop(.6, '#c0645a'); sky.addColorStop(1, '#f4a868'); }
  else if(cloud){ sky.addColorStop(0, '#05060a'); sky.addColorStop(1, '#10131b'); }
  else { sky.addColorStop(0, '#070a14'); sky.addColorStop(1, dark ? '#0c0f18' : '#1e2438'); }
  g.fillStyle = sky; g.fillRect(0, 0, W, H);
  if(mode === 'night' || dark){
    for(let i = 0; i < 60; i++){ g.fillStyle = 'rgba(220,220,240,' + (.2 + r() * .5) + ')'; g.fillRect(r() * W | 0, r() * H * .45 | 0, 1, 1); }
    if(mode === 'night'){ g.fillStyle = '#e9e5cf'; g.beginPath(); g.arc(W * .47, H * .33, 7, 0, Math.PI * 2); g.fill(); }
  } else if(cloud){
    g.fillStyle = 'rgba(28,32,42,.7)';
    for(let i = 0; i < 9; i++){ const x = r() * W, y = r() * H * .4; g.beginPath(); g.ellipse(x, y, 50 + r() * 60, 8 + r() * 6, 0, 0, Math.PI * 2); g.fill(); }
  } else {
    g.fillStyle = dR ? 'rgba(255,200,170,.35)' : 'rgba(255,255,255,.4)';
    for(let i = 0; i < 6; i++){ const x = r() * W, y = r() * H * .3; g.beginPath(); g.ellipse(x, y, 30 + r() * 30, 5 + r() * 3, 0, 0, Math.PI * 2); g.fill(); }
  }
  let x = 0;
  while(x < W){
    const w = 15 + r() * 35, top = H * .3 + r() * H * .14;
    g.fillStyle = day ? '#a7acb0' : dB ? '#59627a' : dR ? '#7a5a64' : '#0b0e18'; g.fillRect(x, top, w, H - top);
    if(!bright && !dark) for(let yy = top + 3; yy < H * .7; yy += 5) for(let xx = x + 2; xx < x + w - 2; xx += 4) if(r() < (cloud ? .08 : .12)){ g.fillStyle = 'rgba(255,' + (200 + r() * 40 | 0) + ',140,' + (.3 + r() * .4) + ')'; g.fillRect(xx | 0, yy | 0, 2, 2); }
    x += w + r() * 3;
  }
  x = -10;
  while(x < W){
    const w = 30 + r() * 60, top = H * .38 + r() * H * .16;
    const shade = day ? 130 + r() * 50 : 4 + r() * 8, q = r() * 12;
    g.fillStyle = day ? 'rgb(' + (shade | 0) + ',' + (shade | 0) + ',' + (shade * .98 | 0) + ')'
      : dB ? 'rgb(' + (36 + q | 0) + ',' + (42 + q | 0) + ',' + (60 + q | 0) + ')'
      : dR ? 'rgb(' + (60 + q | 0) + ',' + (38 + q | 0) + ',' + (46 + q | 0) + ')'
      : 'rgb(' + (shade | 0) + ',' + (shade | 0) + ',' + (shade + 4 | 0) + ')';
    g.fillRect(x | 0, top | 0, w | 0, H - top);
    for(let yy = top + 5; yy < H * .76; yy += 8) for(let xx = x + 4; xx < x + w - 5; xx += 8){
      const rv = r(), rv2 = r();
      if(day){ g.fillStyle = 'rgba(70,90,110,' + (.25 + rv * .3) + ')'; g.fillRect(xx | 0, yy | 0, 4, 4); }
      else if(dawn){ if(rv < .07){ g.fillStyle = 'rgba(255,220,160,.7)'; g.fillRect(xx | 0, yy | 0, 4, 4); } }
      else if(rv < (cloud ? .15 : .22) && !dark){ g.fillStyle = rv2 < .8 ? 'rgba(255,' + (205 + rv2 * 40 | 0) + ',150,' + (.55 + rv * .4) + ')' : 'rgba(170,200,255,.6)'; g.fillRect(xx | 0, yy | 0, 4, 4); }
    }
    if(mode === 'night' && r() < .3){ g.fillStyle = '#c33'; g.fillRect(x + w / 2 | 0, top - 2 | 0, 2, 2); }
    x += w + r() * 5;
  }
  g.fillStyle = day ? '#6d6e6a' : dB ? '#3f4658' : dR ? '#5a4048' : '#06070a'; g.fillRect(0, H * .78, W, H * .22);
  for(let i = 0; i < 12; i++){
    const lx = (i + .5) * W / 12, ly = H * .76;
    if(mode === 'night' || cloud){ g.fillStyle = 'rgba(255,190,110,.5)'; g.fillRect(lx - 6, ly - 6, 12, 8); }
    g.fillStyle = bright ? '#555' : '#222'; g.fillRect(lx - 1, ly, 1, 15);
  }
}
function invertCanvas(src){
  const c = cv(src.width, src.height), g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height), a = d.data;
  for(let i = 0; i < a.length; i += 4){ a[i] = 255 - a[i]; a[i + 1] = 255 - a[i + 1]; a[i + 2] = 255 - a[i + 2]; }
  g.putImageData(d, 0, 0); return c;
}
const cityC = {};
['night', 'day', 'dark', 'cloud', 'dawnB', 'dawnR'].forEach(m => { cityC[m] = cv(640, 256); drawCity(cityC[m], m); });
function texPainting(person){
  const c = cv(128, 96), g = c.getContext('2d');
  const sk = g.createLinearGradient(0, 0, 0, 55); sk.addColorStop(0, '#6f8fb0'); sk.addColorStop(1, '#e9d9b8');
  g.fillStyle = sk; g.fillRect(0, 0, 128, 96);
  g.fillStyle = '#f2e3b0'; g.beginPath(); g.arc(95, 26, 7, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#56657a'; g.beginPath(); g.moveTo(0, 56); g.lineTo(35, 20); g.lineTo(60, 45); g.lineTo(80, 30); g.lineTo(128, 56); g.fill();
  g.fillStyle = '#eef'; g.beginPath(); g.moveTo(29, 26); g.lineTo(35, 20); g.lineTo(41, 26); g.lineTo(35, 28); g.fill();
  g.fillStyle = '#4a6a78'; g.fillRect(0, 56, 128, 20);
  g.fillStyle = 'rgba(255,255,255,.25)'; for(let i = 0; i < 8; i++) g.fillRect(10 + i * 14, 60 + (i % 3) * 4, 6, 1);
  g.fillStyle = '#4f6b3f'; g.fillRect(0, 75, 128, 21);
  g.fillStyle = '#e8e2d2'; g.fillRect(75, 68, 13, 9); g.fillStyle = '#8a3a2a'; g.beginPath(); g.moveTo(73, 69); g.lineTo(81, 62); g.lineTo(90, 69); g.fill();
  if(person){ g.fillStyle = '#1e1e22'; g.fillRect(48, 70, 3, 10); g.fillRect(47, 73, 5, 4); g.beginPath(); g.arc(49.5, 68.5, 2, 0, Math.PI * 2); g.fill(); }
  return ctex(c);
}
const TX = {
  floor: texFloor(), wall: texWall(), rug: texRug(),
  cityNight: ctex(cityC.night), cityDay: ctex(cityC.day), cityDark: ctex(cityC.dark), cityCloud: ctex(cityC.cloud), cityDawnB: ctex(cityC.dawnB), cityDawnR: ctex(cityC.dawnR), cityInv: ctex(invertCanvas(cityC.night)),
  paint: texPainting(false), paintPerson: texPainting(true)
};

/* --- 時間帯 --- */
function timeMode(h){ return h <= 2 ? 'night' : h <= 4 ? 'cloud' : h === 5 ? 'dawnB' : 'dawnR'; }
const BACKDROP = { night: TX.cityNight, cloud: TX.cityCloud, dawnB: TX.cityDawnB, dawnR: TX.cityDawnR, day: TX.cityDay };

/* --- 枕元のデジタル時計 --- */
const DCK = { c: cv(128, 48), last: null }; DCK.g = DCK.c.getContext('2d'); DCK.tex = ctex(DCK.c);
function drawDigital(sec, bug){
  const x = ((Math.floor(sec) % 86400) + 86400) % 86400, hh = Math.floor(x / 3600) % 24, mm = Math.floor(x / 60) % 60;
  const txt = String(hh).padStart(2, '0') + ':' + (bug ? '61' : String(mm).padStart(2, '0'));
  if(txt === DCK.last) return; DCK.last = txt;
  const g = DCK.g;
  g.fillStyle = '#140505'; g.fillRect(0, 0, 128, 48);
  g.shadowColor = '#ff2a10'; g.shadowBlur = 6; g.fillStyle = '#ff4a30';
  g.font = 'bold 38px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, 64, 26);
  g.shadowBlur = 0; DCK.tex.needsUpdate = true;
}

/* --- ポスター / 本の表紙 / メモ書き(異変で文字化けする) --- */
const PST = { c: cv(84, 120), garble: false }; PST.g = PST.c.getContext('2d'); PST.tex = ctex(PST.c);
function drawPoster(garble){
  PST.garble = garble; const g = PST.g;
  const gr = g.createLinearGradient(0, 0, 0, 120); gr.addColorStop(0, '#78b4d8'); gr.addColorStop(.62, '#d8ecf4'); gr.addColorStop(.63, '#2f6f9a'); gr.addColorStop(1, '#174a72');
  g.fillStyle = gr; g.fillRect(0, 0, 84, 120);
  g.fillStyle = '#f6e6a8'; g.beginPath(); g.arc(60, 30, 9, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(255,255,255,.35)'; for(let i = 0; i < 6; i++) g.fillRect(8 + i * 12, 82 + (i % 3) * 8, 8, 1);
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 15px sans-serif'; g.fillText(garble ? 'みみみみみ' : '海へ行こう', 42, 14);
  g.font = 'bold 8px sans-serif'; g.fillText(garble ? 'みみみみみみみみ' : 'SUMMER 2026', 42, 108);
  PST.tex.needsUpdate = true;
}
const BKT = { c: cv(56, 80), garble: false }; BKT.g = BKT.c.getContext('2d'); BKT.tex = ctex(BKT.c);
function drawBook(garble){
  BKT.garble = garble; const g = BKT.g;
  g.fillStyle = '#3d5a7a'; g.fillRect(0, 0, 56, 80); g.strokeStyle = '#d8d0b0'; g.lineWidth = 1; g.strokeRect(4, 4, 48, 72);
  g.fillStyle = '#efe8cc'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = 'bold 11px sans-serif';
  const t = garble ? ['みみ', 'みみ', 'みみ'] : ['夜の', '読書', '案内'];
  t.forEach((w, i) => g.fillText(w, 28, 20 + i * 15));
  BKT.tex.needsUpdate = true;
}
const MEM = { c: cv(64, 80), bad: false }; MEM.g = MEM.c.getContext('2d'); MEM.tex = ctex(MEM.c);
function drawMemo(bad, n = 8){
  MEM.bad = bad; const g = MEM.g, r = rng(5);
  g.fillStyle = '#f2eed8'; g.fillRect(0, 0, 64, 80);
  g.strokeStyle = 'rgba(120,150,190,.5)'; for(let i = 0; i < 8; i++){ g.beginPath(); g.moveTo(2, 14 + i * 9); g.lineTo(62, 14 + i * 9); g.stroke(); }
  g.textAlign = 'left'; g.textBaseline = 'middle';
  if(!bad){
    g.fillStyle = '#2a2a2a'; g.font = 'bold 8px sans-serif'; g.fillText('かいもの', 5, 8);
    g.font = '8px sans-serif'; ['・牛乳', '・たまご', '・食パン', '・洗剤'].forEach((w, i) => g.fillText(w, 7, 22 + i * 9));
  } else {
    g.fillStyle = '#3a1f1f'; g.font = 'bold 8px sans-serif';
    for(let i = 0; i < n; i++) g.fillText('のんだ のんだ のんだ'.slice(0, 7 + (r() * 4 | 0)), 4 + r() * 4, 8 + i * 9 + r() * 2);
  }
  MEM.tex.needsUpdate = true;
}
drawPoster(false); drawBook(false); drawMemo(false);
function softShadowTex(){
  const c = cv(32, 40), g = c.getContext('2d');
  g.clearRect(0, 0, 32, 40); g.filter = 'blur(2px)'; g.fillStyle = 'rgba(0,0,0,.9)'; g.fillRect(6, 6, 20, 28);
  const t = new T3.CanvasTexture(c); t.minFilter = t.magFilter = T3.LinearFilter; return t;
}
function sheetTex(seed){
  const c = cv(64, 96), g = c.getContext('2d'), r = rng(seed);
  const gr = g.createLinearGradient(0, 0, 64, 96); gr.addColorStop(0, '#d2d7dd'); gr.addColorStop(1, '#a4abb3');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 96);
  g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(0, 0, 64, 3); g.fillRect(0, 93, 64, 3);
  for(let col = 0; col < 2; col++) for(let row = 0; row < 5; row++){
    const x = 17 + col * 30 + (r() - .5) * 2, y = 14 + row * 17 + (r() - .5) * 2;
    g.fillStyle = '#7c838b'; g.beginPath(); g.ellipse(x, y, 11, 7.5, 0, 0, Math.PI * 2); g.fill();       // 膨らみのふち
    g.fillStyle = '#3f444b'; g.beginPath(); g.ellipse(x, y, 8, 5, 0, 0, Math.PI * 2); g.fill();         // 押し出された穴
    g.strokeStyle = 'rgba(230,234,238,.9)'; g.lineWidth = 1;                                              // 破れたふち
    g.beginPath(); g.moveTo(x - 7, y - 2); g.lineTo(x - 3, y - 6); g.lineTo(x + 2, y - 4); g.lineTo(x + 7, y - 5); g.stroke();
  }
  for(let i = 0; i < 40; i++){ g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(r() * 64 | 0, r() * 96 | 0, 1, 1); }
  const t = ctex(c); return t;
}
function glowTex(){
  const c = cv(32, 32), g = c.getContext('2d'), gr = g.createRadialGradient(16, 16, 1, 16, 16, 15);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.4, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  const t = new T3.CanvasTexture(c); t.minFilter = t.magFilter = T3.LinearFilter; return t;
}

/* --- clock --- */
const CLK = { c: cv(256, 256) }; CLK.g = CLK.c.getContext('2d'); CLK.tex = ctex(CLK.c);
CLK.tex.generateMipmaps = true; CLK.tex.minFilter = T3.LinearMipmapLinearFilter; CLK.tex.magFilter = T3.LinearFilter; CLK.tex.anisotropy = 4;
function drawClock(sec, mirrored, noHands){
  const g = CLK.g, cx = 64, cy = 64;
  g.setTransform(2, 0, 0, 2, 0, 0);
  g.clearRect(0, 0, 128, 128);
  g.fillStyle = '#2b2b2b'; g.beginPath(); g.arc(cx, cy, 63, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ece8df'; g.beginPath(); g.arc(cx, cy, 57, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#333';
  for(let i = 0; i < 60; i++){
    if(i % 5) continue;
    const a = i / 60 * Math.PI * 2;
    g.lineWidth = 2; g.beginPath(); g.moveTo(cx + Math.sin(a) * 50, cy - Math.cos(a) * 50); g.lineTo(cx + Math.sin(a) * 55, cy - Math.cos(a) * 55); g.stroke();
  }
  g.fillStyle = '#222'; g.font = 'bold 16px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for(let i = 1; i <= 12; i++){
    const a = i / 12 * Math.PI * 2, label = mirrored ? (12 - i) || 12 : i;
    g.fillText(String(label), cx + Math.sin(a) * 41, cy - Math.cos(a) * 41 + 1);
  }
  if(!noHands){
    const m = (x, n) => ((x % n) + n) % n;
    const s = m(sec, 60), mi = m(sec / 60, 60), hr = m(sec / 3600, 12);
    const hand = (a, len, w, col, back = 7) => { g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(cx - Math.sin(a) * back, cy + Math.cos(a) * back); g.lineTo(cx + Math.sin(a) * len, cy - Math.cos(a) * len); g.stroke(); };
    hand(hr / 12 * Math.PI * 2, 27, 4, '#1d1d1d');
    hand(mi / 60 * Math.PI * 2, 43, 3, '#1d1d1d');
    hand(s / 60 * Math.PI * 2, 48, 1.2, '#a52a2a', 11);
  }
  g.fillStyle = '#a52a2a'; g.beginPath(); g.arc(cx, cy, 2.5, 0, Math.PI * 2); g.fill();
  CLK.tex.needsUpdate = true;
}

/* --- calendar (October 2026, starts on Thursday) --- */
const CAL = { c: cv(168, 240), move: false, circles: false, m13: false, blank: false }; CAL.g = CAL.c.getContext('2d'); CAL.tex = ctex(CAL.c);
CAL.tex.minFilter = T3.LinearFilter; CAL.tex.magFilter = T3.LinearFilter;
function drawCalendar(t){
  const g = CAL.g, W = 168;
  g.fillStyle = '#f1eee6'; g.fillRect(0, 0, W, 240);
  const sk = g.createLinearGradient(0, 0, 0, 95); sk.addColorStop(0, '#9fb9cc'); sk.addColorStop(1, '#e3e3d6');
  g.fillStyle = sk; g.fillRect(6, 6, W - 12, 89);
  g.fillStyle = '#7d8c74'; g.beginPath(); g.moveTo(6, 75); g.quadraticCurveTo(55, 48, 100, 70); g.quadraticCurveTo(135, 55, W - 6, 65); g.lineTo(W - 6, 95); g.lineTo(6, 95); g.fill();
  g.fillStyle = '#b8873e'; g.fillRect(6, 80, W - 12, 15);
  g.fillStyle = '#5c4636'; g.fillRect(120, 59, 3, 20); g.fillStyle = '#a24d2b'; g.beginPath(); g.arc(121, 56, 10, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#222'; g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  g.font = 'bold 27px sans-serif'; g.fillText(CAL.m13 ? '13' : '10', 9, 126);
  g.font = '10px sans-serif'; g.fillText('OCTOBER', 50, 114);
  g.font = '9px sans-serif'; g.fillStyle = '#555'; g.fillText('2026', 50, 125);
  const days = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  g.textAlign = 'center'; g.font = 'bold 8px sans-serif';
  days.forEach((d, i) => { g.fillStyle = i === 0 ? '#b03030' : i === 6 ? '#305090' : '#444'; g.fillText(d, 12 + i * 24, 142); });
  g.font = '10px sans-serif';
  if(CAL.blank) return void (CAL.tex.needsUpdate = true);
  for(let d = 1; d <= 31; d++){
    const idx = d + 3, col = idx % 7, row = Math.floor(idx / 7);
    let x = 12 + col * 24, y = 159 + row * 18;
    if(CAL.move){ x += Math.sin(t * 1.7 + d * 1.3) * 5; y += Math.cos(t * 1.3 + d * .9) * 4; }
    g.fillStyle = col === 0 ? '#b03030' : col === 6 ? '#305090' : '#2a2a2a';
    g.fillText(String(d), x, y);
    if(d === 12 || CAL.circles || (CAL.grow && d <= CAL.n)){
      g.strokeStyle = 'rgba(190,30,30,.9)'; g.lineWidth = 1.5;
      g.beginPath(); g.ellipse(x, y - 3.5, 9, 7, -.2, 0, Math.PI * 2); g.stroke();
    }
  }
  CAL.tex.needsUpdate = true;
}

/* --- TV / phone / ECG --- */
const TVC = { c: cv(80, 45) }; TVC.g = TVC.c.getContext('2d'); TVC.tex = ctex(TVC.c); TVC.img = TVC.g.createImageData(80, 45);
function drawTV(){
  const a = TVC.img.data;
  for(let i = 0; i < a.length; i += 4){ const v = Math.random() * 150 | 0; a[i] = a[i + 1] = a[i + 2] = v; a[i + 3] = 255; }
  TVC.g.putImageData(TVC.img, 0, 0);
  TVC.g.fillStyle = 'rgba(0,0,0,.6)'; TVC.g.fillRect(0, 15, 80, 15);
  TVC.g.fillStyle = '#fff'; TVC.g.font = 'bold 11px sans-serif'; TVC.g.textAlign = 'center'; TVC.g.textBaseline = 'middle';
  TVC.g.fillText('おきて', 40, 23);
  TVC.tex.needsUpdate = true;
}
function texPhoneCall(){
  const c = cv(36, 72), g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 72); gr.addColorStop(0, '#2f4a3a'); gr.addColorStop(1, '#101814');
  g.fillStyle = gr; g.fillRect(0, 0, 36, 72);
  g.fillStyle = '#ddd'; g.textAlign = 'center'; g.font = '6px sans-serif'; g.fillText('着信', 18, 13);
  g.font = 'bold 9px sans-serif'; g.fillText('自分', 18, 26);
  g.fillStyle = '#c33'; g.beginPath(); g.arc(9, 59, 5, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#3b3'; g.beginPath(); g.arc(27, 59, 5, 0, Math.PI * 2); g.fill();
  return ctex(c);
}
const ECG = { c: cv(80, 48), x: 0, last: 0 }; ECG.g = ECG.c.getContext('2d'); ECG.tex = ctex(ECG.c);
ECG.g.fillStyle = '#020604'; ECG.g.fillRect(0, 0, 80, 48);
function drawECG(phase){
  const g = ECG.g, y0 = 23, x = ECG.x;
  g.fillStyle = '#020604'; g.fillRect(x, 0, 4, 48);
  let p = phase, y = y0;
  if(p < .04) y = y0 - 17 * Math.sin(p / .04 * Math.PI);
  else if(p < .07) y = y0 + 6 * Math.sin((p - .04) / .03 * Math.PI);
  else if(p > .25 && p < .38) y = y0 - 3 * Math.sin((p - .25) / .13 * Math.PI);
  g.strokeStyle = '#4dff8a'; g.lineWidth = 1; g.beginPath(); g.moveTo(x - 1, ECG.last || y); g.lineTo(x, y); g.stroke();
  ECG.last = y; ECG.x = (x + 1) % 80; if(ECG.x === 0) ECG.last = 0;
  g.fillStyle = '#020604'; g.fillRect(58, 35, 22, 13);
  g.fillStyle = '#4dff8a'; g.font = '9px monospace'; g.fillText('58', 63, 45);
  ECG.tex.needsUpdate = true;
}

/* ============================================================
   materials / helpers
   ============================================================ */
let CRISP_BUILD = false;   // true の間に作った素材は、頂点の吸着なし(鮮明)で描く
const crispMat = m => { if(CRISP_BUILD) m.customProgramCacheKey = () => 'crisp'; return m; };
const lam = (color, o = {}) => crispMat(new T3.MeshLambertMaterial(Object.assign({ color }, o)));
const basic = (color, o = {}) => crispMat(new T3.MeshBasicMaterial(Object.assign({ color }, o)));
const blackMat = basic(0x030303);
function box(parent, w, h, d, m, x, y, z){ const me = new T3.Mesh(new T3.BoxGeometry(w, h, d), m); me.position.set(x, y, z); parent.add(me); return me; }
/* ---- フリー素材(Kenney・CC0)の3Dモデル。読み込めなかった時は、図形のままでも遊べる ---- */
const MODELS = {};
function loadModel(name){
  if(!T3.GLTFLoader) return Promise.resolve(null);
  if(!MODELS[name]) MODELS[name] = new Promise(res => new T3.GLTFLoader().load('assets/models/' + name + '.glb', g => {
    CRISP_BUILD = true;   // 鮮明な場面用: 頂点の吸着なし
    g.scene.traverse(m => { if(m.isMesh){ const old = m.material; if(old.map) old.map.encoding = T3.LinearEncoding; m.material = lam(0xffffff, { map: old.map || null, color: old.color ? old.color.getHex() : 0xffffff }); } });
    CRISP_BUILD = false;
    res(g.scene);
  }, undefined, () => res(null)));
  return MODELS[name].then(o => o && o.clone());
}
/* モデルを、指定の大きさ(h=高さ / w=横 / d=奥行き のどれか1つ)に合わせ、足元の中央を原点にそろえる */
function fitModel(o, fit, ry = 0){
  o.rotation.y = ry;
  const b = new T3.Box3().setFromObject(o), sz = b.getSize(new T3.Vector3());
  o.scale.multiplyScalar(fit.h ? fit.h / sz.y : fit.w ? fit.w / sz.x : fit.d / sz.z);
  b.setFromObject(o); const c = b.getCenter(new T3.Vector3());
  o.position.set(-c.x, -b.min.y, -c.z);
  const w = new T3.Group(); w.add(o); return w;
}
/* 図形でできた proc を、モデルに差し替える(読み込めたら proc を隠す) */
async function swapModel(proc, name, fit, x, z, ry = 0, y = 0){
  const o = await loadModel(name); if(!o) return null;
  const w = fitModel(o, fit, ry); w.position.set(x, y, z); proc.parent.add(w); proc.visible = false; return w;
}
function tubeBetween(parent, a, b, r, m){   // 2点を結ぶ細い管(点滴のチューブ用)
  const d = new T3.Vector3().subVectors(b, a), len = d.length(), me = new T3.Mesh(new T3.CylinderGeometry(r, r, len, 5), m);
  me.position.copy(a).addScaledVector(d, .5); me.quaternion.setFromUnitVectors(new T3.Vector3(0, 1, 0), d.normalize()); parent.add(me); return me;
}
function cyl(parent, rt_, rb, h, m, x, y, z, seg = 8){ const me = new T3.Mesh(new T3.CylinderGeometry(rt_, rb, h, seg), m); me.position.set(x, y, z); parent.add(me); return me; }
function plane(parent, w, h, m, x, y, z, ry = 0, rx = 0){
  const big = Math.max(w, h) >= 1, sw = big ? Math.max(1, Math.min(64, Math.ceil(w / .5))) : 1, sh = big ? Math.max(1, Math.min(32, Math.ceil(h / .5))) : 1;
  const me = new T3.Mesh(new T3.PlaneGeometry(w, h, sw, sh), m); me.position.set(x, y, z); me.rotation.set(rx, ry, 0); parent.add(me); return me;
}
/* ---- 人物(等身大・8頭身。肩・腕・脚・首・顔をちゃんと作る) ---- */
function limb(g, r1, r2, len, m, x, y, z){   // 上の端を原点にした、先細りの手足
  const geo = new T3.CylinderGeometry(r1, r2, len, 8); geo.translate(0, -len / 2, 0);
  const me = new T3.Mesh(geo, m); me.position.set(x, y, z); g.add(me); return me;
}
function addHead(g, y, skinM, hairM){   // y は首の付け根。頭はその上
  const head = new T3.Group(); head.position.y = y; g.add(head);
  const hd = new T3.Mesh(new T3.SphereGeometry(.1, 14, 10), skinM); hd.scale.set(.88, 1.12, 1); hd.position.y = .1; head.add(hd);
  box(head, .125, .08, .14, skinM, 0, .04, .015);   // あご
  const hr = new T3.Mesh(new T3.SphereGeometry(.108, 14, 10, 0, Math.PI * 2, 0, Math.PI * .55), hairM); hr.position.set(0, .125, -.012); hr.scale.set(.9, 1.05, 1.03); hr.rotation.x = -.25; head.add(hr);
  box(head, .02, .045, .03, skinM, 0, .095, .1);   // 鼻
  const eyeM = basic(0x15110f);
  for(const sx of [-1, 1]){ box(head, .017, .012, .01, eyeM, .034 * sx, .125, .092); const ear = new T3.Mesh(new T3.SphereGeometry(.02, 6, 5), skinM); ear.position.set(.088 * sx, .1, 0); head.add(ear); }
  g.userData.head = head;
  return head;
}
function makePerson(o){
  const g = new T3.Group(), k = (o.h || 1.72) / 1.75, sl = o.slim || 1;   // sl: 体の横幅(細身は1より小さく)
  const M = c => o.black ? blackMat : lam(c);
  const skinM = M(o.skin || 0xd2a98a), hairM = M(o.hair || 0x1c1816), pantsM = M(o.bottom), topM = M(o.top);
  const coatM = o.coat ? M(o.coat) : null, sleeveM = coatM || topM;
  for(const s of [-1, 1]){
    limb(g, .088, .05, .86 * k, pantsM, .095 * s, .92 * k, 0);
    box(g, .09, .06, .26, M(0x1a1a1c), .095 * s, .03, .05);
  }
  box(g, .31 * sl, .2, .21 * sl, pantsM, 0, .95 * k, 0);
  const tor = new T3.Mesh(new T3.CylinderGeometry(.165, .14, .52 * k, 12), sleeveM); tor.scale.set(1.25 * sl, 1, .75 * sl); tor.position.y = 1.19 * k; g.add(tor);
  { const sb = new T3.Mesh(new T3.CylinderGeometry(.1, .1, .46 * sl, 10), sleeveM); sb.rotation.z = Math.PI / 2; sb.scale.set(1, 1, 1.6 * sl); sb.position.y = 1.42 * k; g.add(sb); }   // 丸い肩
  if(coatM){
    const c = new T3.Mesh(new T3.CylinderGeometry(.165, .27, .8 * k, 16), coatM); c.scale.set(1.22 * sl, 1, .72 * sl); c.position.y = 1.03 * k; g.add(c);   // 白衣・制服: 肩から裾へ広がる
    box(g, .012, .62 * k, .01, M(0xb8b8b2), 0, 1.0 * k, .205 * .72 + .06);   // 前の合わせ目
    for(const s2 of [-1, 1]){ const lp = box(g, .07, .12, .02, coatM, .06 * s2, 1.46 * k, .1); lp.rotation.z = -.5 * s2; }   // 襟
  }
  else { box(g, .09, .28 * k, .012, M(0xf2f2ee), 0, 1.27 * k, .122); box(g, .035, .25 * k, .012, M(o.tie || 0x7a2a30), 0, 1.25 * k, .13); }   // シャツとネクタイ
  const nk = new T3.Mesh(new T3.CylinderGeometry(.045, .05, .1, 8), skinM); nk.position.y = 1.5 * k; g.add(nk);
  for(const s of [-1, 1]){   // 腕: 肩 → ひじ → 手
    const sh = new T3.Group(); sh.position.set(.235 * s * sl, 1.41 * k, 0); sh.rotation.z = .07 * s; g.add(sh);
    const ball = new T3.Mesh(new T3.SphereGeometry(.06, 8, 6), sleeveM); sh.add(ball);
    limb(sh, .05, .041, .3 * k, sleeveM, 0, 0, 0);
    const el = new T3.Group(); el.position.y = -.3 * k; el.rotation.x = -.22; sh.add(el);
    limb(el, .041, .033, .27 * k, sleeveM, 0, 0, 0);
    box(el, .07, .1, .035, skinM, 0, -.32 * k, 0);
  }
  addHead(g, 1.55 * k, skinM, hairM);
  if(o.cap) box(g.userData.head, .19, .055, .12, M(0xf6f6f2), 0, .215, -.01);   // 看護帽
  return g;
}
function makeSitter(o){
  // faces +z. o.floor: sitting on the floor (cross-legged)
  const g = new T3.Group();
  const M_ = c => o.black ? blackMat : lam(c);
  const pants = M_(o.bottom), top = M_(o.top), skinM = M_(o.skin || 0xd2a98a), hairM = M_(o.hair || 0x1c1816);
  const hy = o.floor ? .1 : .5;
  if(o.floor){
    for(const s of [-1, 1]){ const l = box(g, .5, .12, .14, pants, 0, .07, .12); l.rotation.y = .45 * s; }
  } else {
    for(const s of [-1, 1]){
      const th = cyl(g, .085, .065, .46, pants, .1 * s, hy, .22, 8); th.rotation.x = Math.PI / 2;
      cyl(g, .06, .045, hy, pants, .1 * s, hy / 2, .44, 8);
      box(g, .09, .06, .26, M_(0x1a1a1c), .1 * s, .03, .5);
    }
  }
  const torso = new T3.Mesh(new T3.CylinderGeometry(.165, .14, .56, 12), top); torso.scale.set(1.25, 1, .75); torso.position.set(0, hy + .34, 0); torso.rotation.x = .08; g.add(torso);
  box(g, .46, .07, .2, top, 0, hy + .6, 0);
  for(const s of [-1, 1]){ const a = limb(g, .05, .04, .5, top, .235 * s, hy + .58, 0); a.rotation.x = -.95; }
  const nk = new T3.Mesh(new T3.CylinderGeometry(.045, .05, .1, 8), skinM); nk.position.set(0, hy + .7, .02); g.add(nk);
  const h = addHead(g, hy + .73, skinM, hairM); h.position.z = .03; h.rotation.x = .15;
  return g;
}

/* ============================================================
   ROOM
   ============================================================ */
const GH = { n: 12, k: 0, c: [], tex: null };
for(let i = 0; i < GH.n; i++){ const c = document.createElement('canvas'); c.width = 160; c.height = 180; GH.c.push(c); }
const room = new T3.Scene(); room.background = new T3.Color(0x000000);
room.fog = new T3.Fog(0x050608, 3.5, 12);
const R = {};
const W = 1.8, D = 2.4, H = 2.4;
const BED_EYE = new T3.Vector3(-1.28, 1.18, 1.45);
(function buildRoom(){
  const wallM = lam(0xffffff, { map: TX.wall });
  plane(room, 2 * W, 2 * D, lam(0xffffff, { map: TX.floor }), 0, 0, 0, 0, -Math.PI / 2);
  plane(room, 2 * W, 2 * D, lam(0xe6e3dc), 0, H, 0, 0, Math.PI / 2);
  plane(room, 2 * D, H, wallM, -W, H / 2, 0, Math.PI / 2);
  plane(room, 2 * W, H, wallM, 0, H / 2, D, Math.PI);
  plane(room, 2.15, H, wallM, -.725, H / 2, -D);
  plane(room, .65, H, wallM, 1.475, H / 2, -D);
  plane(room, .8, .4, wallM, .75, 2.2, -D);
  plane(room, 2.1, H, wallM, W, H / 2, -1.35, -Math.PI / 2);
  plane(room, 1.1, H, wallM, W, H / 2, 1.85, -Math.PI / 2);
  plane(room, 1.6, .8, wallM, W, .4, .5, -Math.PI / 2);
  plane(room, 1.6, .3, wallM, W, 2.25, .5, -Math.PI / 2);
  const bb = lam(0x5a4636);
  box(room, .02, .07, 2 * D, bb, -W + .01, .035, 0);
  box(room, 2 * W, .07, .02, bb, 0, .035, D - .01);
  box(room, 2.15, .07, .02, bb, -.725, .035, -D + .01);
  box(room, .65, .07, .02, bb, 1.475, .035, -D + .01);
  box(room, .02, .07, 2.1, bb, W - .01, .035, -1.35);
  box(room, .02, .07, 1.1, bb, W - .01, .035, 1.85);
  R.discMat = lam(0xeeeeee, { emissive: 0x6b5a40 });
  cyl(room, .26, .28, .07, R.discMat, 0, H - .035, -.2, 12);

  // window
  const frame = lam(0x8c8f92);
  box(room, .06, .04, 1.64, frame, W + .02, 2.1, .5);
  box(room, .06, .04, 1.64, frame, W + .02, .8, .5);
  box(room, .06, 1.34, .04, frame, W + .02, 1.45, -.3);
  box(room, .06, 1.34, .04, frame, W + .02, 1.45, 1.3);
  box(room, .05, 1.3, .035, frame, W + .03, 1.45, .5);
  box(room, .14, .03, 1.66, lam(0xd9d4c8), W - .04, .79, .5);
  plane(room, 1.6, 1.3, basic(0x2a3a48, { transparent: true, opacity: .14, depthWrite: false }), W + .025, 1.45, .5, -Math.PI / 2);
  plane(room, 1.0, 2.4, lam(0x55585a), 2.3, 0, .5, 0, -Math.PI / 2);
  const rail = lam(0x3a3d40);
  box(room, .04, .04, 2.4, rail, 2.78, 1.05, .5);
  for(let i = 0; i < 25; i++) box(room, .015, 1.05, .015, rail, 2.78, .525, -.7 + i * .1);
  box(room, .9, 1.1, .05, lam(0x6a6c6e), 2.3, .55, -.7);
  box(room, .9, 1.1, .05, lam(0x6a6c6e), 2.3, .55, 1.7);
  R.backdropMat = basic(0xffffff, { map: TX.cityNight, fog: false });
  plane(room, 40, 16, R.backdropMat, 8, 2, .5, -Math.PI / 2);
  R.winFig = makePerson({ top: 0x4c4c52, bottom: 0x2c2c30, skin: 0x8f8178, hair: 0x141414, h: 1.72 }); R.winFig.position.set(2.32, 0, .62); R.winFig.lookAt(-1, 0, .62); room.add(R.winFig);
  R.curtainMat = lam(0x8a8a72, { side: T3.DoubleSide });
  R.curtains = [-.58, 1.58].map(z => {
    const geo = new T3.PlaneGeometry(.5, 1.55, 10, 14), m = new T3.Mesh(geo, R.curtainMat);
    m.rotation.y = -Math.PI / 2; m.position.set(W - .1, 1.425, z); room.add(m);
    return { geo, base: geo.attributes.position.array.slice() };
  });
  box(room, .03, .03, 2.4, lam(0xbbbbbb), W - .1, 2.22, .5);
  // feet behind the curtain (anomaly)
  R.feet = new T3.Group(); room.add(R.feet);
  for(const z of [1.5, 1.68]){
    cyl(R.feet, .055, .05, .6, lam(0x2d2e33), 1.74, .34, z, 6);
    box(R.feet, .2, .06, .09, lam(0x9a8a7c), 1.68, .03, z);
  }

  // door + hallway
  const trim = lam(0x7a6650);
  box(room, .05, 2.04, .06, trim, .33, 1.02, -D + .01);
  box(room, .05, 2.04, .06, trim, 1.17, 1.02, -D + .01);
  box(room, .88, .05, .06, trim, .75, 2.02, -D + .01);
  R.door = new T3.Group(); R.door.position.set(1.15, 0, -D - .01); room.add(R.door);
  box(R.door, .8, 1.99, .04, lam(0xb7a58c), -.4, 1.0, 0);
  const knob = lam(0xc8c3b6);
  R.knobs = [.045, -.045].map(z => { const k = new T3.Mesh(new T3.SphereGeometry(.03, 6, 4), knob); k.position.set(-.72, 1.0, z); R.door.add(k); return k; });
  R.hallNight = basic(0x0a0a0a, { side: T3.BackSide });
  R.hallDay = basic(0xe9e4d6, { side: T3.BackSide, fog: false });
  R.hall = box(room, 1.3, 2.4, 1.8, R.hallNight, .75, 1.2, -D - .92);
  box(room, .07, .11, .01, lam(0xeeeeee), .2, 1.2, -D + .005);
  // extra door on the left wall (anomaly)
  R.extraDoor = new T3.Group(); room.add(R.extraDoor);
  box(R.extraDoor, .04, 1.99, .8, lam(0xb7a58c), -W + .02, 1.0, -.3);
  box(R.extraDoor, .05, 2.04, .05, trim, -W + .02, 1.02, .12);
  box(R.extraDoor, .05, 2.04, .05, trim, -W + .02, 1.02, -.72);
  box(R.extraDoor, .05, .05, .88, trim, -W + .02, 2.02, -.3);
  const ek = new T3.Mesh(new T3.SphereGeometry(.03, 6, 4), knob); ek.position.set(-W + .07, 1.0, -.62); R.extraDoor.add(ek);

  // bed
  const wood = lam(0x8a6a4c);
  box(room, 1.02, .34, 2.1, wood, -1.28, .17, 1.33);
  box(room, 1.02, .85, .05, wood, -1.28, .425, 2.375);
  box(room, .97, .18, 2.04, lam(0xdedbd2), -1.28, .43, 1.33);
  box(room, .99, .1, 1.45, lam(0x6c7a8c), -1.28, .57, .96);
  box(room, .99, .05, .25, lam(0xd4d2cb), -1.28, .59, 1.78);
  const pil = box(room, .55, .1, .32, lam(0xe2e0da), -1.28, .58, 2.18); pil.rotation.x = .1;
  box(room, .4, .5, .38, lam(0x9a7a58), -.52, .25, 2.17);
  box(room, .4, .02, .38, lam(0x8a6a4c), -.52, .51, 2.17);
  R.phoneGroup = new T3.Group(); room.add(R.phoneGroup);
  box(R.phoneGroup, .075, .009, .15, lam(0x111111), -.5, .525, 2.09);
  R.phoneOff = basic(0x060606); R.phoneOn = basic(0xffffff, { map: texPhoneCall() });
  R.phoneScreen = plane(R.phoneGroup, .066, .135, R.phoneOff, -.5, .5305, 2.09, 0, -Math.PI / 2);
  R.phoneScreen.rotation.z = Math.PI;
  box(room, .14, .03, .2, lam(0x5d6f7d), -.6, .535, 2.26);

  // TV (group so it can be turned around)
  box(room, 1.1, .4, .38, lam(0x5b4a3c), -.45, .2, -D + .19);
  R.tv = new T3.Group(); R.tv.position.set(-.45, 0, -D + .2); room.add(R.tv);
  box(R.tv, .2, .03, .14, lam(0x222222), 0, .415, 0);
  box(R.tv, .04, .08, .04, lam(0x222222), 0, .45, 0);
  box(R.tv, .92, .54, .05, lam(0x1a1a1a), 0, .76, 0);
  box(R.tv, .6, .34, .06, lam(0x2a2a2c), 0, .74, -.05);
  R.tvOff = basic(0x0c0d0f, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }); R.tvOn = basic(0xffffff, { map: TVC.tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  R.tvScreen = plane(R.tv, .86, .48, R.tvOff, 0, .76, .026);
  box(R.tv, .012, .012, .005, basic(0xaa2020), .38, .51, .027);
  box(room, .14, .05, .04, lam(0x333333), .0, .425, -2.05);
  cyl(room, .25, .25, .04, lam(0x2b2b2b), -.45, 1.86, -D + .02, 20).rotation.x = Math.PI / 2;
  plane(room, .5, .5, lam(0xffffff, { map: CLK.tex, transparent: true, alphaTest: .05, emissive: 0x262626, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), -.45, 1.86, -D + .045);
  R.calendar = plane(room, .45, .64, lam(0xffffff, { map: CAL.tex, emissive: 0x1a1a1a, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), -1.3, 1.45, -D + .025);
  box(room, .02, .02, .02, lam(0x999999), -1.3, 1.78, -D + .02);

  // desk, chair
  const deskM = lam(0xa4876a), metal = lam(0x444444);
  box(room, .55, .03, 1.1, deskM, 1.525, .72, -1.35);
  for(const [x, z] of [[1.27, -1.88], [1.77, -1.88], [1.27, -.82], [1.77, -.82]]) box(room, .03, .705, .03, metal, x, .352, z);
  box(room, .26, .02, .34, lam(0x3a3c40), 1.52, .745, -1.42);
  cyl(room, .07, .08, .02, metal, 1.66, .745, -1.76);
  const arm = cyl(room, .01, .01, .38, metal, 1.63, .93, -1.72); arm.rotation.z = .25;
  const shade = cyl(room, .03, .09, .1, lam(0x333333), 1.56, 1.1, -1.66); shade.rotation.z = .5;
  box(room, .2, .04, .27, lam(0x8b3a32), 1.6, .755, -.98);
  box(room, .19, .03, .26, lam(0x3d5a7a), 1.6, .79, -.98);
  const makeMug = () => { const m = new T3.Group(); cyl(m, .04, .036, .1, lam(0xe8e4dc), 0, .05, 0, 10); const hdl = new T3.Mesh(new T3.TorusGeometry(.027, .007, 4, 8), lam(0xe8e4dc)); hdl.position.set(.045, .05, 0); m.add(hdl); room.add(m); return m; };
  R.mugPos = new T3.Vector3(1.4, .735, -1.1);
  R.mug = makeMug(); R.mug.position.copy(R.mugPos);
  R.mug2 = makeMug(); R.mug2.position.set(1.4, .735, -1.26);
  R.chair = new T3.Group(); R.chairPos = new T3.Vector3(1.02, 0, -1.35); room.add(R.chair);
  const chM = lam(0x3b3b3e);
  box(R.chair, .44, .06, .44, chM, 0, .46, 0);
  box(R.chair, .05, .46, .42, chM, -.2, .74, 0);
  for(const [x, z] of [[-.19, -.19], [.19, -.19], [-.19, .19], [.19, .19]]) box(R.chair, .025, .43, .025, metal, x, .215, z);
  R.trash = cyl(room, .12, .1, .3, lam(0xcfcfcf), 1.6, .15, -.5);
  R.trashPos = R.trash.position.clone();

  // bookshelf, painting
  const shM = lam(0xb59b7a);
  const bx = 1.0, bz = D - .16;
  box(room, .02, 1.8, .3, shM, bx - .4, .9, bz);
  box(room, .02, 1.8, .3, shM, bx + .4, .9, bz);
  box(room, .82, .02, .3, shM, bx, 1.8, bz);
  box(room, .82, .01, .3, lam(0x8f7a60), bx, .9, bz + .149);
  const r = rng(21), pal = [0x7a3a32, 0x3d566e, 0x5d6b46, 0xc8b78f, 0x2b2d33, 0x8a7a5a, 0x6c4a6a, 0xd2cfc4, 0x9a5a2a, 0x405a58];
  R.books = []; R.bookMeshes = [];
  for(let s = 0; s < 4; s++){
    const y0 = .02 + s * .44;
    box(room, .78, .02, .3, shM, bx, y0, bz);
    let x = bx - .38;
    while(x < bx + .34){
      const w = .025 + r() * .035, h = .2 + r() * .14, c = pal[Math.floor(r() * pal.length)];
      const m = lam(c); m.userData.c = c;
      const b = box(room, w, h, .2 + r() * .05, m, x + w / 2, y0 + .01 + h / 2, bz - .02);
      if(r() < .07) b.rotation.z = .25;
      R.books.push(m); R.bookMeshes.push(b);
      x += w + .003;
      if(r() < .06) x += .08;
    }
  }
  R.picture = new T3.Group(); R.picture.position.set(-1.28, 1.72, D - .02); room.add(R.picture);
  box(R.picture, .64, .49, .03, lam(0x3a2e24), 0, 0, 0);
  R.paintMat = lam(0xffffff, { map: TX.paint, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  plane(R.picture, .56, .42, R.paintMat, 0, 0, -.017, Math.PI);

  // AC, plant
  R.ac = new T3.Group(); room.add(R.ac);
  box(R.ac, .22, .28, .82, lam(0xe6e6e1), -W + .11, 2.1, -1.2);
  box(R.ac, .01, .02, .7, lam(0x999999), -W + .225, 2.0, -1.2);
  R.plant = new T3.Group(); R.plant.position.set(1.56, 0, 2.12); room.add(R.plant);
  cyl(R.plant, .15, .11, .3, lam(0xb06a46), 0, .15, 0, 10);
  cyl(R.plant, .14, .14, .02, lam(0x3a2a1e), 0, .29, 0, 10);
  R.leafM = lam(0x3f5c36); R.stemM = lam(0x4d5f3a);
  const pr = rng(4);
  for(let i = 0; i < 11; i++){
    const a = i / 11 * Math.PI * 2 + pr(), h = .45 + pr() * .5;
    const st = cyl(R.plant, .006, .008, h, R.stemM, Math.cos(a) * .05, .3 + h / 2, Math.sin(a) * .05, 4);
    st.rotation.set(Math.sin(a) * .25, 0, -Math.cos(a) * .25);
    const lf = new T3.Mesh(new T3.SphereGeometry(.1, 6, 4), R.leafM);
    lf.scale.set(.5, .14, 1.1); lf.position.set(Math.cos(a) * (.05 + h * .25), .3 + h, Math.sin(a) * (.05 + h * .25));
    lf.rotation.y = -a; lf.rotation.x = .3; R.plant.add(lf);
  }

  // rug, low table
  R.rug = plane(room, 1.5, 1.9, lam(0xffffff, { map: TX.rug, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), .2, .004, -.6, 0, -Math.PI / 2);
  box(room, .85, .035, .55, lam(0xb39573), .2, .34, -.6);
  for(const [x, z] of [[-.17, -.83], [.57, -.83], [-.17, -.37], [.57, -.37]]) box(room, .035, .32, .035, lam(0x8f7458), x, .16, z);
  box(room, .05, .02, .16, lam(0x222222), .35, .368, -.55);
  R.glass = new T3.Group(); R.glass.position.set(.05, .358, -.68); room.add(R.glass);
  cyl(R.glass, .033, .03, .1, basic(0x9fb4bf, { transparent: true, opacity: .4 }), 0, .05, 0);
  R.water = cyl(R.glass, .029, .028, .05, basic(0xbcd0d8, { transparent: true, opacity: .5 }), 0, .03, 0);
  box(room, .22, .09, .12, lam(0xe0ddd5), .38, .403, -.75);
  box(room, .35, .3, .15, lam(0x3f3a34), -.55, .15, .05).rotation.y = .4;

  // people (anomalies)
  R.shadowMan = makePerson({ black: true, h: 1.82 }); R.shadowMan.position.set(-1.42, 0, -1.55); room.add(R.shadowMan);
  R.shadowMan.lookAt(BED_EYE.x, 0, BED_EYE.z); R.shadowMan.userData.head.rotation.z = .25;
  R.pDesk = makeSitter({ top: 0x5a5e66, bottom: 0x2e3038, hair: 0x141210 }); R.pDesk.position.copy(R.chairPos); R.pDesk.rotation.y = Math.PI / 2; room.add(R.pDesk);
  R.pDoor = makePerson({ top: 0x6a6258, bottom: 0x34322f, h: 1.68 }); R.pDoor.position.set(.75, 0, -3.0); R.pDoor.lookAt(BED_EYE.x, 0, BED_EYE.z); room.add(R.pDoor);
  R.pTable = makeSitter({ top: 0x7a7468, bottom: 0x3a3a40, hair: 0x201a16, floor: true }); R.pTable.position.set(.2, 0, -1.05); R.pTable.rotation.y = Math.PI; room.add(R.pTable);
  R.pCorner = makePerson({ top: 0x5f6a72, bottom: 0x2f3236, h: 1.7 }); R.pCorner.position.set(-1.5, 0, -2.1); R.pCorner.lookAt(-1.8, 0, -2.4); room.add(R.pCorner);
  R.pBedside = makePerson({ top: 0x8c8478, bottom: 0x3e3b38, h: 1.66 }); R.pBedside.position.set(-.42, 0, .9); R.pBedside.lookAt(BED_EYE.x, 0, BED_EYE.z); R.pBedside.userData.head.rotation.x = .35; room.add(R.pBedside);
  // ---- 追加: 黒い人(立っているだけ・座っているだけ) ----
  R.sBed = makePerson({ black: true, h: 1.74 }); R.sBed.position.set(-.45, 0, .85); R.sBed.lookAt(BED_EYE.x, 0, BED_EYE.z); room.add(R.sBed);
  R.sDesk = makeSitter({ black: true, top: 0, bottom: 0 }); R.sDesk.position.copy(R.chairPos); R.sDesk.rotation.y = Math.PI / 2; room.add(R.sDesk);
  R.sDoor = makePerson({ black: true, h: 1.76 }); R.sDoor.position.set(.75, 0, -3.0); R.sDoor.lookAt(BED_EYE.x, 0, BED_EYE.z); room.add(R.sDoor);
  R.sWin = makePerson({ black: true, h: 1.74 }); R.sWin.position.set(2.32, 0, .62); R.sWin.lookAt(-1, 0, .62); room.add(R.sWin);
  // 天井の電気に、仰向けでなく「うつ伏せ」で張り付いている黒い人(顔は下=部屋側を向く)
  R.sCeil = makePerson({ black: true, h: 1.7 }); R.sCeil.rotation.x = Math.PI / 2; R.sCeil.position.set(0, H - .22, -1.45); room.add(R.sCeil);
  // ---- 追加: 病室の記憶(本当は病院のベッドで寝ているから、夢の部屋に病室のものがにじみ出る) ----
  R.sFam = [[-.52, .75, 1.74], [-.38, 1.25, 1.6], [-.56, 1.72, 1.72]].map(([x, z, h]) => {   // お見舞いの家族3人 = 黒い影
    const o = makePerson({ black: true, h }); o.position.set(x, 0, z); o.lookAt(BED_EYE.x, 0, BED_EYE.z); o.userData.head.rotation.x = .38; o.visible = false; room.add(o); return o; });
  const wardMetal = lam(0xb4babd);
  R.iv = new T3.Group(); R.iv.position.set(-.68, 0, .62); R.iv.visible = false; room.add(R.iv);   // 点滴スタンド
  cyl(R.iv, .012, .012, 1.9, wardMetal, 0, .95, 0, 6);
  box(R.iv, .5, .025, .03, wardMetal, 0, .03, 0); box(R.iv, .03, .025, .5, wardMetal, 0, .03, 0); box(R.iv, .3, .02, .02, wardMetal, 0, 1.88, 0);
  for(const x of [-.13, .13]) box(R.iv, .1, .17, .028, basic(0xcfe0e0, { transparent: true, opacity: .75 }), x, 1.74, 0);
  tubeBetween(R.iv, new T3.Vector3(0, 1.64, 0), new T3.Vector3(-.27, .66, .28), .005, basic(0xdfe9e6));
  R.sSyr = makePerson({ black: true, h: 1.72 }); R.sSyr.position.set(-.58, 0, 1.72); R.sSyr.lookAt(BED_EYE.x, 0, 2.2); R.sSyr.userData.head.rotation.x = .3; R.sSyr.visible = false; room.add(R.sSyr);
  {   // 手に持った注射器(黒い人の中で、ここだけ白く浮かぶ)
    const sg = new T3.Group(); sg.position.set(.24, 1.0, .2); sg.rotation.x = .5; R.sSyr.add(sg);
    const sx = (m, r, len, z) => { const c = cyl(sg, r, r, len, m, 0, 0, z, 8); c.rotation.x = Math.PI / 2; return c; };
    sx(basic(0xe4ecee), .02, .17, 0); sx(basic(0x9fe0d0), .014, .13, 0); sx(basic(0xd8dcde), .004, .12, .14); sx(basic(0xd8dcde), .03, .005, -.09);
  }
  R.rails = new T3.Group(); R.rails.visible = false; room.add(R.rails);   // ベッドの柵
  for(const x of [-.745, -1.775]){ box(R.rails, .03, .03, 1.5, wardMetal, x, .98, 1.2); box(R.rails, .03, .03, 1.5, wardMetal, x, .76, 1.2); for(let i = 0; i < 6; i++) box(R.rails, .025, .38, .025, wardMetal, x, .8, .5 + i * .28); }
  R.syr = [[1.15, 1.9], [1.6, 1.25], [1.35, .5], [1.95, 1.6], [1.05, 1.2], [1.75, 2.15], [1.3, 1.65], [1.85, .7]].map(([y, z], i) => {   // 壁から突き出る注射器
    const g = new T3.Group(); g.position.set(-W + .01, y, z); g.rotation.set((i % 3 - 1) * .12, (i % 2) * .15 - .07, (i % 4 - 1.5) * .1); g.visible = false;
    const ax = (m, r, len, x) => { const c = cyl(g, r, r, len, m, x, 0, 0, 8); c.rotation.z = Math.PI / 2; return c; };
    ax(lam(0xe8eef0), .017, .15, .1); ax(lam(0x8fd8c8), .0125, .12, .1); ax(wardMetal, .0035, .12, .235); ax(wardMetal, .03, .004, .022); ax(wardMetal, .005, .08, -.02);
    room.add(g); return g; });
  // 窓の外の黒い人は暗い夜景に溶けてしまうので、背後にぼんやり明るい光を置いて輪郭を浮かび上がらせる
  plane(R.sWin, 1.5, 2.3, basic(0xc4d4ff, { map: glowTex(), transparent: true, opacity: .75, blending: T3.AdditiveBlending, depthWrite: false, fog: false }), 0, 1.0, -.3, 0, 0);

  // ---- 枕元のデジタル時計 ----
  R.dclockPos = new T3.Vector3(-.38, .5575, 2.27);
  R.dclock = new T3.Group(); R.dclock.position.copy(R.dclockPos); room.add(R.dclock);
  box(R.dclock, .14, .075, .07, lam(0x1c1c1f), 0, 0, 0);
  plane(R.dclock, .12, .045, basic(0xffffff, { map: DCK.tex }), 0, .003, -.0356, Math.PI, 0);
  box(R.dclock, .02, .012, .02, lam(0x2a2a2e), -.04, .043, 0); box(R.dclock, .02, .012, .02, lam(0x2a2a2e), .04, .043, 0);

  // ---- 枕元の薬の袋 / 空のシート ----
  R.pillBag = new T3.Group(); R.pillBag.position.set(-.36, .526, 2.1); room.add(R.pillBag);
  R.bagBody = box(R.pillBag, .1, .012, .14, lam(0xdde2e2, { transparent: true, opacity: .62 }), 0, 0, 0);
  const pillM = [lam(0xf4f1e8), lam(0xe9d9a8), lam(0xe8bcbc)];
  const addPill = (grp, x, y, z) => { const p = new T3.Mesh(new T3.CylinderGeometry(.006, .006, .004, 6), pick(pillM)); p.position.set(x, y, z); p.rotation.set(Math.random() * 3, 0, Math.random() * 3); grp.add(p); };
  R.pillsFew = new T3.Group(); R.pillBag.add(R.pillsFew);
  [[-.02, .01, -.03], [.015, .01, .0], [-.005, .01, .035]].forEach(p => addPill(R.pillsFew, ...p));
  R.pillsMany = new T3.Group(); R.pillBag.add(R.pillsMany);
  for(let i = 0; i < 34; i++) addPill(R.pillsMany, (Math.random() - .5) * .08, .004 + Math.random() * .036, (Math.random() - .5) * .12);
  R.blisters = new T3.Group(); room.add(R.blisters);
  const bm = lam(0xb9bfc6, { emissive: 0x15171a });
  [[-.5, .522, 2.31, .4], [-.63, .522, 2.04, 1.1], [-.44, .522, 2.2, 2.2], [-.67, .522, 2.27, .2], [-.2, .004, 2.15, .8], [-.1, .004, 1.92, 2.0], [-.32, .004, 1.78, 1.3], [-.55, .004, 1.85, 2.6], [-.25, .004, 2.3, .5]].forEach(p => {
    const b = box(R.blisters, .045, .003, .065, bm, p[0], p[1], p[2]); b.rotation.y = p[3];
  });

  // 日がたつごとに増える「使い終えた」空のシート(ふだんの状態)。第1夜は0枚
  R.usedSheets = [];
  const sheetM = lam(0xb9bfc6, { emissive: 0x15171a }), SHEET_A = sheetTex(3), SHEET_B = sheetTex(8);

  // 枕元の飲みかけの水(夜がたつほど減る)と、床・台に転がる錠剤
  R.nightGlass = new T3.Group(); R.nightGlass.position.set(-.69, .52, 2.33); room.add(R.nightGlass);
  cyl(R.nightGlass, .03, .027, .09, basic(0x9fb4bf, { transparent: true, opacity: .35 }), 0, .045, 0);
  R.nightWater = cyl(R.nightGlass, .026, .025, .06, basic(0xbcd0d8, { transparent: true, opacity: .55 }), 0, .03, 0);
  R.loosePills = [];
  [[-.52, .5235, 2.17], [-.31, .5235, 2.2], [-.6, .5235, 1.99]].forEach(p => {
    const m = new T3.Mesh(new T3.CylinderGeometry(.006, .006, .004, 6), lam(0xf4f1e8)); m.position.set(p[0], p[1], p[2]); m.rotation.z = Math.random() * 3; m.visible = false; room.add(m); R.loosePills.push(m);
  });
  [[-.64, .5235, 2.03, .2], [-.645, .5265, 2.035, .7], [-.64, .5295, 2.03, 1.3], [-.635, .5325, 2.032, 2.0], [-.64, .5355, 2.03, .45],
   [-.57, .5225, 2.07, .9], [-.45, .5225, 2.18, .3], [-.7, .5225, 2.15, 1.6], [-.55, .5225, 2.34, 2.4], [-.4, .5225, 2.35, 1.0]].forEach(p => {
    const g = new T3.Group(); g.position.set(p[0], p[1], p[2]); g.rotation.y = p[3];
    box(g, .045, .003, .065, sheetM, 0, 0, 0);
    plane(g, .043, .063, lam(0xffffff, { map: (g.id % 2 ? SHEET_B : SHEET_A), emissive: 0x181a1d, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), 0, .0019, 0, 0, -Math.PI / 2);
    g.visible = false; room.add(g); R.usedSheets.push(g);
  });

  // ---- スマホの通知ランプ ----
  R.ledMat = basic(0x1a2630);
  box(R.phoneGroup, .009, .003, .009, R.ledMat, -.5 - .026, .5325, 2.026);
  R.ledGlow = plane(R.phoneGroup, .09, .09, basic(0x7fd0ff, { map: glowTex(), transparent: true, blending: T3.AdditiveBlending, depthWrite: false }), -.526, .534, 2.026, 0, -Math.PI / 2);
  R.ledGlow.visible = false;

  // ---- 壁の上着と影(窓の月明かりは +x 側 → 影は左へ落ちる) ----
  const jm = lam(0x3d4b5c);
  box(room, .025, .025, .04, lam(0x888888), 1.55, 1.82, -D + .03);
  box(room, .42, .5, .05, jm, 1.55, 1.46, -D + .055);
  box(room, .12, .5, .05, jm, 1.38, 1.44, -D + .055).rotation.z = .08;
  box(room, .12, .5, .05, jm, 1.72, 1.44, -D + .055).rotation.z = -.08;
  box(room, .28, .06, .06, lam(0x2f3a48), 1.55, 1.72, -D + .06);
  R.jShadow = plane(room, .56, .7, basic(0x000000, { map: softShadowTex(), transparent: true, opacity: .62, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), 1.41, 1.43, -D + .012);

  // ---- ドアの隙間の光 ----
  R.doorGap = new T3.Group(); room.add(R.doorGap);
  const po = { polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 };
  plane(R.doorGap, .78, .014, basic(0xffe3a8, po), .75, .007, -D + .012);
  plane(R.doorGap, .78, .18, basic(0xffd890, Object.assign({ transparent: true, opacity: .3, depthWrite: false }, po)), .75, .004, -D + .1, 0, -Math.PI / 2);

  // ---- 壁のポスター / 机の本の表紙 / 机のメモ ----
  plane(room, .42, .6, lam(0xffffff, { map: PST.tex, emissive: 0x14161a, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), -W + .014, 1.5, .85, Math.PI / 2);
  const flat = m => { m.rotation.set(-Math.PI / 2, 0, -Math.PI / 2); return m; };
  flat(plane(room, .17, .24, lam(0xffffff, { map: BKT.tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), 1.6, .8065, -.98));
  flat(plane(room, .12, .15, lam(0xffffff, { map: MEM.tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), 1.36, .7365, -.9));

  // ---- 窓に映る部屋(一瞬遅れてついてくる) ----
  GH.tex = new T3.CanvasTexture(GH.c[0]); GH.tex.minFilter = GH.tex.magFilter = T3.LinearFilter;
  R.ghostMat = new T3.ShaderMaterial({
    uniforms: { tGhost: { value: GH.tex }, uLow: post.uniforms.uLow, uAmt: { value: .3 } },
    transparent: true, depthWrite: false,
    vertexShader: 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform sampler2D tGhost; uniform vec2 uLow; uniform float uAmt; void main(){ vec2 uv = gl_FragCoord.xy / uLow; vec3 c = texture2D(tGhost, uv).rgb; gl_FragColor = vec4(c * vec3(.75, .88, 1.0), uAmt); }'
  });
  R.ghost = new T3.Mesh(new T3.PlaneGeometry(1.6, 1.3), R.ghostMat); R.ghost.position.set(W + .024, 1.45, .5); R.ghost.rotation.y = -Math.PI / 2; R.ghost.visible = false; room.add(R.ghost);

  // ---- 散らかり(第2夜から少しずつ増える。異変ではなく、ふだんの状態) ----
  R.clutter = [];
  const cl = (lv, o) => { room.add(o); R.clutter.push({ o, lv, p0: o.position.clone(), r0: o.rotation.y }); return o; };
  const cb = (lv, w, h, d, c, x, y, z, ry = 0, rz = 0) => { const m = new T3.Mesh(new T3.BoxGeometry(w, h, d), lam(c)); m.position.set(x, y, z); m.rotation.set(0, ry, rz); return cl(lv, m); };
  const cc = (lv, r1, r2, h, c, x, y, z, op) => { const m = new T3.Mesh(new T3.CylinderGeometry(r1, r2, h, 8), op ? basic(c, { transparent: true, opacity: op }) : lam(c)); m.position.set(x, y, z); return cl(lv, m); };
  // 第2夜
  cb(1, .46, .04, .32, 0x7c8798, -.58, .022, .66, .5); cb(1, .4, .035, .3, 0xa89b84, -.62, .05, .7, 1.1); cb(1, .3, .03, .22, 0x5a6a5a, -.52, .075, .6, .2);
  cc(1, .03, .03, .2, 0x9fd0e8, .08, .46, -.72, .55);
  cb(1, .22, .015, .3, 0xc8b078, 1.0, .012, .55, .6);
  // 第3夜
  cb(2, .3, .22, .17, 0xe8ecee, .85, .12, .3, .3); cb(2, .22, .02, .02, 0xd0d4d6, .85, .245, .3, .3);
  cc(2, .048, .038, .09, 0xc8433a, .42, .405, -.42);
  cb(2, .2, .03, .26, 0x3d566e, .85, .02, 1.95, .2); cb(2, .22, .03, .27, 0x7a3a32, .85, .05, 1.95, -.15); cb(2, .2, .03, .25, 0x8a7a5a, .87, .08, 1.96, .3);
  // 第4夜
  cb(3, .42, .3, .36, 0xb89a68, 1.55, .15, 1.15, .1); cb(3, .32, .26, .3, 0xa88a58, 1.5, .43, 1.2, -.2);
  cb(3, .42, .08, .46, 0x6b6f78, 1.0, .53, -1.35, .3);
  { const m = new T3.Mesh(new T3.SphereGeometry(.17, 8, 6), lam(0x15151a)); m.scale.set(1, .85, 1); m.position.set(1.65, .15, -.22); cl(3, m); }
  { const m = new T3.Mesh(new T3.SphereGeometry(.15, 8, 6), lam(0x1d1d22)); m.scale.set(1, .9, 1); m.position.set(1.45, .13, -.1); cl(3, m); }
  [[.3, -1.7, .4], [.7, -1.5, 1.2], [.55, -.3, 2.2], [.95, -1.1, .1], [.2, -.2, 1.7]].forEach(p => cb(3, .2, .004, .28, 0xeeeeea, p[0], .006, p[1], p[2]));
  cc(3, .04, .036, .1, 0xe8e4dc, .0, .41, -.5); cc(3, .045, .04, .08, 0xd8d0c0, .5, .4, -.7);
  // 第5夜
  cb(4, .5, .08, .34, 0x7c8798, -1.2, .67, .42, .1); cb(4, .44, .07, .3, 0xa89b84, -1.18, .74, .4, -.2); cb(4, .34, .07, .26, 0x5a6a5a, -1.22, .8, .43, .5);
  [[1.3, -1.82], [1.4, -1.76], [1.5, -1.84], [1.62, -1.78], [1.72, -1.84]].forEach(p => cc(4, .03, .03, .2, 0x9fd0e8, p[0], .835, p[1], .55));
  cc(4, .12, .12, .02, 0xe8e4dc, .2, .016, -1.3); cc(4, .1, .1, .02, 0xd0c8b4, .6, .016, -1.0);
  [[1.45, -2.0], [1.62, -1.95], [-.2, -2.2]].forEach(p => { const m = new T3.Mesh(new T3.SphereGeometry(.17, 8, 6), lam(0x15151a)); m.scale.set(1, .85, 1); m.position.set(p[0], .15, p[1]); cl(4, m); });
  cb(4, .5, .05, .34, 0x6a7a8a, .1, .026, .8, .9); cb(4, .4, .04, .3, 0x8a6a5a, .35, .022, 1.2, .3); cb(4, .45, .04, .3, 0x5a5a62, -.2, .022, -.4, 1.2);
  [[.0, -.58], [.3, -.8], [.5, -.55]].forEach(p => cc(4, .04, .036, .1, 0xe8e4dc, p[0], .41, p[1]));
  [[-.1, 1.1, .8], [.5, 2.0, 1.6], [.6, 1.2, .2], [1.1, .3, 2.5], [.1, 1.5, .1]].forEach(p => cb(4, .2, .004, .28, 0xeeeeea, p[0], .006, p[1], p[2]));

  // ---- 散らかりの異変用(ふだんは非表示) ----
  const ab = (g, w, h, d, c, x, y, z, ry = 0) => { const m = new T3.Mesh(new T3.BoxGeometry(w, h, d), lam(c)); m.position.set(x, y, z); m.rotation.y = ry; g.add(m); return m; };
  R.aPerson = new T3.Group(); R.aPerson.position.set(.2, 0, .55); R.aPerson.rotation.y = 1.45; room.add(R.aPerson);
  ab(R.aPerson, .42, .03, .5, 0x4f6f9a, 0, .02, 0);                                   // シャツ(胴)
  { const a = ab(R.aPerson, .14, .028, .42, 0x4f6f9a, -.3, .02, -.08); a.rotation.y = .35; const b = ab(R.aPerson, .14, .028, .42, 0x4f6f9a, .3, .02, -.08); b.rotation.y = -.35; }
  ab(R.aPerson, .16, .03, .5, 0x4a4d55, -.1, .02, .5); ab(R.aPerson, .16, .03, .5, 0x4a4d55, .1, .02, .5);   // ズボン(脚)
  ab(R.aPerson, .1, .025, .12, 0xe8e4dc, -.1, .02, .82); ab(R.aPerson, .1, .025, .12, 0xe8e4dc, .1, .02, .82);   // 靴下
  R.aTrail = new T3.Group(); room.add(R.aTrail);
  for(let i = 0; i < 8; i++){ const k = i / 7; ab(R.aTrail, .32, .06, .22, [0x4f6f9a, 0xeeeeea, 0xb04a3c, 0xeeeeea][i % 4], -.7 + k * 1.45, .03, .8 - k * 3.0, .15 + (i % 3) * .1); }
  R.aHuge = new T3.Group(); room.add(R.aHuge);
  [[.9, .3, .8, 1.5, 1.2, 0x7c8798], [.7, .28, .62, 1.52, 1.18, 0xa89b84], [.55, .26, .5, 1.5, 1.2, 0x5a6a5a], [.42, .24, .4, 1.52, 1.18, 0x8a6a5a], [.3, .22, .3, 1.5, 1.2, 0xc8b078]].forEach((p, i) => {
    ab(R.aHuge, p[0], p[1] + .3, p[2], p[5], p[3], .15 + i * .26 + (i ? 0 : 0), p[4], i * .5);
  });
  R.aShoes = new T3.Group(); room.add(R.aShoes);
  for(let i = 0; i < 4; i++) for(const dz of [-.1, .1]){
    const g = new T3.Group(); g.position.set(.25, 0, .15 + i * .3 + dz); g.rotation.y = Math.PI / 2;   // つま先がベッド(-x)側
    ab(g, .09, .035, .27, 0x1f1f22, 0, .018, 0); ab(g, .085, .07, .15, 0x2c2c32, 0, .06, .04); R.aShoes.add(g);
  }
  R.aBottles = new T3.Group(); room.add(R.aBottles);
  for(let i = 0; i < 9; i++){ const m = new T3.Mesh(new T3.CylinderGeometry(.03, .03, .2, 8), basic(0x9fd0e8, { transparent: true, opacity: .55 })); m.position.set(-.1, .1, -.4 + i * .22); R.aBottles.add(m); }
  R.aPapers = new T3.Group(); room.add(R.aPapers);
  for(let i = 0; i < 3; i++) for(let j = 0; j < 4; j++) ab(R.aPapers, .2, .004, .28, 0xeeeeea, -.05 + i * .27, .006, .15 + j * .34);
  [R.aPerson, R.aTrail, R.aHuge, R.aShoes, R.aBottles, R.aPapers].forEach(g => g.visible = false);

  // ---- 増えていくもの(時間がたつほど増える異変用。ふだんは非表示) ----
  R.grow = {};
  const gr = rng(55);
  const mkGrow = (id, items, start, period) => { items.forEach(m => { m.visible = false; room.add(m); }); R.grow[id] = { items, start, period, n: -1 }; };
  const bottleM = basic(0x9fd0e8, { transparent: true, opacity: .55 });
  mkGrow('bottlesGrow', Array.from({ length: 14 }, () => { const m = new T3.Mesh(new T3.CylinderGeometry(.03, .03, .2, 8), bottleM); m.position.set(-.1 + gr() * .8, .1, .1 + gr() * 1.3); return m; }), 3, 5);
  mkGrow('papersGrow', Array.from({ length: 16 }, () => { const m = new T3.Mesh(new T3.BoxGeometry(.2, .006, .28), lam(0xeeeeea)); m.position.set(-.3 + gr() * 1.0, .01, .2 + gr() * 1.4); m.rotation.y = gr() * 3; return m; }), 3, 4);
  mkGrow('cupsGrow', Array.from({ length: 10 }, (_, i) => { const m = new T3.Mesh(new T3.CylinderGeometry(.04, .036, .09, 8), lam([0xe8e4dc, 0xc8433a, 0xd8d0c0, 0x7a9ab8][i % 4])); m.position.set(-.12 + gr() * .66, .405, -.82 + gr() * .4); return m; }), 3, 6);
  mkGrow('laundryGrow', Array.from({ length: 9 }, (_, i) => { const m = new T3.Mesh(new T3.BoxGeometry(.5 - i * .02, .09, .4 - i * .015), lam([0x7c8798, 0xa89b84, 0x5a6a5a, 0x8a6a5a, 0x4f6f9a][i % 5])); m.position.set(.95, .05 + i * .085, .95); m.rotation.y = i * .45; return m; }), 2, 6);
  mkGrow('trashGrow', Array.from({ length: 9 }, () => { const m = new T3.Mesh(new T3.SphereGeometry(.16, 8, 6), lam(0x15151a)); m.scale.set(1, .85, 1); m.position.set(1.15 + gr() * .55, .14, -2.05 + gr() * 1.3); return m; }), 2, 6);
  mkGrow('boxesGrow', Array.from({ length: 9 }, (_, i) => { const lv = i < 5 ? 0 : i < 8 ? 1 : 2; const m = new T3.Mesh(new T3.BoxGeometry(.42, .3, .36), lam(0xb89a68)); m.position.set(1.4 + (i % 5) * .0 + (lv ? .1 : 0) + (i % 2) * .02, .15 + lv * .31, .2 + (lv === 0 ? i * .4 : (i - 5) * .5 + .15)); m.rotation.y = (i % 3) * .1; return m; }), 2, 7);

  // ---- 懐中電灯(スマホのライト) ----
  R.flash = new T3.SpotLight(0xfff2d4, 0, 7.5, .42, .6, 1.2); room.add(R.flash, R.flash.target);
})();

const L = {
  amb: new T3.AmbientLight(0x56607a, .55),
  ceil: new T3.PointLight(0xffc790, .8, 9, 1.2),
  moon: new T3.DirectionalLight(0x8aa0d0, .35),
  sun: new T3.DirectionalLight(0xfff0d8, 0)
};
L.ceil.position.set(0, 2.1, -.2); L.moon.position.set(6, 3, .3); L.sun.position.set(6, 4, 1.4);
Object.values(L).forEach(l => room.add(l));
function setLights(m){
  const set = (ac, ai, cc, ci, mi, mc, si, em) => {
    L.amb.color.setHex(ac); L.amb.intensity = ai; L.ceil.color.setHex(cc); L.ceil.intensity = ci;
    L.moon.color.setHex(mc); L.moon.intensity = mi; L.sun.intensity = si; R.discMat.emissive.setHex(em);
  };
  S.dark = m === 'cloud';
  L.moon.position.set(6, 3, .3);
  if(m === 'night') set(0x56607a, .62, 0xffc790, .85, .35, 0x8aa0d0, 0, 0x6b5a40);
  if(m === 'cloud') set(0x232b40, .2, 0xffc790, .12, .03, 0x8aa0d0, 0, 0x1a1610);
  if(m === 'dawnB') set(0x7f95c4, .78, 0xffc790, .2, .5, 0xa8bcf0, 0, 0x2a2418);
  if(m === 'dawnR'){ set(0xc88a78, .74, 0xffc790, .2, .6, 0xff9a6a, 0, 0x2a2018); L.moon.position.set(6, 1.2, .3); }
  if(m === 'ward') set(0x9fb0a8, .85, 0xe4fff0, 1.1, .2, 0x8aa0d0, 0, 0x6b5a40);
  if(m === 'red') set(0x5a1c1c, .62, 0xff2a18, 1.2, .12, 0x8aa0d0, 0, 0x900c0c);
  if(m === 'day') set(0xc9ced6, .72, 0xffc790, 0, 0, 0x8aa0d0, .75, 0x000000);
}
function updateCurtains(t, sway){
  for(const c of R.curtains){
    const p = c.geo.attributes.position.array, b = c.base;
    for(let i = 0; i < p.length; i += 3){
      const x = b[i], y = b[i + 1], down = (.775 - y) / 1.55;
      let z = Math.sin((x + .25) * Math.PI * 8) * .03;
      if(sway) z += (Math.sin(t * 1.7 + y * 2.2) * .09 + Math.sin(t * .9 + x * 4) * .04 + .1 * (.5 + .5 * Math.sin(t * 1.2))) * down;
      p[i + 2] = z;
    }
    c.geo.attributes.position.needsUpdate = true; c.geo.computeVertexNormals();
  }
}

/* ============================================================
   HOSPITAL
   ============================================================ */
const hosp = new T3.Scene(); hosp.background = new T3.Color(0x000000);
const HP = {};
(function buildHospital(){
  const s = hosp;
  box(s, 5, 2.8, 6.4, lam(0xa9b4ae, { side: T3.BackSide }), .6, 1.4, -.9);
  plane(s, 5, 6.4, lam(0x8b908a), .6, .002, -.9, 0, -Math.PI / 2);
  box(s, 1.0, .5, 2.3, lam(0xd6dadb), 0, .3, -.1);
  box(s, .96, .14, 2.2, lam(0xe2e4e2), 0, .62, -.1);
  box(s, .98, .16, 1.55, lam(0xbfcad3), 0, .74, -.55);
  box(s, .6, .12, .34, lam(0xe8e8e6), 0, .74, .82);
  for(const x of [-.53, .53]) box(s, .03, .25, 1.1, lam(0x9aa0a4), x, .82, -.2);
  const metal = lam(0x9a9fa3);
  cyl(s, .012, .012, 1.9, metal, -.78, .95, .35, 5);
  box(s, .12, .2, .03, basic(0xb8c6c8, { transparent: true, opacity: .7 }), -.78, 1.75, .35);
  box(s, .38, .3, .16, lam(0x2e3236), -.85, 1.35, .62).rotation.y = .7;
  plane(s, .32, .22, basic(0xffffff, { map: ECG.tex }), -.79, 1.35, .565, .7);
  cyl(s, .015, .015, 1.2, metal, -.85, .6, .62, 5);
  plane(s, 1.4, 1.0, basic(0x1d2633), 1.3, 1.6, -4.09);
  box(s, 1.5, .05, .06, lam(0xcfd3d0), 1.3, 2.12, -4.07);
  box(s, 1.5, .05, .06, lam(0xcfd3d0), 1.3, 1.08, -4.07);
  plane(s, 2.8, 2.2, lam(0x9fb3a6, { side: T3.DoubleSide }), 2.6, 1.2, -1.2, -Math.PI / 2);
  box(s, .3, .9, .3, lam(0xc8c4b8), -1.0, .45, -1.4);
  HP.doc = makePerson({ top: 0xdedede, bottom: 0x3a3d44, coat: 0xe6e6e2, hair: 0x232323, h: 1.75 });
  HP.mom = makePerson({ top: 0x6e5d63, bottom: 0x3b3438, hair: 0x2a2220, h: 1.58 });
  HP.dad = makePerson({ top: 0x3d4450, bottom: 0x2b2e33, hair: 0x353535, h: 1.72 });
  HP.doc.position.set(1.45, 0, -1.55); HP.mom.position.set(.85, 0, -2.25); HP.dad.position.set(1.4, 0, -2.55);
  HP.nurse = makePerson({ top: 0xf2e4e8, bottom: 0xeeeeec, coat: 0xf4f4f2, hair: 0x2a2220, h: 1.62 }); HP.nurse.position.set(-.8, 0, .1); HP.nurse.visible = false; s.add(HP.nurse);
  [HP.doc, HP.mom, HP.dad].forEach(p => s.add(p));
  HP.doc.lookAt(1.0, 0, -2.4); HP.mom.lookAt(1.45, 0, -1.55); HP.dad.lookAt(1.45, 0, -1.55);
  box(s, .3, .05, 1.3, basic(0xf4f8f2), 0, 2.76, -.3); box(s, .3, .05, 1.3, basic(0xf4f8f2), 1.2, 2.76, -1.8); box(s, .3, .05, 1.3, basic(0xf4f8f2), -.9, 2.76, -2.6);
  s.add(new T3.AmbientLight(0x3d4644, .9));
  const wl = new T3.DirectionalLight(0x8090a8, .3); wl.position.set(1, 3, -5); s.add(wl);
  const ml = new T3.PointLight(0x40ff80, .35, 2.5); ml.position.set(-.7, 1.3, .3); s.add(ml);
  const cl = new T3.PointLight(0xd8e0dc, .55, 7, 1.2); cl.position.set(1.2, 2.6, -1.8); s.add(cl);
})();

/* 病室の人の位置: near=true で、ベッドの脇に集まる(真エンディング)。false で元の位置(失敗エンディング) */
function hospPlace(near){
  if(near){
    HP.doc.position.set(.8, 0, .5); HP.mom.position.set(.76, 0, .05); HP.dad.position.set(.82, 0, -.4);
    [HP.doc, HP.mom, HP.dad, HP.nurse].forEach(o => o.lookAt(0, 0, .1)); HP.nurse.visible = true;
    HP.mom.userData.head.rotation.x = .3; HP.dad.userData.head.rotation.x = .3;
  } else {
    HP.doc.position.set(1.45, 0, -1.55); HP.mom.position.set(.85, 0, -2.25); HP.dad.position.set(1.4, 0, -2.55);
    HP.doc.lookAt(1.0, 0, -2.4); HP.mom.lookAt(1.45, 0, -1.55); HP.dad.lookAt(1.45, 0, -1.55); HP.nurse.visible = false;
  }
}

/* ============================================================
   WARD(真エンディング: 目を覚ました病室。主人公の部屋と、同じ間取り)
   ============================================================ */
const ward = new T3.Scene(); ward.background = new T3.Color(0xcfd8d4);
const WD = {};
(function buildWard(){
  CRISP_BUILD = true;
  const s = ward;
  const wallM = lam(0xe9e6da), floorM = lam(0xbdb8a8), ceilM = lam(0xf2f2ee), metal = lam(0xc4c9cc), wood = lam(0xcdbf9f);
  plane(s, 2 * W, 2 * D, floorM, 0, 0, 0, 0, -Math.PI / 2);
  plane(s, 2 * W, 2 * D, ceilM, 0, H, 0, 0, Math.PI / 2);
  plane(s, 2 * D, H, wallM, -W, H / 2, 0, Math.PI / 2);
  plane(s, 2 * W, H, wallM, 0, H / 2, D, Math.PI);
  plane(s, 2.15, H, wallM, -.725, H / 2, -D);
  plane(s, .65, H, wallM, 1.475, H / 2, -D);
  plane(s, .8, .4, wallM, .75, 2.2, -D);
  plane(s, 2.1, H, wallM, W, H / 2, -1.35, -Math.PI / 2);
  plane(s, 1.1, H, wallM, W, H / 2, 1.85, -Math.PI / 2);
  plane(s, 1.6, .8, wallM, W, .4, .5, -Math.PI / 2);
  plane(s, 1.6, .3, wallM, W, 2.25, .5, -Math.PI / 2);
  // 窓の外(明るい朝)とカーテン
  plane(s, 1.6, 1.3, basic(0xeaf5ff), W + .15, 1.45, .5, -Math.PI / 2);
  for(const z of [-.32, 1.32]) box(s, .05, 1.34, .05, metal, W - .02, 1.45, z);
  box(s, .05, .05, 1.64, metal, W - .02, 2.1, .5); box(s, .05, .05, 1.64, metal, W - .02, .8, .5);
  box(s, .06, 1.5, .32, lam(0xa9c4b0), W - .06, 1.4, -.4); box(s, .06, 1.5, .32, lam(0xa9c4b0), W - .06, 1.4, 1.4);
  // 廊下(ドアの向こう)
  plane(s, 2.4, 2.6, floorM, .75, 0, -3.7, 0, -Math.PI / 2);
  plane(s, 2.4, 2.6, ceilM, .75, H, -3.7, 0, Math.PI / 2);
  plane(s, 2.6, H, wallM, -.45, H / 2, -3.7, Math.PI / 2);
  plane(s, 2.6, H, wallM, 1.95, H / 2, -3.7, -Math.PI / 2);
  plane(s, 2.4, H, wallM, .75, H / 2, -5, 0);
  plane(s, 1, 1.2, basic(0xf6fff8), .75, 1.4, -4.98);
  box(s, .9, .03, .4, basic(0xffffff), .75, H - .02, -3.7);
  // ベッド(部屋のベッドと同じ位置)
  const procBed = new T3.Group(); s.add(procBed);
  box(procBed, 1.02, .34, 2.1, metal, -1.28, .17, 1.33);
  box(procBed, 1.02, .85, .05, metal, -1.28, .425, 2.375);
  box(procBed, .97, .18, 2.04, lam(0xe8ecee), -1.28, .43, 1.33);
  box(procBed, .99, .1, 1.45, lam(0x9db7c8), -1.28, .57, .96);
  box(procBed, .55, .1, .32, lam(0xf6f6f2), -1.28, .58, 2.18).rotation.x = .1;
  swapModel(procBed, 'bedSingle', { d: 2.1 }, -1.28, 1.33, Math.PI);
  for(const x of [-.745, -1.775]){ box(s, .03, .03, 1.5, metal, x, .98, 1.2); box(s, .03, .03, 1.5, metal, x, .76, 1.2); for(let i = 0; i < 6; i++) box(s, .025, .38, .025, metal, x, .8, .5 + i * .28); }
  // 点滴スタンド・モニター
  const iv = new T3.Group(); iv.position.set(-.68, 0, .62); s.add(iv);
  cyl(iv, .012, .012, 1.9, metal, 0, .95, 0, 6); box(iv, .5, .025, .03, metal, 0, .03, 0); box(iv, .03, .025, .5, metal, 0, .03, 0); box(iv, .3, .02, .02, metal, 0, 1.88, 0);
  for(const x of [-.13, .13]) box(iv, .1, .17, .028, basic(0xcfe0e0, { transparent: true, opacity: .75 }), x, 1.74, 0);
  tubeBetween(iv, new T3.Vector3(0, 1.64, 0), new T3.Vector3(-.27, .66, .28), .005, basic(0xdfe9e6));
  const procNs = new T3.Group(); s.add(procNs); box(procNs, .4, .5, .38, lam(0xd8d4c8), -.52, .25, 2.17);
  swapModel(procNs, 'sideTable', { h: .5 }, -.52, 2.17, -Math.PI / 2);
  box(s, .36, .28, .16, lam(0x2e3236), -.52, .66, 2.17);
  plane(s, .32, .22, basic(0xffffff, { map: ECG.tex }), -.602, .66, 2.17, -Math.PI / 2);
  // 机と椅子・テレビ・時計・ホワイトボード・掲示・絵・お見舞いの花(部屋の物と同じ位置)
  const procDesk = new T3.Group(); s.add(procDesk);
  box(procDesk, .6, .04, 1.3, wood, 1.5, .73, -1.3); for(const [x, z] of [[1.25, -1.9], [1.25, -.7], [1.75, -1.9], [1.75, -.7]]) box(procDesk, .04, .71, .04, metal, x, .36, z);
  swapModel(procDesk, 'desk', { d: 1.3 }, 1.5, -1.3, Math.PI / 2);
  const procChair = new T3.Group(); s.add(procChair);
  box(procChair, .4, .05, .4, lam(0x5a6a7a), 1.02, .45, -1.35); box(procChair, .04, .4, .4, lam(0x5a6a7a), .83, .7, -1.35); for(const [x, z] of [[.86, -1.52], [.86, -1.18], [1.18, -1.52], [1.18, -1.18]]) box(procChair, .03, .43, .03, metal, x, .22, z);
  swapModel(procChair, 'chairDesk', { h: .95 }, 1.02, -1.35, Math.PI / 2);
  const procTv = new T3.Group(); s.add(procTv);
  box(procTv, 1.0, .4, .45, lam(0x8b6f55), -.45, .2, -2.15); box(procTv, .95, .55, .06, lam(0x16181b), -.45, .78, -2.2);
  swapModel(procTv, 'cabinetTelevision', { w: 1.0 }, -.45, -2.15, 0).then(w => { if(w){ const dm = new T3.Group(); s.add(dm); swapModel(dm, 'televisionModern', { w: .85 }, -.45, -2.18, 0, new T3.Box3().setFromObject(w).max.y); } });
  { const c = cyl(s, .22, .22, .04, lam(0xf2f2ee), -.45, 1.86, -2.37, 24); c.rotation.x = Math.PI / 2; box(s, .02, .16, .01, lam(0x222222), -.45, 1.9, -2.34); box(s, .12, .02, .01, lam(0x222222), -.4, 1.86, -2.34); }
  box(s, .55, .75, .03, lam(0xf8f8f6), -1.3, 1.45, -2.38); for(let i = 0; i < 4; i++) box(s, .4, .012, .01, lam(0x445566), -1.3, 1.65 - i * .14, -2.36);
  box(s, .03, .8, .6, lam(0xf4f4f0), -1.78, 1.5, .85); box(s, .035, .14, .6, lam(0x6a9ac0), -1.78, 1.84, .85);
  box(s, .6, .4, .03, lam(0xb6cfc4), -1.28, 1.72, 2.37);
  const procFl = new T3.Group(); s.add(procFl);
  box(procFl, .5, .5, .5, lam(0xd8d4c8), 1.55, .25, 2.1); cyl(procFl, .06, .05, .25, lam(0xd8e4ea), 1.55, .63, 2.1, 8);
  for(const [x, y, z, c] of [[1.55, .84, 2.1, 0xf0a0b8], [1.5, .8, 2.06, 0xf6e27a], [1.6, .8, 2.14, 0xffffff], [1.52, .88, 2.14, 0xf0a0b8]]){ const f = new T3.Mesh(new T3.SphereGeometry(.05, 8, 6), lam(c)); f.position.set(x, y, z); procFl.add(f); }
  swapModel(procFl, 'pottedPlant', { h: .95 }, 1.55, 2.1, 0);
  // 光
  s.add(new T3.AmbientLight(0x9aa6a0, .7));
  box(s, 1.2, .03, .5, basic(0xffffff), 0, H - .02, -.2);
  const pl = new T3.PointLight(0xf4fff8, .55, 9, 1.2); pl.position.set(0, 2.15, -.2); s.add(pl);
  const cp = new T3.PointLight(0xeafff0, .7, 5); cp.position.set(.75, 2.2, -3.7); s.add(cp);
  const sun = new T3.DirectionalLight(0xfff0d8, .4); sun.position.set(6, 3, .5); s.add(sun);
  // 人(黒い人が立っていた場所に、先生・看護師・お見舞いの人がいる)
  const nurse = { top: 0xf2e4e8, bottom: 0xeeeeec, coat: 0xf4f4f2, hair: 0x2a2220, h: 1.62, cap: true, slim: .74 };
  const at = (o, x, z, tx, tz) => { const g = makePerson(o); g.position.set(x, 0, z); g.lookAt(tx, 0, tz); s.add(g); return g; };
  WD.nurseCorner = at(Object.assign({}, nurse, { hair: 0x3a2c24 }), -1.42, -1.55, BED_EYE.x, BED_EYE.z);
  WD.doctor = at({ top: 0xdedede, bottom: 0x3a3d44, coat: 0xe6e6e2, hair: 0x232323, h: 1.76 }, .75, -3.0, BED_EYE.x, BED_EYE.z);
  WD.nurseBed = at(nurse, -.45, .85, BED_EYE.x, BED_EYE.z); WD.nurseBed.userData.head.rotation.x = .3;
  { const sg = new T3.Group(); sg.position.set(.24, 1.0, .2); sg.rotation.x = .5; WD.nurseBed.add(sg);
    const sx = (m, r, len, z) => { const c = cyl(sg, r, r, len, m, 0, 0, z, 8); c.rotation.x = Math.PI / 2; return c; };
    sx(basic(0xe4ecee), .02, .17, 0); sx(basic(0x9fe0d0), .014, .13, 0); sx(basic(0xd8dcde), .004, .12, .14); }
  WD.mom = at({ top: 0x6e5d63, bottom: 0x3b3438, hair: 0x2a2220, h: 1.58 }, -.38, 1.3, BED_EYE.x, BED_EYE.z); WD.mom.userData.head.rotation.x = .3;
  WD.dad = at({ top: 0x3d4450, bottom: 0x2b2e33, hair: 0x353535, h: 1.72 }, -.58, 1.75, BED_EYE.x, BED_EYE.z); WD.dad.userData.head.rotation.x = .3;
  CRISP_BUILD = false;
})();

/* ============================================================
   TOWN(退院して、病院を出ると広がる、陽光きらめく街並み。クリア後のタイトルの背景にもなる)
   ============================================================ */
const town = new T3.Scene(); town.fog = new T3.Fog(0xa9d3f4, 60, 145);
const TW = { sparks: [], doors: [], open: 0 };
(function buildTown(){
  CRISP_BUILD = true;
  const s = town, r = rng(21), GLOW = glowTex();
  // 空と太陽
  { const c = cv(8, 256), g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#2a78d6'); gr.addColorStop(.25, '#3f8fe4'); gr.addColorStop(.42, '#6fb4f0'); gr.addColorStop(.5, '#b5dcf8'); gr.addColorStop(1, '#b5dcf8');
    g.fillStyle = gr; g.fillRect(0, 0, 8, 256);
    const t = new T3.CanvasTexture(c); t.minFilter = t.magFilter = T3.LinearFilter;
    s.add(new T3.Mesh(new T3.SphereGeometry(125, 20, 14), new T3.MeshBasicMaterial({ map: t, side: T3.BackSide, fog: false }))); }
  const sunM = new T3.SpriteMaterial({ map: GLOW, color: 0xfff1b8, blending: T3.AdditiveBlending, transparent: true, depthWrite: false, fog: false });
  const sun = new T3.Sprite(sunM); sun.position.set(-30, 34, -95); sun.scale.set(42, 42, 1); s.add(sun);
  const sunC = new T3.Sprite(new T3.SpriteMaterial({ map: GLOW, color: 0xffffff, blending: T3.AdditiveBlending, transparent: true, depthWrite: false, fog: false })); sunC.position.copy(sun.position); sunC.scale.set(11, 11, 1); s.add(sunC);
  // 地面・道・川・橋
  plane(s, 140, 280, lam(0xaaa391), 0, 0, -120, 0, -Math.PI / 2);
  plane(s, 7, 160, lam(0xb8b09c), 0, .03, -60, 0, -Math.PI / 2);
  for(const x of [-6.5, 6.5]) plane(s, 5, 160, lam(0x8cc07a), x, .03, -60, 0, -Math.PI / 2);
  for(const zr of [-18, -62, -98]){ plane(s, 140, 9, lam(0x6d7078), 0, .06, zr, 0, -Math.PI / 2); for(let i = -4; i <= 4; i++) box(s, .5, .02, 3.2, lam(0xf4f4f0), i * .9, .09, zr); }   // 横断歩道のある交差点が、奥へ続く
  // 街並み(窓が陽光を反射する)
  const winT = (() => { const c = cv(64, 96), g = c.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 96);
    for(let y = 0; y < 8; y++) for(let x = 0; x < 4; x++){ g.fillStyle = r() < .22 ? '#fff1b8' : '#9ec9ea'; g.fillRect(x * 16 + 3, y * 12 + 3, 10, 7); }
    const t = new T3.CanvasTexture(c); t.wrapS = t.wrapT = T3.RepeatWrapping; t.minFilter = T3.LinearMipmapLinearFilter; t.magFilter = T3.LinearFilter; return t; })();
  const pastel = [0xf3d9c4, 0xdbe6c8, 0xc9dcee, 0xf1e4b6, 0xe9c9d3, 0xd5d0e8, 0xf6f0e4];
  const procBld = new T3.Group(), slots = []; s.add(procBld);
  const bld = (x, z, w, h, d, c, far) => { const t = winT.clone(); t.needsUpdate = true; t.repeat.set(Math.max(1, w / 4), Math.max(1, h / 4.5)); box(procBld, w, h, d, lam(c, { map: t }), x, h / 2, z); slots.push({ x, z, w, h, far }); };
  for(const side of [-1, 1]) for(let z = 8; z > -128; z -= 7.6) bld(side * (10.5 + r() * 1.5), z - r() * .6, 5.2 + r() * 1.3, 7 + r() * 13, 6.5, pastel[(r() * pastel.length) | 0], false);
  {   // フリー素材のビルに差し替え(通り沿いは低めのビル、遠くの街並みは高層ビル)
    const near = 'abcdefghijklmn'.split('').map(k => 'building-' + k).concat('abcde'.split('').map(k => 'building-skyscraper-' + k)), far = near;
    Promise.all(slots.map((sl, i) => loadModel(sl.far ? far[i % far.length] : near[i % near.length]))).then(list => {
      if(list.some(o => !o)) return;
      const g = new T3.Group(); town.add(g);
      list.forEach((o, i) => { const sl = slots[i], w = fitModel(o, { w: sl.w }); w.scale.y = 1.5 + (i % 5) * .35; w.position.set(sl.x, 0, sl.z); w.rotation.y = sl.far ? 0 : (sl.x < 0 ? Math.PI / 2 : -Math.PI / 2); g.add(w); });
      procBld.visible = false;
    });
  }
  // 並木・街灯
  const procTrees = new T3.Group(), treeSpots = []; s.add(procTrees);
  for(let z = -3; z > -122; z -= 5) for(const side of [-1, 1]){
    const bloom = false, tg = procTrees;   // ピンクの桜は図形のまま。ほかの木はモデルに差し替え
    cyl(tg, .15, .2, 2.2, lam(0x7a5a3c), side * 4.6, 1.1, z, 6);
    const crown = new T3.Mesh(new T3.SphereGeometry(1.4, 10, 8), lam(bloom ? 0xf6b8cc : 0x66b95c)); crown.position.set(side * 4.6, 3.1, z); tg.add(crown);
    if(!bloom) treeSpots.push([side * 4.6, z]);
    cyl(s, .05, .06, 3.4, lam(0x5a5f66), side * 3.3, 1.7, z - 2.5, 6);
  }
  {
    const kinds = ['tree_default', 'tree_oak', 'tree_fat', 'tree_detailed'];
    Promise.all(treeSpots.map((_, i) => loadModel(kinds[i % kinds.length]))).then(list => {
      if(list.some(o => !o)) return;
      list.forEach((o, i) => { const w = fitModel(o, { h: 4.6 + (i % 3) * .5 }); w.position.set(treeSpots[i][0], 0, treeSpots[i][1]); w.rotation.y = i * 1.7; town.add(w); });
      procTrees.visible = false;
    });
    // 芝生に、花と低木
    const fl = ['flower_redA', 'flower_yellowA', 'flower_purpleA', 'plant_bush'];
    Promise.all(Array.from({ length: 44 }, (_, i) => loadModel(fl[i % fl.length]))).then(list => {
      if(list.some(o => !o)) return;
      list.forEach((o, i) => { const w = fitModel(o, { h: i % 4 === 3 ? .9 : .5 }); w.position.set((i % 2 ? 1 : -1) * (5.4 + r() * 2.4), 0, -1 - r() * 115); town.add(w); });
    });
  }
  // 病院の入口(カメラの後ろ: ロビー → ガラスの自動ドア → 車寄せ)
  const lw = lam(0x9aa6a2);
  plane(s, 9, 9, lam(0xcfcfc6), 0, .06, 6, 0, -Math.PI / 2);
  plane(s, 9, 9, lam(0xdfe3e0), 0, 3.4, 6, 0, Math.PI / 2);
  plane(s, 9, 3.4, lw, -4.5, 1.7, 6, Math.PI / 2); plane(s, 9, 3.4, lw, 4.5, 1.7, 6, -Math.PI / 2);
  plane(s, 2.9, 3.4, lw, -3.05, 1.7, 1.5, 0); plane(s, 2.9, 3.4, lw, 3.05, 1.7, 1.5, 0); plane(s, 3.2, .8, lw, 0, 3.0, 1.5, 0);
  box(s, .12, 2.6, .12, lam(0xc9ced0), -1.6, 1.3, 1.5); box(s, .12, 2.6, .12, lam(0xc9ced0), 1.6, 1.3, 1.5);
  const glass = basic(0xcfe9f5, { transparent: true, opacity: .32, side: T3.DoubleSide, depthWrite: false });
  for(const x of [-.8, .8]){ const g = new T3.Group(); g.position.set(x, 1.3, 1.45); g.add(new T3.Mesh(new T3.PlaneGeometry(1.6, 2.6), glass)); box(g, 1.6, .06, .05, lam(0xc9ced0), 0, 1.27, 0); TW.doors.push(g); s.add(g); }
  box(s, 10, .25, 5, lam(0xf2f2ee), 0, 3.5, -1.0); for(const x of [-4.3, 4.3]) cyl(s, .18, .18, 3.5, lam(0xe8e8e2), x, 1.75, -3, 10);
  box(s, 2.4, .5, .5, lam(0x8b6f55), -3, .25, 8); box(s, .8, 1.2, .8, lam(0x5a8a5a), 3.2, .6, 8.5);
  // 光(日なた)
  s.add(new T3.AmbientLight(0xdfe9ff, .72));
  const dl = new T3.DirectionalLight(0xfff0cc, .62); dl.position.set(12, 30, 30); s.add(dl);
  // きらめき(空気中の光の粒と、川面の反射)
  for(let i = 0; i < 150; i++){
    const m = new T3.SpriteMaterial({ map: GLOW, color: 0xfff2c0, blending: T3.AdditiveBlending, transparent: true, depthWrite: false, fog: false, opacity: 0 });
    const sp = new T3.Sprite(m), water = false;
    sp.position.set(water ? (r() - .5) * 40 : (r() - .5) * 26, water ? -.3 : .6 + r() * 9, -4 - r() * 115);
    const sz = .25 + r() * .6; sp.scale.set(sz, sz, 1); s.add(sp);
    TW.sparks.push({ m, ph: r() * 6.28, sp: .8 + r() * 1.8, k: water ? .95 : .65 });
  }
  CRISP_BUILD = false;
})();

/* ============================================================
   RAILWAY CROSSING
   ============================================================ */
const cross = new T3.Scene(); cross.background = new T3.Color(0x06070b); cross.fog = new T3.Fog(0x06070b, 6, 55);
const CR = { lamps: [], reds: [] };
(function buildCrossing(){
  const s = cross;
  plane(s, 120, 120, lam(0x1f2023), 0, 0, 0, 0, -Math.PI / 2);
  plane(s, 6, 120, lam(0x2b2c2f), 0, .01, 0, 0, -Math.PI / 2);
  for(const x of [-2.9, 2.9]) box(s, .1, .01, 120, basic(0x8a8a86), x, .02, 0);
  plane(s, 160, 3.4, lam(0x3b3834), 0, .015, -6, 0, -Math.PI / 2);
  for(let x = -80; x < 80; x += .6){ if(Math.abs(x) > 3.2) box(s, .2, .07, 2.1, lam(0x3b342d), x, .05, -6); }
  for(const z of [-5.47, -6.53]) box(s, 160, .12, .07, lam(0x8a8d90), 0, .12, z);
  box(s, 6.4, .1, 2.6, lam(0x333335), 0, .06, -6);
  const stripeV = texStripe('#d8b520', '#151515', 10); stripeV.repeat.set(1, 3);
  const stripeD = texDiag('#e0c020', '#151515'); stripeD.repeat.set(4, 1);
  for(const side of [-1, 1]){
    const px = 3.4 * side, pz = -4.3;
    cyl(s, .07, .07, 3.3, lam(0xffffff, { map: stripeV }), px, 1.65, pz, 8);
    for(const a of [1, -1]){ const c = box(s, 1.05, .14, .03, lam(0xd8b520), px, 3.05, pz + .05); c.rotation.z = Math.PI / 4 * a; }
    box(s, .95, .26, .1, lam(0x111111), px, 2.45, pz + .05);
    for(const lx of [-.28, .28]){
      const m = basic(0x2a0606);
      const lamp = new T3.Mesh(new T3.CircleGeometry(.11, 10), m); lamp.position.set(px + lx, 2.45, pz + .11); s.add(lamp);
      CR.lamps.push(m);
    }
    const bar = box(s, 3.0, .07, .07, lam(0xffffff, { map: stripeD }), px - side * 1.55, 1.0, pz + .18);
    const red = new T3.PointLight(0xff2010, 0, 6, 1.5); red.position.set(px, 2.4, pz + .6); s.add(red); CR.reds.push(red);
  }
  // streetlight
  cyl(s, .06, .08, 5, lam(0x555555), 4.6, 2.5, -1, 6);
  box(s, .8, .06, .15, lam(0x555555), 4.25, 5, -1);
  box(s, .3, .05, .15, basic(0xffe0b0), 3.95, 4.96, -1);
  const sl = new T3.PointLight(0xffd8a0, 1.1, 16, 1.4); sl.position.set(3.95, 4.7, -1); s.add(sl);
  // houses
  const hr = rng(31);
  for(let i = 0; i < 26; i++){
    const side = i % 2 ? 1 : -1, x = side * (7 + hr() * 14), z = -30 + i * 2.6 + hr() * 2;
    if(Math.abs(z + 6) < 3) continue;
    const w = 4 + hr() * 4, h = 3 + hr() * 4, d = 4 + hr() * 3;
    box(s, w, h, d, lam([0x3a3836, 0x45423e, 0x2f3032, 0x4a4640][i % 4]), x, h / 2, z);
    if(hr() < .5) plane(s, .6, .5, basic(0xd8b070), x - side * (w / 2 + .01), h * .6, z, side > 0 ? -Math.PI / 2 : Math.PI / 2);
  }
  // fence along the tracks
  for(const z of [-4.2, -7.8]) for(const side of [-1, 1]) box(s, 30, .9, .04, lam(0x4a4d50), side * 19, .45, z);
  // train
  CR.train = new T3.Group(); CR.train.position.set(-160, 0, -6); s.add(CR.train);
  box(CR.train, 20, 3.1, 2.8, lam(0xa0a4a8), 0, 2.0, 0);
  box(CR.train, 20.02, .5, 2.82, lam(0x2f6a3a), 0, 1.0, 0);
  box(CR.train, 18, .6, 2.84, lam(0x1a1c20), 0, 2.4, 0);
  box(CR.train, .05, .7, 2.0, lam(0x15171a), 10.01, 2.6, 0);
  for(const z of [-.8, .8]){ const hl = new T3.Mesh(new T3.CircleGeometry(.14, 10), basic(0xfffbe0)); hl.position.set(10.03, 1.25, z); hl.rotation.y = Math.PI / 2; CR.train.add(hl); }
  CR.head = new T3.PointLight(0xfff4d0, 0, 45, 1.2); CR.head.position.set(11, 1.4, 0); CR.train.add(CR.head);
  s.add(new T3.AmbientLight(0x2a2e38, .7));
  const mn = new T3.DirectionalLight(0x6a7aa0, .25); mn.position.set(-3, 6, 4); s.add(mn);
})();

/* ============================================================
   PLAYER ARMS (一人称の腕)
   カメラ空間に固定。部屋とは別シーンで最後に重ねて描く(壁に埋まらない)。
   ============================================================ */
const armScene = new T3.Scene();
const armRoot = new T3.Group(); armScene.add(armRoot);
const armAmb = new T3.AmbientLight(0x6b6470, .9); armScene.add(armAmb);
const armLamp = new T3.PointLight(0xffc790, .3, 4, 1.4); armLamp.position.set(0, .35, .1); armRoot.add(armLamp);
const ARM = { hit: 0, on: true, reach: 0, tool: null, fl: 0, tf: null, scr: null, arms: [], phone: null, hammer: null, stand: 0, speed: 0, ph: 0, t: null, last: null };
(function buildArms(){
  // 肌のテクスチャ(うっすらムラとキメ)
  const c = cv(32, 32), g = c.getContext('2d'), r = rng(12);
  g.fillStyle = '#d6aa88'; g.fillRect(0, 0, 32, 32);
  for(let i = 0; i < 300; i++){ g.fillStyle = r() < .5 ? 'rgba(150,90,60,.04)' : 'rgba(255,232,214,.04)'; g.fillRect(r() * 32 | 0, r() * 32 | 0, 1, 1); }
  const skinTex = ctex(c); skinTex.wrapS = skinTex.wrapT = T3.RepeatWrapping;
  const skin = lam(0xffffff, { map: skinTex, emissive: 0x1c110b });
  const nail = lam(0xf0d2c8, { emissive: 0x2a1c18 });
  const cloth = lam(0x8b92a0, { emissive: 0x15171c, side: T3.DoubleSide });
  const cuffM = lam(0x6e7482, { emissive: 0x101216, side: T3.DoubleSide });
  const dark = lam(0x2a2d34);

  // 先端が -z を向く円錐台(根元が原点)
  const seg = (len, r1, r2) => { const gm = new T3.CylinderGeometry(r2, r1, len, 9); gm.rotateX(-Math.PI / 2); gm.translate(0, 0, -len / 2); return gm; };
  function finger(len, r0, nails = true){
    const root = new T3.Group(), joints = [], L = [len * .46, len * .30, len * .24];
    let parent = root;
    L.forEach((l, i) => {
      const ra = r0 * (1 - i * .09), rb = r0 * (1 - (i + 1) * .09);
      const jg = new T3.Group(); if(i > 0) jg.position.z = -L[i - 1];
      parent.add(jg);
      jg.add(new T3.Mesh(seg(l, ra, rb), skin));
      jg.add(new T3.Mesh(new T3.SphereGeometry(ra * 1.03, 8, 6), skin));
      joints.push(jg); parent = jg;
    });
    const last = joints[2], rt_ = r0 * (1 - 3 * .09);
    const tip = new T3.Mesh(new T3.SphereGeometry(rt_ * 1.05, 8, 6), skin); tip.position.z = -L[2]; last.add(tip);
    if(nails){ const n = box(last, r0 * 1.15, .0018, L[2] * .7, nail, 0, rt_ * 1.0 + .0022, -L[2] * .62); n.rotation.x = .08; }
    return { root, joints };
  }
  function makeArm(s){
    const arm = new T3.Group(); arm.rotation.order = 'YXZ';
    // 前腕(手首が z=0、ひじ側が +z)
    const fg = new T3.CylinderGeometry(.043, .027, .42, 10); fg.rotateX(Math.PI / 2); fg.translate(0, 0, .21);
    const fa = new T3.Mesh(fg, skin); fa.scale.set(1.06, .92, 1); arm.add(fa);
    // 手首の骨のふくらみ
    const ul = new T3.Mesh(new T3.SphereGeometry(.014, 8, 6), skin); ul.position.set(s * .02, .008, .035); arm.add(ul);
    // 長そでパジャマ
    const sg = new T3.CylinderGeometry(.066, .052, .34, 12, 1, true); sg.rotateX(Math.PI / 2); sg.translate(0, 0, .12 + .17);
    arm.add(new T3.Mesh(sg, cloth));
    const cg = new T3.CylinderGeometry(.054, .054, .03, 12, 1, true); cg.rotateX(Math.PI / 2); cg.translate(0, 0, .125);
    arm.add(new T3.Mesh(cg, cuffM));
    const ig = new T3.CylinderGeometry(.051, .051, .09, 12, 1, true); ig.rotateX(Math.PI / 2); ig.translate(0, 0, .17);
    const inner = new T3.Mesh(ig, dark); inner.material = new T3.MeshBasicMaterial({ color: 0x1a1c22, side: T3.BackSide }); arm.add(inner);
    // 手首・手のひら
    const wr = new T3.Mesh(new T3.SphereGeometry(.03, 10, 8), skin); wr.scale.set(1.05, .78, 1.1); wr.position.z = -.005; arm.add(wr);
    const palm = new T3.Mesh(new T3.SphereGeometry(1, 12, 9), skin); palm.scale.set(.043, .0185, .056); palm.position.set(0, -.002, -.052); arm.add(palm);
    const heel = new T3.Mesh(new T3.SphereGeometry(.026, 8, 6), skin); heel.scale.set(1.2, .7, 1); heel.position.set(s * .006, -.008, -.03); arm.add(heel);
    // 手の甲のすじ(腱)
    for(let i = 0; i < 4; i++){
      const x = -s * (.03 - i * .02), t = box(arm, .006, .003, .07, skin, x, .017, -.065); t.rotation.y = -s * (.07 - i * .035) * 0;
    }
    // 指(人差し→小指)。親指側は x = -s
    const spec = [
      { x: -s * .031, z: -.097, len: .078, r: .0088, splay: s * .08, curl: 1 },
      { x: -s * .010, z: -.101, len: .088, r: .0092, splay: s * .015, curl: 1.05 },
      { x: s * .011, z: -.097, len: .081, r: .0088, splay: -s * .04, curl: 1.1 },
      { x: s * .030, z: -.088, len: .064, r: .0076, splay: -s * .10, curl: 1.15 }
    ];
    const fingers = spec.map(f => {
      const fi = finger(f.len, f.r); fi.root.position.set(f.x, -.002, f.z); fi.root.rotation.y = f.splay; arm.add(fi.root);
      const kn = new T3.Mesh(new T3.SphereGeometry(f.r * 1.15, 8, 6), skin); kn.position.set(f.x, .004, f.z + .006); arm.add(kn);
      return Object.assign(fi, { curl: f.curl });
    });
    // 親指
    const th = new T3.Group(); th.position.set(-s * .034, -.007, -.03); th.rotation.set(-.12, s * .55, -s * .45); arm.add(th);
    const t1 = new T3.Group(), t2 = new T3.Group(); th.add(t1); t1.add(new T3.Mesh(seg(.045, .0115, .0102), skin)); t1.add(new T3.Mesh(new T3.SphereGeometry(.0118, 8, 6), skin));
    t2.position.z = -.045; t1.add(t2); t2.add(new T3.Mesh(seg(.036, .0102, .0092), skin));
    const tt = new T3.Mesh(new T3.SphereGeometry(.0096, 8, 6), skin); tt.position.z = -.036; t2.add(tt);
    const tn = box(t2, .011, .002, .02, nail, 0, .0098, -.026);
    const thenar = new T3.Mesh(new T3.SphereGeometry(.022, 8, 6), skin); thenar.scale.set(1, .8, 1.5); thenar.position.set(-s * .024, -.005, -.04); arm.add(thenar);
    // 持ち物の置き場(手のひら側 = -y)
    const hold = new T3.Group(); hold.position.set(0, -.016, -.07); arm.add(hold);
    return { group: arm, fingers, thumb: [t1, t2], hold, side: s };
  }
  const L_ = makeArm(-1), R_ = makeArm(1);
  armRoot.add(L_.group, R_.group);
  ARM.arms = [L_, R_];
  {   // 左手の甲の点滴(テープとチューブ)
    R.ivArm = new T3.Group(); R.ivArm.visible = false; L_.group.add(R.ivArm);
    const tube = basic(0xdfe9e6);
    box(R.ivArm, .075, .012, .06, basic(0xfafaf6), 0, .052, .07);
    tubeBetween(R.ivArm, new T3.Vector3(.0, .058, .07), new T3.Vector3(.02, .1, .17), .006, tube);
    tubeBetween(R.ivArm, new T3.Vector3(.02, .1, .17), new T3.Vector3(.05, .22, .75), .006, tube);
  }
  // スマホ(画面が手のひらの反対=カメラ側を向く)
  const phone = new T3.Group();
  box(phone, .072, .0095, .15, lam(0x15161a), 0, -.0055, 0);
  const scr = plane(phone, .064, .136, basic(0x56687c), 0, -.0108, 0, 0, Math.PI / 2); scr.rotation.x = Math.PI / 2; ARM.scr = scr;
  phone.position.set(0, -.034, -.03); phone.visible = false; R_.hold.add(phone); ARM.phone = phone;
  // ハンマー(握り込む)
  const ham = new T3.Group(); ham.visible = false;
  const hg = new T3.CylinderGeometry(.0145, .0125, .3, 8); const handle = new T3.Mesh(hg, lam(0x9a6a3c)); handle.position.y = .09; ham.add(handle);
  box(ham, .034, .042, .11, lam(0x4d5157, { emissive: 0x16181a }), 0, .25, -.01);
  box(ham, .03, .02, .03, lam(0x4d5157), 0, .25, .065);
  ham.rotation.z = Math.PI / 2; ham.position.set(0, -.03, -.01); R_.hold.add(ham); ARM.hammer = ham;
})();

function armUpdate(t){
  // ライト:スマホを手に取って持ち上げる(約0.4秒)→ 持ち上がったところで点灯。消す時は点灯を止めてから手を下ろす
  const dtF = ARM.tf === null ? 0 : Math.min(.1, t - ARM.tf); ARM.tf = t;
  const wantF = S.flash && S.scene === 'room' ? 1 : 0;
  ARM.fl = clamp(ARM.fl + (wantF ? dtF / .45 : -dtF / .3) * (wantF ? 1 : (ARM.fl > 0 ? 1 : 0)), 0, 1);
  S.flashK = wantF ? clamp((ARM.fl - .8) / .2, 0, 1) : 0;
  // 机の上のスマホを手に取った間は、机から消す(消えるのは「なくなっていた」異変の時と同じ扱い)
  const inHand = wantF ? ARM.fl >= .45 : ARM.fl > .05;   // 机から手に取った後は、手の中に出る
  if(inHand && R.phoneGroup.visible){ R.phoneGroup.visible = false; ARM.deskHid = true; }
  else if(!inHand && !wantF && ARM.fl <= 0 && ARM.deskHid){ ARM.deskHid = false; if(!S.active.has('phoneGone')) R.phoneGroup.visible = true; }
  const show = ARM.on && S.scene === 'room' && V.fov > 50 && !$('phone').classList.contains('on');
  armRoot.visible = show;
  if(!show) return false;
  armRoot.position.copy(camera.position); armRoot.quaternion.copy(camera.quaternion);
  armAmb.color.copy(L.amb.color); armAmb.intensity = L.amb.intensity * 1.15 + (S.dark ? .12 : .3);
  armLamp.color.copy(L.ceil.color); armLamp.intensity = S.day ? .2 : .3;
  const xk = clamp(.10 + .12 * camera.aspect, .17, .42);
  const sway = Math.sin(t * 1.1) * .004;
  const sm_ = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  let r = ARM.reach, tool = ARM.tool, fm = false, dP = null, dR = null;
  if(!(tool && r > 0) && ARM.fl > 0){ tool = 'phone'; fm = true; r = sm_(ARM.fl); }   // ライト用の持ち上げ(他の道具が優先)
  if(fm && wantF){   // 手に取る前の姿勢:視界の右下へ手を下ろして伸ばす(机は視界の外にあることが多い)
    dP = [.34, -.37, -.38]; dR = [.55, .22, 0];
  }
  // 立っているか(ベッドから離れた/目線が高い) → 腕を体の横に下ろす
  const dtA = ARM.t === null ? 0 : Math.min(.1, t - ARM.t); ARM.t = t;
  const standing = V.pos.y > 1.35 || Math.hypot(V.pos.x - BED_EYE.x, V.pos.z - BED_EYE.z) > .9;
  if(dtA > .0005){
    ARM.stand += ((standing ? 1 : 0) - ARM.stand) * Math.min(1, dtA * 3.5);
    const mv = ARM.last ? Math.hypot(V.pos.x - ARM.last.x, V.pos.z - ARM.last.z) / dtA : 0;
    ARM.speed += (clamp(mv, 0, 2.5) - ARM.speed) * Math.min(1, dtA * 6);
    ARM.ph += dtA * ARM.speed * 4.2;
  }
  ARM.last = V.pos.clone();
  const phi = clamp(-V.pitch, -.3, 1.45);               // 下を向くほど、体の横の手が視界に入る
  const cp = Math.cos(phi), sp_ = Math.sin(phi);
  for(const a of ARM.arms){
    const s = a.side, g = a.group;
    let pos = [s * xk, -.275, -.52], rot = [.22, s * .16, -s * .10], curl = .55;
    if(ARM.stand > .001){
      const swing = Math.sin(ARM.ph + (s > 0 ? 0 : Math.PI)) * Math.min(1, ARM.speed / 1.2);
      const by = -.66, bz = -.10 + swing * .08, bx = s * .25;       // 体の横(ヨー基準)
      const sp = [bx, by * cp - bz * sp_, by * sp_ + bz * cp];       // ピッチぶん回してカメラ空間へ
      const sr = [-1.42 + phi + swing * .35, s * .04, s * .06];
      const w = ARM.stand;
      pos = pos.map((v, i) => v + (sp[i] - v) * w); rot = rot.map((v, i) => v + (sr[i] - v) * w); curl += (.42 - curl) * w;
    }
    const hand = s === 1 && tool && r > 0;
    if(hand){
      let tp, tr, tc;
      if(tool === 'phone'){ tp = [.14, -.15 + .03 * (1 - r), -.40]; tr = [.95, .38, Math.PI]; tc = .3; }   // 指は軽く曲げるだけ(深く曲げると画面を突き抜ける)
      else if(tool === 'hit'){ const h = ARM.hit; tp = [.10, -.04 - .16 * h, -.42 - .20 * h]; tr = [.95 - .75 * h, -.25, -.4 * (1 - h)]; tc = 1.0; }
      else { tp = [.03, -.19, -.40]; tr = [.35, -.12, -1.5]; tc = 1.25; }
      let w = r;
      if(fm && wantF && dP){   // 伸ばす(前半)→ 手前に持ち上げる(後半)
        if(ARM.fl < .45){ tp = dP; tr = dR; tc = .3; w = sm_(ARM.fl / .45); }
        else { pos = dP.slice(); rot = dR.slice(); curl = .3; w = sm_((ARM.fl - .45) / .55); }
      }
      pos = pos.map((v, i) => v + (tp[i] - v) * w); rot = rot.map((v, i) => v + (tr[i] - v) * w); curl += (tc - curl) * w;
    }
    g.position.set(pos[0], pos[1] + sway, pos[2]); g.rotation.set(rot[0], rot[1], rot[2]);
    const idle = hand ? 0 : Math.sin(t * .8 + s) * .03;
    a.fingers.forEach((f, i) => {
      const c = (curl + idle + i * .04) * f.curl;
      f.joints[0].rotation.x = -c * .85; f.joints[1].rotation.x = -c * 1.1; f.joints[2].rotation.x = -c * .7;
    });
    a.thumb[0].rotation.x = -curl * .25 - .05; a.thumb[1].rotation.x = -curl * .45;
  }
  ARM.phone.visible = tool === 'phone' && r > .05 && !(fm && wantF && ARM.fl < .45);
  ARM.scr.material.color.setHex(S.flashK > .5 ? 0xe8eef8 : 0x56687c);
  ARM.hammer.visible = tool === 'hammer' && r > .05;
  return true;
}

/* ============================================================
   view / input
   ============================================================ */
const V = { yaw: 0, pitch: -.05, roll: 0, pos: BED_EYE.clone(), fov: 70, tfov: 70, shake: 0, breathe: 0, free: false };
const NIGHTS = 3;
// 3夜に凝縮:散らかり・難しさ・黒い人の速さなどは「元の5夜構成」の第1・3・5夜の段階を使う
const stage = () => [1, 3, 5][S.night - 1] || 5;
const TRUE_END_ENABLED = true;    // 真エンディング(黒い人=眠りへの誘い)。ミスなしで全3夜を抜けた人だけ
const S = {
  seen: new Set(), seenNow: new Set(), mistakes: 0, trueEnd: false, night: 1, mode: 'title', scene: 'room', look: false, hour: 1, seq: [], idx: 0, used: new Set(),
  isDream: false, active: new Set(), day: false, roundStart: 0, clockBase: 3600, lastSec: null,
  ticking: false, firstHint: true, humLevel: .14, beeping: false, death: null
};
let dragging = false, lx = 0, ly = 0;
glc.addEventListener('contextmenu', e => e.preventDefault());   // 右クリックで視点移動(マウスは右ボタンだけ。左クリックでは動かない)
glc.addEventListener('pointerdown', e => { if(!S.look || PAUSED) return; if(e.pointerType === 'mouse' && e.button !== 2) return; dragging = true; lx = e.clientX; ly = e.clientY; try{ glc.setPointerCapture(e.pointerId); }catch(_){} glc.classList.add('drag'); });
glc.addEventListener('pointermove', e => {
  if(!dragging) return;
  const k = .0042 * (V.fov / 70);
  V.yaw -= (e.clientX - lx) * k; V.pitch = clamp(V.pitch - (e.clientY - ly) * k, -1.45, 1.45);
  lx = e.clientX; ly = e.clientY;
});
const endDrag = () => { dragging = false; glc.classList.remove('drag'); };
glc.addEventListener('pointerup', endDrag); glc.addEventListener('pointercancel', endDrag);
glc.addEventListener('wheel', e => { if(!S.look) return; e.preventDefault(); V.tfov = clamp(V.tfov + e.deltaY * .03, 20, 70); $('bZoom').classList.toggle('act', V.tfov < 60); }, { passive: false });
const keys = {};
addEventListener('keydown', e => { if(e.target.closest && e.target.closest('input')) return; keys[e.key.toLowerCase()] = true; });
addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
$('bLight').onclick = () => { S.flash = !S.flash; $('bLight').classList.toggle('act', S.flash); $('bLight').textContent = S.flash ? 'ライト ON' : 'ライト'; };
$('bZoom').onclick = () => { V.tfov = V.tfov < 60 ? 70 : 30; $('bZoom').classList.toggle('act', V.tfov < 60); };
$('bSound').onclick = () => { A.muted = !A.muted; setVolume(A.vol); $('bSound').textContent = A.muted ? '音 OFF' : '音 ON'; };
function aimAt(p, from = V.pos){
  const dx = p.x - from.x, dy = p.y - from.y, dz = p.z - from.z;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}
function lookTo(yaw, pitch, ms){
  const y0 = V.yaw, p0 = V.pitch; let dy = yaw - y0; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  return tween(ms, e => { V.yaw = y0 + dy * e; V.pitch = p0 + (pitch - p0) * e; });
}
function moveTo(p, ms){ const a = V.pos.clone(); return tween(ms, e => { V.pos.lerpVectors(a, p, e); }); }

/* ============================================================
   anomalies
   ============================================================ */
const AT = {
  dclock: [-.38, .56, 2.27], pills: [-.36, .55, 2.1], poster: [-1.8, 1.5, .85], jacket: [1.55, 1.45, -2.4], memo: [1.36, .78, -.9],
  clock: [-.45, 1.86, -2.4], cal: [-1.3, 1.45, -2.4], win: [1.8, 1.45, .5], desk: [1.1, .7, -1.3], door: [.75, 1.1, -2.4],
  pic: [-1.28, 1.72, 2.38], books: [1, 1, 2.25], mug: [1.4, .85, -1.1], tv: [-.45, .76, -2.2], phone: [-.5, .53, 2.09], plant: [1.56, 1.1, 2.12]
};
const ANOM = [
  // --- d1: すぐわかる
  { id: 'windowInvert', d: 1, at: AT.win, name: '窓の外の景色の色が、反転していた', on(){ R.backdropMat.map = TX.cityInv; } },
  { id: 'shadowMan', role: 'nurse', d: 1, black: true, at: [-1.42, 1.2, -1.55], name: '部屋の隅に、黒い人影が立っていた', on(){ R.shadowMan.visible = true; } },
  { id: 'redLight', d: 1, at: [0, 2.3, -.2], name: '部屋の灯りが、赤かった', on(){ setLights('red'); } },
  { id: 'clockSpin', d: 1, at: AT.clock, name: '時計の針が、異様な速さで回っていた', on(){} },
  { id: 'chairCeiling', d: 1, at: [1.02, 2.2, -1.35], name: '椅子が、天井に張りついていた', on(){ R.chair.position.set(R.chairPos.x, H, R.chairPos.z); R.chair.rotation.set(Math.PI, 0, 0); } },
  { id: 'plantHuge', d: 1, at: AT.plant, name: '観葉植物が、天井に届くほど大きくなっていた', on(){ R.plant.scale.setScalar(2.3); } },
  { id: 'windowDay', d: 1, at: AT.win, name: '夜中なのに、窓の外が昼間だった', on(){ R.backdropMat.map = TX.cityDay; } },
  { id: 'personBedside', d: 1, at: [-.42, 1.4, .9], name: 'ベッドのすぐ横に、誰かが立っていた', on(){ R.pBedside.visible = true; } },
  // --- d2
  { id: 'calendarMove', d: 2, at: AT.cal, name: 'カレンダーの数字が、動いていた', on(){ CAL.move = true; } },
  { id: 'clockReverse', d: 2, at: AT.clock, name: '時計が、逆向きに進んでいた', on(){} },
  { id: 'clockNoHands', d: 2, at: AT.clock, name: '時計に、針がなかった', on(){} },
  { id: 'mugFloat', d: 2, at: AT.mug, name: '机の上のマグカップが、浮いていた', on(){} },
  { id: 'tvOn', d: 2, at: AT.tv, name: '消えているはずのテレビが、ついていた', on(){ R.tvScreen.material = R.tvOn; } },
  { id: 'tvBackward', d: 2, at: AT.tv, name: 'テレビが、壁の方を向いていた', on(){ R.tv.rotation.y = Math.PI; } },
  { id: 'phoneCall', d: 2, at: AT.phone, name: '枕元のスマホに、自分から着信があった', on(){ R.phoneScreen.material = R.phoneOn; } },
  { id: 'pictureUpside', d: 2, at: AT.pic, name: 'ベッドの上の絵が、逆さまになっていた', on(){ R.picture.rotation.z = Math.PI; } },
  { id: 'pictureGone', d: 2, at: AT.pic, name: 'ベッドの上の絵が、なくなっていた', on(){ R.picture.visible = false; } },
  { id: 'doorAjar', d: 2, at: AT.door, name: '閉めたはずのドアが、少し開いていた', on(){ R.door.rotation.y = -.5; } },
  { id: 'curtainSway', d: 2, at: [1.7, 1.4, 1.58], name: '窓は閉まっているのに、カーテンが揺れていた', on(){} },
  { id: 'windowFigure', d: 2, at: AT.win, name: 'ベランダに、誰かが立っていた', on(){ R.winFig.visible = true; } },
  { id: 'windowDark', d: 2, at: AT.win, name: '窓の外の明かりが、すべて消えていた', on(){ R.backdropMat.map = TX.cityDark; } },
  { id: 'personDesk', d: 2, at: AT.desk, name: '机の椅子に、誰かが座っていた', on(){ R.pDesk.visible = true; } },
  { id: 'personDoor', d: 2, at: AT.door, name: '開いたドアの向こうに、誰かが立っていた', on(){ R.door.rotation.y = -1.25; R.pDoor.visible = true; } },
  { id: 'personTable', d: 2, at: [.2, .5, -1.05], name: 'テーブルの前に、誰かが座っていた', on(){ R.pTable.visible = true; } },
  { id: 'personCorner', d: 2, at: [-1.5, 1.2, -2.1], name: '部屋の隅で、誰かが壁を向いて立っていた', on(){ R.pCorner.visible = true; } },
  { id: 'calendarUpside', d: 2, at: AT.cal, name: 'カレンダーが、逆さまに掛かっていた', on(){ R.calendar.rotation.z = Math.PI; } },
  { id: 'calendarBlank', d: 2, at: AT.cal, name: 'カレンダーに、日付がなかった', on(){ CAL.blank = true; } },
  { id: 'booksGone', d: 2, at: AT.books, name: '本棚から、本がなくなっていた', on(){ R.bookMeshes.forEach(b => b.visible = false); } },
  { id: 'extraDoor', d: 2, at: [-1.8, 1.1, -.3], name: 'あるはずのない場所に、ドアがあった', on(){ R.extraDoor.visible = true; } },
  { id: 'trashOnBed', d: 2, at: [-1.28, .75, .55], name: 'ゴミ箱が、ベッドの上に置かれていた', on(){ R.trash.position.set(-1.28, .77, .55); } },
  { id: 'chairGone', d: 2, at: AT.desk, name: '机の椅子が、なくなっていた', on(){ R.chair.visible = false; } },
  // --- d3: 気づきにくい
  { id: 'calendarCircles', d: 3, at: AT.cal, name: 'カレンダーの日付が、すべて丸で囲まれていた', on(){ CAL.circles = true; } },
  { id: 'calendarMonth', d: 3, at: AT.cal, name: 'カレンダーが「13月」になっていた', on(){ CAL.m13 = true; } },
  { id: 'clockNumbers', d: 3, at: AT.clock, name: '時計の数字が、逆回りに並んでいた', on(){} },
  { id: 'clockStopped', d: 3, at: AT.clock, name: '時計の秒針が、止まっていた', on(){} },
  { id: 'clockWrongHour', d: 3, at: AT.clock, name: '時計が、ありえない時刻を指していた', on(){} },
  { id: 'booksSame', d: 3, at: AT.books, name: '本棚の本が、すべて同じ色になっていた', on(){ R.books.forEach(m => m.color.setHex(0x7a2e2a)); } },
  { id: 'chairFacing', d: 3, at: AT.desk, name: '椅子が、ベッドの方を向いていた', on(){
      R.chair.position.set(.78, 0, -.98);
      const dx = BED_EYE.x - .78, dz = BED_EYE.z + .98, n = Math.hypot(dx, dz);
      R.chair.rotation.set(0, Math.atan2(-dz / n, dx / n), 0);
    } },
  { id: 'curtainFeet', d: 3, at: [1.72, .3, 1.58], name: 'カーテンの下から、足が見えていた', on(){ R.feet.visible = true; } },
  { id: 'mugTwo', d: 3, at: AT.mug, name: 'マグカップが、二つになっていた', on(){ R.mug2.visible = true; } },
  { id: 'paintingPerson', d: 3, at: AT.pic, name: '絵の中に、人が立っていた', on(){ R.paintMat.map = TX.paintPerson; } },
  { id: 'plantDead', d: 3, at: AT.plant, name: '観葉植物が、枯れていた', on(){ R.leafM.color.setHex(0xb08a3a); R.stemM.color.setHex(0x8f6e3a); R.plant.scale.set(1, .82, 1); } },
  { id: 'rugRotated', d: 3, at: [.2, 0, -.6], name: 'ラグが、斜めにずれていた', on(){ R.rug.rotation.z = .55; } },
  { id: 'acGone', d: 3, at: [-1.7, 2.1, -1.2], name: 'エアコンが、なくなっていた', on(){ R.ac.visible = false; } },
  { id: 'glassTilted', d: 3, at: [.05, .4, -.68], name: 'グラスが、傾いたまま止まっていた', on(){ R.glass.rotation.z = .6; } },
  { id: 'doorKnobSwap', d: 3, at: AT.door, name: 'ドアノブが、反対側についていた', on(){ R.knobs.forEach(k => k.position.x = -.08); } },
  { id: 'ceilingLightOff', d: 3, at: [0, 2.36, -.2], name: '灯りは消えているのに、部屋が明るかった', on(){ R.discMat.emissive.setHex(0x000000); R.discMat.color.setHex(0x555555); } },
  { id: 'phoneGone', d: 3, at: AT.phone, name: '枕元のスマホが、なくなっていた', on(){ R.phoneGroup.visible = false; } },
  // --- 黒い人(すぐわかる。序盤に出やすい)
  { id: 'shadowBed', role: 'nurse', d: 1, black: true, at: [-.45, 1.3, .85], name: 'ベッドのすぐ横に、黒い人影が立っていた', on(){ R.sBed.visible = true; } },
  { id: 'shadowDesk', role: 'doctor', d: 1, black: true, at: AT.desk, name: '机の椅子に、黒い人影が座っていた', on(){ R.sDesk.visible = true; } },
  { id: 'shadowDoor', role: 'doctor', d: 1, black: true, at: AT.door, name: '開いたドアの前に、黒い人影が立っていた', on(){ R.door.rotation.y = -1.25; R.sDoor.visible = true; } },
  { id: 'shadowCeiling', role: 'visitor', d: 2, black: true, at: [0, 2.2, -.2], name: '天井の電気に、黒い人影が張り付いていた', on(){ R.sCeil.visible = true; } },
  // --- 病室の記憶(本当は病院のベッドにいる)
  { id: 'shadowFamily', role: 'visitor', hosp: true, d: 1, black: true, at: [-.45, 1.3, 1.25], name: 'ベッドの横に、黒い人影が3人並んで、見下ろしていた', on(){ R.sFam.forEach(o => o.visible = true); } },
  { id: 'shadowSyringe', role: 'nurse', hosp: true, d: 1, black: true, at: [-.55, 1.3, 1.8], name: '枕元に、注射器を持った黒い人影が立っていた', on(){ R.sSyr.visible = true; } },
  { id: 'ivStand', hosp: true, d: 1, at: [-.68, 1.5, .62], name: 'ベッドの横に、点滴スタンドが立っていた', on(){ R.iv.visible = true; } },
  { id: 'bedRails', hosp: true, d: 1, at: [-.75, .9, 1.2], name: 'ベッドの両側に、柵が立っていた', on(){ R.rails.visible = true; } },
  { id: 'ivArm', hosp: true, d: 2, at: [-1.28, .6, 1.0], name: '左手に、点滴のチューブがつながっていた', on(){ R.ivArm.visible = true; } },
  { id: 'syringeWall', hosp: true, d: 2, at: [-1.7, 1.15, 1.9], name: '壁から、注射器が突き出ていた', on(){ R.syr[0].visible = true; } },
  { id: 'syringesWall', hosp: true, d: 3, at: [-1.7, 1.5, 1.2], name: '壁から、注射器が何本も突き出ていた', on(){ R.syr.forEach(g => g.visible = true); } },
  { id: 'wardLight', hosp: true, maxHour: 2, d: 2, at: [0, 2.3, -.2], name: '天井の灯りが、病室のような白い蛍光灯になっていた', on(){ setLights('ward'); } },
  { id: 'monitorBeep', hosp: true, d: 2, at: [-1.0, 1.3, 1.2], name: '規則正しい電子音(ピッ、ピッ)が、どこからか聞こえていた', on(){}, start(){ every('monitor', 1030, () => tone(1046, .09, .1)); } },
  { id: 'shadowWindow', role: 'visitor', d: 1, black: true, at: AT.win, name: 'ベランダに、黒い人影が立っていた', on(){ R.sWin.visible = true; } },
  // --- 数字・文字
  { id: 'digitalBug', d: 3, at: AT.dclock, name: '枕元のデジタル時計の分が「61」になっていた', on(){} },
  { id: 'posterText', d: 3, at: AT.poster, name: '壁のポスターの文字が「みみみみ」になっていた', on(){ drawPoster(true); } },
  { id: 'bookText', d: 3, at: [1.6, .8, -.98], name: '机の本のタイトルが「みみ みみ みみ」になっていた', on(){ drawBook(true); } },
  { id: 'memoNote', d: 3, at: AT.memo, name: '机のメモ書きが「のんだ」で埋まっていた', on(){ drawMemo(true); } },
  // --- 暮らしの違和感(主人公の状態を暗示)
  { id: 'pillsFull', d: 2, at: AT.pills, name: '枕元の薬の袋が、パンパンにふくらんでいた', on(){ R.bagBody.scale.y = 4; R.bagBody.position.y = .018; R.pillsFew.visible = false; R.pillsMany.visible = true; } },
  { id: 'pillsScatter', d: 2, at: AT.pills, name: '枕元に、空のシートが散らばっていた', on(){ R.blisters.visible = true; } },
  { id: 'phoneLed', d: 2, at: AT.phone, name: 'スマホの通知ランプが、規則正しく点滅していた', on(){} },
  // --- 「ただそこにあるだけ」の気持ち悪さ
  { id: 'jacketShadowFlip', d: 3, at: AT.jacket, name: '壁の上着の影が、逆側に落ちていた', on(){ R.jShadow.position.x = 1.55 + .14; } },
  { id: 'jacketShadowGone', d: 3, at: AT.jacket, name: '壁の上着に、影がなかった', on(){ R.jShadow.visible = false; } },
  { id: 'carLoop', d: 3, at: AT.win, name: '窓の外を、同じ赤い車が何度も通り過ぎていた', on(){} },
  { id: 'waterTilt', d: 3, at: [.05, .4, -.68], name: 'コップの水面が、傾いたまま止まっていた', on(){ R.water.rotation.z = .55; } },
  // --- 安心感を奪う
  { id: 'doorLight', d: 2, at: AT.door, name: 'ドアの隙間の光が、見つめていると消えた', on(){ R.doorGap.visible = true; } },
  { id: 'selfBreath', d: 2, at: [-1.28, 1.0, 1.45], name: '自分の呼吸音が、だんだん速くなっていった', on(){}, start(){ selfBreathStart(); } },
  // --- 散らかりが「おかしくなる」
  { id: 'clothesPerson', d: 2, at: [.2, .1, .55], name: '床の服が、人の形に並べられていた', on(){ R.aPerson.visible = true; } },
  { id: 'clothesTrail', d: 2, at: [.0, .1, -.5], name: '服が、ベッドからドアまで一本の道のように落ちていた', on(){ R.aTrail.visible = true; } },
  { id: 'laundryHuge', d: 2, at: [1.5, .6, 1.2], name: '部屋の隅に、洗濯物が異様な量で積み上がっていた', on(){ R.aHuge.visible = true; } },
  { id: 'shoesLined', d: 2, at: [.25, .1, .6], name: '部屋の中に、靴がベッドの方を向いて並んでいた', on(){ R.aShoes.visible = true; } },
  { id: 'bottlesLined', d: 3, at: [-.1, .1, .3], name: 'ペットボトルが、床に一直線に並んでいた', on(){ R.aBottles.visible = true; } },
  { id: 'papersGrid', d: 3, at: [.1, .05, .7], name: '床の紙が、きっちり格子状に並んでいた', on(){ R.aPapers.visible = true; } },
  { id: 'tidyAll', d: 3, minNight: 2, at: [.5, .1, .5], name: '散らかっていたはずの物が、すべて片付いていた', on(){ setClutter(-1); } },
  { id: 'clutterMoved', d: 3, minNight: 2, at: [.5, .1, .5], name: '床に落ちている物の位置が、少しずれていた', on(){
      R.clutter.forEach((c, i) => {
        if(!c.o.visible || c.p0.y > .2) return;
        c.o.position.x = clamp(c.p0.x + ((i % 3) - 1) * .32, -1.6, 1.62);
        c.o.position.z = clamp(c.p0.z + (((i + 1) % 3) - 1) * .27, -2.1, 2.2);
        c.o.rotation.y = c.r0 + .9;
      });
    } },
  // --- 増えていくもの(時間がたつほど増える)
  { id: 'bottlesGrow', d: 2, at: [.3, .1, .7], name: 'ペットボトルが、少しずつ増えていった', on(){ growStart('bottlesGrow'); } },
  { id: 'papersGrow', d: 2, at: [.2, .05, .9], name: '床の紙が、少しずつ増えていった', on(){ growStart('papersGrow'); } },
  { id: 'cupsGrow', d: 3, at: [.2, .4, -.6], name: 'テーブルの上のコップが、少しずつ増えていった', on(){ growStart('cupsGrow'); } },
  { id: 'laundryGrow', d: 2, at: [.95, .4, .95], name: '洗濯物の山が、少しずつ高くなっていった', on(){ growStart('laundryGrow'); } },
  { id: 'trashGrow', d: 3, at: [1.4, .2, -1.6], name: 'ゴミ袋が、少しずつ増えていった', on(){ growStart('trashGrow'); } },
  { id: 'boxesGrow', d: 3, at: [1.4, .3, .8], name: '段ボールが、少しずつ積み上がっていった', on(){ growStart('boxesGrow'); } },
  { id: 'plantGrow', d: 2, at: AT.plant, name: '観葉植物が、少しずつ大きくなっていった', on(){} },
  { id: 'calendarGrow', d: 3, at: AT.cal, name: 'カレンダーの丸が、少しずつ増えていった', on(){ CAL.grow = true; CAL.n = 4; } },
  { id: 'memoGrow', d: 3, at: AT.memo, name: 'メモの「のんだ」が、少しずつ増えていった', on(){ MEM.n = 2; drawMemo(true, 2); } },
  { id: 'windowLag', d: 3, at: AT.win, name: '窓に映る部屋が、一瞬遅れてついてきた', on(){ R.ghost.visible = true; } }
];
const ANOM_BY = Object.fromEntries(ANOM.map(a => [a.id, a]));
function growStart(id){ const g = R.grow[id]; g.n = g.start; g.items.forEach((m, i) => m.visible = i < g.start); }
const DIFF = { 1: [1], 2: [1, 2], 3: [2], 4: [2, 3], 5: [3, 2], 6: [3] };
function pickAnomaly(){
  const hourOk = a => !a.maxHour || S.hour <= a.maxHour;   // 朝と見分けがつかない異変は、夜(午前1〜2時)だけ
  if(S.idx === S.forceHosp){   // 毎晩、病院関連の異変を必ず1回
    const hp = ANOM.filter(a => a.hosp && !S.used.has(a.id) && hourOk(a));
    if(hp.length){
      const hw = a => S.seen.has(a.id) ? .2 : 1;
      let r = Math.random() * hp.reduce((t, a) => t + hw(a), 0), ph = hp[hp.length - 1];
      for(const a of hp){ r -= hw(a); if(r <= 0){ ph = a; break; } }
      S.used.add(ph.id); S.seenNow.add(ph.id); return ph;
    }
  }
  if(S.idx === S.forceBlack){
    let bp = ANOM.filter(a => a.black && a.role === S.forceRole && !S.used.has(a.id));   // その夜の黒い人の役(医者/看護師/見舞い)
    if(!bp.length) bp = ANOM.filter(a => a.black && !S.used.has(a.id));
    if(bp.length){
      const bw = a => (a.id === 'shadowMan' || a.id === 'shadowDoor') ? 2 : 1;   // 近づいてくる黒い人を出やすく
      let r = Math.random() * bp.reduce((t, a) => t + bw(a), 0), pb = bp[bp.length - 1];
      for(const a of bp){ r -= bw(a); if(r <= 0){ pb = a; break; } }
      S.used.add(pb.id); S.seenNow.add(pb.id); return pb;
    }
  }
  const hh = Math.min(6, S.hour + stage() - 1);
  const okDiff = a => (DIFF[hh] || [1, 2, 3]).includes(a.d);
  const elig = a => !(a.minNight && stage() < a.minNight) && hourOk(a);   // 「散らかり」を前提にした異変は第2夜から
  let pool = ANOM.filter(a => elig(a) && !S.used.has(a.id) && (okDiff(a) || (a.black && S.hour >= 3 && Math.random() < .5)));
  if(!pool.length) pool = ANOM.filter(a => elig(a) && !S.used.has(a.id));
  if(!pool.length) pool = ANOM.filter(elig);
  const w = a => (a.black ? (hh <= 2 ? 6 : 2) : 1) * (S.seen.has(a.id) ? .15 : 1);   // 前の夜に出た異変は、あまり出ない   // 黒い人は他の異変より出やすく、序盤はとくに
  let r = Math.random() * pool.reduce((t, a) => t + w(a), 0), pickA = pool[pool.length - 1];
  for(const a of pool){ r -= w(a); if(r <= 0){ pickA = a; break; } }
  S.used.add(pickA.id); S.seenNow.add(pickA.id); return pickA;
}
const activeNames = () => [...S.active].map(id => ANOM_BY[id].name);

const CARS = { list: [], t: 0, next: 2 };
function clearCars(){ CARS.list.forEach(c => room.remove(c)); CARS.list = []; }
function spawnCar(loop){
  const dir = loop ? -1 : (Math.random() < .5 ? 1 : -1);
  const g = new T3.Group();
  box(g, .8, .42, 1.9, loop ? lam(0xa82020, { emissive: 0x3a0808 }) : lam(0x2a2d33), 0, 0, 0);
  box(g, .7, .28, .9, loop ? lam(0x8a1818, { emissive: 0x2a0606 }) : lam(0x23262b), 0, .33, -.1 * dir);
  const hm = basic(0xfff4d0, { fog: false }), tm = basic(0xff2a1a, { fog: false });
  for(const x of [-.28, .28]){ box(g, .15, .1, .04, hm, x, .05, dir * .96); box(g, .15, .1, .04, tm, x, .05, -dir * .96); }
  g.position.set(4.2, 1.15, -dir * 9);
  g.userData = { dir, spd: loop ? 3.4 : 2.2 + Math.random() * 2.6 };
  room.add(g); CARS.list.push(g);
}
function updateCars(dt){
  if(S.scene !== 'room') return;
  const loop = S.active.has('carLoop');
  if(loop){ CARS.t += dt; if(CARS.t >= 3){ CARS.t = 0; spawnCar(true); } }
  else { CARS.next -= dt; if(CARS.next <= 0){ CARS.next = 2.5 + Math.random() * 6; spawnCar(false); } }
  for(const c of CARS.list.slice()){
    c.position.z += c.userData.dir * c.userData.spd * dt;
    if(Math.abs(c.position.z) > 10){ room.remove(c); CARS.list.splice(CARS.list.indexOf(c), 1); }
  }
}
function sosOn(ms){
  const U = 240, seq = [[1, 1], [0, 1], [1, 1], [0, 1], [1, 1], [0, 3], [1, 3], [0, 1], [1, 3], [0, 1], [1, 3], [0, 3], [1, 1], [0, 1], [1, 1], [0, 1], [1, 1], [0, 8]];
  const total = seq.reduce((t, p) => t + p[1], 0) * U; let x = ms % total;
  for(const [on, u] of seq){ if(x < u * U) return !!on; x -= u * U; }
  return false;
}
/* 見ていない間だけ、ゆっくり近づいてくる黒い人(立っているだけ・座っているだけの人は動かない) */
function chaseUpdate(dt){
  if(S.caught || S.mode !== 'play' || !S.look || S.scene !== 'room') return;
  const cp = Math.cos(V.pitch), dx = -Math.sin(V.yaw) * cp, dy = Math.sin(V.pitch), dz = -Math.cos(V.yaw) * cp;
  const list = [['shadowMan', R.shadowMan], ['shadowDoor', R.sDoor]];   // ベッドの横・椅子・ベランダの人は動かない
  let minD = Infinity, minRef = Infinity;
  const REF0 = { shadowMan: 2.98, shadowDoor: 4.89 };   // 第1夜の出現距離(赤みの基準)
  for(const [id, o] of list){
    if(!S.active.has(id)) continue;
    const px = o.position.x - V.pos.x, pz = o.position.z - V.pos.z, dist = Math.hypot(px, pz);
    minD = Math.min(minD, dist);
    minRef = Math.min(minRef, Math.max(.85, REF0[id] - .075 * S.chaseT));
    // 見ていても、見ていなくても、少しずつ近づいてくる(ベッドの手前で止まる)
    if(dist > .85){
      const mv = (.075 + .01 * (stage() - 1)) * dt;   // ゆっくり。夜が進むほどほんの少し速い
      o.position.x -= px / dist * mv; o.position.z -= pz / dist * mv;
      o.lookAt(V.pos.x, 0, V.pos.z);
      S.stepT += dt; if(S.stepT > .9){ S.stepT = 0; step(.1); }
    } else {
      // すぐそばまで来た: 顔を見た瞬間に終わる
      const hy = 1.6 - V.pos.y, hl = Math.hypot(px, hy, pz);
      if((dx * px + dy * hy + dz * pz) / hl > .8){ S.caught = true; shadowCaught(o); return; }
    }
  }
  // 画面の赤み・揺れは、第1夜と同じ時間の経ち方で強くなる(後半の夜は近くに出るが、最初から真っ赤にはならない)
  if(isFinite(minD)){
    S.chaseT += dt;
    S.redTarget = clamp((4.6 - minRef) / (4.6 - .85), 0, 1);
  }
  // 近づくほど、心拍が速く・大きくなる(遠いうちは聞こえない)
  if(minD < 4.6){
    const k = clamp((4.6 - minD) / (4.6 - .85), 0, 1);
    S.hbT -= dt;
    S.chaseTarget = k;
    if(S.hbT <= 0){ beatOnce((.6 + 1.7 * k) * 1.5); S.hbT = 1.15 - .75 * k; S.pulse = 1; }   // 速さは約52回/分 → 約160回/分(元に戻した)。音は大きく
  } else S.hbT = 0;
}
function beatOnce(v){
  ping(52, .24, .95 * v, 'sine'); ping(104, .14, .5 * v, 'triangle'); ping(156, .08, .22 * v, 'triangle'); noiseHit(.22 * v, .12, 'lowpass', 190, 1);
  ping(46, .22, .7 * v, 'sine', .2); ping(92, .12, .36 * v, 'triangle', .2); ping(138, .07, .16 * v, 'triangle', .2);
}
function shadowCaught(o){
  const y = V.yaw, p = V.pitch;
  start(async () => { V.yaw = y; V.pitch = p; await caughtEnding(o); });
}
/* 顔を見た瞬間、画面が激しく揺れて、セリフなしで暗転、ゲームオーバーへ */
async function caughtEnding(o){
  S.mode = 'cut'; S.scene = 'room'; skippable = true;
  const over = () => start(async () => gameOver('川で、亡くなっていた。', '黒い人影に、追いつかれた。'));
  setSkip(over);
  S.ticking = false; humTo(0, .05); S.hold = true; S.chaseK = 1; S.redK = 1;
  const am = aimAt(new T3.Vector3(o.position.x, 1.62, o.position.z));
  lookTo(am.yaw, am.pitch, 220);
  V.shake = .07;   // 当たったときの効果音はなし(無音のまま揺れて、暗転)
  tween(1100, e => { V.shake = .07 + e * .08; });
  await sleep(1200);
  skippable = false;
  V.shake = 0; setFade(1, '#000');
  await sleep(500);
  S.hold = false;
  loopNoise('river', { type: 'lowpass', freq: 520, vol: .16, fadeIn: 2 });   // 暗闇の中、川の流れる音
  await sleep(1800);
  await showNews(over);
  stopSnd('river', 2);
  gameOver('川で、亡くなっていた。', '黒い人影に、追いつかれた。');
}
function setClutter(level){ R.clutter.forEach(c => { c.o.visible = c.lv <= level; c.o.position.copy(c.p0); c.o.rotation.y = c.r0; }); }
function resetExtras(){
  setClutter(stage() - 1);
  { const k = stage() - 1, sheets = [0, 2, 4, 7, 10][k], pills = [3, 2, 2, 1, 0][k];
    R.usedSheets.forEach((g, i) => g.visible = i < sheets);
    const water = [.062, .05, .032, .015, 0][k], loose = [0, 0, 1, 2, 3][k];
    R.nightGlass.visible = k >= 1;
    R.nightWater.visible = water > 0; if(water > 0){ R.nightWater.scale.y = water / .06; R.nightWater.position.y = water / 2 + .005; }
    R.loosePills.forEach((m, i) => m.visible = i < loose);
    R.pillsFew.children.forEach((p, i) => p.visible = i < pills); }
  Object.values(R.grow).forEach(g => { g.items.forEach(m => m.visible = false); g.n = -1; }); MEM.n = 0;
  // 夜が進むほど、黒い人は最初からベッドの近くに現れる(早く判断しないと間に合わない)
  const placeChaser = (o, ox, oz, minD) => {
    const dx = ox - BED_EYE.x, dz = oz - BED_EYE.z, d0 = Math.hypot(dx, dz), d = Math.max(minD, d0 * (1 - .14 * (stage() - 1)));
    o.position.set(BED_EYE.x + dx / d0 * d, 0, BED_EYE.z + dz / d0 * d); o.lookAt(BED_EYE.x, 0, BED_EYE.z);
  };
  placeChaser(R.shadowMan, -1.42, -1.55, 1.7); placeChaser(R.sDoor, .75, -3.0, 2.0);
  R.sBed.position.set(-.45, 0, .85); R.sBed.lookAt(BED_EYE.x, 0, BED_EYE.z);
  S.caught = false; S.stepT = 0; S.hbT = 0; S.chaseT = 0; S.redK = 0;
  [R.aPerson, R.aTrail, R.aHuge, R.aShoes, R.aBottles, R.aPapers].forEach(g => g.visible = false);
  [R.sBed, R.sDesk, R.sDoor, R.sWin, R.sCeil, R.iv, R.rails, R.ivArm, R.sSyr, ...R.sFam, ...R.syr].forEach(o => o.visible = false);
  R.pillsMany.visible = false; R.blisters.visible = false; R.pillsFew.visible = true; R.bagBody.scale.set(1, 1, 1); R.bagBody.position.y = 0;
  R.ledMat.color.setHex(0x1a2630); R.ledGlow.visible = false;
  R.jShadow.visible = true; R.jShadow.position.x = 1.41;
  R.doorGap.visible = false; S.gaze = 0;
  R.water.rotation.z = 0; R.ghost.visible = false;
  R.dclock.position.copy(R.dclockPos); R.dclock.rotation.set(0, 0, 0); DCK.last = null;
  if(PST.garble) drawPoster(false);
  if(BKT.garble) drawBook(false);
  if(MEM.bad) drawMemo(false);
  clearCars(); CARS.t = 0; CARS.next = 1.5 + Math.random() * 2.5;
  stopSnd('selfBreath'); stopSnd('monitor');
}
function startAnomalySounds(){ S.active.forEach(id => { const a = ANOM_BY[id]; if(a && a.start) a.start(); }); }
function selfBreathStart(){
  if(!A.ctx) return;
  stopSnd('selfBreath');
  let iv = 2400, id = 0, inhale = true;
  const f = () => { noiseHit(.26, .12 + Math.min(.4, iv / 2400 * .4), 'bandpass', inhale ? 1100 : 650, .8); inhale = !inhale; iv = Math.max(200, iv * .93); id = vset(f, iv); };
  f(); snd.selfBreath = () => vclear(id);
}

/* rebuild the room to its baseline, then apply every active anomaly */
function rebuild(){
  const day = S.day, tm = day ? 'day' : timeMode(S.hour);
  R.backdropMat.map = BACKDROP[tm];
  setLights(tm);
  R.discMat.color.setHex(0xeeeeee);
  [R.shadowMan, R.winFig, R.pDesk, R.pDoor, R.pTable, R.pCorner, R.pBedside, R.feet, R.mug2, R.extraDoor].forEach(o => o.visible = false);
  [R.chair, R.ac, R.picture, R.phoneGroup].forEach(o => o.visible = true);
  R.bookMeshes.forEach(b => b.visible = true);
  R.books.forEach(m => m.color.setHex(m.userData.c));
  R.chair.position.copy(R.chairPos); R.chair.rotation.set(0, 0, 0);
  R.mug.position.copy(R.mugPos); R.mug.rotation.set(0, 0, 0);
  R.tvScreen.material = R.tvOff; R.tv.rotation.y = 0;
  R.phoneScreen.material = R.phoneOff;
  R.picture.rotation.z = 0; R.paintMat.map = TX.paint;
  R.door.rotation.y = 0; R.knobs.forEach(k => k.position.x = -.72);
  R.plant.scale.setScalar(1); R.leafM.color.setHex(0x3f5c36); R.stemM.color.setHex(0x4d5f3a);
  R.calendar.rotation.z = 0; R.rug.rotation.z = 0; R.glass.rotation.z = 0;
  R.trash.position.copy(R.trashPos);
  R.hall.material = day ? R.hallDay : R.hallNight;
  ARM.reach = 0; ARM.tool = null;
  resetExtras();
  CAL.move = CAL.circles = CAL.m13 = CAL.blank = CAL.grow = false; CAL.n = 0;
  for(const id of S.active) ANOM_BY[id] && ANOM_BY[id].on();
  R.backdropMat.needsUpdate = true; R.paintMat.needsUpdate = true;
  drawCalendar(0);
  updateCurtains(0, S.active.has('curtainSway'));
  S.lastSec = null;
}

/* ============================================================
   main loop
   ============================================================ */
let lastT = performance.now(), frame = 0, beepAt = 0;
function loop(now){
  requestAnimationFrame(loop);
  const dt = Math.min(.05, (now - lastT) / 1000); lastT = now; frame++;
  vstep(dt);
  const t = vt / 1000;
  {
    const dg = PAUSED ? 0 : dt;
    S.pulse = Math.max(0, (S.pulse || 0) - dg * 3.5);
    const target = S.hold ? 1 : (S.scene === 'room' ? (S.chaseTarget || 0) : 0);
    S.chaseK = (S.chaseK || 0) + (target - (S.chaseK || 0)) * Math.min(1, dg * 3.5);
    S.chaseTarget = 0;
    const rt_ = S.hold ? 1 : (S.scene === 'room' ? (S.redTarget || 0) : 0);
    S.redK = (S.redK || 0) + (rt_ - (S.redK || 0)) * Math.min(1, dg * 3.5);
    S.redTarget = 0;
    const K = S.redK;   // 赤み・揺れ(時間基準)。時計の音の消え方は S.chaseK(距離基準)のまま
    post.uniforms.uRed.value = 0;   // 画面の赤みは無し(揺れだけ残す)
    S.chaseShake = K * (.009 + .03 * S.pulse);
  }
  if(S.look && !PAUSED){
    const sp = 1.6 * dt * (V.fov / 70);
    if(keys['arrowleft'] || (!V.free && keys['a'])) V.yaw += sp;
    if(keys['arrowright'] || (!V.free && keys['d'])) V.yaw -= sp;
    if(keys['arrowup'] || (!V.free && keys['w'])) V.pitch = clamp(V.pitch + sp, -1.45, 1.45);
    if(keys['arrowdown'] || (!V.free && keys['s'])) V.pitch = clamp(V.pitch - sp, -1.45, 1.45);
    if(V.free){
      const mv = (keys['shift'] ? 4 : 1.5) * dt, fx = -Math.sin(V.yaw), fz = -Math.cos(V.yaw);
      if(keys['w']){ V.pos.x += fx * mv; V.pos.z += fz * mv; }
      if(keys['s']){ V.pos.x -= fx * mv; V.pos.z -= fz * mv; }
      if(keys['a']){ V.pos.x += fz * mv; V.pos.z -= fx * mv; }
      if(keys['d']){ V.pos.x -= fz * mv; V.pos.z += fx * mv; }
      if(keys['e']) V.pos.y += mv;
      if(keys['q']) V.pos.y -= mv;
    }
  }
  V.fov += (V.tfov - V.fov) * Math.min(1, dt * 8);
  if(Math.abs(camera.fov - V.fov) > .01){ camera.fov = V.fov; camera.updateProjectionMatrix(); }

  let scene = room;
  if(S.scene === 'room'){
    const a = S.active, e = (vt - S.roundStart) / 1000;
    let sec = S.clockBase + e;
    if(a.has('clockReverse')) sec = S.clockBase - e;
    if(a.has('clockSpin')) sec = S.clockBase + e * 240;
    if(a.has('clockStopped')) sec = S.clockBase + 23;
    if(a.has('clockWrongHour')) sec += 5 * 3600 + 17 * 60;
    const fs = Math.floor(sec);
    if(fs !== S.lastSec || a.has('clockSpin')){
      if(S.ticking && S.lastSec !== null && fs !== S.lastSec) tick();
      S.lastSec = fs;
      drawClock(a.has('clockSpin') ? sec : fs, a.has('clockNumbers'), a.has('clockNoHands'));
      drawDigital(sec, a.has('digitalBug'));
    }
    if(CAL.move && frame % 3 === 0) drawCalendar(t);
    if(a.has('mugFloat')){ R.mug.position.y = R.mugPos.y + .3 + Math.sin(t * 1.3) * .05; R.mug.rotation.y += dt * .5; R.mug.rotation.z = Math.sin(t * .8) * .2; }
    if(a.has('curtainSway')) updateCurtains(t, true);
    if(a.has('tvOn') && frame % 3 === 0) drawTV();
    if(a.has('phoneCall')) R.phoneOn.color.setScalar(Math.sin(t * 5) > 0 ? 1 : .45);
    if(a.has('phoneLed')){ const on = sosOn(vt); R.ledMat.color.setHex(on ? 0x9fdcff : 0x1a2630); R.ledGlow.visible = on; }
    updateCars(PAUSED ? 0 : dt);
    chaseUpdate(PAUSED ? 0 : dt);
    // 増えていくものを、時間に合わせて増やす
    for(const id in R.grow){
      if(!a.has(id)) continue;
      const g = R.grow[id], n = Math.min(g.items.length, g.start + Math.floor(e / g.period));
      if(n !== g.n){ g.n = n; g.items.forEach((m, i) => m.visible = i < n); }
    }
    if(a.has('plantGrow')) R.plant.scale.setScalar(1 + Math.min(1.5, e / 30 * 1.5));
    if(a.has('calendarGrow')){ const n = Math.min(31, 4 + Math.floor(e / 3)); if(n !== CAL.n){ CAL.n = n; drawCalendar(0); } }
    if(a.has('memoGrow')){ const n = Math.min(8, 2 + Math.floor(e / 5)); if(n !== MEM.n){ MEM.n = n; drawMemo(true, n); } }
    if(a.has('doorLight') && R.doorGap.visible && S.look && !PAUSED){
      const cp = Math.cos(V.pitch), dx = -Math.sin(V.yaw) * cp, dy = Math.sin(V.pitch), dz = -Math.cos(V.yaw) * cp;
      const tx = .75 - V.pos.x, ty = .3 - V.pos.y, tz = -2.4 - V.pos.z, tl = Math.hypot(tx, ty, tz);
      const dot = (dx * tx + dy * ty + dz * tz) / tl;
      S.gaze = dot > .93 ? S.gaze + dt : Math.max(0, S.gaze - dt * .5);
      if(S.gaze > 2.2){ R.doorGap.visible = false; noiseHit(.9, .02, 'bandpass', 2600, 4); ping(900, .03, .35, 'square'); }
    }
  } else if(S.scene === 'hospital'){
    scene = hosp;
    const period = 1.03, ph = (t % period) / period;
    if(S.beeping && t - beepAt > period){ beepAt = t - (t % period); tone(1046, .09, .16); }
    if(frame % 2 === 0) drawECG(ph);
    HP.doc.userData.head.rotation.y = Math.sin(t * .7) * .08;
    HP.dad.userData.head.rotation.x = .1 + Math.sin(t * .4) * .03;
  } else if(S.scene === 'ward'){
    scene = ward;
    const period = 1.03, ph = (t % period) / period;
    if(S.beeping && t - beepAt > period){ beepAt = t - (t % period); tone(1046, .09, .12); }
    if(frame % 2 === 0) drawECG(ph);
  } else if(S.scene === 'town'){
    scene = town;
    TW.doors[0].position.x = -.8 - 1.6 * TW.open; TW.doors[1].position.x = .8 + 1.6 * TW.open;
    TW.sparks.forEach(o => { o.m.opacity = o.k * Math.pow(Math.max(0, Math.sin(t * o.sp + o.ph)), 8); });
    if(S.townIdle){ V.pos.set(Math.sin(t * .13) * .6, 1.75 + Math.sin(t * .21) * .05, -6 + Math.sin(t * .09) * .8); V.yaw = Math.sin(t * .11) * .05; V.pitch = .04; }
  } else if(S.scene === 'cross'){
    scene = cross;
    const on = Math.floor(t * 2.3) % 2;
    CR.lamps.forEach((m, i) => m.color.setHex(i % 2 === on ? 0xff2a1a : 0x2a0606));
    CR.reds.forEach((l, i) => l.intensity = (i + on) % 2 ? .9 : .15);
  }

  {   // 病室(目覚めた後)と街並みは、がびがびのフィルターなし・低解像度なし・頂点の吸着なしで、鮮明に
    const crisp = S.scene === 'ward' || S.scene === 'town';   // 真エンディング(病室・街並み)は、がびがびを中くらいに(解像度320・弱フィルターを強めに)
    if(crisp !== VIEW.crisp){
      VIEW.crisp = crisp;
      if(crisp){ VIEW.prevFilter = post.uniforms.uFilter.value; post.uniforms.uFilter.value = VIEW.prevFilter > 0 ? .95 : 0; setGrain(false); } else post.uniforms.uFilter.value = VIEW.prevFilter;
      resize();
    }
    T3.ShaderChunk.project_vertex = crisp ? PV_PLAIN : PV_SNAP;
  }
  { const nr = S.scene === 'town' ? .4 : .1; if(camera.near !== nr){ camera.near = nr; camera.updateProjectionMatrix(); } }   // 遠くの地面のちらつき(Zファイティング)を防ぐ
  { const grit = false; if(grit !== VIEW.grit){ VIEW.grit = grit; resize(); } post.uniforms.uGrit.value = grit ? 1 : 0; }   // 強いがびがびは、退院後の街並みだけ(病室は元のフィルター)
  post.uniforms.uVig.value = S.scene === 'town' ? 0 : 1;   // 四隅が黒くなる効果は、退院後はなし
  camera.position.copy(V.pos);
  if(V.breathe) camera.position.y += Math.sin(t * 1.1) * .006 * V.breathe;
  const shk = V.shake + (S.chaseShake || 0);
  if(shk){ camera.position.x += (Math.random() - .5) * shk; camera.position.y += (Math.random() - .5) * shk; }
  const jr = shk ? (Math.random() - .5) * shk * .6 : 0;
  camera.rotation.set(V.pitch + jr, V.yaw + jr, V.roll);

  // 懐中電灯(スマホのライト)
  const fl = S.flash && S.scene === 'room';
  R.flash.intensity = fl ? 2.6 * (S.flashK || 0) : 0;
  if(fl){
    const cp = Math.cos(V.pitch), dx = -Math.sin(V.yaw) * cp, dy = Math.sin(V.pitch), dz = -Math.cos(V.yaw) * cp;
    R.flash.position.set(camera.position.x + .12, camera.position.y - .18, camera.position.z);
    R.flash.target.position.set(camera.position.x + dx * 5, camera.position.y + dy * 5, camera.position.z + dz * 5);
    R.flash.target.updateMatrixWorld();
  }
  post.uniforms.uTime.value = (now / 1000) % 1000;
  renderer.setRenderTarget(rt); renderer.render(scene, camera);
  if(armUpdate(t)){ renderer.autoClear = false; renderer.clearDepth(); renderer.render(armScene, camera); renderer.autoClear = true; }
  renderer.setRenderTarget(null); renderer.render(postScene, postCam);
  // 窓に映る部屋(遅れて映る)
  if(R.ghost.visible && S.scene === 'room' && !PAUSED){
    GH.c[GH.k].getContext('2d').drawImage(glc, 0, 0, 160, 180);
    GH.k = (GH.k + 1) % GH.n;
    GH.tex.image = GH.c[(GH.k + 1) % GH.n]; GH.tex.needsUpdate = true;
  }
  if(grainOn && frame % 2 === 0) drawGrain();
  if(pauseBtn && frame % 10 === 0) pauseBtn.classList.toggle('on', PAUSED || canPause());
  if(DEBUG && frame % 15 === 0) dbgInfo();
}
const grainC = $('grain'), grainG = grainC.getContext('2d'), grainImg = grainG.createImageData(200, 120);
let grainOn = false;
function drawGrain(){
  const a = grainImg.data;
  for(let i = 0; i < a.length; i += 4){ const v = Math.random() * 255 | 0; a[i] = a[i + 1] = a[i + 2] = v; a[i + 3] = 255; }
  grainG.putImageData(grainImg, 0, 0);
}
function setGrain(on){ grainOn = on; grainC.style.opacity = on ? '.1' : '0'; }

/* ============================================================
   game flow
   ============================================================ */
const skipBtn = $('skipBtn');
function setSkip(fn){ S.skip = fn || null; skipBtn.classList.toggle('on', !!fn); }
skipBtn.onclick = () => { const f = S.skip; if(f) f(); };
function cleanup(){
  setSkip(null); S.death = null; S.hold = false; S.chaseK = 0; S.chaseTarget = 0; S.pulse = 0; S.redK = 0; S.redTarget = 0;
  skipper = null; skippable = false;
  stopAllSnd(); humTo(.14);
  $('phone').classList.remove('on'); setGrain(false);
  $('lights').style.opacity = 0;
  $('sub').style.opacity = 0; $('center').style.opacity = 0; $('hint').style.opacity = 0;
  hud(false); tools(false); $('bWake').style.display = '';
  ['over', 'end', 'title', 'rules', 'news'].forEach(id => show(id, false));
  S.beeping = false; S.ticking = false; S.look = false; endDrag();
  CR.train.position.x = -160; CR.head.intensity = 0;
  resetView();
}
function newGame(keepNight){
  S.trueEnd = false;
  if(!keepNight){ S.night = 1; S.mistakes = 0; S.seen = new Set(); S.wakeIntro = true; }   // 新しいゲームの最初だけ、目覚める演出
  S.seenNow = new Set();   // この夜に出した異変(やり直しなら、出し直し)
  S.hour = 1; S.idx = 0; S.used = new Set();
  const lo = stage() >= 3 ? 3 : 2, hi = stage() >= 3 ? 5 : 4, p = .55 + .04 * (stage() - 1);
  let seq, n;
  do{ seq = Array.from({ length: 6 }, () => Math.random() < p); n = seq.filter(Boolean).length; }while(n < lo || n > hi || (!(seq[0] || seq[1]) && Math.random() < .85));   // 最初の2回のうちに夢が来やすい
  S.seq = seq;
  S.forceBlack = seq.findIndex(Boolean);   // 毎晩、最初の夢のラウンドで必ず黒い人を出す
  // 黒い人の役(医者・看護師・見舞いの人)は、3夜で重ならず全部出る。順番は、ゲームごとにランダム
  if(!keepNight || !S.roles) S.roles = ['doctor', 'nurse', 'visitor'].sort(() => Math.random() - .5);
  S.forceRole = S.roles[(S.night - 1) % 3];
  // 毎晩、病院関連の異変を1回(黒い人の回とは別の夢のラウンドで)
  const others = seq.map((v, i) => v && i !== S.forceBlack ? i : -1).filter(i => i >= 0);
  S.forceHosp = others.length ? others[Math.floor(Math.random() * others.length)] : -1;
}
function resetView(){
  V.pos.copy(BED_EYE); V.yaw = 0; V.pitch = -.05; V.roll = 0; V.tfov = 70; V.shake = 0; V.breathe = 0;
  $('bZoom').classList.remove('act');
  post.uniforms.uNarrow.value = 0; post.uniforms.uBlur.value = 0; post.uniforms.uBright.value = 1;
}
function setHour(h){ S.hour = h; S.clockBase = h * 3600; S.roundStart = vt; S.lastSec = null; }

async function round(){
  S.mode = 'trans'; S.look = false; skippable = false; hud(false); tools(false);
  S.scene = 'room'; S.day = false;
  S.isDream = S.seq[S.idx];
  S.active = new Set(S.isDream ? [pickAnomaly().id] : []);
  setHour(S.hour); rebuild(); resetView();
  setFade(1, '#000');
  humTo(.14);
  setSkip(() => start(roundReady));
  await center(`午前${S.hour}時`, 1500);
  S.ticking = true;
  await fade(0, 1500);
  await roundReady(true);
}
async function roundReady(quick){
  setSkip(null);
  S.scene = 'room'; setFade(0); S.ticking = true;
  sayNow(S.idx === 0 ? '目が覚めた。' : pick(['目が覚めた。', 'また、目が覚めた。', '目が覚めた。']), 2200);
  S.mode = 'play'; S.look = true; tools(true);
  startAnomalySounds();
  if(S.firstHint){ $('hint').style.opacity = 1; S.firstHint = false; vset(() => $('hint').style.opacity = 0, 7000); }
  $('bLight').classList.toggle('need', !!S.dark && !S.flash);   // 暗い部屋では「ライト」ボタンを点滅させる
  if(S.dark && !S.darkHinted){ S.darkHinted = true; vset(() => sayNow('暗くて見えない。スマホのライトを使おう。', 5200), 2400); }
  if(quick === true) await sleep(800);
  if(S.mode === 'play') hud(true);
}

const hospitalOver = () => gameOver('眠り続けた。', 'この部屋の異変 ── ' + (activeNames().join(' / ') || 'なし'));
const panicOver = () => gameOver('これは、夢ではなかった。', 'この部屋に、異変はなかった。');
async function choose(wake){
  if(S.mode !== 'play') return;
  S.mode = 'trans'; S.look = false; endDrag(); hud(false); tools(false); $('hint').style.opacity = 0;
  const ok = wake === S.isDream;
  setSkip(ok ? () => start(advance) : wake ? () => start(async () => panicOver()) : () => start(async () => hospitalOver()));
  if(wake){
    await wakeAction();
    if(!ok) return panicEnding(null, true);
    await fade(1, 280);
  } else {
    if(!ok) return hospitalEnding();
    await sleepFade();
  }
  S.ticking = false;
  await sleep(700);
  return advance();
}
/* 眠る: ゆっくり暗転 → 心音だけが聞こえる */
async function sleepFade(){
  S.ticking = false;
  sayNow('目を閉じた。', 2400);
  humTo(.03, 2.5); heartbeatStart();
  await fade(1, 3000);
  await sleep(3000);
  stopSnd('heart', .5);
}
/* 起きる: 目覚まし時計を叩く / 頬をつねる(画面がバシンと揺れる) */
async function wakeAction(){
  if(Math.random() < .5) return slapCheek();
  return smashClock();
}
async function slapCheek(){
  sayNow('頬を、つねった。', 1800);
  await sleep(550);
  slapSound(); V.shake = .07;
  setFade(.65, '#fff'); await sleep(60);
  await fade(0, 320); setFade(0, '#000');
  tween(380, e => { V.shake = .07 * (1 - e); });
  await sleep(750);
  V.shake = 0;
}
async function smashClock(){
  sayNow('目覚まし時計を、思い切り叩いた。', 2400);
  const from = R.dclockPos.clone(), to = new T3.Vector3(-.1, .036, 1.85);
  const am = aimAt(new T3.Vector3(-.4, .58, 2.27));
  await lookTo(am.yaw, am.pitch, 750);
  ARM.tool = 'hit'; ARM.hit = 0;
  await tween(320, e => { ARM.reach = e; });
  await tween(130, e => { ARM.hit = e; });
  crash(); V.shake = .07;
  tween(450, e => {
    R.dclock.position.set(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e + Math.sin(e * Math.PI) * .25, from.z + (to.z - from.z) * e);
    R.dclock.rotation.set(e * 5, e * 3, e * 2);
  });
  await sleep(460); thud(.4);
  tween(380, e => { V.shake = .07 * (1 - e); });
  await sleep(650);
  V.shake = 0;
  tween(380, e => { ARM.reach = 1 - e; });
  await sleep(400);
  ARM.tool = null; ARM.reach = 0;
}
async function advance(){
  S.hour++; S.idx++; setSkip(null);
  if(S.hour >= 7) return morning();
  return round();
}
$('bWake').onclick = () => { const tok = RUN; choose(true).catch(e => { if(!(e instanceof Cancel)) console.error(e); }); };
$('bSleep').onclick = () => {
  if(S.mode === 'memorize') return start(startSleep);
  choose(false).catch(e => { if(!(e instanceof Cancel)) console.error(e); });
};

/* ---- 最初に部屋を覚える時間(「眠る」を押すまで見渡せる) ---- */
const HINT_HTML = $('hint').innerHTML;
async function memorize(){
  S.mode = 'trans'; S.look = false; skippable = false; hud(false); tools(false);
  S.scene = 'room'; S.day = false; S.isDream = false; S.active = new Set();
  setHour(0); rebuild(); resetView();
  setFade(1, '#000'); humTo(.14);
  setSkip(() => start(memorizeReady));
  await center('第' + S.night + '夜\n午後11時', 1900);
  S.ticking = true;
  if(S.wakeIntro){ S.wakeIntro = false; await wakeIntro(); } else await fade(0, 1500);
  await memorizeReady();
}
/* 最初の目覚め: ぼやけた視界で天井 → まばたき → 視界が晴れて、起き上がる */
async function wakeIntro(){
  V.pos.set(BED_EYE.x, .9, BED_EYE.z); V.pitch = 1.0; V.yaw = .25; V.breathe = 1;
  S.armOn0 = ARM.on; ARM.on = false;   // 天井を見上げている間は、手は見せない(不自然な位置に浮くため)
  post.uniforms.uNarrow.value = .95; post.uniforms.uBlur.value = 1.4;
  fade(0, 1800);
  await tween(3000, e => { post.uniforms.uNarrow.value = .95 - e * .4; post.uniforms.uBlur.value = 1.4 * (1 - e * .7); });
  await tween(240, e => { post.uniforms.uNarrow.value = .55 + e * .45; });   // まばたき
  await sleep(100);
  await tween(380, e => { post.uniforms.uNarrow.value = 1 - e * .5; });
  await sleep(500);
  await Promise.all([moveTo(BED_EYE.clone(), 2200), lookTo(0, -.05, 2200), tween(2200, e => { post.uniforms.uNarrow.value = .5 * (1 - e); post.uniforms.uBlur.value = .42 * (1 - e); if(e > .6) ARM.on = S.armOn0 !== false; })]);   // 起き上がる(視線が下がってきたら、手が見える)
  resetView();
}
async function memorizeReady(){
  setSkip(null); resetView();
  if(S.armOn0 !== undefined){ ARM.on = S.armOn0; S.armOn0 = undefined; }
  S.scene = 'room'; setFade(0); S.ticking = true;
  S.mode = 'memorize'; S.look = true; tools(true);
  $('hint').innerHTML = (S.night > 1 ? '少し散らかってきた。<br>' : '') + '部屋の様子を、よく覚えておこう。<br>準備ができたら「眠る」。<br>' + (document.body.classList.contains('mobile') ? 'ドラッグで見渡す' : '右クリックを押しながら動かして見渡す') + ' / ' + (document.body.classList.contains('mobile') ? 'ズームボタンで拡大' : 'ホイールで拡大');
  $('hint').style.opacity = 1; S.firstHint = false;
  $('bWake').style.display = 'none';
  hud(true);
}
async function startSleep(){
  S.mode = 'trans'; S.look = false; endDrag(); hud(false); tools(false);
  $('hint').style.opacity = 0; $('bWake').style.display = '';
  vset(() => { $('hint').innerHTML = HINT_HTML; }, 1200);
  S.hour = 1; S.idx = 0;   // 覚える時間は午後11時(hour=0)。最初のラウンドは午前1時から数える(6ラウンド=異変の並び6個)
  setSkip(() => start(round));
  await sleepFade();
  await sleep(500);
  return round();
}

/* ---- failure: it was a dream, but you slept ---- */
async function hospitalEnding(){
  S.mode = 'cut'; hospPlace(false);
  const reasonInfo = `この部屋の異変 ── ${activeNames().join(' / ') || 'なし'}`;
  setSkip(() => start(async () => gameOver('眠り続けた。', reasonInfo)));
  S.ticking = false;
  sayNow('目を閉じた。', 2400);
  humTo(.03, 2.5); heartbeatStart();
  await fade(1, 3000);
  await sleep(3000);
  stopSnd('heart', .4);
  S.scene = 'hospital';
  V.pos.set(0, .98, .78); V.yaw = -.2; V.pitch = 1.2; V.roll = -.2; V.tfov = V.fov = 62; V.breathe = 1;   // 目を開けると、病院の天井
  post.uniforms.uNarrow.value = .95; post.uniforms.uBlur.value = 1.2; post.uniforms.uBright.value = .8;
  S.beeping = true;
  await sleep(500);
  fade(0, 2600);
  lookTo(-.42, .06, 7000);
  await tween(4200, e => { post.uniforms.uNarrow.value = .95 - e * .32; });
  skippable = true;
  const blink = async () => {
    const n0 = post.uniforms.uNarrow.value;
    await tween(260, e => { post.uniforms.uNarrow.value = n0 + (1 - n0) * e; });
    await sleep(120);
    await tween(420, e => { post.uniforms.uNarrow.value = 1 - (1 - n0) * e; });
  };
  HP.mom.userData.head.rotation.x = .25;
  const lines = [
    ['医者「……検査の結果ですが、脳に大きな損傷は見られません」', 3400],
    ['医者「ただ、意識が戻らないんです」', 2800],
    ['母「……眠っているだけ、なんですよね」', 3000],
    ['医者「呼びかけにも、痛みにも、ほとんど反応がありません」', 3400],
    ['医者「いわゆる、植物状態です」', 3200],
    ['父「いつ、目を覚ますんですか」', 2800],
    ['医者「……わかりません」', 3000],
  ];
  for(let i = 0; i < lines.length; i++){
    if(i === 2 || i === 5) blink();
    if(i === 4) tween(2000, e => { HP.mom.userData.head.rotation.x = .25 + e * .3; });
    await say(lines[i][0], lines[i][1]);
  }
  await wait(1200);
  await say('聞こえている。', 2400);
  await say('起きているのに。', 2600);
  skippable = false;
  fade(1, 3200);
  await tween(3200, e => { post.uniforms.uNarrow.value = .63 + e * .37; });
  await sleep(1800);
  S.beeping = false;
  await sleep(800);
  gameOver('眠り続けた。', `この部屋の異変 ── ${activeNames().join(' / ') || 'なし'}`);
}

/* ---- failure: it was real, but you tried to wake up ---- */
const DEATHS = {
  hammer:   { name: 'ハンマー', fn: deathHammer },
  window:   { name: '窓から', fn: deathWindow },
  road:     { name: '道路', fn: deathRoad },
  crossing: { name: '踏切', fn: deathCrossing },
  stairs:   { name: '橋(川)', fn: deathStairs }
};
async function panicEnding(kind, afterAction){
  kind = kind || pick(Object.keys(DEATHS));
  S.death = kind;
  setSkip(() => start(async () => gameOver('これは、夢ではなかった。', 'この部屋に、異変はなかった。')));
  S.mode = 'cut'; S.scene = 'room'; skippable = true;
  await say('起きなきゃ。', 1800);
  await say('……', 1400);
  await say('目は、もう開いている。', 2200);
  await say('部屋は、何も変わらない。', 2400);
  breathingStart();
  tween(6000, e => { V.shake = e * .012; });
  await say(afterAction ? '……覚めない。' : '頬をつねった。痛い。', 2400);
  await say('夢の中でも、痛いことはある。', 2600);
  V.shake = .02;
  await say('起きろ。', 1100);
  await say('起きろ。起きろ。', 1300);
  await DEATHS[kind].fn();
  skippable = false;
  await sleep(800);
  gameOver('これは、夢ではなかった。', 'この部屋に、異変はなかった。');
}
function calmDown(){ stopSnd('breath'); V.shake = 0; }
function blackout(){ setFade(1, '#000'); humTo(0, .05); S.ticking = false; $('sub').style.opacity = 0; }

async function deathHammer(){
  ARM.tool = 'hammer';
  tween(1400, e => { ARM.reach = e; });
  await say('ハンマーを、手に取った。', 2800);
  await say('夢なら、これで覚めるはずだ。', 2800);
  skippable = false;
  calmDown(); blackout(); thud(1.2);
  await sleep(3600);
  skippable = true;
  await center('午前7時', 2000);
  alarmStart(.22);
  await say('アラームが、鳴り続けている。', 3800);
  await say('誰も、止めない。', 3600);
  stopSnd('alarm');
}
async function deathWindow(){
  const wp = new T3.Vector3(1.25, 1.52, .5);
  await Promise.all([lookTo(-Math.PI / 2, -.05, 1800), moveTo(wp, 2800)]);
  await say('窓を開けた。', 1800);
  windStart(); stopSnd('breath'); V.shake = .006;
  await say('夜の風が冷たい。', 2400);
  await say('手すりの向こうに、道路が見える。', 2600);
  await say('ここから落ちれば、さすがに目が覚める。', 3000);
  skippable = false;
  await moveTo(new T3.Vector3(1.6, 1.62, .5), 900);
  V.shake = 0; blackout(); stopSnd('wind');
  await sleep(4500);
  sirenStart();
  await sleep(17000);
  stopSnd('siren', 3); await sleep(3200);
}
async function deathRoad(){
  await say('部屋を飛び出した。', 1800);
  skippable = false;
  calmDown(); await fade(1, 500); humTo(0, .1); S.ticking = false;
  doorSlam(); for(let i = 0; i < 9; i++) step(.4, .5 + i * .28);
  await sleep(3200);
  loopNoise('street', { type: 'lowpass', freq: 350, vol: .22, fadeIn: 2 });
  skippable = true;
  await say('裸足のまま、外に出た。', 2400);
  await say('アスファルトが冷たい。', 2400);
  await say('大通りの方から、トラックの音が近づいてくる。', 3000);
  await say('夢なら、何にぶつかっても平気だ。', 3000);
  skippable = false;
  engineRise(4);
  const L_ = $('lights');
  carHorn(2.4, 1.2); brakes(3.0, 1.1);
  await tween(3800, (e, k) => { L_.style.opacity = Math.min(1, k * 1.4); L_.style.transform = `scale(${.3 + k * k * 2.6})`; });
  setFade(1, '#fff'); L_.style.opacity = 0; thud(1.2);
  await sleep(120);
  stopSnd('engine'); stopSnd('street'); setFade(1, '#000');
  await sleep(3200);
  hazardStart();
  await sleep(9000);
  stopSnd('hazard'); stopSnd('idle'); await sleep(1500);
}
async function deathCrossing(){
  await say('部屋を出た。', 1800);
  skippable = false;
  calmDown(); await fade(1, 700); humTo(0, .1); S.ticking = false;
  for(let i = 0; i < 6; i++) step(.3, .3 + i * .45);
  skippable = true;
  await say('近所の踏切まで、歩いた。', 2600);
  S.scene = 'cross'; V.pos.set(0, 1.6, 2.5); V.yaw = 0; V.pitch = .02; V.roll = 0; V.tfov = V.fov = 70;
  bellStart();
  loopNoise('night', { type: 'lowpass', freq: 300, vol: .12, fadeIn: 2 });
  await fade(0, 1800);
  await say('遮断機が、下りている。', 2400);
  await say('夢なら、電車にはねられても目が覚める。', 3000);
  await say('遮断機をくぐった。', 1600);
  skippable = false;
  await moveTo(new T3.Vector3(0, 1.6, -3.7), 1800);
  await moveTo(new T3.Vector3(0, 1.0, -4.3), 600);
  await moveTo(new T3.Vector3(0, 1.6, -6), 1300);
  trainHorn(0, 1.4);
  await lookTo(Math.PI / 2, .02, 1200);
  const rumble = loopNoise('train', { type: 'lowpass', freq: 220, vol: .7, fadeIn: 4 });
  CR.head.intensity = 2.2;
  trainHorn(1.6, 2.2);
  await tween(4200, (e, k) => { CR.train.position.x = -160 + 149 * Math.pow(k, 1.6); post.uniforms.uBright.value = 1 + Math.max(0, k - .75) * 6; });
  // 衝突: 電車・踏切・環境音を一瞬で断ち、鈍い音だけ残す
  stopSnd('train', .04); stopSnd('bell'); stopSnd('night');
  blackout(); post.uniforms.uBright.value = 1;
  crunch();
  await sleep(3200);
  // 静寂のあと、救急車のサイレンだけが鳴り続ける(ゲームオーバー画面でも続く)
  sirenStart();
  await sleep(14000);
}
async function deathStairs(){
  await say('部屋を出た。', 1800);
  skippable = false;
  calmDown(); await fade(1, 700); humTo(0, .1); S.ticking = false;
  doorSlam(); for(let i = 0; i < 5; i++) step(.3, .4 + i * .4);
  loopNoise('night', { type: 'lowpass', freq: 300, vol: .12, fadeIn: 1.5 });
  await sleep(2200);
  skippable = true;
  await say('川に架かる、橋の上。', 2400);
  await say('高いところから落ちる夢は、いつも途中で目が覚める。', 3400);
  await say('欄干から、飛んだ。', 2600);
  skippable = false;
  whoosh(); await sleep(450);
  noiseHit(.7, 1.1, 'lowpass', 900, .7, .55); thud(.5, .6);   // 水に落ちる音
  await sleep(2600);
  stopSnd('night');
  await sleep(3000);
  skippable = true;
  await say('川沿いの道を、誰かが走ってくる足音がした。', 3000);
  for(let i = 0; i < 7; i++) step(.35, i * .22);
  await sleep(1800);
  await say('「……大丈夫ですか」', 2800);
  await say('「誰か、救急車を」', 3200);
  await sleep(1500);
}

/* ---- success: 7:00 ---- */
async function nextNight(){ S.seenNow.forEach(id => S.seen.add(id)); S.night++; newGame(true); return memorize(); }
async function nightEnd(){
  S.mode = 'cut'; S.scene = 'room'; S.day = true; S.active = new Set();
  setSkip(() => start(nextNight));
  setHour(7); rebuild(); resetView();
  setFade(1, '#000'); humTo(.08);
  await center('午前7時', 1500);
  S.ticking = true;
  await fade(0, 1600);
  skippable = true;
  await say('朝になった。', 2400);
  await say('第' + S.night + '夜が、終わった。', 2400);
  await say('また、夜が来る。', 2400);
  skippable = false;
  await fade(1, 1800);
  S.ticking = false;
  await sleep(500);
  return nextNight();
}
async function morning(){
  if(S.night < NIGHTS) return nightEnd();
  S.mode = 'cut'; S.scene = 'room'; S.day = true; S.active = new Set();
  setSkip(() => start(finishMorning));
  rebuild(); resetView();
  setHour(7);
  setFade(1, '#000');
  await center('午前7時', 1800);
  S.ticking = true; humTo(.08);
  alarmStart();
  await fade(0, 2000);
  skippable = true;
  await say('アラームが鳴っている。', 2400);
  const a = aimAt(new T3.Vector3(-.5, .53, 2.09));
  await lookTo(a.yaw, a.pitch, 1800);
  ARM.tool = 'phone';
  tween(1000, e => { ARM.reach = e; if(e > .5) R.phoneGroup.visible = false; });
  await say('スマホを手に取った。', 1800);
  stopSnd('alarm');
  skippable = false;
  $('phone').classList.add('on'); setGrain(true);
  await sleep(1200);
  await new Promise(res => {
    const done = () => { $('phone').removeEventListener('pointerdown', done); vclear(tid); res(); };
    const tid = vset(done, 20000);
    $('phone').addEventListener('pointerdown', done);
  });
  $('phone').classList.remove('on'); setGrain(false);
  await sleep(600);
  await fade(1, 1400);
  S.ticking = false;
  skippable = true;
  await say('顔を洗った。', 2000);
  await say('着替えた。', 2000);
  await say('保険証を、財布に入れた。', 2400);
  skippable = false;
  V.pos.set(.75, 1.58, -.95); V.yaw = 0; V.pitch = -.02; V.roll = 0;
  await fade(0, 1400);
  await sleep(900);
  creak();
  await tween(2000, e => { R.door.rotation.y = -1.4 * e; });
  await sleep(700);
  moveTo(new T3.Vector3(.75, 1.58, -3.0), 3200);
  await sleep(600);
  await wardBlink();
  await sleep(300);
  await fade(1, 2600, '#fff');
  await sleep(600);
  S.trueEnd = TRUE_END_ENABLED && S.mistakes === 0;
  if(S.trueEnd) return trueEnding();
  skippable = true;
  await say('外に出た。', 2800, true);
  skippable = false;
  await finishMorning();
}
/* 通常エンディング: 歩いている途中で、一瞬だけ病室が映る(まだ夢の中だった、とほのめかす) */
async function wardBlink(){
  S.scene = 'ward'; S.beeping = true;
  await sleep(260);
  S.beeping = false; S.scene = 'room';
}
/* 真エンディング: 一度もミスしなかった人だけが見る(病室で目覚める) */
/* 真エンディング: 静かな黒い人 → 病室で目覚める(先生・母・父の声) → 退院して街並み → TRUE END */
async function trueEnding(){
  S.mode = 'cut'; S.scene = 'room'; skippable = true;
  setSkip(() => start(trueAfter));
  S.day = false; S.active = new Set(['shadowBed']); setHour(1); rebuild(); resetView();
  R.sBed.position.set(-.55, 0, 1.4); R.sBed.lookAt(BED_EYE.x, 0, BED_EYE.z);
  V.pos.set(BED_EYE.x, .9, BED_EYE.z); V.pitch = .45; V.yaw = .3;      // 横になって、天井を見ている
  S.ticking = false; humTo(0, .05); stopAllSnd();
  post.uniforms.uNarrow.value = .45; post.uniforms.uBlur.value = .7;
  setFade(1, '#000');
  await sleep(600);
  every('heart', 1700, () => beatOnce(.4));                              // ゆっくりした、小さな心音
  await fade(0, 2600);
  await sleep(1800);
  const am = aimAt(new T3.Vector3(-.55, 1.62, 1.4));
  await lookTo(am.yaw, am.pitch, 7500);                                  // ゆっくり、黒い人の顔へ(揺れも、赤みもなし)
  await sleep(3800);
  skippable = false;
  stopSnd('heart');
  await fade(1, 2600, '#000');
  await trueAfter();
}
async function trueAfter(){
  post.uniforms.uNarrow.value = 0; post.uniforms.uBlur.value = 0;
  setFade(1, '#000'); stopAllSnd();
  await trueTail();
}
async function trueTail(){
  setFade(1, '#000'); S.scene = 'room';
  skippable = true;
  setSkip(() => start(trueWake));
  await say('先生「目を覚ましました」', 3000);
  await say('母「良かった！」', 2200);
  await say('(母の、泣く声。)', 2600);
  await say('父「心配させて。お前は、3カ月も寝たままだったんだぞ」', 4400);
  await say('目を覚ますと、そこは病院の病室のベッドの上だった。', 4800);
  await trueWake();
}
/* 目を覚ました瞬間から、画面は鮮明。病室を見回すと、自分の部屋と同じ間取り。黒い人が立っていた場所に、先生・看護師・お見舞いの人がいる */
async function trueWake(){
  S.mode = 'cut'; S.scene = 'ward'; skippable = true;
  setSkip(() => start(trueDischarge));
  V.pos.set(-1.28, .98, 1.5); V.yaw = .35; V.pitch = 1.2; V.roll = 0; V.tfov = V.fov = 66; V.breathe = 1;   // 目を開けると、病院の天井
  post.uniforms.uNarrow.value = .95; post.uniforms.uBlur.value = 1.4; post.uniforms.uBright.value = 1;
  S.beeping = true;
  setFade(1, '#000');
  await sleep(500);
  fade(0, 1800);
  await tween(2600, e => { post.uniforms.uNarrow.value = .95 * (1 - e); post.uniforms.uBlur.value = 1.4 * (1 - e); });
  await wait(400);
  await Promise.all([moveTo(new T3.Vector3(-1.28, 1.18, 1.45), 1800), lookTo(.1, -.05, 1800)]);   // 起き上がる
  const look = (x, y, z, ms) => { const m = aimAt(new T3.Vector3(x, y, z)); return lookTo(m.yaw, m.pitch, ms); };
  await look(.75, 1.2, -2.4, 1100); await say('ドアの位置。', 1300);
  await look(1.8, 1.45, .5, 1100); await say('窓の位置。', 1300);
  await look(1.3, .9, -1.3, 1000); await say('机の場所まで。', 1500);
  await lookTo(0, -.05, 900);
  await say('……僕の部屋と、同じ間取りだ。', 2600);
  await say('黒い人影が立っていた場所に、人が立っている。', 3000);
  for(const [x, y, z] of [[-1.42, 1.5, -1.55], [.75, 1.5, -3.0], [-.45, 1.4, .85], [-.4, 1.4, 1.3]]){ await look(x, y, z, 900); await wait(600); }
  skippable = false;
  await fade(1, 2200, '#000');
  await trueDischarge();
}
/* 退院。病院を出ると、目の前に、陽光がきらめく街並みが広がる */
const TOWN_END = { pos: new T3.Vector3(0, 1.75, -6), pitch: .04, fov: 72 };
async function trueDischarge(){
  S.mode = 'cut'; S.scene = 'town'; S.townIdle = false; skippable = true;
  setSkip(() => start(trueFinish));
  stopAllSnd(); S.beeping = false; TW.open = 0; let amb = false;
  V.pos.set(0, 1.55, 5.2); V.yaw = 0; V.pitch = 0; V.roll = 0; V.tfov = V.fov = 62; V.breathe = 1;
  post.uniforms.uNarrow.value = 0; post.uniforms.uBlur.value = 0; post.uniforms.uBright.value = .8;
  setFade(1, '#000');
  await sleep(500);
  fade(0, 2200);
  for(let i = 0; i < 14; i++) step(.2, i * .7);
  const sm = (a, b, x) => { const k = clamp((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
  await tween(11000, e => {
    const z = 5.2 + (TOWN_END.pos.z - 5.2) * e;
    V.pos.set(0, 1.55 + (TOWN_END.pos.y - 1.55) * e, z); V.pitch = TOWN_END.pitch * e; V.fov = V.tfov = 62 + (TOWN_END.fov - 62) * e;
    TW.open = sm(3.8, 2.2, z);   // 自動ドアが開く
    if(!amb && TW.open > .4){ amb = true; townSoundsStart(); }   // ドアが開くと、外の風と鳥の声
    post.uniforms.uBright.value = .8 + 1.2 * sm(3.2, 1.0, z) - .95 * sm(1.0, -3.5, z);   // 外の光で、まぶしく
  });
  skippable = false;
  await wait(900);
  await lookTo(.14, .85, 2600);   // 外に出て、一度、空を見上げる
  await wait(2400);
  await lookTo(0, TOWN_END.pitch, 2200);
  await wait(1200);
  await trueFinish();
}
async function trueFinish(){
  setSkip(null); skippable = false;
  S.beeping = false; S.scene = 'town'; TW.open = 1; S.trueEnd = true; markCleared();
  if(!snd.windTown) townSoundsStart();
  post.uniforms.uNarrow.value = 0; post.uniforms.uBlur.value = 0; post.uniforms.uBright.value = 1;
  V.pos.copy(TOWN_END.pos); V.yaw = 0; V.pitch = TOWN_END.pitch; V.roll = 0; V.fov = V.tfov = TOWN_END.fov; V.breathe = 0;
  // 白い光の中へ、ゆっくりフェードアウト → 白からゆっくりフェードインして、タイトル画面
  stopSnd('windTown', 3.2); stopSnd('birds');
  await fade(1, 3200, '#fff');
  S.mode = 'title'; townTitle(true);
  const tl = $('title'); tl.style.transition = 'none'; tl.style.opacity = 0; show('title', true); void tl.offsetWidth;
  tl.style.transition = 'opacity 3200ms linear'; tl.style.opacity = 1;
  await fade(0, 3200);
  tl.style.transition = ''; tl.style.opacity = ''; setFade(0, '#000');
}
/* 新聞記事(黒い人に捕まった時: 川に落ちていたと分かる) */
async function showNews(onSkip){
  S.mode = 'cut'; skippable = true;
  setSkip(onSkip);
  const news = $('news');
  news.querySelectorAll('.nf').forEach(e => e.style.opacity = 0);
  show('news', true);
  setFade(0, '#000');
  await sleep(1500);
  const parts = [...news.querySelectorAll('.nf')];
  const waits = [1800, 2200, 3600, 4200, 4800, 4200];
  for(let i = 0; i < parts.length; i++){ parts[i].style.opacity = 1; await wait(waits[i] || 3000); }
  await wait(3500);
  skippable = false;
  await fade(1, 2200, '#000');
  await sleep(600);
}
async function finishMorning(){
  setSkip(null);
  S.mode = 'end';
  $('endE').textContent = S.trueEnd ? 'TRUE END' : 'END';
  $('end').classList.toggle('scene', !!S.trueEnd);
  show('end', true);
  if(S.trueEnd){ S.townIdle = true; setFade(0); } else setFade(1, '#000');
  humTo(0);
}

function gameOver(reason, info, note){
  setSkip(null); S.mistakes++; show('news', false);
  $('overNote').textContent = note || '';
  S.mode = 'over'; S.look = false; skippable = false;
  const keep = S.death === 'crossing' ? snd.siren : null;
  if(keep) delete snd.siren;
  stopAllSnd(); S.beeping = false; S.ticking = false;
  if(keep) snd.siren = keep;
  $('overText').innerHTML = `<div>${reason}</div><div class="m">${info}</div><div class="m">到達 ── 第${S.night}夜 午前${S.hour}時</div>`;
  show('over', true);
  $('sub').style.opacity = 0;
}

/* ---- screens ---- */
const CLEAR_KEY = DEBUG ? 'dd_true_clear_debug' : 'dd_true_clear';   // デバッグ画面は別のキー
const isCleared = () => { try{ return localStorage.getItem(CLEAR_KEY) === '1'; }catch(_){ return false; } };
function markCleared(){ try{ localStorage.setItem(CLEAR_KEY, '1'); }catch(_){} document.body.classList.add('cleared'); }
function townTitle(keepFade){   // 真エンディングをクリアした後は、タイトル画面の背景が、ラストの街並みになる
  S.scene = 'town'; S.townIdle = true; TW.open = 1;
  V.pos.copy(TOWN_END.pos); V.yaw = 0; V.pitch = TOWN_END.pitch; V.roll = 0; V.fov = V.tfov = TOWN_END.fov; V.breathe = 0;
  post.uniforms.uBright.value = 1; post.uniforms.uNarrow.value = 0; post.uniforms.uBlur.value = 0;
  if(!keepFade) setFade(0);
}
function toTitle(){ return start(async () => { if(isCleared()) townTitle(); else setFade(1, '#000'); S.mode = 'title'; show('title', true); }); }
$('title').addEventListener('click', () => { audioInit(); show('title', false); show('rules', true); });
$('rules').addEventListener('click', () => start(async () => { newGame(); await memorize(); }));
$('bReset') && $('bReset').addEventListener('click', e => {   // クリア記録を消して、タイトルをクリア前に戻す
  e.stopPropagation();
  if(!confirm('クリアの記録を消して、タイトル画面をクリア前に戻します。よろしいですか?')) return;
  try{ localStorage.removeItem(CLEAR_KEY); }catch(_){}
  document.body.classList.remove('cleared'); S.scene = 'room'; S.townIdle = false; setFade(1, '#000');
  document.querySelector('#rules .s').textContent = 'クリア記録をリセットしました。クリックで続ける';
});
$('bRetry').onclick = () => start(async () => { setFade(1, '#000'); newGame(true); await memorize(); });   // 同じ夜を、部屋を覚えるところからやり直す
$('bTitle').onclick = toTitle;
$('bResume').onclick = () => setPause(false);
$('bPauseTitle').onclick = () => { setPause(false); toTitle(); };
$('bEndTitle').onclick = toTitle;

S.active = new Set(); rebuild(); drawClock(3600, false, false);
if(!DEBUG && isCleared()){ document.body.classList.add('cleared'); townTitle(); }
requestAnimationFrame(loop);

/* ============================================================
   DEBUG PANEL (debug.html only)
   ============================================================ */
let dbgInfo = () => {};
if(DEBUG) buildDebug();
function buildDebug(){
  const panel = document.createElement('div'); panel.id = 'dbg';
  const btn = document.createElement('button'); btn.id = 'dbgBtn'; btn.textContent = 'DEBUG [F2]';
  document.body.append(panel, btn);
  const toggle = () => panel.classList.toggle('on');
  btn.onclick = toggle;
  addEventListener('keydown', e => { if(e.key === 'F2' || e.key === '`'){ e.preventDefault(); toggle(); } });

  const diffLabel = { 1: 'すぐ', 2: 'ふつう', 3: '気づきにくい' };
  panel.innerHTML = `
    <h3>状態</h3><div class="info" id="dInfo"></div>
    <h3>部屋</h3>
    <div>
      <button data-a="room">部屋を表示(自由観察)</button>
      <button data-a="newgame">通常ゲーム開始</button>
      <button data-a="title">タイトル</button>
      <button data-a="tutorial">チュートリアル画面</button>
    </div>
    <div>
      <button data-a="night">夜</button><button data-a="day">朝(昼)</button>
      <button data-a="free" id="dFree">フリーカメラ</button><button data-a="bed">ベッドに戻る</button>
    </div>
    <div class="note">フリーカメラ: WASDで移動 / Q・Eで上下 / Shiftで速く / 矢印キーで向き</div>
    <h3>夜(散らかり・難しさ)</h3>
    <div>${[1, 2, 3].map(n => '<button data-n="' + n + '">第' + n + '夜</button>').join('')}<button data-a="nextnight">夜明け演出(次の夜へ)</button></div>
    <h3>時刻</h3>
    <div>${[1, 2, 3, 4, 5, 6, 7].map(h => `<button data-h="${h}">${h}時</button>`).join('')}</div>
    <h3>正解の設定(この部屋は…)</h3>
    <div><button data-a="dream" id="dDream">夢(起きるが正解)</button><button data-a="real" id="dReal">現実(眠るが正解)</button></div>
    <div class="note">異変をオンにすると自動で「夢」、全部オフで「現実」になります。</div>
    <h3>異変 (${ANOM.length}種類)</h3>
    <div><button data-a="clear">すべて解除</button><button data-a="randomA">ランダム1つ</button></div>
    <div id="dAnoms">${ANOM.map(a => `<div class="an"><span class="d">${diffLabel[a.d].slice(0, 3)}</span><input type="checkbox" id="an_${a.id}" data-an="${a.id}"><label for="an_${a.id}">${a.name}</label><button data-look="${a.id}" title="そちらを向く">見る</button></div>`).join('')}</div>
    <h3>選択の演出</h3>
    <div><button data-a="actClock">起きる(時計を叩く)</button><button data-a="actCheek">起きる(頬をつねる)</button><button data-a="actSleep">眠る(心音)</button></div>
    <h3>エンディング / 死亡シーン</h3>
    <div>
      <button data-e="clear">クリア(朝7時)</button>
      <button data-e="hospital">病院(夢なのに眠る)</button>
      <button data-e="caught">黒い人に追いつかれる</button>
      <button data-e="town">退院(街並み)</button>
      <button data-e="wake">真エンディング(病室で目覚める)</button>
      <button data-e="trueend">真エンディング(黒い人→病室→退院→街並み)</button>
    </div>
    <div>${Object.entries(DEATHS).map(([k, v]) => `<button data-d="${k}">死亡: ${v.name}</button>`).join('')}<button data-d="random">死亡: ランダム</button></div>
    <div><button data-e="over">ゲームオーバー画面</button><button data-e="end">END画面</button></div>
    <h3>画面</h3>
    <div>
      <button data-a="filter" id="dFilter" class="on">90年代フィルター</button>
      <button data-a="lowres" id="dLow" class="on">低解像度(240)</button>
      <button data-a="flash">スマホのライト</button>
      <button data-a="arms" id="dArms" class="on">主人公の腕</button>
      <button data-arm="phone">スマホを持つ</button><button data-arm="hammer">ハンマーを持つ</button><button data-arm="none">手を戻す</button>
    </div>
    <h3>音</h3>
    <div>音量 <span id="dVolV">100</span>%<input type="range" id="dVol" min="0" max="300" value="100"></div>
    <div><button data-s="tick">時計</button><button data-s="alarm">アラーム</button><button data-s="siren">サイレン</button><button data-s="bell">踏切</button><button data-s="horn">警笛</button><button data-s="car">クラクション</button><button data-s="thud">衝撃</button><button data-s="stop">音を止める</button></div>
  `;
  const q = s => panel.querySelector(s);

  async function enterRoom(){
    S.scene = 'room'; rebuild();
    setHour(S.hour); rebuild();
    setFade(0); S.mode = 'play'; S.look = true; S.ticking = true;
    hud(true); tools(true); startAnomalySounds();
  }
  const goRoom = () => start(enterRoom);
  const ensureRoom = () => { if(S.mode !== 'play' || S.scene !== 'room') goRoom(); };
  function syncChecks(){ ANOM.forEach(a => { q('#an_' + a.id).checked = S.active.has(a.id); }); }
  function setActive(set){ S.active = set; S.isDream = set.size > 0; rebuild(); syncChecks(); ensureRoom(); startAnomalySounds(); }

  panel.addEventListener('click', e => {
    const b = e.target.closest('button'); if(!b) return;
    audioInit();
    const a = b.dataset.a, h = b.dataset.h, en = b.dataset.e, d = b.dataset.d, look = b.dataset.look, s = b.dataset.s;
    if(a === 'room') goRoom();
    if(a === 'newgame') start(async () => { setFade(1, '#000'); newGame(); await memorize(); });
    if(a === 'title') toTitle();
    if(a === 'tutorial') start(async () => { show('rules', true); });
    if(a === 'night' || a === 'day'){ S.day = a === 'day'; rebuild(); ensureRoom(); }
    if(a === 'free'){ V.free = !V.free; b.classList.toggle('on', V.free); }
    if(a === 'bed'){ V.pos.copy(BED_EYE); V.yaw = 0; V.pitch = -.05; }
    if(a === 'dream'){ S.isDream = true; }
    if(a === 'real'){ S.isDream = false; }
    if(a === 'clear') setActive(new Set());
    if(a === 'randomA'){ S.used = new Set(); setActive(new Set([pick(ANOM).id])); }
    if(a === 'arms'){ ARM.on = !ARM.on; b.classList.toggle('on', ARM.on); }
    if(b.dataset.arm){ const k = b.dataset.arm; ensureRoom(); ARM.tool = k === 'none' ? null : k; tween(900, e => { ARM.reach = k === 'none' ? 1 - e : e; }); }
    if(a === 'filter'){ const on = post.uniforms.uFilter.value < .5; post.uniforms.uFilter.value = on ? 1 : 0; b.classList.toggle('on', on); }
    if(a === 'lowres'){ VIEW.lowH = VIEW.lowH ? 0 : 240; b.classList.toggle('on', !!VIEW.lowH); resize(); }
    if(b.dataset.n){ S.night = +b.dataset.n; rebuild(); ensureRoom(); }
    if(a === 'nextnight') start(async () => { newGame(true); S.hour = 6; await nightEnd(); });
    if(h){ setHour(+h); rebuild(); ensureRoom(); startAnomalySounds(); }
    if(a === 'actClock') start(async () => { S.scene = 'room'; rebuild(); setFade(0); S.mode = 'trans'; await smashClock(); await enterRoom(); });
    if(a === 'actCheek') start(async () => { S.scene = 'room'; rebuild(); setFade(0); S.mode = 'trans'; await slapCheek(); await enterRoom(); });
    if(a === 'actSleep') start(async () => { S.scene = 'room'; rebuild(); setFade(0); S.mode = 'trans'; await sleepFade(); await enterRoom(); });
    if(a === 'flash'){ S.flash = !S.flash; $('bLight').classList.toggle('act', S.flash); $('bLight').textContent = S.flash ? 'ライト ON' : 'ライト'; b.classList.toggle('on', S.flash); }
    if(look){
      ensureRoom();
      const p = new T3.Vector3(...ANOM_BY[look].at), am = aimAt(p);
      V.yaw = am.yaw; V.pitch = am.pitch;
    }
    if(en === 'clear') start(async () => { S.night = NIGHTS; await morning(); });
    if(en === 'hospital') start(async () => { S.scene = 'room'; rebuild(); setFade(0); await hospitalEnding(); });
    if(en === 'town') start(async () => { S.scene = 'room'; rebuild(); await trueDischarge(); });
    if(en === 'wake') start(async () => { S.scene = 'room'; rebuild(); setFade(1, '#000'); await trueTail(); });
    if(en === 'trueend') start(async () => { S.night = NIGHTS; S.trueEnd = true; await trueEnding(); });
    if(en === 'caught') start(async () => { S.scene = 'room'; S.active = new Set(['shadowBed']); rebuild(); setFade(0); R.sBed.position.set(-1.0, 0, .9); await caughtEnding(R.sBed); });
    if(en === 'over') start(async () => { gameOver('これは、夢ではなかった。', '(デバッグ表示)'); });
    if(en === 'end') start(async () => { show('end', true); });
    if(d) start(async () => { S.scene = 'room'; S.active = new Set(); S.isDream = false; rebuild(); syncChecks(); setFade(0); setHour(S.hour); S.ticking = true; await panicEnding(d === 'random' ? null : d); });
    if(s === 'tick') tick();
    if(s === 'alarm'){ alarmStart(); setTimeout(() => stopSnd('alarm'), 3000); }
    if(s === 'siren'){ sirenStart(); setTimeout(() => stopSnd('siren', 1), 8000); }
    if(s === 'bell'){ bellStart(); setTimeout(() => stopSnd('bell'), 3000); }
    if(s === 'horn') trainHorn(0, 1.6);
    if(s === 'car'){ carHorn(0, 1); brakes(.6, 1.1); }
    if(s === 'thud') thud(1.1);
    if(s === 'stop') stopAllSnd();
  });
  panel.addEventListener('change', e => {
    const id = e.target.dataset.an; if(!id) return;
    const set = new Set(S.active);
    e.target.checked ? set.add(id) : set.delete(id);
    setActive(set);
  });
  q('#dVol').addEventListener('input', e => { const v = +e.target.value; q('#dVolV').textContent = v; setVolume(v / 100); });

  dbgInfo = () => {
    q('#dInfo').textContent =
      `mode: ${S.mode} / scene: ${S.scene} / ${S.day ? '朝' : '夜'}\n` +
      `第${S.night}夜  時刻: 午前${S.hour}時  ラウンド: ${S.idx + 1}/6\n` +
      `正解: ${S.isDream ? '夢 →「起きる」' : '現実 →「眠る」'}\n` +
      `異変: ${activeNames().join(' / ') || 'なし'}\n` +
      `camera: (${V.pos.x.toFixed(2)}, ${V.pos.y.toFixed(2)}, ${V.pos.z.toFixed(2)}) yaw ${V.yaw.toFixed(2)} fov ${V.fov.toFixed(0)}`;
    q('#dDream').classList.toggle('on', S.isDream); q('#dReal').classList.toggle('on', !S.isDream);
  };

  window.__DD = { S, V, R, CR, post, rebuild, setFade, snd, ANOM, pickAnomaly, nightEnd, nextNight, memorize, newGame };
  // debug starts straight in the room
  show('title', false);
  newGame();
  goRoom();
  panel.classList.add('on');
}
})();
