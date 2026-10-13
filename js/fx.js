import * as THREE from 'three';

function softTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.45, 'rgba(255,255,255,0.45)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export const SOFT_TEX = softTexture();

/** Pool-based point-sprite particle system with per-particle size/alpha/colour. */
export class Particles {
  constructor(max, { additive = false, gravity = 0, texture = SOFT_TEX } = {}) {
    this.max = max; this.gravity = gravity;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.cursor = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry = g;
    this.material = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: texture }, uScale: { value: 600 } },
      vertexShader: /* glsl */`
        attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
        varying vec3 vC; varying float vA; uniform float uScale;
        void main(){
          vC = aColor; vA = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = aSize * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D uMap; varying vec3 vC; varying float vA;
        void main(){
          vec4 t = texture2D(uMap, gl_PointCoord);
          gl_FragColor = vec4(vC, t.a * vA);
          if (gl_FragColor.a < 0.003) discard;
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    // start all dead
    for (let i = 0; i < max; i++) { this.life[i] = 0; this.alpha[i] = 0; this.pos[i * 3 + 1] = -999; }
  }
  setScale(s) { this.material.uniforms.uScale.value = s; }
  emit(x, y, z, vx, vy, vz, { life = 1, size = 1, grow = 1, color = [1, 1, 1], alpha = 0.6, drag = 1 } = {}) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
    const j = i * 3;
    this.pos[j] = x; this.pos[j + 1] = y; this.pos[j + 2] = z;
    this.vel[j] = vx; this.vel[j + 1] = vy; this.vel[j + 2] = vz;
    this.col[j] = color[0]; this.col[j + 1] = color[1]; this.col[j + 2] = color[2];
    this.life[i] = this.maxLife[i] = life; this.size0[i] = size; this.size[i] = size;
    this.grow[i] = grow; this.alpha[i] = alpha; this.drag[i] = drag;
    this._a0 = this._a0 || new Float32Array(this.max); this._a0[i] = alpha;
  }
  update(dt) {
    const { pos, vel, life, maxLife, size, size0, alpha, grow, drag } = this;
    const a0 = this._a0; if (!a0) return;
    for (let i = 0; i < this.max; i++) {
      if (life[i] <= 0) { if (alpha[i] !== 0) alpha[i] = 0; continue; }
      life[i] -= dt;
      const j = i * 3, k = Math.max(0, life[i] / maxLife[i]);
      const dm = Math.exp(-drag[i] * dt);
      vel[j] *= dm; vel[j + 1] = vel[j + 1] * dm - this.gravity * dt; vel[j + 2] *= dm;
      pos[j] += vel[j] * dt; pos[j + 1] += vel[j + 1] * dt; pos[j + 2] += vel[j + 2] * dt;
      if (pos[j + 1] < 0.02 && this.gravity > 0) { pos[j + 1] = 0.02; vel[j + 1] *= -0.3; }
      size[i] = size0[i] * (1 + (1 - k) * grow[i]);
      alpha[i] = a0[i] * k * Math.min(1, (1 - k) * 12);
    }
    const g = this.geometry.attributes;
    g.position.needsUpdate = g.aSize.needsUpdate = g.aAlpha.needsUpdate = g.aColor.needsUpdate = true;
  }
}

/** Ring-buffer skid marks drawn as flat quads on the road. */
export class SkidMarks {
  constructor(maxSegments = 1800) {
    this.max = maxSegments;
    this.pos = new Float32Array(maxSegments * 4 * 3);
    this.alpha = new Float32Array(maxSegments * 4);
    const idx = new Uint32Array(maxSegments * 6);
    for (let s = 0; s < maxSegments; s++) {
      const v = s * 4, o = s * 6;
      idx.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], o);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      vertexShader: 'attribute float aAlpha; varying float vA; void main(){ vA=aAlpha; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'varying float vA;\nvoid main(){\n gl_FragColor = vec4(0.02,0.02,0.02,vA*0.62);\n#include <colorspace_fragment>\n}',
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 2;
    this.cursor = 0;
    this.last = [null, null, null, null];
  }
  /** wheel index w, world position x,z; sliding intensity 0..1 */
  add(w, x, z, hx, hz, intensity, y = 0.06) {
    const prev = this.last[w];
    if (intensity <= 0.02) { this.last[w] = null; return; }
    if (prev) {
      const dx = x - prev.x, dz = z - prev.z, l = Math.hypot(dx, dz);
      if (l > 0.35) {
        const nx = -dz / l * 0.14, nz = dx / l * 0.14;
        const s = this.cursor; this.cursor = (this.cursor + 1) % this.max;
        const p = this.pos, v = s * 12;
        p[v] = prev.x + prev.nx; p[v + 1] = y; p[v + 2] = prev.z + prev.nz;
        p[v + 3] = prev.x - prev.nx; p[v + 4] = y; p[v + 5] = prev.z - prev.nz;
        p[v + 6] = x + nx; p[v + 7] = y; p[v + 8] = z + nz;
        p[v + 9] = x - nx; p[v + 10] = y; p[v + 11] = z - nz;
        const a = Math.min(1, intensity);
        const aa = this.alpha, q = s * 4;
        aa[q] = aa[q + 1] = prev.a; aa[q + 2] = aa[q + 3] = a;
        this.mesh.geometry.attributes.position.needsUpdate = true;
        this.mesh.geometry.attributes.aAlpha.needsUpdate = true;
        this.last[w] = { x, z, nx, nz, a };
      }
    } else {
      this.last[w] = { x, z, nx: 0, nz: 0, a: Math.min(1, intensity) };
    }
  }
  clear() { this.alpha.fill(0); this.last.fill(null); this.mesh.geometry.attributes.aAlpha.needsUpdate = true; }
}
