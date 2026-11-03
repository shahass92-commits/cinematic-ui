// CNIQ scroll drive: one Three.js stage, one GSAP master timeline scrubbed by ScrollTrigger.
// Scenes 01–05 are side elevations, 06–10 are plan views, then a 3D camera study of the same vehicle.
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
const X1 = 240; // start of the bend
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

const vehicle = createVehicle();
scene.add(vehicle.group);

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
    vw0: 12.2, vw1: 13.6, sy0: 0.66, sy1: 0.42, sy2: 0.31, sy3: 0.27, sx3: 0.44, sx4: 0.4,
    ohVw: 19, ohSx: 0.42, ohSy: 0.38,
    curveVw: 44, curveFx: X1 - 4, curveFz: 10,
    vVw: 32, vSx: 0.63, vSy: 0.42,
    studyVw: 8.6, studySx: 0.64, studySy: 0.55, heroSx: 0.68, wheelVw: 2.5, wheelSx: 0.64, endVw: 12.5, endSx: 0.64, endSy: 0.54,
  },
  narrow: {
    vw0: 6.3, vw1: 7.0, sy0: 0.62, sy1: 0.42, sy2: 0.33, sy3: 0.28, sx3: 0.5, sx4: 0.5,
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

const SHOTS = [
  [10, 'SHOT 01', 'CRANE DOWN'],
  [11, 'SHOT 02', 'ARC 180°'],
  [12, 'SHOT 03', 'LOW-ANGLE HERO'],
  [13, 'SHOT 04', 'DOLLY IN'],
  [13.55, 'SHOT 05', 'PULL BACK'],
];

function updateHud(t, kmh) {
  el.speed.textContent = String(Math.round(kmh)).padStart(2, '0');
  let no;
  let of = '10';
  let name;
  if (t < 10) {
    const i = Math.min(10, Math.floor(t) + 1);
    no = String(i).padStart(2, '0');
    if (t >= 4.35 && t < 5.3) name = 'CRANE UP';
    else if (i <= 5) name = 'SIDE ELEVATION';
    else if (i === 7) name = 'PLAN VIEW · BEND';
    else name = 'PLAN VIEW';
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
  el.rail.style.transform = `scaleX(${Math.min(1, t / 14).toFixed(4)})`;
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
    },
  });

  // ---- 01–05 · side elevation: the mat rises, the car rolls
  t.to(rig, { sy: L.sy1, vw: L.vw1, duration: 1, ease: 'power1.inOut' }, 0)
    .to(rig, { s: S0 + 8, duration: 1, ease: 'power1.in' }, 0)
    .to(rig, { sy: L.sy2, duration: 1, ease: 'power1.inOut' }, 1)
    .to(rig, { s: S0 + 30, duration: 1 }, 1)
    .to(rig, { sy: L.sy3, sx: L.sx3, duration: 1, ease: 'power1.inOut' }, 2)
    .to(rig, { s: S0 + 55, duration: 1 }, 2)
    .to(rig, { sx: L.sx4, duration: 1, ease: 'power1.inOut' }, 3)
    .to(rig, { s: S0 + 82, duration: 1 }, 3)
    .to(rig, { s: S0 + 96, duration: 0.35 }, 4)
    // crane up: elevation → plan, with a wide-lens breath in the middle (dolly zoom keeps the car's size)
    .to(rig, { elev: 90, duration: 0.95, ease: 'power2.inOut' }, 4.35)
    .to(rig, { edge: 0, ty: 0, sx: L.ohSx, sy: L.ohSy, vw: L.ohVw, duration: 0.95, ease: 'power2.inOut' }, 4.35)
    .to(rig, { fov: 26, duration: 0.45, ease: 'power1.in' }, 4.35)
    .to(rig, { fov: 11, duration: 0.5, ease: 'power1.out' }, 4.8)
    .to(rig, { s: S0 + 125, duration: 0.95 }, 4.35)
    // ---- 06 · plan, straight
    .to(rig, { s: 520, duration: 0.8 }, 5.3)
    // ---- 07 · the bend: hold a fixed frame and let the car drive through it
    .to(rig, { follow: 0, vw: L.curveVw, sx: 0.5, sy: 0.5, duration: 0.35, ease: 'power2.inOut' }, 6.1)
    .to(rig, { s: 596, duration: 0.9 }, 6.1)
    // ---- 08–10 · vertical road, camera re-acquires the car
    .to(rig, { follow: 1, vw: L.vVw, sx: L.vSx, sy: L.vSy, duration: 0.45, ease: 'power2.inOut' }, 7.0)
    .to(rig, { s: 612, duration: 0.45 }, 7.0)
    .to(rig, { s: 712, duration: 2.25 }, 7.45)
    .to(rig, { s: 722, duration: 0.3, ease: 'power2.out' }, 9.7)
    .to(rig, { brake: 1.3, duration: 0.15 }, 9.75)
    // ---- camera study
    .to(rig, {
      elev: 26, azim: 38, fov: 30, vw: L.studyVw, ty: 0.8, ay: 0.8, sx: L.studySx, sy: L.studySy,
      fade: 16, duration: 1, ease: 'power2.inOut',
    }, 10)
    .to(rig, { brake: 0.2, drl: 1.6, duration: 0.5 }, 10.2)
    .to(rig, { azim: 200, elev: 11, duration: 1, ease: 'power1.inOut' }, 11)
    .to(rig, { azim: 328, elev: 2.5, fov: 22, vw: L.studyVw * 1.12, sx: L.heroSx, drl: 2.4, duration: 1, ease: 'power1.inOut' }, 12)
    .to(rig, { wheel: 1, vw: L.wheelVw, elev: 6, azim: 292, fov: 24, sx: L.wheelSx, sy: 0.5, duration: 0.55, ease: 'power2.inOut' }, 13)
    .to(rig, { wheel: 0, vw: L.endVw, elev: 20, azim: 400, fov: 30, sx: L.endSx, sy: L.endSy, duration: 0.45, ease: 'power2.inOut' }, 13.55);

  // ---- DOM choreography
  const reveal = (sel, at, out) => {
    const items = $$(`${sel} .r`);
    const targets = items.length ? items : $$(sel);
    t.fromTo(targets, { autoAlpha: 0, y: 34 }, { autoAlpha: 1, y: 0, duration: 0.22, stagger: 0.035, ease: 'power2.out' }, at);
    if (out != null) t.to(targets, { autoAlpha: 0, y: -34, duration: 0.18, stagger: 0.02, ease: 'power2.in' }, out);
    const panel = $(`${sel} .panel`);
    if (panel) {
      t.fromTo(panel, { autoAlpha: 0, scale: 0.985 }, { autoAlpha: 1, scale: 1, duration: 0.2, ease: 'power2.out' }, at);
      if (out != null) t.to(panel, { autoAlpha: 0, duration: 0.18, ease: 'power2.in' }, out + 0.04);
    }
  };
  const show = (sel, at, out, d = 0.2) => {
    t.fromTo(sel, { autoAlpha: 0 }, { autoAlpha: 1, duration: d }, at);
    if (out != null) t.to(sel, { autoAlpha: 0, duration: d }, out);
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
  reveal('.s4', 2.95, 3.88);
  t.fromTo('#cards', { x: () => window.innerWidth * 0.25 }, { x: () => -Math.max(0, $('#cards').scrollWidth - window.innerWidth * 0.82), duration: 1.0 }, 2.95);
  reveal('.s5', 3.95, 4.42);
  reveal('.s6', 5.3, 6.0);
  show('#liveTag', 5.32, 6.95);
  reveal('.s7', 6.3, 6.95);
  reveal('.s8', 7.3, 8.05);
  reveal('.s9', 8.1, 8.85);
  reveal('.s10', 8.95, 9.85);
  show('#milestones', 7.2, 9.95, 0.25);
  show('#shot', 10.05, null);
  reveal('.c1', 10.2, 10.9);
  reveal('.c2', 11.1, 11.88);
  reveal('.c3', 12.15, 12.9);
  reveal('.c4', 13.05, 13.5);
  reveal('.c5', 13.62, null);
  t.set({}, {}, 14);
  return t;
}

// ---------------------------------------------------------------- boot
root.style.setProperty('--units', '15');
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

// debug hook for automated checks: window.__cniq.seek(timelineSeconds)
window.__cniq = {
  rig,
  get timeline() { return tl; },
  seek(time) {
    const st = tl && tl.scrollTrigger;
    if (!st) return;
    const y = st.start + (st.end - st.start) * (time / tl.duration());
    window.scrollTo(0, y);
  },
};
