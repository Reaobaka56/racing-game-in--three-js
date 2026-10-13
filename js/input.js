/** Unified keyboard / touch / gamepad input. */
export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.touch = { left: false, right: false, gas: false, brake: false, nitro: false, drift: false };
    this.steerSmooth = 0;
    this.pressed = new Set(); // edge-triggered keys since last poll
    this.padPrev = {};
    const prevent = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);
    addEventListener('keydown', e => {
      if (prevent.has(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); for (const k in this.touch) this.touch[k] = false; });
    this._bindTouch();
  }

  _bindTouch() {
    const map = { tL: 'left', tR: 'right', tG: 'gas', tB: 'brake', tN: 'nitro', tD: 'drift' };
    for (const id in map) {
      const el = document.getElementById(id); if (!el) continue;
      const down = e => { e.preventDefault(); this.touch[map[id]] = true; el.classList.add('on'); try { el.setPointerCapture(e.pointerId); } catch (_) {} };
      const up = e => { e.preventDefault(); this.touch[map[id]] = false; el.classList.remove('on'); };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
      el.addEventListener('contextmenu', e => e.preventDefault());
    }
  }

  /** true once per key press */
  wasPressed(...codes) { let r = false; for (const c of codes) if (this.pressed.has(c)) r = true; return r; }
  endFrame() { this.pressed.clear(); }

  _pad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  /** returns {throttle, brake, steer(-1..1, left +), handbrake, nitro} and edge events from gamepad */
  poll(dt) {
    const k = this.keys, t = this.touch;
    const left = k.has('KeyA') || k.has('ArrowLeft') || t.left;
    const right = k.has('KeyD') || k.has('ArrowRight') || t.right;
    let target = (left ? 1 : 0) - (right ? 1 : 0);
    // smooth keyboard steering so taps feel precise and holds ramp up
    const rate = target === 0 ? 9 : (Math.sign(target) !== Math.sign(this.steerSmooth) && this.steerSmooth !== 0 ? 14 : 5.2);
    this.steerSmooth += Math.sign(target - this.steerSmooth) * Math.min(Math.abs(target - this.steerSmooth), rate * dt);
    let steer = this.steerSmooth;
    let throttle = (k.has('KeyW') || k.has('ArrowUp') || t.gas) ? 1 : 0;
    let brake = (k.has('KeyS') || k.has('ArrowDown') || t.brake) ? 1 : 0;
    let handbrake = k.has('Space') || t.drift;
    let nitro = k.has('ShiftLeft') || k.has('ShiftRight') || t.nitro;
    const p = this._pad();
    const edges = {};
    if (p) {
      const dz = v => Math.abs(v) < 0.12 ? 0 : v;
      const ax = dz(p.axes[0] || 0);
      if (ax !== 0) steer = -ax;
      const rt = p.buttons[7] ? p.buttons[7].value : 0, lt = p.buttons[6] ? p.buttons[6].value : 0;
      if (rt > 0.05) throttle = Math.max(throttle, rt);
      if (lt > 0.05) brake = Math.max(brake, lt);
      if (p.buttons[2] && p.buttons[2].pressed) handbrake = true;
      if ((p.buttons[0] && p.buttons[0].pressed) || (p.buttons[5] && p.buttons[5].pressed)) nitro = true;
      const edge = (i, name) => { const now = !!(p.buttons[i] && p.buttons[i].pressed); if (now && !this.padPrev[i]) edges[name] = true; this.padPrev[i] = now; };
      edge(3, 'cam'); edge(8, 'reset'); edge(9, 'pause');
    }
    return { throttle, brake, steer, handbrake, nitro, edges };
  }
}
