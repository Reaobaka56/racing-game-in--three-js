import * as THREE from 'three';
import { TRACK_POINTS } from './trackdata.js';

export const ROAD_HALF = 7;          // asphalt half width
export const CURB_W = 1.4;           // rumble strip
export const SHOULDER_W = 3.6;       // dirt run-off
export const WALL_DIST = ROAD_HALF + CURB_W + SHOULDER_W + 0.2;
export const OFFROAD_DIST = ROAD_HALF + CURB_W;

const TAU = Math.PI * 2;

/** Sample the closed spline into evenly spaced points + tangents + curvature. */
export function buildTrackData() {
  const pts = TRACK_POINTS.map(([x, z]) => new THREE.Vector3(x, 0, z));
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  const length = curve.getLength();
  const N = Math.round(length / 2.5);
  const sp = curve.getSpacedPoints(N).slice(0, N);
  const ds = length / N;
  const px = new Float32Array(N), pz = new Float32Array(N);
  const tx = new Float32Array(N), tz = new Float32Array(N);
  const curv = new Float32Array(N);
  for (let i = 0; i < N; i++) { px[i] = sp[i].x; pz[i] = sp[i].z; }
  for (let i = 0; i < N; i++) {
    const a = (i - 1 + N) % N, b = (i + 1) % N;
    let dx = px[b] - px[a], dz = pz[b] - pz[a];
    const l = Math.hypot(dx, dz) || 1;
    tx[i] = dx / l; tz[i] = dz / l;
  }
  // signed curvature (left turn = +) smoothed
  const raw = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const b = (i + 1) % N;
    let da = Math.atan2(tx[b], tz[b]) - Math.atan2(tx[i], tz[i]);
    while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
    raw[i] = da / ds;
  }
  for (let i = 0; i < N; i++) {
    let s = 0;
    for (let k = -3; k <= 3; k++) s += raw[(i + k + N) % N];
    curv[i] = s / 7;
  }

  const track = {
    N, length, ds, px, pz, tx, tz, curv,
    wrap(i) { return ((i % N) + N) % N; },
    /** Nearest sample around `hint` (or global search if hint < 0). */
    nearest(x, z, hint = -1) {
      let best = 0, bd = 1e18;
      if (hint < 0) {
        for (let i = 0; i < N; i++) {
          const dx = x - px[i], dz = z - pz[i], d = dx * dx + dz * dz;
          if (d < bd) { bd = d; best = i; }
        }
      } else {
        for (let k = -30; k <= 30; k++) {
          const i = (hint + k + N) % N;
          const dx = x - px[i], dz = z - pz[i], d = dx * dx + dz * dz;
          if (d < bd) { bd = d; best = i; }
        }
      }
      const dx = x - px[best], dz = z - pz[best];
      // right normal r = (-tz, tx); lateral positive = right side
      const lat = dx * -tz[best] + dz * tx[best];
      const along = dx * tx[best] + dz * tz[best];
      return { i: best, lat, along };
    },
    heading(i) { return Math.atan2(tx[i], tz[i]); },
  };
  return track;
}

/* ---------- procedural textures ---------- */
function canvasTex(w, h, draw, opts = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = opts.wrapS || THREE.ClampToEdgeWrapping;
  t.wrapT = opts.wrapT || THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
function speckle(g, w, h, n, colors, size = 1.6) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[(Math.random() * colors.length) | 0];
    g.fillRect(Math.random() * w, Math.random() * h, size, size);
  }
}

export function makeRoadTexture() {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#34373c'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 26000, ['#2b2d31', '#3c4046', '#44484f', '#25272b'], 2);
    // darker rubbered-in racing line stripes
    const lg = g.createLinearGradient(0, 0, w, 0);
    lg.addColorStop(0, 'rgba(0,0,0,0)'); lg.addColorStop(0.22, 'rgba(0,0,0,0)');
    lg.addColorStop(0.3, 'rgba(0,0,0,.16)'); lg.addColorStop(0.38, 'rgba(0,0,0,0)');
    lg.addColorStop(0.62, 'rgba(0,0,0,0)'); lg.addColorStop(0.7, 'rgba(0,0,0,.16)');
    lg.addColorStop(0.78, 'rgba(0,0,0,0)'); lg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = lg; g.fillRect(0, 0, w, h);
    // edge lines
    g.fillStyle = '#e9e9e4';
    g.fillRect(w * 0.028, 0, w * 0.016, h);
    g.fillRect(w * 0.956, 0, w * 0.016, h);
    // dashed centre line
    g.fillStyle = '#d9d4a8';
    g.fillRect(w * 0.492, 0, w * 0.016, h * 0.5);
    speckle(g, w, h, 5000, ['rgba(0,0,0,.35)'], 1.5);
  });
}
function makeCurbTexture() {
  return canvasTex(64, 128, (g, w, h) => {
    g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#d6232b'; g.fillRect(0, 0, w, h / 2);
    speckle(g, w, h, 600, ['rgba(0,0,0,.18)'], 2);
  });
}
function makeDirtTexture() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#7d6a4d'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 9000, ['#6d5c42', '#8d7a5a', '#5f503a', '#9a8764'], 2);
  });
}
export function makeGrassTexture() {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#4b6b32'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 30000, ['#3f5e2a', '#587a38', '#46652e', '#678a41', '#33501f'], 2);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = 'rgba(30,50,15,.06)';
      g.beginPath(); g.ellipse(Math.random() * w, Math.random() * h, 30 + Math.random() * 50, 20 + Math.random() * 40, Math.random() * 3, 0, TAU); g.fill();
    }
  }, { wrapS: THREE.RepeatWrapping });
}
function makeRailTexture() {
  return canvasTex(256, 64, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#d9dde0'); gr.addColorStop(0.5, '#9aa1a6'); gr.addColorStop(1, '#c7cdd1');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,.35)';
    g.fillRect(0, h * 0.4, w, 3); g.fillRect(0, h * 0.62, w, 3);
    // alternate red/white blocks on top band
    for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#e8e8e8' : '#d6232b'; g.fillRect(i * 32, 0, 32, h * 0.18); }
  }, { wrapS: THREE.RepeatWrapping });
}
function makeChevronTexture() {
  return canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = 'rgba(8,12,20,0.92)'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#ffd400'; g.lineWidth = 16; g.lineJoin = 'miter';
    for (let i = 0; i < 4; i++) {
      const y = 30 + i * 62;
      g.beginPath(); g.moveTo(14, y + 34); g.lineTo(w / 2, y); g.lineTo(w - 14, y + 34); g.stroke();
    }
    g.strokeStyle = '#ffffff'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
  });
}

/* ---------- ribbon mesh helper ---------- */
/** Builds a ribbon along the track between lateral offsets a..b (right positive).
 *  uvScaleV: meters per texture repeat along the track. */
function ribbon(track, a, b, y, uvMeters, { step = 1, closed = true } = {}) {
  const { N, px, pz, tx, tz, ds } = track;
  const count = Math.floor(N / step);
  const pos = [], uv = [], idx = [], nrm = [];
  for (let k = 0; k <= count; k++) {
    const i = (k * step) % N;
    const rx = -tz[i], rz = tx[i];
    const v = (k * step * ds) / uvMeters;
    // left vertex (lat a) then right vertex (lat b)
    pos.push(px[i] + rx * a, y, pz[i] + rz * a, px[i] + rx * b, y, pz[i] + rz * b);
    uv.push(0, v, 1, v);
    nrm.push(0, 1, 0, 0, 1, 0);
    if (k < count) {
      const j = k * 2;
      // triangle winding facing +Y: right vector r, forward t; ordering chosen after verifying with DoubleSide off
      idx.push(j, j + 1, j + 2, j + 1, j + 3, j + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function wallRibbon(track, lat, y0, y1, uvMeters, step = 1) {
  const { N, px, pz, tx, tz, ds } = track;
  const count = Math.floor(N / step);
  const pos = [], uv = [], idx = [];
  for (let k = 0; k <= count; k++) {
    const i = (k * step) % N;
    const rx = -tz[i], rz = tx[i];
    const v = (k * step * ds) / uvMeters;
    pos.push(px[i] + rx * lat, y0, pz[i] + rz * lat, px[i] + rx * lat, y1, pz[i] + rz * lat);
    uv.push(v, 0, v, 1);
    if (k < count) { const j = k * 2; idx.push(j, j + 1, j + 2, j + 1, j + 3, j + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

/* ---------- world construction ---------- */
export function buildTrackMeshes(track) {
  const group = new THREE.Group();
  const { N, px, pz, tx, tz, ds } = track;

  const roadTex = makeRoadTexture();
  const road = new THREE.Mesh(
    ribbon(track, -ROAD_HALF, ROAD_HALF, 0.02, 12),
    new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.92, metalness: 0.0 })
  );
  road.receiveShadow = true; group.add(road);

  const curbTex = makeCurbTexture();
  const curbMat = new THREE.MeshStandardMaterial({ map: curbTex, roughness: 0.8 });
  for (const side of [-1, 1]) {
    const a = side * ROAD_HALF, b = side * (ROAD_HALF + CURB_W);
    const m = new THREE.Mesh(ribbon(track, Math.min(a, b), Math.max(a, b), 0.035, 5), curbMat);
    m.receiveShadow = true; group.add(m);
  }
  const dirtTex = makeDirtTexture();
  const dirtMat = new THREE.MeshStandardMaterial({ map: dirtTex, roughness: 1 });
  dirtTex.wrapS = THREE.RepeatWrapping;
  for (const side of [-1, 1]) {
    const a = side * (ROAD_HALF + CURB_W - 0.05), b = side * (ROAD_HALF + CURB_W + SHOULDER_W + 0.4);
    const m = new THREE.Mesh(ribbon(track, Math.min(a, b), Math.max(a, b), 0.01, 8), dirtMat);
    m.receiveShadow = true; group.add(m);
  }

  // guard rails
  const railTex = makeRailTexture();
  const railMat = new THREE.MeshStandardMaterial({ map: railTex, roughness: 0.45, metalness: 0.6, side: THREE.DoubleSide });
  for (const side of [-1, 1]) {
    const lat = side * WALL_DIST;
    const m = new THREE.Mesh(wallRibbon(track, lat, 0.25, 0.95, 8, 1), railMat);
    m.castShadow = true; m.receiveShadow = true; group.add(m);
  }
  // posts
  const postGeo = new THREE.BoxGeometry(0.18, 1.05, 0.18);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x6b7278, roughness: 0.6, metalness: 0.5 });
  const step = 3;
  const posts = new THREE.InstancedMesh(postGeo, postMat, Math.floor(N / step) * 2);
  const dummy = new THREE.Object3D(); let pc = 0;
  for (let i = 0; i < N; i += step) for (const side of [-1, 1]) {
    const lat = side * (WALL_DIST + 0.12);
    dummy.position.set(px[i] - tz[i] * lat, 0.5, pz[i] + tx[i] * lat);
    dummy.rotation.y = Math.atan2(tx[i], tz[i]); dummy.updateMatrix();
    posts.setMatrixAt(pc++, dummy.matrix);
  }
  posts.count = pc; posts.castShadow = true; group.add(posts);

  // start / finish line (checker strip on the road)
  const checker = canvasTex(256, 64, (g, w, h) => {
    const n = 16, sz = w / n;
    for (let y = 0; y < 4; y++) for (let x = 0; x < n; x++) { g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4'; g.fillRect(x * sz, y * (h / 4), sz, h / 4); }
  }, { wrapT: THREE.ClampToEdgeWrapping });
  const lineGeo = new THREE.PlaneGeometry(ROAD_HALF * 2, 3.2);
  lineGeo.rotateX(-Math.PI / 2);
  const line = new THREE.Mesh(lineGeo, new THREE.MeshStandardMaterial({ map: checker, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  line.position.set(px[0], 0.03, pz[0]);
  line.rotation.y = Math.atan2(tx[0], tz[0]);
  line.receiveShadow = true; group.add(line);

  // gantry
  const gantry = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x20252b, roughness: 0.5, metalness: 0.6 });
  const span = (WALL_DIST + 1.5) * 2;
  for (const s of [-1, 1]) {
    const pil = new THREE.Mesh(new THREE.BoxGeometry(0.7, 9, 0.7), steel);
    pil.position.set(s * (WALL_DIST + 1.2), 4.5, 0); pil.castShadow = true; gantry.add(pil);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(span, 1.6, 0.9), steel);
  beam.position.set(0, 9, 0); beam.castShadow = true; gantry.add(beam);
  const banner = bannerPlane('START / FINISH', span - 1.2, 3.2, '#101418', '#ffffff', '#ff3b30', true);
  banner.position.set(0, 7.0, -0.52); banner.rotation.y = Math.PI; gantry.add(banner);
  const banner2 = bannerPlane('START / FINISH', span - 1.2, 3.2, '#101418', '#ffffff', '#ff3b30', true);
  banner2.position.set(0, 7.0, 0.52); gantry.add(banner2);
  gantry.position.set(px[0], 0, pz[0]);
  gantry.rotation.y = Math.atan2(tx[0], tz[0]);
  group.add(gantry);

  return { group, roadTex };
}

export function bannerPlane(text, w, h, bg, fg, accent, stripe = false) {
  const cw = 1024, ch = Math.round(1024 * h / w);
  const tex = canvasTex(cw, ch, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, cw, ch);
    if (stripe) { g.fillStyle = accent; g.fillRect(0, 0, cw, ch * 0.08); g.fillRect(0, ch * 0.92, cw, ch * 0.08); }
    g.fillStyle = fg; g.font = `italic 800 ${Math.round(ch * 0.55)}px Rajdhani, 'Arial Black', Impact, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, cw / 2, ch * 0.54);
  }, { wrapT: THREE.ClampToEdgeWrapping });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35, side: THREE.DoubleSide }));
  return m;
}

/* ---------- boost pads ---------- */
export function buildBoostPads(track, padSpecs) {
  const group = new THREE.Group();
  const tex = makeChevronTexture();
  tex.wrapT = THREE.RepeatWrapping;
  const pads = [];
  for (const spec of padSpecs) {
    const i = track.wrap(spec.i);
    const geo = new THREE.PlaneGeometry(4.6, 10);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      map: tex, emissive: 0xffc800, emissiveMap: tex, emissiveIntensity: 0.9,
      roughness: 0.7, transparent: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    const m = new THREE.Mesh(geo, mat);
    const lat = spec.lat || 0;
    m.position.set(track.px[i] - track.tz[i] * lat, 0.045, track.pz[i] + track.tx[i] * lat);
    m.rotation.y = Math.atan2(track.tx[i], track.tz[i]);
    group.add(m);
    pads.push({ i, lat, x: m.position.x, z: m.position.z, mesh: m, cooldown: 0 });
  }
  return { group, pads, tex };
}

/* ---------- scenery ---------- */
function mulberry(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function buildScenery(track) {
  const rnd = mulberry(1337);
  const group = new THREE.Group();
  const { N, px, pz } = track;
  // spatial bucket: distance to centerline approx via sampled points (every 4th sample)
  const sampled = [];
  for (let i = 0; i < N; i += 4) sampled.push(i);
  const distToTrack = (x, z) => {
    let d = 1e18;
    for (const i of sampled) { const dx = x - px[i], dz = z - pz[i]; const q = dx * dx + dz * dz; if (q < d) d = q; }
    return Math.sqrt(d);
  };
  let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
  for (let i = 0; i < N; i++) { minx = Math.min(minx, px[i]); maxx = Math.max(maxx, px[i]); minz = Math.min(minz, pz[i]); maxz = Math.max(maxz, pz[i]); }
  const cx = (minx + maxx) / 2, cz = (minz + maxz) / 2;

  // pines
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.4, 2.2, 6); trunkGeo.translate(0, 1.1, 0);
  const coneGeo = new THREE.ConeGeometry(2.2, 6.5, 7); coneGeo.translate(0, 5.0, 0);
  const cone2Geo = new THREE.ConeGeometry(1.6, 5, 7); cone2Geo.translate(0, 8.0, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
  const T = 2600;
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, T);
  const cones = new THREE.InstancedMesh(coneGeo, leafMat, T);
  const cones2 = new THREE.InstancedMesh(cone2Geo, leafMat, T);
  const d = new THREE.Object3D(); const col = new THREE.Color();
  let n = 0, tries = 0;
  while (n < T && tries < 40000) {
    tries++;
    const x = cx + (rnd() - 0.5) * (maxx - minx + 700);
    const z = cz + (rnd() - 0.5) * (maxz - minz + 700);
    const dist = distToTrack(x, z);
    if (dist < WALL_DIST + 7) continue;
    // denser near the track, thin out far away
    if (dist > 70 && rnd() > 0.35) continue;
    const s = 0.7 + rnd() * 1.1;
    d.position.set(x, 0, z); d.rotation.set(0, rnd() * 6.28, 0); d.scale.set(s, s * (0.9 + rnd() * 0.5), s); d.updateMatrix();
    trunks.setMatrixAt(n, d.matrix); cones.setMatrixAt(n, d.matrix); cones2.setMatrixAt(n, d.matrix);
    col.setHSL(0.27 + rnd() * 0.06, 0.45, 0.16 + rnd() * 0.09);
    cones.setColorAt(n, col); cones2.setColorAt(n, col);
    n++;
  }
  trunks.count = cones.count = cones2.count = n;
  for (const m of [trunks, cones, cones2]) { m.castShadow = false; m.frustumCulled = false; group.add(m); }

  // boulders
  const rockGeo = new THREE.DodecahedronGeometry(1.4, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x7c7770, roughness: 1, flatShading: true });
  const R = 160; const rocks = new THREE.InstancedMesh(rockGeo, rockMat, R); let rc = 0;
  for (let k = 0; k < 6000 && rc < R; k++) {
    const x = cx + (rnd() - 0.5) * (maxx - minx + 400), z = cz + (rnd() - 0.5) * (maxz - minz + 400);
    const dist = distToTrack(x, z); if (dist < WALL_DIST + 4 || dist > 60) continue;
    const s = 0.5 + rnd() * 1.6; d.position.set(x, s * 0.35, z); d.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3); d.scale.set(s, s * 0.7, s * 1.1); d.updateMatrix();
    rocks.setMatrixAt(rc++, d.matrix);
  }
  rocks.count = rc; rocks.castShadow = false; group.add(rocks);

  // mountains ring
  const mtnMat = new THREE.MeshStandardMaterial({ color: 0x55627a, roughness: 1, flatShading: true });
  const mtnGeo = new THREE.ConeGeometry(1, 1, 6, 1); mtnGeo.translate(0, 0.5, 0);
  const M = 70; const mtn = new THREE.InstancedMesh(mtnGeo, mtnMat, M);
  const baseR = Math.max(maxx - minx, maxz - minz) * 0.5 + 1300;
  for (let k = 0; k < M; k++) {
    const a = (k / M) * Math.PI * 2 + rnd() * 0.05; const r = baseR + rnd() * 700;
    const h = 260 + rnd() * 520, w = 380 + rnd() * 520;
    d.position.set(cx + Math.cos(a) * r, -5, cz + Math.sin(a) * r); d.rotation.set(0, rnd() * 6, 0); d.scale.set(w, h, w); d.updateMatrix();
    mtn.setMatrixAt(k, d.matrix);
    col.setHSL(0.6 + rnd() * 0.04, 0.22, 0.28 + rnd() * 0.1); mtn.setColorAt(k, col);
  }
  mtn.frustumCulled = false; group.add(mtn);

  // billboards beyond the wall at selected spots
  const texts = [['CLUBSPORT', '#101820', '#ffffff', '#00a3e0'], ['NITRO', '#1a0f0f', '#ffd400', '#ff3b30'], ['APEX RUN', '#0d1a14', '#e8fff2', '#2ecc71'], ['GTI', '#0d0d12', '#ffffff', '#d6232b'], ['DRIFT KING', '#150e1c', '#f7e6ff', '#a855f7']];
  const marks = [140, 260, 430, 520, 640, 700, 800, 910, 980];
  marks.forEach((i, k) => {
    i = track.wrap(i);
    const side = k % 2 ? 1 : -1;
    const lat = side * (WALL_DIST + 7);
    const t = texts[k % texts.length];
    const b = bannerPlane(t[0], 14, 4.6, t[1], t[2], t[3], true);
    const x = px[i] - track.tz[i] * lat, z = pz[i] + track.tx[i] * lat;
    // face the track
    const hd = Math.atan2(track.tx[i], track.tz[i]) + (side > 0 ? Math.PI / 2 : -Math.PI / 2);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4, 0.4), new THREE.MeshStandardMaterial({ color: 0x222 }));
    const holder = new THREE.Group();
    b.position.y = 5.2; post.position.set(-4, 2, 0); const post2 = post.clone(); post2.position.set(4, 2, 0);
    holder.add(b, post, post2);
    holder.position.set(x, 0, z);
    // plane normal is +z; rotate so +z faces track center => direction toward track = -side * right vector
    const rx = -track.tz[i], rz = track.tx[i];
    holder.rotation.y = Math.atan2(-side * rx, -side * rz);
    holder.traverse(o => { if (o.isMesh) o.castShadow = true; });
    group.add(holder);
  });

  // tyre stacks at the outside of the tightest corners
  const stackGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.5, 14);
  const stackMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.9 });
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0xd6232b, roughness: 0.9 });
  const stackList = [];
  for (let i = 0; i < N; i += 3) {
    const c = track.curv[i];
    if (Math.abs(c) > 0.012) {
      const side = c > 0 ? -1 : 1; // outside of the corner
      const lat = side * (ROAD_HALF + CURB_W + 1.2);
      stackList.push([px[i] - track.tz[i] * lat, pz[i] + track.tx[i] * lat, (i / 3) | 0]);
    }
  }
  const stacks = new THREE.InstancedMesh(stackGeo, stackMat, stackList.length * 3);
  const stripes = new THREE.InstancedMesh(stackGeo, stripeMat, stackList.length);
  let sc = 0, st = 0;
  for (const [x, z, k] of stackList) {
    for (let h = 0; h < 3; h++) { d.position.set(x, 0.25 + h * 0.5, z); d.rotation.set(0, 0, 0); d.scale.set(1, 1, 1); d.updateMatrix(); stacks.setMatrixAt(sc++, d.matrix); }
    if (k % 2 === 0) { d.position.set(x, 0.75, z); d.scale.set(1.02, 0.3, 1.02); d.updateMatrix(); stripes.setMatrixAt(st++, d.matrix); }
  }
  stacks.count = sc; stripes.count = st; stacks.castShadow = true; stripes.castShadow = true;
  group.add(stacks, stripes);

  return { group, treeMaterial: leafMat };
}
