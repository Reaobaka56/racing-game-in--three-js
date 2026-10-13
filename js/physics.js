import { ROAD_HALF, CURB_W, WALL_DIST, OFFROAD_DIST } from './track.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

export const TUNE = {
  wheelbase: 2.63,
  accel: 11.5,          // m/s^2 at standstill
  vmax: 66,             // m/s (~238 km/h) without nitro
  nitroAccelMul: 1.75,
  nitroVmaxMul: 1.2,
  brake: 30,
  reverseAccel: 7,
  vReverse: 12,
  grip: 27,             // lateral grip limit m/s^2
  coast: 1.4,
  aero: 0.00075,
};

export const GEAR_TOP = [14, 27, 40, 52, 63, 80]; // upper speed (m/s) for gears 1..6

export class CarPhysics {
  constructor(track) {
    this.track = track;
    this.reset(0);
  }

  /** Place the car at track sample i, optionally offset laterally. */
  reset(i, lat = 0, speed = 0) {
    const t = this.track;
    i = t.wrap(i);
    this.x = t.px[i] - t.tz[i] * lat;
    this.z = t.pz[i] + t.tx[i] * lat;
    this.psi = t.heading(i);
    const fx = Math.sin(this.psi), fz = Math.cos(this.psi);
    this.vx = fx * speed; this.vz = fz * speed;
    this.yaw = 0; this.steer = 0;
    this.vF = speed; this.vL = 0; this.speed = speed;
    this.aF = 0; this.aR = 0;
    this.nitro = 0.25; this.nitroOn = false; this.boostTimer = 0;
    this.idx = i; this.lat = lat; this.along = 0;
    this.cum = 0; // unwrapped distance along track from index 0
    this._lastIdx = i;
    this.onRoad = true; this.drifting = false; this.slip = 0;
    this.impact = 0; this.braking = false; this.throttle = 0;
    this.gear = 1; this.rpm = 0.12;
    this.driftTime = 0; this.driftScore = 0; this.surface = 'road';
    this.wallHit = false;
    this.cumInitialised = false;
  }

  setCum(c) { this.cum = c; this.cumInitialised = true; }

  applyBoost(dv, nitroAdd, timer) {
    const fx = Math.sin(this.psi), fz = Math.cos(this.psi);
    if (this.vF > 0) { this.vx += fx * dv; this.vz += fz * dv; }
    this.nitro = Math.min(1, this.nitro + nitroAdd);
    this.boostTimer = Math.max(this.boostTimer, timer);
  }

  update(dt, input) {
    const T = TUNE, tr = this.track;
    const fx = Math.sin(this.psi), fz = Math.cos(this.psi);
    const rx = -fz, rz = fx;
    let vF = this.vx * fx + this.vz * fz;
    let vL = this.vx * rx + this.vz * rz;
    const speed = Math.hypot(this.vx, this.vz);

    // ---- surface
    const near = tr.nearest(this.x, this.z, this._lastIdx);
    this.idx = near.i; this.lat = near.lat; this.along = near.along;
    const absLat = Math.abs(near.lat);
    const onRoad = absLat < OFFROAD_DIST;
    this.onRoad = onRoad;
    this.surface = onRoad ? 'road' : 'dirt';
    const surfGrip = onRoad ? 1 : 0.62;
    const surfPower = onRoad ? 1 : 0.7;

    // ---- boost state
    const wantNitro = input.nitro && input.throttle > 0.1 && (this.nitro > 0.01 || this.boostTimer > 0);
    this.nitroOn = !!wantNitro;
    if (this.nitroOn) {
      if (this.boostTimer > 0) this.boostTimer -= dt;
      else this.nitro = Math.max(0, this.nitro - dt * 0.28);
    } else if (this.boostTimer > 0) this.boostTimer -= dt * 0.5;
    const boost = this.nitroOn ? 1 : 0;

    // ---- longitudinal
    let a = 0;
    this.throttle = input.throttle; this.braking = false;
    if (input.throttle > 0) {
      if (vF > -1) {
        const top = T.vmax * (boost ? T.nitroVmaxMul : 1) * (onRoad ? 1 : 0.8);
        const k = Math.max(0, 1 - Math.pow(Math.max(vF, 0) / top, 2.4));
        // launch: gentle wheelspin-limited start
        const launch = 0.55 + 0.45 * clamp(vF / 6, 0, 1);
        a += input.throttle * T.accel * k * launch * (boost ? T.nitroAccelMul : 1) * surfPower;
      } else {
        a += input.throttle * T.brake; this.braking = true;
      }
    }
    if (input.brake > 0) {
      if (vF > 1.5) { a -= input.brake * T.brake * (onRoad ? 1 : 0.8); this.braking = true; }
      else {
        const k = Math.max(0, 1 - (-vF) / T.vReverse);
        a -= input.brake * T.reverseAccel * k;
        if (vF > -0.5) this.braking = vF > 0.2;
      }
    }
    if (input.throttle === 0 && input.brake === 0) a -= Math.sign(vF) * Math.min(Math.abs(vF) / 0.5, 1) * T.coast;
    a -= Math.sign(vF) * T.aero * vF * vF;
    if (!onRoad) a -= Math.sign(vF) * Math.min(1, Math.abs(vF) / 8) * (2.4 + Math.abs(vF) * 0.06);
    if (input.handbrake && speed > 3) a -= Math.sign(vF) * 3.5;

    // ---- steering
    const sp = clamp(speed / 55, 0, 1);
    const maxSteer = lerp(0.58, 0.085, Math.pow(sp, 0.7));
    const steerTarget = input.steer * maxSteer;
    this.steer += (steerTarget - this.steer) * Math.min(1, dt * (input.steer === 0 ? 9 : 6.5));
    let gripAcc = T.grip * surfGrip * (input.handbrake ? 0.56 : 1);
    let yawTarget = (vF * Math.tan(this.steer)) / T.wheelbase;
    const yawMax = (gripAcc * 1.18) / Math.max(Math.abs(vF), 6);
    yawTarget = clamp(yawTarget, -yawMax, yawMax);
    if (input.handbrake && speed > 8) yawTarget = clamp(yawTarget * 1.5 + input.steer * 0.3, -1.3, 1.3);
    // weathervane / counter-steer assist: yaw toward the velocity vector when sliding
    if (speed > 6) {
      const sl = clamp(vL / Math.max(speed, 8), -0.7, 0.7);
      yawTarget += -sl * (input.handbrake ? 0.9 : 1.55) * (Math.sign(vF) || 1);
    }
    this.yaw += (yawTarget - this.yaw) * Math.min(1, dt * (input.handbrake ? 5 : 9));
    this.psi += this.yaw * dt;

    // ---- integrate forces in the (old) heading frame, then rotate velocity
    vF += a * dt;
    // lateral grip: remove sideways velocity up to the grip limit
    const maxLat = gripAcc * dt;
    const removed = clamp(vL, -maxLat, maxLat);
    vL -= removed;
    // sliding scrubs speed a bit; grip turning conserves most momentum
    const scrub = Math.abs(vL) * 0.22 * dt;
    vF -= Math.sign(vF) * Math.min(Math.abs(vF), scrub * 1.6 + Math.abs(removed) * 0.04);
    // rebuild world velocity in the NEW heading frame (heading rotated by yaw*dt)
    // keep world velocity: components were measured in old frame
    const wvx = vF * fx + vL * rx, wvz = vF * fz + vL * rz;
    this.vx = wvx; this.vz = wvz;
    // re-measure in new frame for state/FX

    // ---- move
    const ox = this.x, oz = this.z;
    this.x += this.vx * dt; this.z += this.vz * dt;

    // ---- walls
    this.impact = 0; this.wallHit = false;
    const n2 = tr.nearest(this.x, this.z, near.i);
    const lim = WALL_DIST - 1.15;
    if (Math.abs(n2.lat) > lim) {
      const side = Math.sign(n2.lat);
      const i = n2.i;
      const nx = -tr.tz[i] * side, nz = tr.tx[i] * side; // outward normal
      const over = Math.abs(n2.lat) - lim;
      this.x -= nx * over; this.z -= nz * over;
      const vn = this.vx * nx + this.vz * nz;
      if (vn > 0) {
        this.impact = vn; this.wallHit = true;
        this.vx -= nx * vn * 1.22; this.vz -= nz * vn * 1.22;
        const tx = tr.tx[i], tz = tr.tz[i];
        const vt = this.vx * tx + this.vz * tz;
        // Coulomb-style scrape: friction proportional to the normal impulse
        const dv = Math.min(Math.abs(vt), 0.38 * vn * 1.22 + 0.4 * dt);
        this.vx -= tx * Math.sign(vt) * dv; this.vz -= tz * Math.sign(vt) * dv;
        // swing the nose around to run along the wall
        const wallHead = Math.atan2(tx, tz) + ((vt < 0) ? Math.PI : 0);
        let da = wallHead - this.psi; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
        this.psi += da * Math.min(0.4, dt * 5 + vn * 0.025);
        this.yaw *= 0.5;
      }
    }

    // ---- derived state
    const sfx = Math.sin(this.psi), sfz = Math.cos(this.psi);
    this.vF = this.vx * sfx + this.vz * sfz;
    this.vL = this.vx * -sfz + this.vz * sfx;
    this.speed = Math.hypot(this.vx, this.vz);
    this.aF = a;                                      // commanded long accel (for body pitch)
    this.aR = -this.yaw * Math.abs(this.vF) * Math.sign(this.vF || 1);
    const slipAng = Math.atan2(Math.abs(this.vL), Math.max(Math.abs(this.vF), 4));
    this.slip = clamp(Math.abs(this.vL) / 7, 0, 1);
    this.drifting = this.speed > 14 && Math.abs(this.vL) > 2.6;
    if (this.drifting && onRoad) {
      this.driftTime += dt;
      this.driftScore += dt * this.speed * Math.min(1, Math.abs(this.vL) / 6) * (1 + this.driftTime * 0.25);
      this.nitro = Math.min(1, this.nitro + dt * 0.14 * Math.min(1, Math.abs(this.vL) / 6));
    } else if (this.driftTime > 0) {
      this.driftTime = Math.max(0, this.driftTime - dt * 2.5);
    }
    this.slipAngle = slipAng;

    // ---- progress along track
    const n3 = tr.nearest(this.x, this.z, n2.i);
    this.idx = n3.i; this.lat = n3.lat; this.along = n3.along;
    let d = n3.i - this._lastIdx;
    if (d > tr.N / 2) d -= tr.N; else if (d < -tr.N / 2) d += tr.N;
    this.cum += d * tr.ds; this._lastIdx = n3.i;
    this._lastNearestIdx = n3.i;

    // ---- gearbox (for UI + audio)
    const sp2 = Math.abs(this.vF);
    let g = 0; while (g < GEAR_TOP.length - 1 && sp2 > GEAR_TOP[g]) g++;
    const lo = g === 0 ? 0 : GEAR_TOP[g - 1] * 0.62, hi = GEAR_TOP[g];
    const rpmT = clamp((sp2 - lo) / (hi - lo), 0, 1);
    this.gear = this.vF < -0.5 ? -1 : (sp2 < 0.8 && input.throttle === 0 ? 0 : g + 1);
    const targetRpm = 0.13 + rpmT * 0.82 + (g === 0 ? input.throttle * 0.1 * (1 - rpmT) : 0);
    this.rpm += (targetRpm - this.rpm) * Math.min(1, dt * 14);
  }
}
