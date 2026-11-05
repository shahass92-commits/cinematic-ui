// CNIQ scroll drive: one Three.js stage, one GSAP master timeline scrubbed by ScrollTrigger.
// Scenes 01–07 are side elevations, 08–14 are plan views, then a 3D camera study of the same vehicle.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createVehicle, SPEC } from './vehicle.js';

const { gsap, ScrollTrigger } = window;
gsap.registerPlugin(ScrollTrigger);

const root = document.documentElement;
const params = new URLSearchParams(window.location.search);
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// ---------------------------------------------------------------- route
const ROAD = 3.5; // half width of the road (m)
const X0 = -320; // road start
const X1 = 400; // start of the bend (long straight so the side-view drive can run longer)
const RADIUS = 12;
const RUN_OUT = 700;
const L1 = X1 - X0;
const LC = (Math.PI / 2) * RADIUS;
const LTOTAL = L1 + LC + RUN_OUT;
const S0 = -X0; // car starts at x = 0
const V_X = X1 + RADIUS; // centre line of the vertical road
const sAtZ = (z) => L1 + LC + (z - RADIUS);

function pathAt(s, o) {
  if (s <= L1) {
    o.x = X0 + s; o.z = 0; o.h = 0; o.k = 0;
  } else if (s <= L1 + LC) {
    const a = (s - L1) / RADIUS;
    o.x = X1 + RADIUS * Math.sin(a); o.z = RADIUS - RADIUS * Math.cos(a); o.h = a; o.k = 1 / RADIUS;
  } else {
    o.x = V_X; o.z = RADIUS + (s - L1 - LC); o.h = Math.PI / 2; o.k = 0;
  }
  return o;
}

// ---------------------------------------------------------------- renderer
const canvas = $('#stage');
let renderer = null;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
} catch (err) {
  root.classList.add('no-webgl');
  console.warn('WebGL unavailable, showing the static layout.', err);
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(9, 1, 0.1, 4000);

if (renderer) {
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.9;
}
scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3a3a, 0.55));
const key = new THREE.DirectionalLight(0xffffff, 1.35);
key.position.set(-6, 12, 9);
scene.add(key);

// ---------------------------------------------------------------- road
const GRAIN = /* glsl */ `
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  // soft felt texture, kept above pixel scale so it does not sparkle while the camera tracks
  float felt(vec2 p) { return (vnoise(p * 22.0) - 0.5) * 0.016 + (vnoise(p * 5.0) - 0.5) * 0.014; }
`;
const roadUniforms = {
  uFocus: { value: new THREE.Vector3() },
  uFade0: { value: 4000 },
  uFade1: { value: 5000 },
  uHalf: { value: ROAD },
};

function buildRoad() {
  const pos = [];
  const uv = [];
  const idx = [];
  const p = {};
  let s = 0;
  let row = 0;
  while (s <= LTOTAL) {
    pathAt(s, p);
    const nx = -Math.sin(p.h);
    const nz = Math.cos(p.h);
    for (const l of [-ROAD, ROAD]) {
      pos.push(p.x + nx * l, 0, p.z + nz * l);
      uv.push(s, l);
    }
    if (row > 0) {
      const a = (row - 1) * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    row++;
    s += s > L1 - 2 && s < L1 + LC + 2 ? 0.25 : 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    uniforms: roadUniforms,
    transparent: true,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vW;
      void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uFocus; uniform float uFade0; uniform float uFade1; uniform float uHalf;
      varying vec2 vUv; varying vec3 vW;
      ${GRAIN}
      void main() {
        float s = vUv.x; float l = vUv.y;
        vec3 col = vec3(0.098) + felt(vW.xz);
        float t = s / 7.0; float ft = fwidth(t) + 1e-4;
        float f = fract(t);
        float dash = smoothstep(0.0, ft, f) * (1.0 - smoothstep(0.42 - ft, 0.42 + ft, f));
        float fl = fwidth(l) + 1e-4;
        float centre = (1.0 - smoothstep(0.065, 0.065 + fl, abs(l))) * dash;
        float edge = 1.0 - smoothstep(0.045, 0.045 + fl, abs(abs(l) - (uHalf - 0.32)));
        col = mix(col, vec3(0.19), centre * 0.85);
        col = mix(col, vec3(0.135), edge * 0.75);
        float a = 1.0 - smoothstep(uFade0, uFade1, distance(vW.xz, uFocus.xz));
        gl_FragColor = vec4(col, a);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 1;
  return mesh;
}

// The vertical face of the road slab: in elevation it becomes the dark "mat" that rises.
function buildWall() {
  const width = X1 - (X0 - 200);
  const geo = new THREE.PlaneGeometry(width, 90);
  const mat = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vW;
      ${GRAIN}
      void main() {
        // poster mat: warm grey under the car, settling darker with depth
        vec3 col = mix(vec3(0.235), vec3(0.13), smoothstep(-0.2, -9.0, vW.y)) + felt(vW.xy) * 1.6;
        float fx = fwidth(vW.x) + 1e-4;
        float seam = 1.0 - smoothstep(0.02, 0.02 + fx, abs(fract(vW.x / 14.0) - 0.5) * 14.0);
        col = mix(col, col * 0.86, seam * step(vW.y, -0.3));
        col = mix(col, vec3(0.098), smoothstep(-0.16, -0.01, vW.y));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set((X0 - 200 + X1) / 2, -45, ROAD);
  return mesh;
}

const road = buildRoad();
const wall = buildWall();
scene.add(road, wall);

// two original vehicles; the switch in the edition bar picks which one drives
const fleet = { mpv: createVehicle('mpv'), suv: createVehicle('suv') };
let vehicle = fleet.mpv;
for (const v of Object.values(fleet)) scene.add(v.group);
// build both vehicles' shaders up front so switching never stalls on a first-time compile
if (renderer) {
  try { renderer.compile(scene, camera); } catch (err) { /* compile on first draw instead */ }
}
fleet.suv.group.visible = false;

// ---------------------------------------------------------------- camera rig (all values tweened by GSAP)
const rig = {
  s: S0, // distance along the route
  elev: 0, // camera elevation, 0 = side elevation, 90 = plan
  azim: 0, // camera azimuth around the subject
  fov: 9,
  vw: 12, // metres visible across the screen at the subject
  follow: 1, // 1 = track the car, 0 = hold a fixed frame
  fx: X1 - 4,
  fz: 10,
  ty: 0.45, // look-at height
  ay: 0, // composition anchor height
  edge: 1, // 1 = anchor on the road edge (elevation), 0 = anchor on the car
  sx: 0.5, // where the anchor sits on screen (0..1)
  sy: 0.64,
  wheel: 0, // 1 = frame the front wheel
  fade: 4000, // road dissolves into white beyond this radius
  drl: 1.1,
  brake: 0,
};

const RIG_KEYS = Object.keys(rig); // GSAP adds its own cache key to tweened objects, so freeze the list

const LAYOUTS = {
  wide: {
    vw0: 12.2, vw1: 13.6, vw2: 11.6, sx5: 0.58, sy0: 0.66, sy1: 0.42, sy2: 0.31, sy3: 0.27, sx3: 0.44, sx4: 0.4,
    ohVw: 19, ohSx: 0.42, ohSy: 0.38,
    curveVw: 44, curveFx: X1 - 4, curveFz: 10,
    vVw: 32, vSx: 0.63, vSy: 0.42,
    studyVw: 8.6, studySx: 0.64, studySy: 0.55, heroSx: 0.68, wheelVw: 2.5, wheelSx: 0.64, endVw: 12.5, endSx: 0.64, endSy: 0.54,
  },
  narrow: {
    vw0: 6.3, vw1: 7.0, vw2: 6.4, sx5: 0.5, sy0: 0.62, sy1: 0.42, sy2: 0.33, sy3: 0.28, sx3: 0.5, sx4: 0.5,
    ohVw: 10, ohSx: 0.5, ohSy: 0.42,
    curveVw: 30, curveFx: X1 + 0.5, curveFz: 20,
    vVw: 20, vSx: 0.73, vSy: 0.4,
    studyVw: 6.2, studySx: 0.5, studySy: 0.33, heroSx: 0.5, wheelVw: 2.1, wheelSx: 0.5, endVw: 8.4, endSx: 0.5, endSy: 0.33,
  },
};

// ---------------------------------------------------------------- per-frame state
const P = {};
const target = new THREE.Vector3();
const carT = new THREE.Vector3();
const fixedT = new THREE.Vector3();
const anchor = new THREE.Vector3();
const fixedA = new THREE.Vector3();
const wheelT = new THREE.Vector3();
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const DEG = Math.PI / 180;

let W = 1;
let H = 1;
let lastS = rig.s;
let lastTime = performance.now();
let speed = 0;
let tl = null;
let lastKey = '';
// 3D rail cards: GSAP tweens `in` (entrance 0..1); frame() composes the full transform every tick
let railCards = [];
// scroll velocity drives a gentle skew on the moving type and rails; it decays when scrolling stops
let scrollVel = 0;
let skew = 0;
const skewTargets = ['#ghost', '#ghost2', '#cards', '#cards2', '.flow'];
const streaks = document.getElementById('streaks');
// pointer tilt for the 3D cards (smoothed each frame); stays at rest on touch-only devices
const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
window.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') return;
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
}, { passive: true });

const el = {
  speed: $('#speed'),
  sceneNo: $('#sceneNo'),
  sceneOf: $('#sceneOf'),
  sceneName: $('#sceneName'),
  lens: $('#lens'),
  rail: $('#railFill'),
  needle: $('#needle'),
  live: $('#liveTag'),
  shotNo: $('#shotNo'),
  shotName: $('#shotName'),
  milestones: $$('#milestones li').map((li) => ({ li, z: Number(li.dataset.z), done: false })),
};

function toScreen(v, out) {
  tmp.copy(v).project(camera);
  out.x = (tmp.x * 0.5 + 0.5) * W;
  out.y = (-tmp.y * 0.5 + 0.5) * H;
  out.z = tmp.z;
  return out;
}

function resize() {
  W = window.innerWidth;
  H = canvas.clientHeight || window.innerHeight;
  if (renderer) {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H, false);
  }
  lastKey = '';
}

// timeline map (seconds). The study starts once the car has stopped on the vertical road.
const STUDY = 19.65;
const TOTAL = STUDY + 4.45; // the last word reveal and colour sweep end just after the pull-back
const CRANE = [11, 11.95];
const SCENES = [
  [0, 'SIDE ELEVATION'],
  [1, 'SIDE ELEVATION'],
  [2, 'SIDE ELEVATION'],
  [3, 'SIDE ELEVATION · SERVICES'],
  [5, 'SIDE ELEVATION · PLATFORM'],
  [8, 'SIDE ELEVATION'],
  [9, 'SIDE ELEVATION · WORKFLOW'],
  [11.95, 'PLAN VIEW'],
  [12.75, 'PLAN VIEW · BEND'],
  [13.95, 'PLAN VIEW'],
  [14.95, 'PLAN VIEW'],
  [15.95, 'PLAN VIEW · ACCESS'],
  [17, 'PLAN VIEW · STATUS'],
  [18.4, 'PLAN VIEW'],
];
const SHOTS = [
  [STUDY, 'SHOT 01', 'CRANE DOWN'],
  [STUDY + 1, 'SHOT 02', 'ARC 180°'],
  [STUDY + 2, 'SHOT 03', 'LOW-ANGLE HERO'],
  [STUDY + 3, 'SHOT 04', 'DOLLY IN'],
  [STUDY + 3.55, 'SHOT 05', 'PULL BACK'],
];

// chapter navigator: one entry per scene plus the 3D study
const CHAPTERS = [
  [0, 'Intro'], [1, 'Platform'], [2, 'Promise'], [3, 'Services'], [5, 'Compass Nexus iQ'],
  [8, 'Built for'], [9, 'Workflow'], [11.95, 'Live operations'], [12.75, 'Routing'], [13.95, 'Reliability'],
  [14.95, 'Airport & intercity'], [15.95, 'Security & audit'], [17, 'Trip status'], [18.4, 'Verified'], [STUDY, '3D study'],
];
const chapterList = document.querySelector('#chapters ol');
const chapterItems = CHAPTERS.map(([time, label], i) => {
  const li = document.createElement('li');
  const b = document.createElement('button');
  b.type = 'button';
  b.setAttribute('aria-label', `Chapter ${i + 1}: ${label}`);
  const span = document.createElement('span');
  span.textContent = `${String(i + 1).padStart(2, '0')} ${label.toUpperCase().replace('IQ', 'iQ')}`;
  b.appendChild(span);
  // land just after the chapter starts, once its copy has revealed
  b.addEventListener('click', () => window.__cniq.seek(time + 0.35, true));
  li.appendChild(b);
  chapterList.appendChild(li);
  return li;
});
let activeChapter = -1;

function updateHud(t, kmh) {
  el.speed.textContent = String(Math.round(kmh)).padStart(2, '0');
  let no;
  let of = String(SCENES.length);
  let name;
  if (t < STUDY) {
    let i = 0;
    for (let j = 0; j < SCENES.length; j++) if (t >= SCENES[j][0]) i = j;
    no = String(i + 1).padStart(2, '0');
    name = t >= CRANE[0] && t < CRANE[1] ? 'CRANE UP' : SCENES[i][1];
    if (W < 560) name = name.replace(/ · .*/, ''); // short label on phones so it clears the speed readout
  } else {
    let k = 0;
    for (let j = 0; j < SHOTS.length; j++) if (t >= SHOTS[j][0]) k = j;
    no = String(k + 1).padStart(2, '0');
    of = '05';
    name = 'CAMERA STUDY';
    el.shotNo.textContent = SHOTS[k][1];
    el.shotName.textContent = SHOTS[k][2];
  }
  if (el.sceneNo.textContent !== no) el.sceneNo.textContent = no;
  if (el.sceneOf.textContent !== of) el.sceneOf.textContent = of;
  if (el.sceneName.textContent !== name) el.sceneName.textContent = name;
  const mm = Math.round(12 / Math.tan((rig.fov * DEG) / 2));
  el.lens.textContent = `LENS ${mm}MM · TILT ${String(Math.round(rig.elev)).padStart(2, '0')}°`;
  el.rail.style.transform = `scaleX(${Math.min(1, t / TOTAL).toFixed(4)})`;
  let ch = 0;
  for (let j = 0; j < CHAPTERS.length; j++) if (t >= CHAPTERS[j][0] - 0.05) ch = j;
  if (ch !== activeChapter) {
    activeChapter = ch;
    chapterItems.forEach((li, j) => {
      li.classList.toggle('active', j === ch);
      li.classList.toggle('passed', j < ch);
    });
  }
}

function updateScrollFx(dt) {
  // speed streaks only in the side elevation, sliding with the car
  const side = Math.max(0, 1 - rig.elev / 8);
  const on = side * Math.min(1, speed / 55);
  streaks.style.opacity = (on * 0.9).toFixed(3);
  if (on > 0.001) streaks.style.setProperty('--sx', `${(-(rig.s * 46) % 70000).toFixed(1)}px`);
  if (reduceMotion) return;
  scrollVel *= Math.pow(0.02, dt); // decays to rest within about a second
  const target = Math.max(-7, Math.min(7, -scrollVel / 260));
  const next = skew + (target - skew) * Math.min(1, dt * 7);
  if (Math.abs(next - skew) > 0.005 || Math.abs(next) > 0.005) {
    skew = Math.abs(next) < 0.005 ? 0 : next;
    gsap.set(skewTargets, { skewX: skew });
  }
}

// Cards bend like a curved wall around the screen centre: they turn toward the viewer,
// sink back in depth toward the edges, and a sheen sweeps across the glass as they pass.
function updateCards3d(narrow) {
  const half = W / 2;
  const maxY = narrow ? 16 : 26;
  const depth = narrow ? 90 : 170;
  pointer.sx += (pointer.x - pointer.sx) * 0.08;
  pointer.sy += (pointer.y - pointer.sy) * 0.08;
  const now = performance.now() / 1000;
  let i = 0;
  for (const c of railCards) {
    i++;
    if (c.rail.style.visibility === 'hidden') continue;
    const x = gsap.getProperty(c.rail, 'x');
    const cx = c.el.offsetLeft + c.el.offsetWidth / 2 + x;
    const n = Math.max(-1.5, Math.min(1.5, (cx - half) / half));
    const a = Math.abs(n);
    const e = 1 - c.in; // entrance remainder
    const focus = Math.max(0, 1 - a); // the card nearest the centre reacts most to the pointer
    const float = reduceMotion ? 0 : Math.sin(now * 1.3 + i * 0.9) * 4 * c.in;
    // cards fold away steeply as they reach the screen edges, like pages of a book
    const fold = Math.min(1, Math.max(0, (a - 0.78) / 0.6));
    const foldE = fold * fold * (3 - 2 * fold);
    const ry = -n * maxY + e * 34 + pointer.sx * 9 * focus - Math.sign(n) * foldE * 42;
    const rx = e * -26 - pointer.sy * 7 * focus;
    const tz = -Math.pow(a, 1.4) * depth - e * 160 + focus * 26 - foldE * 110;
    const ty = e * 90 + a * a * 10 + float;
    c.el.style.transform = `perspective(1100px) translate3d(0, ${ty.toFixed(1)}px, ${tz.toFixed(1)}px) rotateY(${ry.toFixed(2)}deg) rotateX(${rx.toFixed(2)}deg)`;
    c.el.style.setProperty('--sheen', `${(50 - n * 70 - pointer.sx * 18 * focus).toFixed(1)}%`);
    c.el.style.setProperty('--rim', (focus * focus * c.in).toFixed(3));
    c.el.style.setProperty('--shade', (Math.min(1, a) * 0.42 + e * 0.3 + foldE * 0.25).toFixed(3));
    c.el.style.setProperty('--foil', `${(50 + n * 80 + pointer.sx * 30 * focus).toFixed(1)}%`);
    c.el.style.setProperty('--foilA', (0.25 + focus * 0.55).toFixed(3));
  }
}

const scr = { x: 0, y: 0, z: 0 };
const scr2 = { x: 0, y: 0, z: 0 };

function frame() {
  const now = performance.now();
  const dt = Math.min(0.1, Math.max(1e-3, (now - lastTime) / 1000));
  lastTime = now;

  pathAt(rig.s, P);
  const ds = rig.s - lastS;
  lastS = rig.s;
  const kmhTarget = Math.min(96, (Math.abs(ds) / dt) * 0.42);
  speed += (kmhTarget - speed) * Math.min(1, dt * 5);
  if (speed < 0.4) speed = 0;

  // vehicle on the route
  const g = vehicle.group;
  g.position.set(P.x, 0, P.z);
  g.rotation.y = -P.h;
  g.updateMatrixWorld(true);
  vehicle.update({
    distance: rig.s,
    steer: -Math.atan((SPEC.frontAxle - SPEC.rearAxle) * P.k) * 1.2,
    drl: rig.drl,
    tail: 0.55 + rig.brake,
  });

  // camera: spherical rig around a target, then a lens shift to place the anchor on screen
  const aspect = W / H;
  carT.set(P.x, rig.ty, P.z);
  if (rig.wheel > 0.001) {
    vehicle.wheelWorld(true, 1, wheelT);
    carT.lerp(wheelT, rig.wheel);
  }
  fixedT.set(rig.fx, rig.ty, rig.fz);
  target.copy(fixedT).lerp(carT, rig.follow);

  const fovR = rig.fov * DEG;
  const dist = rig.vw / aspect / (2 * Math.tan(fovR / 2));
  const A = rig.azim * DEG;
  const E = Math.min(89.999, rig.elev) * DEG;
  camera.position.set(
    target.x + dist * Math.sin(A) * Math.cos(E),
    target.y + dist * Math.sin(E),
    target.z + dist * Math.cos(A) * Math.cos(E),
  );
  camera.up.set(-Math.sin(A) * Math.sin(E), Math.cos(E), -Math.cos(A) * Math.sin(E));
  camera.lookAt(target);
  camera.fov = rig.fov;
  camera.aspect = aspect;
  camera.near = Math.max(0.05, dist * 0.06);
  camera.far = dist * 3 + 600;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();

  const nx = -Math.sin(P.h);
  const nz = Math.cos(P.h);
  anchor.set(P.x + nx * ROAD * rig.edge, rig.ay, P.z + nz * ROAD * rig.edge);
  if (rig.wheel > 0.001) anchor.lerp(wheelT, rig.wheel);
  fixedA.set(rig.fx, rig.ay, rig.fz).lerp(anchor, rig.follow);
  tmp2.copy(fixedA).project(camera);
  const pe = camera.projectionMatrix.elements;
  pe[8] -= rig.sx * 2 - 1 - tmp2.x;
  pe[9] -= 1 - rig.sy * 2 - tmp2.y;
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();

  wall.visible = rig.elev < 70 && rig.s < L1;
  roadUniforms.uFocus.value.set(P.x, 0, P.z);
  roadUniforms.uFade0.value = rig.fade;
  roadUniforms.uFade1.value = rig.fade * 1.8 + 10;

  // ---- DOM sync (screen positions projected from the scene)
  toScreen(tmp2.set(P.x, 0, P.z + ROAD * Math.cos(P.h)), scr);
  root.style.setProperty('--road-top', `${scr.y.toFixed(1)}px`);
  toScreen(tmp2.set(V_X - ROAD, 0, Math.max(P.z, RADIUS)), scr);
  toScreen(tmp2.set(V_X + ROAD, 0, Math.max(P.z, RADIUS)), scr2);
  root.style.setProperty('--road-l', `${Math.min(scr.x, scr2.x).toFixed(1)}px`);
  root.style.setProperty('--road-r', `${Math.max(scr.x, scr2.x).toFixed(1)}px`);

  const narrow = aspect < 1;
  // live tag rides just ahead of the front bumper
  toScreen(tmp2.set(P.x + Math.cos(P.h) * 2.9, 1.0, P.z + Math.sin(P.h) * 2.9), scr);
  el.live.style.transform = `translate3d(${(scr.x + 6).toFixed(1)}px, ${(scr.y - 14).toFixed(1)}px, 0)`;

  for (const m of el.milestones) {
    toScreen(tmp2.set(narrow ? V_X : V_X + ROAD, 0, m.z), scr);
    m.li.style.transform = `translate3d(${scr.x.toFixed(1)}px, ${(scr.y - 7).toFixed(1)}px, 0)`;
    const done = rig.s >= sAtZ(m.z) - 1.2;
    if (done !== m.done) {
      m.done = done;
      m.li.classList.toggle('done', done);
    }
  }

  // compass needle follows the car's on-screen heading
  toScreen(tmp2.set(P.x, 0.8, P.z), scr);
  toScreen(tmp2.set(P.x + Math.cos(P.h) * 2, 0.8, P.z + Math.sin(P.h) * 2), scr2);
  const ang = Math.atan2(scr2.y - scr.y, scr2.x - scr.x) / DEG;
  el.needle.style.transform = `rotate(${ang.toFixed(1)}deg)`;

  updateCards3d(narrow);
  updateScrollFx(dt);
  updateHud(tl ? tl.time() : 0, speed);

  // render only when something visible changed
  let keyNow = `${W}x${H}`;
  for (const k of RIG_KEYS) keyNow += `|${rig[k].toFixed(4)}`;
  if (renderer && keyNow !== lastKey) {
    lastKey = keyNow;
    renderer.render(scene, camera);
  }
}

// ---------------------------------------------------------------- timeline
function buildTimeline(L) {
  railCards = [];
  Object.assign(rig, {
    s: S0, elev: 0, azim: 0, fov: 9, vw: L.vw0, follow: 1, fx: L.curveFx, fz: L.curveFz,
    ty: 0.45, ay: 0, edge: 1, sx: 0.5, sy: L.sy0, wheel: 0, fade: 4000, drl: 1.1, brake: 0,
  });
  lastS = rig.s;

  const t = gsap.timeline({
    defaults: { ease: 'none' },
    scrollTrigger: {
      trigger: '#track',
      start: 'top top',
      end: 'bottom bottom',
      scrub: reduceMotion || params.has('noscrub') ? true : 1,
      invalidateOnRefresh: true,
      onUpdate: (self) => { scrollVel = self.getVelocity(); },
    },
  });

  // ---- 01–06 · side elevation: the mat rises, then a long cruise past two card rails
  t.to(rig, { sy: L.sy1, vw: L.vw1, duration: 1, ease: 'power1.inOut' }, 0)
    .to(rig, { s: S0 + 8, duration: 1, ease: 'power1.in' }, 0)
    .to(rig, { sy: L.sy2, duration: 1, ease: 'power1.inOut' }, 1)
    .to(rig, { s: S0 + 30, duration: 1 }, 1)
    .to(rig, { sy: L.sy3, sx: L.sx3, duration: 1, ease: 'power1.inOut' }, 2)
    .to(rig, { s: S0 + 55, duration: 1 }, 2)
    // 04 · services rail
    .to(rig, { sx: L.sx4, duration: 1, ease: 'power1.inOut' }, 3)
    .to(rig, { s: S0 + 110, duration: 2 }, 3)
    // 05 · Compass Nexus iQ platform rail: slow push-in and drift while the car keeps cruising
    .to(rig, { vw: L.vw2, sx: L.sx5, duration: 1.5, ease: 'sine.inOut' }, 5)
    .to(rig, { vw: L.vw1, sx: L.sx4, duration: 1.5, ease: 'sine.inOut' }, 6.5)
    .to(rig, { s: S0 + 190, duration: 3 }, 5)
    // 06 · sectors
    .to(rig, { s: S0 + 216, duration: 1 }, 8)
    // 07 · workflow: keep cruising while the flow line draws, with a gentle lens drift
    .to(rig, { s: S0 + 272, duration: 2 }, 9)
    .to(rig, { vw: L.vw2, sx: L.sx5, duration: 1, ease: 'sine.inOut' }, 9)
    .to(rig, { vw: L.vw1, sx: L.sx4, duration: 1, ease: 'sine.inOut' }, 10)
    // crane up: elevation → plan, with a wide-lens breath in the middle (dolly zoom keeps the car's size)
    .to(rig, { elev: 90, duration: 0.95, ease: 'power2.inOut' }, 11)
    .to(rig, { edge: 0, ty: 0, sx: L.ohSx, sy: L.ohSy, vw: L.ohVw, duration: 0.95, ease: 'power2.inOut' }, 11)
    .to(rig, { fov: 26, duration: 0.45, ease: 'power1.in' }, 11)
    .to(rig, { fov: 11, duration: 0.5, ease: 'power1.out' }, 11.45)
    .to(rig, { s: S0 + 301, duration: 0.95 }, 11)
    // ---- 08 · plan, straight
    .to(rig, { s: L1 - 40, duration: 0.8 }, 11.95)
    // ---- 09 · the bend: hold a fixed frame and let the car drive through it
    .to(rig, { follow: 0, vw: L.curveVw, sx: 0.5, sy: 0.5, duration: 0.35, ease: 'power2.inOut' }, 12.75)
    .to(rig, { s: L1 + 36, duration: 0.9 }, 12.75)
    // ---- 10–14 · long vertical road past eight milestones, camera re-acquires the car
    .to(rig, { follow: 1, vw: L.vVw, sx: L.vSx, sy: L.vSy, duration: 0.45, ease: 'power2.inOut' }, 13.65)
    .to(rig, { s: L1 + 52, duration: 0.45 }, 13.65)
    .to(rig, { s: L1 + 262, duration: 5.25 }, 14.1)
    .to(rig, { s: L1 + 272, duration: 0.3, ease: 'power2.out' }, 19.35)
    .to(rig, { brake: 1.3, duration: 0.15 }, 19.4)
    // ---- camera study
    .to(rig, {
      elev: 26, azim: 38, fov: 30, vw: L.studyVw, ty: 0.8, ay: 0.8, sx: L.studySx, sy: L.studySy,
      fade: 16, duration: 1, ease: 'power2.inOut',
    }, STUDY)
    .to(rig, { brake: 0.2, drl: 1.6, duration: 0.5 }, STUDY + 0.2)
    .to(rig, { azim: 200, elev: 11, duration: 1, ease: 'power1.inOut' }, STUDY + 1)
    .to(rig, { azim: 328, elev: 2.5, fov: 22, vw: L.studyVw * 1.12, sx: L.heroSx, drl: 2.4, duration: 1, ease: 'power1.inOut' }, STUDY + 2)
    .to(rig, { wheel: 1, vw: L.wheelVw, elev: 6, azim: 292, fov: 24, sx: L.wheelSx, sy: 0.5, duration: 0.55, ease: 'power2.inOut' }, STUDY + 3)
    .to(rig, { wheel: 0, vw: L.endVw, elev: 20, azim: 400, fov: 30, sx: L.endSx, sy: L.endSy, duration: 0.45, ease: 'power2.inOut' }, STUDY + 3.55);

  // ---- DOM choreography
  const reveal = (sel, at, out) => {
    const items = $$(`${sel} .r`);
    const targets = items.length ? items : $$(sel);
    t.fromTo(targets, { autoAlpha: 0, y: 34 }, { autoAlpha: 1, y: 0, duration: 0.22, stagger: 0.035, ease: 'power2.out' }, at);
    // word-mask reveal on titles
    const words = $$(`${sel} .wi`);
    if (words.length) t.fromTo(words, { yPercent: 115, rotate: 5 }, { yPercent: 0, rotate: 0, duration: 0.32, stagger: 0.03, ease: 'power3.out' }, at + 0.02);
    // colour type on paper: the gradient sweeps through the second line, the eyebrow tracks in
    const onPaper = !$(sel)?.classList.contains('on-road');
    if (onPaper) {
      const inks = $$(`${sel} .dim .wi`);
      if (inks.length) t.fromTo(inks, { backgroundPosition: '100% 0%' }, { backgroundPosition: '0% 0%', duration: 0.7, stagger: 0.05, ease: 'power2.out' }, at + 0.06);
      const eb = $$(`${sel} .eyebrow`);
      if (eb.length) t.fromTo(eb, { letterSpacing: '0.62em' }, { letterSpacing: '0.14em', duration: 0.4, ease: 'expo.out' }, at);
    }
    // icons draw themselves
    const shapes = $$(`${sel} .svc .draw, ${sel} .panel .draw`);
    if (shapes.length) t.fromTo(shapes, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.4, stagger: 0.02, ease: 'power1.inOut' }, at + 0.06);
    if (out != null) {
      t.to(targets, { autoAlpha: 0, y: -34, duration: 0.18, stagger: 0.02, ease: 'power2.in' }, out);
      if (words.length) t.to(words, { yPercent: -110, duration: 0.18, stagger: 0.012, ease: 'power2.in' }, out);
    }
    const panel = $(`${sel} .panel`);
    if (panel) {
      t.fromTo(panel, { autoAlpha: 0, scale: 0.96, rotateY: 14, rotateX: 6, transformPerspective: 1200, transformOrigin: '0% 50%', clipPath: 'inset(0% 0% 100% 0%)' }, { autoAlpha: 1, scale: 1, rotateY: 0, rotateX: 0, clipPath: 'inset(0% 0% 0% 0%)', duration: 0.34, ease: 'power3.out' }, at);
      if (out != null) t.to(panel, { autoAlpha: 0, duration: 0.18, ease: 'power2.in' }, out + 0.04);
    }
  };
  const show = (sel, at, out, d = 0.2) => {
    t.fromTo(sel, { autoAlpha: 0 }, { autoAlpha: 1, duration: d }, at);
    if (out != null) t.to(sel, { autoAlpha: 0, duration: d }, out);
  };
  // stepper: lights list items one by one across [at, at + d]; `now` marks the current one
  const step = (items, at, d, onCls = 'on', nowCls) => {
    const proxy = { v: 0 };
    t.fromTo(proxy, { v: 0 }, {
      v: items.length,
      duration: d,
      onUpdate() {
        const k = Math.floor(proxy.v);
        items.forEach((li, j) => {
          li.classList.toggle(onCls, j < k || (j === k && !nowCls && proxy.v > j));
          if (nowCls) li.classList.toggle(nowCls, j === Math.min(k, items.length - 1) && proxy.v > 0);
        });
      },
    }, at);
  };

  // 01 hero leaves as the mat rises
  t.to('.s1 .brand, .s1 .display', { autoAlpha: 0, y: -60, duration: 0.35, ease: 'power1.in' }, 0.42)
    .to('.s1-foot', { autoAlpha: 0, duration: 0.25 }, 0.3);
  // ghost type crosses behind the vehicle
  t.fromTo('#ghost', { autoAlpha: 0, x: () => window.innerWidth * 0.35 }, { autoAlpha: 1, duration: 0.3 }, 0.55)
    .to('#ghost', { x: () => -($('#ghost').offsetWidth - window.innerWidth * 0.2), duration: 2.75 }, 0.55)
    .to('#ghost', { autoAlpha: 0, duration: 0.3 }, 3.0);
  reveal('.s2', 1.0, 1.8);
  reveal('.s3', 2.0, 2.8);
  // card rails slide across the mat while the car drives: cards rise in one by one,
  // their icons draw, and the meter counts up with the rail
  const rail = (sel, meter, at, d) => {
    const cards = $$(`${sel} .card`);
    t.fromTo(sel, { x: () => window.innerWidth * 0.3 }, { x: () => -Math.max(0, $(sel).scrollWidth - window.innerWidth * 0.86), duration: d }, at);
    const states = cards.map((el) => ({ el, rail: $(sel), in: 0 }));
    railCards.push(...states);
    const st = d / (cards.length + 2);
    t.fromTo(cards, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3, stagger: st, ease: 'power1.out' }, at + 0.04);
    t.fromTo(states, { in: 0 }, { in: 1, duration: 0.55, stagger: st, ease: 'expo.out' }, at + 0.04);
    t.fromTo($$(`${sel} .draw`), { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.45, stagger: d / (cards.length * 3), ease: 'power1.inOut' }, at + 0.12);
    t.fromTo(`${sel} .tags span`, { autoAlpha: 0, x: -8 }, { autoAlpha: 1, x: 0, duration: 0.2, stagger: d / (cards.length * 3), ease: 'power2.out' }, at + 0.25);
    t.fromTo(meter, { scaleX: 0 }, { scaleX: 1, duration: d * 0.92 }, at + 0.08);
    const label = $(meter).closest('.meter').querySelector('span');
    const n = { v: 1 };
    t.fromTo(n, { v: 1 }, { v: cards.length, duration: d * 0.92, onUpdate: () => { label.textContent = String(Math.round(n.v)).padStart(2, '0'); } }, at + 0.08);
  };
  reveal('.s4', 2.95, 4.85);
  rail('#cards', '#meter4', 2.95, 1.95);
  reveal('.s4b', 5.0, 7.85);
  rail('#cards2', '#meter4b', 5.0, 2.85);
  t.fromTo('#ghost2', { autoAlpha: 0, x: () => window.innerWidth * 0.5 }, { autoAlpha: 1, duration: 0.3 }, 5.1)
    .to('#ghost2', { x: () => -($('#ghost2').offsetWidth - window.innerWidth * 0.25), duration: 2.8 }, 5.1)
    .to('#ghost2', { autoAlpha: 0, duration: 0.3 }, 7.6);
  reveal('.s5', 8.0, 8.92);
  t.fromTo('.s5 .sectors span, .s5 .sectors i', { autoAlpha: 0, y: 40, skewY: 4 }, { autoAlpha: 1, y: 0, skewY: 0, duration: 0.28, stagger: 0.05, ease: 'power3.out' }, 8.02);
  // 07 · workflow: the gold line draws across and each node lights as the line reaches it
  reveal('.s5b', 9.0, 10.85);
  const flowItems = $$('.flow li');
  t.fromTo('#flowFill', { scaleX: 0 }, { scaleX: 1, duration: 1.45 }, 9.15);
  t.fromTo(flowItems, { autoAlpha: 0, y: 26 }, { autoAlpha: 1, y: 0, duration: 0.24, stagger: 1.45 / flowItems.length, ease: 'power2.out' }, 9.12);
  step(flowItems, 9.15, 1.45);
  // crane-up: a gold scan line sweeps up the screen as the camera rises
  t.to('#scan', { autoAlpha: 1, duration: 0.06 }, 11.02)
    .fromTo('#scan', { y: () => window.innerHeight }, { y: -24, duration: 0.9, ease: 'power2.inOut' }, 11.02)
    .to('#scan', { autoAlpha: 0, duration: 0.1 }, 11.84);
  reveal('.s6', 11.95, 12.65);
  show('#liveTag', 11.97, 13.6);
  reveal('.s7', 12.95, 13.6);
  show('#milestones', 13.85, 19.6, 0.25);
  reveal('.s8', 13.95, 14.85);
  t.fromTo('.s8 .feat li', { autoAlpha: 0, x: -16 }, { autoAlpha: 1, x: 0, duration: 0.2, stagger: 0.05, ease: 'power2.out' }, 14.1);
  reveal('.s9', 14.95, 15.85);
  t.fromTo('.s9 .svc', { rotateY: -72, z: -120, transformPerspective: 1000, transformOrigin: '0% 50%' }, { rotateY: 0, z: 0, duration: 0.4, stagger: 0.12, ease: 'power3.out' }, 14.95)
    .fromTo('.s9 .svc-in', { rotateY: 0 }, { rotateY: 180, duration: 0.32, stagger: 0.1, ease: 'power2.inOut' }, 15.32)
    .to('.s9 .svc', { rotateY: 60, transformOrigin: '100% 50%', duration: 0.2, stagger: 0.04, ease: 'power2.in' }, 15.85);
  reveal('.s9b', 15.95, 16.9);
  t.fromTo('.roles li', { autoAlpha: 0, scale: 0.8, y: 10 }, { autoAlpha: 1, scale: 1, y: 0, duration: 0.18, stagger: 0.04, ease: 'back.out(2)' }, 16.08);
  // 13 · trip status steps from Scheduled to Billed as the car drives
  reveal('.s9c', 17.0, 18.3);
  step($$('#status li'), 17.12, 1.0, 'on', 'now');
  t.fromTo('.exc span', { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.16, stagger: 0.06 }, 17.5);
  reveal('.s10', 18.4, 19.5);
  t.fromTo('.chain li', { autoAlpha: 0, x: -14 }, { autoAlpha: 1, x: 0, duration: 0.16, stagger: 0.09, ease: 'power2.out' }, 18.55);
  show('#shot', STUDY + 0.05, null);
  reveal('.c1', STUDY + 0.2, STUDY + 0.9);
  reveal('.c2', STUDY + 1.1, STUDY + 1.88);
  // inspection checks deal in like cards: they swing down from above in 3D
  t.fromTo('.checks li', { autoAlpha: 0, rotateX: -80, y: 18, z: -60, transformPerspective: 700, transformOrigin: '50% 0%' }, { autoAlpha: 1, rotateX: 0, y: 0, z: 0, duration: 0.28, stagger: 0.09, ease: 'back.out(1.6)' }, STUDY + 1.2);
  reveal('.c3', STUDY + 2.15, STUDY + 2.9);
  reveal('.c4', STUDY + 3.05, STUDY + 3.5);
  reveal('.c5', STUDY + 3.62, null);
  t.fromTo('.cta a', { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.15, stagger: 0.07 }, STUDY + 3.7);
  t.set({}, {}, TOTAL);
  return t;
}

// ---------------------------------------------------------------- colour editions
// One vehicle, five paints. The body shader and the painted parts share the colour.
const EDITIONS = {
  // env: how much of the white studio the paint mirrors; darker paints mirror less so they read true
  pearl: { name: 'Pearl White', hex: 0xf2f1ed, env: 1 },
  cosmos: { name: 'Cosmos Black', hex: 0x08090a, env: 0.22 },
  graphite: { name: 'Graphite Grey', hex: 0x3e4146, env: 0.45 },
  harbour: { name: 'Harbour Blue', hex: 0x15306a, env: 0.45 },
  champagne: { name: 'Champagne Gold', hex: 0xb39b74, env: 0.8 },
};
const paintTarget = new THREE.Color();
function setEdition(id, animate = true) {
  const ed = EDITIONS[id] || EDITIONS.pearl;
  paintTarget.setHex(ed.hex);
  const vs = Object.values(fleet);
  const targets = vs.flatMap((v) => [v.uniforms.uBody.value, v.materials.paint.color]);
  gsap.to(targets, {
    r: paintTarget.r, g: paintTarget.g, b: paintTarget.b,
    duration: animate && !reduceMotion ? 0.9 : 0,
    ease: 'power2.inOut',
    overwrite: true,
    onUpdate: () => { lastKey = ''; },
    onComplete: () => { lastKey = ''; },
  });
  gsap.to(vs.flatMap((v) => [v.materials.body, v.materials.paint]), {
    envMapIntensity: ed.env,
    duration: animate && !reduceMotion ? 0.9 : 0,
    ease: 'power2.inOut',
    overwrite: true,
  });
  $('#edName').textContent = ed.name;
  $$('.ed-swatches button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ed === id)));
  try { localStorage.setItem('cniq-edition', id); } catch (err) { /* storage unavailable */ }
}
$$('.ed-swatches button').forEach((b) => b.addEventListener('click', () => setEdition(b.dataset.ed)));

// vehicle switch: the new vehicle takes the old one's place with a short settle
function setVehicle(type, animate = true) {
  const next = fleet[type] || fleet.mpv;
  if (next !== vehicle) {
    vehicle.group.visible = false;
    vehicle = next;
    vehicle.group.visible = true;
    if (animate && !reduceMotion) {
      gsap.fromTo(vehicle.group.scale, { x: 0.94, y: 0.94, z: 0.94 }, {
        x: 1, y: 1, z: 1, duration: 0.7, ease: 'back.out(1.8)', overwrite: true,
        onUpdate: () => { lastKey = ''; },
      });
    }
    lastKey = '';
  }
  $$('.ed-type button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.type === type)));
  try { localStorage.setItem('cniq-vehicle', type); } catch (err) { /* storage unavailable */ }
}
$$('.ed-type button').forEach((b) => b.addEventListener('click', () => setVehicle(b.dataset.type)));
let savedVehicle = 'mpv';
try { savedVehicle = localStorage.getItem('cniq-vehicle') || 'mpv'; } catch (err) { /* storage unavailable */ }
const urlVehicle = params.get('vehicle');
setVehicle(fleet[urlVehicle] ? urlVehicle : savedVehicle, false);
let savedEdition = 'pearl';
try { savedEdition = localStorage.getItem('cniq-edition') || 'pearl'; } catch (err) { /* storage unavailable */ }
const urlEdition = params.get('edition');
setEdition(EDITIONS[urlEdition] ? urlEdition : savedEdition, false);

// ---------------------------------------------------------------- boot
// split every title into masked words (keeps <br>, .dim and .iq spans intact)
function splitWords(node) {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) {
      const parts = child.textContent.split(/(\s+)/);
      if (!child.textContent.trim()) continue;
      const frag = document.createDocumentFragment();
      for (const p of parts) {
        if (!p) continue;
        if (/^\s+$/.test(p)) { frag.appendChild(document.createTextNode(p)); continue; }
        const w = document.createElement('span');
        w.className = 'w';
        const wi = document.createElement('span');
        wi.className = 'wi';
        wi.textContent = p;
        w.appendChild(wi);
        frag.appendChild(w);
      }
      child.replaceWith(frag);
    } else if (child.nodeType === 1 && child.tagName !== 'BR') {
      splitWords(child);
    }
  }
}
if (!reduceMotion) {
  $$('.story .title, .s1 .display').forEach(splitWords);
  root.classList.add('split');
}
$$('.card').forEach((card) => {
  const sheen = document.createElement('i');
  sheen.className = 'sheen';
  sheen.setAttribute('aria-hidden', 'true');
  card.appendChild(sheen);
  const foil = document.createElement('i');
  foil.className = 'foil';
  foil.setAttribute('aria-hidden', 'true');
  card.appendChild(foil);
});
$$('.card svg *, .svc svg *, .panel svg *').forEach((shape) => {
  if (shape.tagName === 'g') return;
  shape.setAttribute('pathLength', '1');
  shape.classList.add('draw');
});

// about 1.4 viewports of scroll per timeline second: a longer, slower drive
root.style.setProperty('--units', String(Math.round(TOTAL * 1.4)));
resize();
window.addEventListener('resize', resize);

const mm = gsap.matchMedia();
mm.add({ wide: '(min-aspect-ratio: 1/1)', narrow: '(max-aspect-ratio: 1/1)' }, (ctx) => {
  tl = buildTimeline(ctx.conditions.wide ? LAYOUTS.wide : LAYOUTS.narrow);
  return () => { tl = null; };
});

gsap.ticker.add(frame);
frame();
requestAnimationFrame(() => root.classList.add('ready'));

// hero intro on load: words rise in, the brand and the location line follow, then the gold line shimmers
if (!reduceMotion) {
  const intro = gsap.timeline({ delay: 0.25 });
  intro.fromTo('.s1 .display .wi', { yPercent: 115, rotate: 6 }, { yPercent: 0, rotate: 0, duration: 1.1, stagger: 0.09, ease: 'expo.out' })
    .fromTo('.s1 .brand > *', { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.7, stagger: 0.08, ease: 'power3.out' }, 0.1)
    .fromTo('.s1 .grad .wi', { backgroundPosition: '100% 0%' }, { backgroundPosition: '0% 0%', duration: 1.6, stagger: 0.12, ease: 'power2.inOut' }, 0.35)
    .fromTo('.s1-foot > *', { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.7, stagger: 0.1, ease: 'power2.out' }, 0.6);
  gsap.to('.s1 .grad .wi', { backgroundPosition: '100% 0%', duration: 3.2, ease: 'sine.inOut', repeat: -1, yoyo: true, delay: 2.4 });
}

// debug hook for automated checks: window.__cniq.seek(timelineSeconds)
window.__cniq = {
  rig,
  get vehicle() { return vehicle; },
  fleet,
  setEdition,
  setVehicle,
  get timeline() { return tl; },
  seek(time, smooth = false) {
    const st = tl && tl.scrollTrigger;
    if (!st) return;
    const y = st.start + (st.end - st.start) * (time / tl.duration());
    window.scrollTo({ top: y, behavior: smooth && !reduceMotion ? 'smooth' : 'auto' });
  },
};
