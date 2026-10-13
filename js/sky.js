import * as THREE from 'three';

export const SUN_DIR = new THREE.Vector3(-0.55, 0.32, 0.6).normalize();
export const HORIZON_COLOR = new THREE.Color(0xf0b383);

const vert = /* glsl */`
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position,1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w * 0.99995; // always at far plane
}`;

const frag = /* glsl */`
precision highp float;
varying vec3 vDir;
uniform vec3 uSun;
uniform float uTime;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float a=.5, s=0.; for(int i=0;i<5;i++){ s+=a*noise(p); p*=2.03; a*=.5; } return s; }
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 zenith  = vec3(0.10, 0.22, 0.46);
  vec3 mid     = vec3(0.38, 0.52, 0.72);
  vec3 horizon = vec3(0.96, 0.70, 0.50);
  vec3 ground  = vec3(0.30, 0.27, 0.22);
  vec3 col = mix(horizon, mid, smoothstep(0.0, 0.22, h));
  col = mix(col, zenith, smoothstep(0.18, 0.85, h));
  // warm glow toward the sun
  float sd = max(dot(d, uSun), 0.0);
  col += vec3(1.0, 0.55, 0.22) * pow(sd, 6.0) * 0.55;
  col += vec3(1.0, 0.8, 0.5) * pow(sd, 48.0) * 0.8;
  // sun disc
  col += vec3(1.0, 0.92, 0.75) * smoothstep(0.9993, 0.9998, sd) * 6.0;
  // clouds
  if (h > 0.01) {
    vec2 uv = d.xz / (h + 0.28) * 1.7 + vec2(uTime * 0.004, 0.0);
    float c = fbm(uv * 1.3);
    c = smoothstep(0.50, 0.82, c);
    vec3 cloudLit = mix(vec3(1.0, 0.72, 0.52), vec3(1.0, 0.93, 0.85), clamp(1.0 - sd * 0.5, 0.0, 1.0));
    vec3 cloudShade = vec3(0.45, 0.38, 0.5);
    float lit = clamp(fbm(uv * 1.3 + uSun.xz * 0.18) * 1.7 - 0.25, 0.0, 1.0);
    vec3 cc = mix(cloudShade, cloudLit, lit);
    col = mix(col, cc, c * smoothstep(0.01, 0.2, h) * 0.9);
  }
  if (h < 0.0) col = mix(horizon * 0.9, ground, smoothstep(0.0, -0.25, h));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function makeSky() {
  const mat = new THREE.ShaderMaterial({
    vertexShader: vert, fragmentShader: frag,
    uniforms: { uSun: { value: SUN_DIR.clone() }, uTime: { value: 0 } },
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
  mesh.frustumCulled = false; mesh.renderOrder = -10;
  mesh.scale.setScalar(1000);
  return mesh;
}

/** Generates an environment map matching the sky for reflections. */
export function makeEnvironment(renderer) {
  const envScene = new THREE.Scene();
  const sky = makeSky();
  // the sky shader writes at far plane with no depth; for PMREM that is fine
  envScene.add(sky);
  // a warm "sun" light panel to give the paint a bright specular streak
  const sun = new THREE.Mesh(new THREE.SphereGeometry(40, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(14, 9, 5) }));
  sun.position.copy(SUN_DIR).multiplyScalar(700);
  envScene.add(sun);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(envScene, 0.02, 1, 2000);
  pmrem.dispose();
  return rt.texture;
}
