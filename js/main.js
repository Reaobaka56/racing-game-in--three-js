import * as THREE from 'three';
import { buildTrackData, buildTrackMeshes, buildBoostPads, buildScenery, makeGrassTexture, ROAD_HALF } from './track.js';
import { makeSky, makeEnvironment, SUN_DIR } from './sky.js';
import { loadCar } from './car.js';
import { CarPhysics } from './physics.js';
import { Particles, SkidMarks } from './fx.js';
import { GameAudio } from './audio.js';
import { Input } from './input.js';
import { AutoDriver } from './ai.js';
import { UI, fmt } from './ui.js';

const params = new URLSearchParams(location.search);
const LAPS = 3;
const MEDALS = [
  { name: 'Gold', title: 'Podium finish', color: '#ffc83d', max: 170 },
  { name: 'Silver', title: 'Solid drive', color: '#cfd6dd', max: 185 },
  { name: 'Bronze', title: 'Race complete', color: '#cd7f32', max: 210 },
  { name: 'Finished', title: 'Race complete', color: '#6b7682', max: 1e9 },
];
const PAINTS = [
  { name: 'Tornado Red', hex: '#c8141e' }, { name: 'Pure White', hex: '#eceff2' }, { name: 'Racing Blue', hex: '#1d55c9' },
  { name: 'Sunset Orange', hex: '#ff6a13' }, { name: 'Viper Green', hex: '#58b82e' }, { name: 'Titan Grey', hex: '#6a727c' },
  { name: 'Deep Black', hex: '#14161a' },
];
const FOG_COLOR = 0xd9a47c;

const ui = new UI();
const audio = new GameAudio();
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

/* ---------------- renderer / scene ---------------- */
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
let maxPR = Math.min(window.devicePixelRatio || 1, 2);
let pr = Math.min(maxPR, 1.5);
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(FOG_COLOR, 0.00052);
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 6000);
scene.add(camera);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(pr); renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

/* ---------------- world ---------------- */
const track = buildTrackData();
const sky = makeSky(); scene.add(sky);
scene.environment = makeEnvironment(renderer);
scene.environmentIntensity = 0.85;

const hemi = new THREE.HemisphereLight(0x9db8ff, 0x6a5440, 0.55); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffd0a0, 3.3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const SH = 38;
Object.assign(sun.shadow.camera, { left: -SH, right: SH, top: SH, bottom: -SH, near: 1, far: 260 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);

const grassTex = makeGrassTexture(); grassTex.repeat.set(900, 900);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1, color: 0xd8d8c8 }));
ground.rotation.x = -Math.PI / 2; ground.position.y = -0.03; ground.receiveShadow = true; scene.add(ground);

const trackM = buildTrackMeshes(track); scene.add(trackM.group);
const scenery = buildScenery(track); scene.add(scenery.group);

// boost pads on straight sections
function pickPadSpots() {
  const spots = [], n = 8;
  for (let k = 0; k < n; k++) {
    let i0 = Math.floor((k / n) * track.N) + 50;
    for (let d = 0; d < 120; d++) {
      const i = (i0 + d) % track.N; let m = 0;
      for (let q = -14; q <= 14; q++) m = Math.max(m, Math.abs(track.curv[(i + q + track.N) % track.N]));
      if (m < 0.004) { spots.push({ i, lat: [0, -3, 3][k % 3] }); break; }
    }
  }
  return spots;
}
const padsObj = buildBoostPads(track, pickPadSpots()); scene.add(padsObj.group);

// particles & skid marks
const smoke = new Particles(260), dust = new Particles(200), sparks = new Particles(120, { additive: true, gravity: 14 }), flames = new Particles(160, { additive: true });
const skids = new SkidMarks(2200);
scene.add(smoke.points, dust.points, sparks.points, flames.points, skids.mesh);

/* ---------------- state ---------------- */
const phys = new CarPhysics(track);
const input = new Input(canvas);
const bot = new AutoDriver(track, { aLat: 20 });
const game = {
  state: 'loading', // loading | menu | countdown | racing | finished
  paused: false,
  raceTime: 0, lapStart: 0, lapsDone: 0, lapTimes: [], bestLapRace: null,
  countdown: 0, lastCount: 4,
  camMode: 0, shake: 0, stuckT: 0,
  records: loadRecords(), car: null, auto: false,
  finishT: 0,
};
function loadRecords() { try { return JSON.parse(localStorage.getItem('clubsport.records') || '{}'); } catch (e) { return {}; } }
function saveRecords() { try { localStorage.setItem('clubsport.records', JSON.stringify(game.records)); } catch (e) { /* ignore */ } }
ui.records(game.records.lap, game.records.race);
ui.minimapInit(track);

const START_IDX = track.N - 6; // grid slot ~15 m behind the line
function placeOnGrid() {
  phys.reset(START_IDX, 0, 0);
  phys.cum = -6 * track.ds; phys._lastIdx = START_IDX;
  skids.clear();
}
placeOnGrid();

/* ---------------- camera ---------------- */
const cam = { heading: phys.psi, pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 62, orbit: 0 };
const tmpV = new THREE.Vector3();
const wrapA = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

function updateCamera(dt, snap = false) {
  const s = phys, speed = s.speed;
  const kSnap = snap ? 1 : null;
  const mode = (game.state === 'menu' || (game.state === 'finished')) ? 'cine' : ['chase', 'hood', 'far'][game.camMode];
  let targetFov = 62 + Math.min(1, speed / 70) * 12 + (s.nitroOn ? 9 : 0);
  if (mode === 'cine') {
    cam.orbit += dt * 0.35;
    const a = s.psi + Math.PI + Math.sin(cam.orbit) * 1.1 + 0.5 * Math.sign(Math.sin(cam.orbit * 0.5) + 0.001);
    const dist = 7.5 + Math.sin(cam.orbit * 0.7) * 1.5;
    const target = new THREE.Vector3(s.x + Math.sin(a) * dist, 1.3 + Math.abs(Math.sin(cam.orbit * 0.9)) * 0.8, s.z + Math.cos(a) * dist);
    cam.pos.lerp(target, kSnap ?? (1 - Math.exp(-dt * 9)));
    cam.look.lerp(tmpV.set(s.x, 0.8, s.z), kSnap ?? (1 - Math.exp(-dt * 8)));
    targetFov = 52;
  } else if (mode === 'hood') {
    const hd = s.psi + cam.slideYaw;
    const fx = Math.sin(s.psi), fz = Math.cos(s.psi), lx = Math.cos(s.psi), lz = -Math.sin(s.psi);
    const p = tmpV.set(s.x + fx * 0.95 + lx * 0.0, 1.26, s.z + fz * 0.95 + lz * 0.0);
    cam.pos.copy(p);
    const dirA = s.psi + (cam.slideYaw || 0);
    cam.look.set(s.x + Math.sin(dirA) * 30, 1.05, s.z + Math.cos(dirA) * 30);
    targetFov = 70 + Math.min(1, speed / 70) * 14 + (s.nitroOn ? 8 : 0);
  } else {
    // chase: blend car heading with velocity direction so drifts look dramatic
    const velA = speed > 4 ? Math.atan2(s.vx, s.vz) : s.psi;
    const target = s.psi + wrapA(velA - s.psi) * 0.35;
    cam.heading += wrapA(target - cam.heading) * (kSnap ?? (1 - Math.exp(-dt * 5.5)));
    const far = mode === 'far';
    const dist = (far ? 10.5 : 6.3) + Math.min(1, speed / 70) * (far ? 2.0 : 1.4) + (s.nitroOn ? 0.7 : 0);
    const hgt = far ? 4.2 : 2.05;
    const dx = Math.sin(cam.heading), dz = Math.cos(cam.heading);
    const desired = tmpV.set(s.x - dx * dist, hgt, s.z - dz * dist);
    cam.pos.lerp(desired, kSnap ?? (1 - Math.exp(-dt * 14)));
    cam.look.set(s.x + dx * 7, far ? 0.8 : 1.15, s.z + dz * 7);
    // keep the car position exact in view by lerping look toward the car a bit
  }
  cam.fov += (targetFov - cam.fov) * (kSnap ?? (1 - Math.exp(-dt * 4)));
  camera.fov = cam.fov; camera.updateProjectionMatrix();
  camera.position.copy(cam.pos);
  // shake
  const sh = game.shake;
  if (sh > 0.002) {
    camera.position.x += (Math.random() - 0.5) * sh; camera.position.y += (Math.random() - 0.5) * sh * 0.7; camera.position.z += (Math.random() - 0.5) * sh;
    game.shake *= Math.exp(-dt * 7);
  }
  if (s.nitroOn) { camera.position.y += (Math.random() - 0.5) * 0.02; }
  camera.lookAt(cam.look);
  if (mode === 'hood') camera.rotateZ(-(game.car ? game.car.roll : 0) * 0.6);
}
cam.slideYaw = 0;

/* ---------------- effects ---------------- */
const SMOKE_COL = [0.86, 0.86, 0.88], DUST_COL = [0.55, 0.45, 0.32];
function wheelWorld(c, out) {
  const w = game.car.wheels[c].center, f = [Math.sin(phys.psi), Math.cos(phys.psi)], l = [Math.cos(phys.psi), -Math.sin(phys.psi)];
  out.x = phys.x + f[0] * w.z + l[0] * w.x; out.z = phys.z + f[1] * w.z + l[1] * w.x; return out;
}
const _w = { x: 0, z: 0 };
let fxAcc = 0;
function updateEffects(dt, inp) {
  const car = game.car; if (!car) return;
  const s = phys;
  const rear = ['RL', 'RR'], all = ['FL', 'FR', 'RL', 'RR'];
  const slide = Math.max(0, Math.abs(s.vL) - 2.2);
  const hardBrake = inp.brake > 0.8 && s.vF > 22;
  const wheelspin = inp.throttle > 0.9 && s.vF < 9 && s.vF >= 0 && game.state === 'racing' && s.onRoad;
  const skidI = s.onRoad ? Math.min(1, slide / 4) : 0;
  all.forEach((c, i) => {
    wheelWorld(c, _w);
    let I = 0;
    if (i >= 2) I = Math.max(skidI, wheelspin ? 0.55 : 0, hardBrake ? 0.6 : 0); else I = hardBrake ? 0.5 : (skidI > 0.6 ? skidI * 0.5 : 0);
    skids.add(i, _w.x, _w.z, 0, 0, I);
  });
  fxAcc += dt;
  const step = 1 / 60;
  while (fxAcc > step) {
    fxAcc -= step;
    if ((skidI > 0.15 || wheelspin || hardBrake) && s.onRoad) {
      for (const c of rear) {
        wheelWorld(c, _w);
        const a = Math.min(0.5, 0.18 + skidI * 0.35 + (wheelspin ? 0.2 : 0));
        smoke.emit(_w.x + (Math.random() - 0.5) * 0.3, 0.2, _w.z + (Math.random() - 0.5) * 0.3, s.vx * 0.15 + (Math.random() - 0.5) * 1.2, 0.5 + Math.random() * 0.9, s.vz * 0.15 + (Math.random() - 0.5) * 1.2,
          { life: 0.9 + Math.random() * 0.7, size: 1.0 + Math.random() * 0.6, grow: 3.2, color: SMOKE_COL, alpha: a, drag: 1.4 });
      }
    }
    if (!s.onRoad && s.speed > 4) {
      for (const c of all) {
        if (Math.random() > 0.55) continue;
        wheelWorld(c, _w);
        dust.emit(_w.x, 0.15, _w.z, s.vx * 0.25 + (Math.random() - 0.5) * 2, 0.8 + Math.random() * 1.6, s.vz * 0.25 + (Math.random() - 0.5) * 2,
          { life: 0.8 + Math.random() * 0.8, size: 0.9 + Math.random() * 0.7, grow: 3, color: DUST_COL, alpha: Math.min(0.5, s.speed / 60), drag: 1.5 });
      }
    }
    if (s.nitroOn) {
      for (const ex of car.exhaust) {
        const f = [Math.sin(s.psi), Math.cos(s.psi)], l = [Math.cos(s.psi), -Math.sin(s.psi)];
        const x = s.x + f[0] * ex.z + l[0] * ex.x, z = s.z + f[1] * ex.z + l[1] * ex.x;
        flames.emit(x, 0.4, z, s.vx * 0.55 - f[0] * (7 + Math.random() * 5) + (Math.random() - 0.5), (Math.random() - 0.3) * 0.8, s.vz * 0.55 - f[1] * (7 + Math.random() * 5) + (Math.random() - 0.5),
          { life: 0.16 + Math.random() * 0.12, size: 0.5 + Math.random() * 0.3, grow: 1.2, color: [0.35, 0.65 + Math.random() * 0.2, 1.0], alpha: 0.6, drag: 2.5 });
        flames.emit(x, 0.4, z, s.vx * 0.6 - f[0] * 4, 0, s.vz * 0.6 - f[1] * 4, { life: 0.1, size: 0.35, grow: 0.5, color: [1, 1, 1], alpha: 1, drag: 3 });
      }
    }
  }
  if (s.wallHit && s.impact > 3) {
    const n = Math.min(14, Math.floor(s.impact * 0.9));
    for (let k = 0; k < n; k++) {
      sparks.emit(s.x + (Math.random() - 0.5) * 1.5, 0.35 + Math.random() * 0.4, s.z + (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 9, 1 + Math.random() * 4, (Math.random() - 0.5) * 9,
        { life: 0.35 + Math.random() * 0.35, size: 0.12 + Math.random() * 0.1, grow: -0.4, color: [1, 0.7 + Math.random() * 0.2, 0.3], alpha: 1, drag: 0.8 });
    }
  }
  const focal = renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  for (const p of [smoke, dust, sparks, flames]) { p.setScale(focal); p.update(dt); }
}

/* ---------------- race logic ---------------- */
function startRace() {
  audio.start();
  game.auto = params.has('bot');
  placeOnGrid();
  game.raceTime = 0; game.lapStart = 0; game.lapsDone = 0; game.lapTimes = []; game.bestLapRace = null;
  phys.driftScore = 0; phys.driftTime = 0;
  for (const p of padsObj.pads) p.cooldown = 0;
  game.state = 'countdown'; game.countdown = 3.2; game.lastCount = 99;
  ui.showMenu(false); ui.showResults(false); ui.showPause(false); ui.showHud(true, isTouch);
  game.paused = false;
  ui.banner('');
  cam.heading = phys.psi; snapCamera();
}
function snapCamera() {
  // place camera instantly behind the car
  const dx = Math.sin(phys.psi), dz = Math.cos(phys.psi);
  cam.pos.set(phys.x - dx * 6.3, 2.05, phys.z - dz * 6.3);
  cam.look.set(phys.x + dx * 7, 1.15, phys.z + dz * 7);
}
function goMenu() {
  game.state = 'menu'; game.paused = false;
  ui.showMenu(true); ui.showHud(false); ui.showResults(false); ui.showPause(false); ui.banner('');
  phys.reset(120, 0, 28); phys.cum = 120 * track.ds; phys._lastIdx = 120;
  phys.nitro = 0.3; skids.clear();
  ui.records(game.records.lap, game.records.race);
}
function finishRace() {
  game.state = 'finished'; game.finishT = 0;
  const total = game.raceTime;
  const medal = MEDALS.find(m => total <= m.max);
  const bestLap = Math.min(...game.lapTimes);
  let record = false, newLap = false;
  if (!game.records.race || total < game.records.race) { game.records.race = total; record = true; }
  if (!game.records.lap || bestLap < game.records.lap) { game.records.lap = bestLap; newLap = true; }
  saveRecords();
  game.result = { laps: game.lapTimes.slice(), total, best: bestLap, medal, record, newLapRecord: newLap && !record };
  audio.chime([523, 659, 784, 1047], 0.11);
  ui.banner('FINISH!');
  setTimeout(() => { if (game.state === 'finished') ui.banner(''); }, 1800);
}
function lapCompleted() {
  const t = game.raceTime - game.lapStart; game.lapStart = game.raceTime;
  game.lapTimes.push(t); game.lapsDone++;
  const prevBest = game.bestLapRace; if (prevBest == null || t < prevBest) game.bestLapRace = t;
  if (game.lapsDone >= LAPS) { finishRace(); return; }
  const isBest = prevBest == null || t <= prevBest;
  ui.toast(`Lap ${game.lapsDone}  ${fmt(t)}`, isBest && game.lapsDone > 1 ? 'gold' : 'good');
  audio.chime([660, 990]);
  if (game.lapsDone === LAPS - 1) setTimeout(() => ui.toast('Final lap!', 'warn'), 700);
}

function respawn() {
  const cum = phys.cum, nit = phys.nitro;
  const i = phys.idx;
  phys.reset(i, 0, 0); phys.cum = cum; phys.nitro = nit; phys._lastIdx = i; skids.clear();
  snapCamera(); cam.heading = phys.psi;
  ui.toast('Back on track', 'warn');
}

function checkPads() {
  for (const p of padsObj.pads) {
    if (p.cooldown > 0) { p.cooldown -= 1 / 120; p.mesh.material.emissiveIntensity = 0.15; p.mesh.material.opacity = 0.5; continue; }
    p.mesh.material.emissiveIntensity = 0.9; p.mesh.material.opacity = 1;
    const ti = p.i, dx = phys.x - p.x, dz = phys.z - p.z;
    const along = dx * track.tx[ti] + dz * track.tz[ti], lat = dx * -track.tz[ti] + dz * track.tx[ti];
    if (Math.abs(along) < 5.2 && Math.abs(lat) < 2.9) {
      p.cooldown = 6; phys.applyBoost(6, 0.38, 1.3);
      audio.whoosh(); ui.flash(0.28); ui.toast('Boost!', 'gold'); game.shake = Math.max(game.shake, 0.12);
    }
  }
}

/* ---------------- simulation step ---------------- */
const DT = 1 / 120;
let acc = 0;
let lastEdge = {};
function simStep(userInput) {
  let inp = userInput;
  if (game.state === 'menu') inp = bot.drive(phys);
  else if (game.state === 'finished') { inp = bot.drive(phys); }
  else if (game.state === 'countdown') inp = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
  else if (game.auto) inp = bot.drive(phys);
  phys.update(DT, inp);
  game.lastInput = inp;
  if (game.state === 'racing') {
    game.raceTime += DT;
    if (phys.cum >= (game.lapsDone + 1) * track.length) lapCompleted();
    checkPads();
    if (phys.impact > 5) { game.shake = Math.max(game.shake, Math.min(0.5, phys.impact * 0.025)); audio.thud(Math.min(1, phys.impact / 16)); }
    if (phys.speed < 2.5 && phys.wallHit) game.stuckT += DT; else if (phys.speed > 5) game.stuckT = 0;
  } else if (game.state === 'menu' || game.state === 'finished') {
    checkPads();
  }
}

/* ---------------- HUD ---------------- */
function updateHud() {
  const lap = game.state === 'countdown' ? 1 : game.lapsDone + 1;
  ui.hud({
    lap, laps: LAPS,
    lapTime: game.state === 'racing' || game.state === 'finished' ? (game.state === 'finished' ? game.lapTimes[game.lapTimes.length - 1] || 0 : game.raceTime - game.lapStart) : 0,
    lastLap: game.lapTimes.length ? game.lapTimes[game.lapTimes.length - 1] : null,
    bestLap: game.bestLapRace, total: game.raceTime,
    speed: phys.speed * Math.sign(phys.vF || 1), gear: phys.gear, rpm: phys.rpm, boost: phys.nitroOn,
    nitro: phys.nitro, nitroOn: phys.nitroOn,
    driftScore: phys.driftScore, driftActive: phys.driftTime > 0.4,
    fx: phys.nitroOn ? 0.9 : Math.max(0, Math.min(0.28, (phys.speed - 48) / 60)),
  });
  ui.minimap(track, phys, padsObj.pads);
}

/* ---------------- main loop ---------------- */
let last = performance.now();
let fpsAcc = 0, fpsN = 0, adaptT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (game.state === 'loading') return;

  const pad = input.poll(dt);
  const ed = pad.edges || {};
  // discrete commands
  if (input.wasPressed('KeyC') || ed.cam) { game.camMode = (game.camMode + 1) % 3; }
  if (input.wasPressed('KeyM')) toggleMute();
  if (input.wasPressed('KeyP', 'Escape') || ed.pause) togglePause();
  if (input.wasPressed('KeyR') || ed.reset) { if (game.state === 'racing') respawn(); else if (game.state === 'finished') startRace(); }
  if (input.wasPressed('Enter')) {
    if (game.state === 'menu') startRace(); else if (game.state === 'finished' && game.finishT > 1.2) startRace();
  }
  input.endFrame();

  if (!game.paused) {
    acc += dt;
    let n = 0;
    while (acc >= DT && n < 24) { simStep(pad); acc -= DT; n++; }
    if (n >= 24) acc = 0;

    // countdown
    if (game.state === 'countdown') {
      game.countdown -= dt;
      const c = Math.ceil(game.countdown);
      if (c !== game.lastCount) {
        game.lastCount = c;
        if (c > 0 && c <= 3) { ui.banner(String(c)); audio.beep(520, 0.2, 0.28); }
      }
      if (game.countdown <= 0) {
        game.state = 'racing'; ui.banner('GO!'); audio.beep(1040, 0.5, 0.3); setTimeout(() => ui.banner(''), 900);
        game.raceTime = 0; game.lapStart = 0;
      }
    }
    if (game.state === 'finished') {
      game.finishT += dt;
      if (game.finishT > 2.2 && document.getElementById('results').classList.contains('hidden')) { ui.results(game.result); ui.showResults(true); }
    }
    if (game.state === 'racing' && game.stuckT > 2.5) { ui.toast('Stuck? Press R to reset', 'warn'); game.stuckT = 0; }
    // slide-yaw for hood cam: look slightly into the slide
    cam.slideYaw += ((-Math.atan2(phys.vL, Math.max(8, Math.abs(phys.vF))) * 0.55) - cam.slideYaw) * (1 - Math.exp(-dt * 6));

    if (game.car) {
      game.car.update({
        x: phys.x, z: phys.z, psi: phys.psi, steer: phys.steer, vF: phys.vF, aF: phys.aF, aR: phys.aR,
        braking: phys.braking && game.state !== 'countdown', headlights: false,
      }, dt);
      updateEffects(dt, game.lastInput || { throttle: 0, brake: 0 });
    }
    audio.update({ rpm: phys.rpm, throttle: phys.throttle, speed: phys.speed, drifting: phys.drifting, onRoad: phys.onRoad, vL: phys.vL, slip: phys.slip, nitroOn: phys.nitroOn }, game.state !== 'finished' || game.finishT < 1.5);
  }

  // lights & sky follow
  const cx = phys.x, cz = phys.z;
  sun.position.set(cx + SUN_DIR.x * 120, SUN_DIR.y * 120, cz + SUN_DIR.z * 120);
  sun.target.position.set(cx, 0, cz); sun.target.updateMatrixWorld();
  // snap shadow frustum to texel grid to avoid shimmering
  updateCamera(game.paused ? 0 : dt, false);
  sky.position.copy(camera.position);
  sky.material.uniforms.uTime.value = now / 1000;
  if (game.state !== 'menu' || true) updateHud();

  renderer.render(scene, camera);

  // adaptive resolution
  fpsAcc += dt; fpsN++; adaptT += dt;
  if (adaptT > 1.5) {
    const fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; adaptT = 0;
    if (fps < 42 && pr > 0.55) { pr = Math.max(0.55, pr - 0.15); resize(); }
    else if (fps > 58 && pr < maxPR) { pr = Math.min(maxPR, pr + 0.1); resize(); }
    game.fps = fps;
  }
}

/* ---------------- UI wiring ---------------- */
function toggleMute() { audio.setMuted(!audio.muted); document.getElementById('btnMute').textContent = audio.muted ? 'Muted' : 'Sound'; }
function togglePause() {
  if (game.state !== 'racing' && game.state !== 'countdown') return;
  game.paused = !game.paused; ui.showPause(game.paused);
  if (game.paused) audio.silence();
}
document.getElementById('btnStart').addEventListener('click', startRace);
document.getElementById('btnAgain').addEventListener('click', startRace);
document.getElementById('btnMenu').addEventListener('click', goMenu);
document.getElementById('btnQuit').addEventListener('click', goMenu);
document.getElementById('btnRestart').addEventListener('click', startRace);
document.getElementById('btnResume').addEventListener('click', togglePause);
document.getElementById('btnPause').addEventListener('click', togglePause);
document.getElementById('btnCam').addEventListener('click', () => { game.camMode = (game.camMode + 1) % 3; });
document.getElementById('btnMute').addEventListener('click', toggleMute);
canvas.addEventListener('pointerdown', () => { audio.start(); });
addEventListener('keydown', () => audio.start(), { once: true });

/* ---------------- boot ---------------- */
const manager = new THREE.LoadingManager();
manager.onProgress = (u, l, t) => ui.progress(0.15 + 0.85 * (l / Math.max(1, t)), 'Loading car…');
ui.progress(0.1, 'Building the circuit…');
manager.itemStart && 0;

(async function boot() {
  try {
    game.car = await loadCar('./assets/golf.b64.txt', manager);
  } catch (err) {
    console.error('car load failed', err);
    ui.progress(1, 'Could not load the car model: ' + (err && err.message));
    return;
  }
  scene.add(game.car.group);
  ui.swatchesInit(PAINTS, c => game.car.setPaint(c.hex), 0);
  game.car.setPaint(PAINTS[0].hex);
  // warm up shaders so the first frame doesn't hitch
  renderer.compile(scene, camera);
  goMenu();
  cam.heading = phys.psi; snapCamera();
  ui.hideLoading();
  if (params.has('autostart')) startRace();
  if (params.has('cam')) game.camMode = +params.get('cam') || 0;
})();

window.__game = { game, phys, track, cam, scene, camera, renderer, ui, input, startRace, goMenu, simStep, updateCamera, bot, padsObj, DT };
requestAnimationFrame(frame);
