
A browser-based 3D time-attack racing game built with [three.js](https://threejs.org/), starring the 2016 Volkswagen Golf GTI Clubsport Mk7.

Race three laps around a 2.6 km sunset circuit. Drift to charge nitro, hit the yellow boost pads, and chase the gold medal.

No build step, no dependencies to install. Everything is plain static files.

## Features

- Arcade car physics with grip, handbrake drifting, off-road slowdown and wall scrapes
- Procedural circuit: spline road, curbs, guard rails, tyre stacks, billboards, pines and mountains
- Real car model with spinning, steering wheels, body roll and pitch, and brake lights
- Drift smoke, skid marks, dust, sparks and nitro flames
- Fully synthesised audio (engine, turbo, tyre squeal, wind, impacts) with no audio files
- Three cameras: chase, hood and far chase
- Autopilot attract mode behind the menu
- Lap timing, medals, and best lap and best race saved in `localStorage`
- Keyboard, gamepad and touch controls
- Adaptive resolution to hold the frame rate on slower GPUs

## Controls

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` / arrows | Throttle, steer, brake and reverse |
| `Space` | Handbrake (start a drift) |
| `Shift` | Nitro (charged by drifting and boost pads) |
| `C` | Cycle camera |
| `R` | Reset to the track |
| `P` / `Esc` | Pause |
| `M` | Mute |
| `Enter` | Start or restart |

Gamepad: left stick steers, RT and LT for throttle and brake, A or RB for nitro, X for handbrake, Y for camera.
Touch devices get on-screen buttons automatically.

Medals: Gold 2:50 or under, Silver 3:05, Bronze 3:30.

## Run locally

Browsers block ES modules and `fetch` on `file://`, so serve the folder over HTTP:

```bash
cd public
python3 -m http.server 8000
# open http://localhost:8000
```

Any static server works (`npx serve`, `caddy file-server`, and so on).

## Project structure

```
public/
├── index.html          page, HUD and menu markup and styles
├── assets/
│   └── golf.b64.txt    car model (glTF binary, base64-encoded, ~2.6 MB before encoding)
├── js/
│   ├── main.js         renderer, scene, game states, camera, race logic, main loop
│   ├── physics.js      car physics, walls, lap progress, gearbox
│   ├── track.js        track sampling, road and scenery meshes, boost pads
│   ├── trackdata.js    control points of the circuit
│   ├── car.js          model loading, wheel and body setup, paint, suspension visuals
│   ├── fx.js           particle system and skid marks
│   ├── sky.js          sky shader and environment map
│   ├── audio.js        Web Audio synthesis
│   ├── input.js        keyboard, touch and gamepad
│   ├── ai.js           autopilot used for the menu demo and testing
│   └── ui.js           HUD, minimap and results screen
└── vendor/             three.js r170 and the addons used (GLTFLoader, meshopt decoder)
```

## Customising

- **Track:** edit the control points in `js/trackdata.js`. The loop is closed automatically.
- **Handling:** tune `TUNE` at the top of `js/physics.js` (acceleration, top speed, grip, nitro).
- **Medal times and paint colours:** `MEDALS` and `PAINTS` at the top of `js/main.js`.
- **Laps:** change `LAPS` in `js/main.js`.

## Deploy

The `public` folder is the whole site.

- **Cloudflare Pages / Netlify:** drag the `public` folder onto the dashboard, or connect the repo and set the publish directory to `public` with no build command.
- **GitHub Pages:** serve from a branch and set the folder to `/public`, or copy its contents to the root or a `docs/` folder.
- **Vercel:** run `vercel deploy` inside `public`.

The model is stored as base64 text because some hosts do not serve `.glb`. If your host does, convert it back with `base64 -d golf.b64.txt > golf.glb`, then load it by URL in `js/main.js`. `loadCar` in `js/car.js` accepts either form.

## Credits and licence

Car model: [2016 Volkswagen Golf GTI Clubsport Mk7](https://sketchfab.com/3d-models/2016-volkswagen-golf-gti-clubsport-mk7-492301d401ea4fb7bb1cb63e980051d0) by [Ddiaz Design](https://sketchfab.com/ddiaz-design), licensed under [CC BY-NC-SA 4.0](http://creativecommons.org/licenses/by-nc-sa/4.0/). The model was converted to a compressed GLB, the mirrors were removed, and wheels were regrouped for animation.

Because of that licence, this project must be shared under the same CC BY-NC-SA 4.0 terms and may not be used commercially (no ads, paid access or sales). Keep the credit on the menu screen.

Built with [three.js](https://github.com/mrdoob/three.js) (MIT).

This is an unofficial fan project and is not affiliated with or endorsed by Volkswagen.
