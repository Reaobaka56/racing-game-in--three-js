const $ = id => document.getElementById(id);

export function fmt(t, digits = 3) {
  if (t == null || !isFinite(t)) return '--:--.' + '-'.repeat(digits);
  const m = Math.floor(t / 60), s = t - m * 60;
  const sec = s.toFixed(digits).padStart(digits + 3, '0');
  return `${m}:${sec}`;
}

export class UI {
  constructor() {
    this.el = {
      loading: $('loading'), loadbar: $('loadbar'), loadtxt: $('loadtxt'),
      menu: $('menu'), hud: $('hud'), top: $('topbtns'), touch: $('touch'), pause: $('pause'), results: $('results'),
      lapno: $('lapno'), laptime: $('laptime'), last: $('lastLap'), best: $('bestLap'), total: $('totalTime'),
      spd: $('spd'), gear: $('gear'), rpm: $('rpm'), nbar: $('nbar'), nfill: $('nfill'), nhint: $('nitroHint'),
      drift: $('drift'), driftVal: $('driftVal'), banner: $('bannerTxt'), toast: $('toast'), fx: $('fx'), flash: $('flash'),
      minimap: $('minimap'), swatches: $('swatches'), recLap: $('recLap'), recRace: $('recRace'),
    };
    this.seg = [];
    for (let i = 0; i < 22; i++) { const s = document.createElement('i'); this.el.rpm.appendChild(s); this.seg.push(s); }
    this._c = {}; // cache of last-written values
    this.mmCtx = this.el.minimap.getContext('2d');
    this.mmBase = null;
  }
  set(key, el, val, prop = 'textContent') { if (this._c[key] !== val) { this._c[key] = val; el[prop] = val; } }

  progress(p, text) { this.el.loadbar.style.width = Math.round(p * 100) + '%'; if (text) this.el.loadtxt.textContent = text; }
  hideLoading() { const l = this.el.loading; l.style.opacity = 0; setTimeout(() => l.classList.add('hidden'), 650); }

  showMenu(on) { this.el.menu.classList.toggle('hidden', !on); document.getElementById('credit').classList.toggle('hidden', !on); }
  showHud(on, touch) {
    this.el.hud.classList.toggle('hidden', !on);
    this.el.top.classList.toggle('hidden', !on);
    this.el.touch.classList.toggle('hidden', !(on && touch));
  }
  showPause(on) { this.el.pause.classList.toggle('hidden', !on); }
  showResults(on) { this.el.results.classList.toggle('hidden', !on); }

  records(lap, race) { this.el.recLap.textContent = fmt(lap); this.el.recRace.textContent = fmt(race); }

  swatchesInit(colors, onPick, selected = 0) {
    const root = this.el.swatches;
    colors.forEach((c, i) => {
      const b = document.createElement('button'); b.className = 'sw' + (i === selected ? ' on' : '');
      b.style.setProperty('--c', c.hex); b.title = c.name; b.setAttribute('aria-label', c.name);
      b.addEventListener('click', () => { root.querySelectorAll('.sw').forEach(x => x.classList.remove('on')); b.classList.add('on'); onPick(c, i); });
      root.appendChild(b);
    });
  }

  hud(s) {
    const e = this.el;
    this.set('lap', e.lapno, `LAP ${Math.min(s.lap, s.laps)}<small>/${s.laps}</small>`, 'innerHTML');
    this.set('lt', e.laptime, fmt(s.lapTime));
    this.set('last', e.last, s.lastLap != null ? fmt(s.lastLap) : '--');
    this.set('best', e.best, s.bestLap != null ? fmt(s.bestLap) : '--');
    this.set('tot', e.total, fmt(s.total, 1));
    const kmh = Math.round(Math.abs(s.speed) * 3.6);
    this.set('spd', e.spd, String(kmh));
    if (this._c.boost !== s.boost) { this._c.boost = s.boost; e.spd.classList.toggle('boost', s.boost); }
    const g = s.gear === 0 ? 'N' : s.gear < 0 ? 'R' : String(s.gear);
    this.set('gear', e.gear, g);
    const on = Math.round(s.rpm * this.seg.length);
    if (this._c.rpmOn !== on) {
      this._c.rpmOn = on;
      this.seg.forEach((el, i) => { el.className = i < on ? 'on' + (i >= 18 ? ' red' : i >= 14 ? ' warm' : '') : ''; });
    }
    const nPct = Math.round(s.nitro * 100);
    if (this._c.nfw !== nPct) { this._c.nfw = nPct; e.nfill.style.width = nPct + '%'; }
    if (this._c.nOn !== s.nitroOn) { this._c.nOn = s.nitroOn; e.nbar.classList.toggle('on', s.nitroOn); }
    const full = s.nitro > 0.98; if (this._c.nFull !== full) { this._c.nFull = full; e.nbar.classList.toggle('full', full); }
    this.set('nh', e.nhint, s.nitro > 0.15 ? 'Hold Shift' : 'Drift to charge');
    // drift
    const show = s.driftScore > 0 && s.driftActive;
    if (this._c.dShow !== show) { this._c.dShow = show; e.drift.style.opacity = show ? 1 : 0; }
    if (show) this.set('dv', e.driftVal, Math.round(s.driftScore / 10) * 10 + '');
    // speed fx
    const fxv = s.fx.toFixed(2);
    if (this._c.fxv !== fxv) { this._c.fxv = fxv; e.fx.style.opacity = fxv; }
  }

  banner(text, pop = true) {
    const b = this.el.banner; b.textContent = text; b.classList.remove('pop'); void b.offsetWidth; if (pop && text) b.classList.add('pop');
  }
  toast(text, cls = '') {
    const d = document.createElement('div'); d.textContent = text; if (cls) d.className = cls;
    this.el.toast.appendChild(d); setTimeout(() => d.remove(), 2400);
    while (this.el.toast.children.length > 3) this.el.toast.firstChild.remove();
  }
  flash(a = 0.35) { const f = this.el.flash; f.style.transition = 'none'; f.style.opacity = a; requestAnimationFrame(() => { f.style.transition = 'opacity .45s'; f.style.opacity = 0; }); }

  /* ---------- minimap ---------- */
  minimapInit(track) {
    const c = this.el.minimap, W = c.width, H = c.height, pad = 22;
    let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
    for (let i = 0; i < track.N; i++) { const x = -track.px[i], z = -track.pz[i]; minx = Math.min(minx, x); maxx = Math.max(maxx, x); minz = Math.min(minz, z); maxz = Math.max(maxz, z); }
    const k = Math.min((W - pad * 2) / (maxx - minx), (H - pad * 2) / (maxz - minz));
    const ox = (W - (maxx - minx) * k) / 2 - minx * k, oz = (H - (maxz - minz) * k) / 2 - minz * k;
    this.mm = { k, ox, oz };
    const base = document.createElement('canvas'); base.width = W; base.height = H;
    const g = base.getContext('2d');
    g.lineJoin = 'round'; g.lineCap = 'round';
    const path = () => { g.beginPath(); for (let i = 0; i <= track.N; i += 3) { const j = i % track.N; const X = -track.px[j] * k + ox, Y = -track.pz[j] * k + oz; i ? g.lineTo(X, Y) : g.moveTo(X, Y); } g.closePath(); };
    g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 17; path(); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.88)'; g.lineWidth = 10; path(); g.stroke();
    g.strokeStyle = '#2a3340'; g.lineWidth = 6; path(); g.stroke();
    // start marker
    const sx = -track.px[0] * k + ox, sy = -track.pz[0] * k + oz;
    g.fillStyle = '#fff'; g.fillRect(sx - 9, sy - 2, 18, 4);
    this.mmBase = base;
  }
  minimap(track, s, pads) {
    if (!this.mmBase) return;
    const g = this.mmCtx, { k, ox, oz } = this.mm, c = this.el.minimap;
    g.clearRect(0, 0, c.width, c.height); g.drawImage(this.mmBase, 0, 0);
    if (pads) for (const p of pads) { g.fillStyle = p.cooldown > 0 ? 'rgba(255,200,0,.25)' : '#ffc800'; g.beginPath(); g.arc(-p.x * k + ox, -p.z * k + oz, 4.5, 0, 6.3); g.fill(); }
    const X = -s.x * k + ox, Y = -s.z * k + oz;
    const dx = -Math.sin(s.psi), dy = -Math.cos(s.psi);
    g.save(); g.translate(X, Y); g.rotate(Math.atan2(dx, -dy));
    g.fillStyle = '#ff3b30'; g.strokeStyle = '#fff'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, -12); g.lineTo(8, 9); g.lineTo(0, 5); g.lineTo(-8, 9); g.closePath(); g.stroke(); g.fill();
    g.restore();
  }

  /* ---------- results ---------- */
  results({ laps, total, best, medal, record, newLapRecord }) {
    const t = $('resTable'); t.innerHTML = '';
    const bestIdx = laps.indexOf(Math.min(...laps));
    laps.forEach((l, i) => {
      const tr = document.createElement('tr'); if (i === bestIdx) tr.className = 'best';
      tr.innerHTML = `<td class="k">Lap ${i + 1}</td><td class="num">${fmt(l)}</td>`; t.appendChild(tr);
    });
    const tr = document.createElement('tr'); tr.className = 'total';
    tr.innerHTML = `<td class="k">Total</td><td class="num">${fmt(total)}</td>`; t.appendChild(tr);
    const m = $('medal'); m.style.setProperty('--m', medal.color); $('medalTxt').textContent = medal.name;
    $('resTitle').textContent = medal.title;
    const rec = $('resRec'); rec.classList.toggle('hidden', !(record || newLapRecord));
    rec.textContent = record ? 'New best race!' : 'New best lap!';
  }
}
