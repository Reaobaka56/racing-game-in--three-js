/** Simple look-ahead autopilot. Used for the attract-mode demo, the victory lap and automated tests. */
const wrapAngle = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class AutoDriver {
  constructor(track, { aLat = 19, brake = 20, useNitro = true } = {}) {
    this.t = track; this.aLat = aLat; this.decel = brake; this.useNitro = useNitro;
  }
  drive(p) {
    const t = this.t, N = t.N, ds = t.ds;
    const speed = Math.max(p.speed, 0);
    const Ld = clamp(9 + speed * 0.5, 11, 48);
    const k = Math.max(2, Math.round(Ld / ds));
    const ti = (p.idx + k) % N;
    // aim slightly to the inside of the upcoming bend
    const c = t.curv[ti];
    const off = clamp(Math.abs(c) * 160, 0, 3.2) * -Math.sign(c);
    const tx = t.px[ti] - t.tz[ti] * off, tz = t.pz[ti] + t.tx[ti] * off;
    const want = Math.atan2(tx - p.x, tz - p.z);
    const err = wrapAngle(want - p.psi);
    const steer = clamp(err * 2.4, -1, 1);

    // braking: find the tightest allowed speed along the look-ahead
    let allowed = 80;
    const horizon = Math.min(220, speed * speed / (2 * this.decel) + 40);
    for (let d = 0; d < horizon; d += 6) {
      const i = (p.idx + Math.round(d / ds)) % N;
      let cm = 0; for (let q = -2; q <= 2; q++) cm = Math.max(cm, Math.abs(t.curv[(i + q * 3 + N) % N]));
      const vt = Math.min(80, Math.sqrt(this.aLat / Math.max(cm, 1e-4)));
      allowed = Math.min(allowed, Math.sqrt(vt * vt + 2 * this.decel * d));
    }
    let throttle = 0, brake = 0;
    if (speed > allowed + 1.5) brake = clamp((speed - allowed) / 7, 0.25, 1);
    else throttle = clamp((allowed - speed) / 5 + 0.35, 0.35, 1);
    if (!p.onRoad) throttle *= 0.6;
    const nitro = this.useNitro && p.nitro > 0.2 && Math.abs(err) < 0.05 && brake === 0 && allowed > speed + 8;
    return { throttle, brake, steer, handbrake: false, nitro };
  }
}
