import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { SOFT_TEX } from './fx.js';

const CORNERS = ['FL', 'FR', 'RL', 'RR'];
const SCALE = 100; // model is authored at 1/100 scale

function floatGeometry(src, matrix) {
  const g = new THREE.BufferGeometry();
  const copyAttr = (name, itemSize) => {
    const a = src.getAttribute(name);
    if (!a) return null;
    const out = new Float32Array(a.count * itemSize);
    for (let i = 0; i < a.count; i++) {
      out[i * itemSize] = a.getX(i);
      if (itemSize > 1) out[i * itemSize + 1] = a.getY(i);
      if (itemSize > 2) out[i * itemSize + 2] = a.getZ(i);
    }
    return new THREE.BufferAttribute(out, itemSize);
  };
  g.setAttribute('position', copyAttr('position', 3));
  const n = copyAttr('normal', 3); if (n) g.setAttribute('normal', n);
  const uv = copyAttr('uv', 2);
  g.setAttribute('uv', uv || new THREE.BufferAttribute(new Float32Array(src.attributes.position.count * 2), 2));
  if (src.index) {
    const idx = new Uint32Array(src.index.count);
    for (let i = 0; i < idx.length; i++) idx[i] = src.index.getX(i);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  } else {
    const cnt = src.attributes.position.count; const idx = new Uint32Array(cnt);
    for (let i = 0; i < cnt; i++) idx[i] = i; g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  g.applyMatrix4(matrix);
  if (matrix.determinant() < 0) { // mirrored: flip winding
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
  }
  if (!n) g.computeVertexNormals();
  return g;
}

function mergeByMaterial(entries) {
  // entries: [{geo, mat}] -> [Mesh]
  const byMat = new Map();
  for (const e of entries) {
    if (!byMat.has(e.mat)) byMat.set(e.mat, []);
    byMat.get(e.mat).push(e.geo);
  }
  const meshes = [];
  for (const [mat, geos] of byMat) {
    const merged = geos.length === 1 ? geos[0] : BufferGeometryUtils.mergeGeometries(geos, false);
    if (!merged) { for (const g of geos) meshes.push(new THREE.Mesh(g, mat)); continue; }
    merged.computeBoundingSphere(); merged.computeBoundingBox();
    meshes.push(new THREE.Mesh(merged, mat));
  }
  return meshes;
}

export async function loadCar(url, manager) {
  const loader = new GLTFLoader(manager);
  loader.setMeshoptDecoder(MeshoptDecoder);
  let gltf;
  if (url.endsWith('.txt')) {
    const b64 = await (await fetch(url)).text();
    const bin = atob(b64.trim()); const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    gltf = await loader.parseAsync(buf.buffer, '');
  } else gltf = await loader.loadAsync(url);
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const S = new THREE.Matrix4().makeScale(SCALE, SCALE, SCALE);

  // ---- classify meshes
  const items = [];
  root.traverse(o => {
    if (!o.isMesh) return;
    const label = `${o.parent ? o.parent.name : ''}|${o.name}`;
    const m = label.match(/(Front|Rear)[ _]?([LR])/);
    let kind = 'body', corner = null;
    if (m) {
      corner = (m[1] === 'Front' ? 'F' : 'R') + m[2];
      kind = /Calliper/i.test(label) ? 'cal' : 'wheel';
    } else if (/Rim/i.test(label)) kind = 'rim';
    const mat = new THREE.Matrix4().multiplyMatrices(S, o.matrixWorld);
    const geo = floatGeometry(o.geometry, mat);
    if (/Mirrors/i.test(label)) return; // mirror mesh is mis-exported (floating arc), drop it
    items.push({ kind, corner, geo, mat: o.material, label });
  });

  // ---- wheel centres from the wheel meshes
  const boxes = {};
  for (const it of items) if (it.kind === 'wheel') {
    it.geo.computeBoundingBox();
    (boxes[it.corner] ||= new THREE.Box3()).union(it.geo.boundingBox);
  }
  const centers = {}, radii = {};
  for (const c of CORNERS) {
    if (!boxes[c]) throw new Error('wheel group missing: ' + c);
    centers[c] = boxes[c].getCenter(new THREE.Vector3());
    radii[c] = (boxes[c].max.y - boxes[c].min.y) / 2;
  }
  // rims belong to the nearest wheel
  for (const it of items) if (it.kind === 'rim') {
    it.geo.computeBoundingBox();
    const c = it.geo.boundingBox.getCenter(new THREE.Vector3());
    let best = 'FL', bd = 1e9;
    for (const k of CORNERS) { const d = c.distanceTo(centers[k]); if (d < bd) { bd = d; best = k; } }
    it.kind = 'wheel'; it.corner = best;
  }

  // ---- ground offset so tyres touch y=0
  let minY = 1e9; for (const c of CORNERS) minY = Math.min(minY, centers[c].y - radii[c]);
  const groundOffset = -minY;

  // ---- build hierarchy
  const group = new THREE.Group();
  const tilt = new THREE.Group(); tilt.position.y = groundOffset; group.add(tilt);

  const bodyEntries = items.filter(i => i.kind === 'body').map(i => ({ geo: i.geo, mat: i.mat }));
  const bodyMeshes = mergeByMaterial(bodyEntries);
  const body = new THREE.Group(); tilt.add(body);
  for (const m of bodyMeshes) { m.castShadow = true; m.receiveShadow = false; body.add(m); }

  const wheels = {};
  for (const c of CORNERS) {
    const steer = new THREE.Group(); steer.position.copy(centers[c]);
    const spin = new THREE.Group(); steer.add(spin);
    const wEntries = items.filter(i => i.kind === 'wheel' && i.corner === c).map(i => ({ geo: i.geo.translate(-centers[c].x, -centers[c].y, -centers[c].z), mat: i.mat }));
    const cEntries = items.filter(i => i.kind === 'cal' && i.corner === c).map(i => ({ geo: i.geo.translate(-centers[c].x, -centers[c].y, -centers[c].z), mat: i.mat }));
    for (const m of mergeByMaterial(wEntries)) { m.castShadow = true; spin.add(m); }
    for (const m of mergeByMaterial(cEntries)) { steer.add(m); }
    tilt.add(steer);
    wheels[c] = { steer, spin, center: centers[c].clone(), radius: radii[c] };
  }

  // ---- materials
  const paintMats = new Set(), glassMats = new Set();
  const seen = new Set();
  for (const it of items) {
    const m = it.mat; if (seen.has(m)) continue; seen.add(m);
    m.envMapIntensity = 1.0;
    if (/CarPaint_Max/.test(it.label) && !/Trim/.test(it.label)) paintMats.add(m);
    if (m.transmission > 0) {
      m.transmission = 0; m.transparent = true; m.opacity = 0.32; m.depthWrite = false;
      m.color = new THREE.Color(0x0c1218); m.roughness = 0.04; m.metalness = 0.0; m.envMapIntensity = 1.6;
      if (m.thickness !== undefined) m.thickness = 0;
      glassMats.add(m);
    }
    m.needsUpdate = true;
  }

  // ---- bounds
  const bbox = new THREE.Box3();
  for (const m of bodyMeshes) { m.geometry.computeBoundingBox(); bbox.union(m.geometry.boundingBox); }

  // ---- brake lights + exhaust anchors (car-local, y includes ground offset)
  const rearZ = bbox.min.z, frontZ = bbox.max.z;
  const brakeMat = new THREE.SpriteMaterial({ map: SOFT_TEX, color: 0xff1a10, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const brakeSprites = [];
  for (const sx of [-0.68, 0.68]) {
    const s = new THREE.Sprite(brakeMat); s.scale.set(0.9, 0.5, 1);
    s.position.set(sx, 0.93 + groundOffset - 0.136 + 0.02, rearZ - 0.05);
    tilt.add(s); brakeSprites.push(s);
  }

  const car = {
    group, tilt, body, wheels, bbox, groundOffset, paintMats, glassMats, brakeMat,
    exhaust: [new THREE.Vector3(-0.62, 0.34, rearZ + 0.1), new THREE.Vector3(0.62, 0.34, rearZ + 0.1)],
    rearZ, frontZ,
    wheelAngle: 0, pitch: 0, roll: 0, steerVis: 0,
    setPaint(hex) { const c = new THREE.Color(hex); for (const m of paintMats) m.color.copy(c); },
    update(st, dt) {
      group.position.set(st.x, 0, st.z);
      group.rotation.y = st.psi;
      // suspension attitude
      const tp = THREE.MathUtils.clamp(-st.aF * 0.0045, -0.05, 0.05);
      const tr = THREE.MathUtils.clamp(-st.aR * 0.0042, -0.07, 0.07);
      const k = 1 - Math.exp(-dt * 8);
      this.pitch += (tp - this.pitch) * k; this.roll += (tr - this.roll) * k;
      tilt.rotation.set(this.pitch, 0, this.roll);
      this.steerVis += (st.steer - this.steerVis) * (1 - Math.exp(-dt * 14));
      this.wheelAngle += (st.vF * dt) / Math.max(0.3, radii.FL);
      for (const c of CORNERS) {
        wheels[c].spin.rotation.x = this.wheelAngle;
        if (c[0] === 'F') wheels[c].steer.rotation.y = this.steerVis;
      }
      this.brakeMat.opacity = THREE.MathUtils.lerp(this.brakeMat.opacity, st.braking ? 0.95 : (st.headlights ? 0.25 : 0), 1 - Math.exp(-dt * 20));
    },
  };
  return car;
}
