// Procedural white MPV used by every scene (side view, top view and the 3D camera study).
// Built from lofted cross-sections so the silhouette reads correctly from any camera angle.
// No third-party branding is modelled. Units: metres. Forward = +X, up = +Y, right side = +Z.
import * as THREE from 'three';

export const SPEC = {
  length: 4.72,
  width: 1.82,
  height: 1.745,
  frontAxle: 1.46,
  rearAxle: -1.43,
  wheelRadius: 0.35,
  wheelWidth: 0.235,
  track: 0.8, // wheel centre offset from the centre line
};

const HALF_L = SPEC.length / 2;
const HALF_W = SPEC.width / 2;

// Side profile (x, y), front to rear. Top line and bottom line are sampled separately.
// Measured from the side-view reference: short sloping bonnet, long raked screen,
// roof spoiler over a raked tailgate. (x, y) in metres, front to rear.
const TOP = [
  [2.36, 0.56], [2.354, 0.644], [2.343, 0.676], [2.313, 0.816], [2.246, 0.9], [2.188, 0.942],
  [2.071, 1.006], [1.955, 1.052], [1.838, 1.09], [1.722, 1.122], [1.605, 1.146], [1.488, 1.163],
  [1.372, 1.184], [1.313, 1.2], [1.197, 1.265], [1.08, 1.33], [0.905, 1.42], [0.789, 1.475],
  [0.672, 1.525], [0.555, 1.569], [0.439, 1.609], [0.322, 1.641], [0.205, 1.671], [0.089, 1.703],
  [-0.144, 1.728], [-0.436, 1.738], [-0.845, 1.738], [-1.19, 1.728], [-1.43, 1.718], [-1.54, 1.708],
  [-1.7, 1.697], [-1.894, 1.673], [-2.01, 1.659], [-2.069, 1.645], [-2.1, 1.52], [-2.127, 1.394],
  [-2.185, 1.344], [-2.24, 1.245], [-2.3, 1.16], [-2.335, 0.95], [-2.36, 0.7],
];
const BOTTOM = [
  [2.36, 0.52], [2.354, 0.484], [2.343, 0.4], [2.313, 0.312], [2.25, 0.29], [2.1, 0.255],
  [1.95, 0.235], [1.8, 0.24], [1.0, 0.24], [-1.0, 0.24], [-1.75, 0.31], [-2.0, 0.32],
  [-2.18, 0.344], [-2.24, 0.37], [-2.3, 0.4], [-2.34, 0.55], [-2.36, 0.66],
];

function profileSampler(points) {
  const curve = new THREE.CatmullRomCurve3(
    points.map(([x, y]) => new THREE.Vector3(x, y, 0)),
    false,
    'centripetal',
  );
  const pts = curve.getSpacedPoints(3000);
  // keep x strictly decreasing (front → rear) so it can be used as a lookup y(x)
  const xs = [];
  const ys = [];
  let last = Infinity;
  for (const p of pts) {
    if (p.x < last) {
      xs.push(p.x);
      ys.push(p.y);
      last = p.x;
    }
  }
  return (x) => {
    if (x >= xs[0]) return ys[0];
    if (x <= xs[xs.length - 1]) return ys[ys.length - 1];
    let lo = 0;
    let hi = xs.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] > x) lo = mid;
      else hi = mid;
    }
    const t = (x - xs[lo]) / (xs[hi] - xs[lo]);
    return ys[lo] + (ys[hi] - ys[lo]) * t;
  };
}

const topAt = profileSampler(TOP);
const bottomAt = profileSampler(BOTTOM);

const smooth = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Plan-view half width: a superellipse, boxier at the rear like an MPV.
function planHalf(x) {
  const t = Math.min(1, Math.abs(x) / HALF_L);
  const p = x > 0 ? 4.6 : 7;
  return HALF_W * Math.pow(Math.max(0, 1 - Math.pow(t, p)), 1 / p);
}

const BELT = 1.15;
function widthFactor(y, yb, yt) {
  const tb = smooth(BELT - 0.02, Math.max(yt, BELT + 0.12), y);
  const tumble = 1 - 0.19 * tb * tb;
  const lower = 1 - 0.035 * (1 - smooth(yb, yb + 0.25, y));
  return tumble * lower;
}

function buildBodyGeometry() {
  const NU = 240;
  const NV = 120;
  const DENSE = 720;
  const n = 5; // superellipse exponent for the cross-section
  const e = 2 / n;
  const positions = [];
  const ring = [];
  const ringPts = new Array(DENSE + 1);
  const cum = new Float32Array(DENSE + 1);

  for (let i = 0; i <= NU; i++) {
    const u = i / NU;
    const x = -HALF_L * Math.cos(Math.PI * u); // cosine spacing: dense at nose and tail
    const yt = topAt(x);
    const yb = bottomAt(x);
    const hm = planHalf(x);
    const cy = (yt + yb) / 2;
    const ry = (yt - yb) / 2;

    // dense superellipse polyline, then resample evenly by arc length
    for (let k = 0; k <= DENSE; k++) {
      const th = (k / DENSE) * Math.PI * 2;
      const s = Math.sin(th);
      const c = Math.cos(th);
      const y = cy + ry * Math.sign(s) * Math.pow(Math.abs(s), e);
      const z = hm * widthFactor(y, yb, yt) * Math.sign(c) * Math.pow(Math.abs(c), e);
      ringPts[k] = [y, z];
      cum[k] = k === 0 ? 0 : cum[k - 1] + Math.hypot(y - ringPts[k - 1][0], z - ringPts[k - 1][1]);
    }
    const total = cum[DENSE] || 1;
    let k = 0;
    for (let j = 0; j < NV; j++) {
      const target = (j / NV) * total;
      while (k < DENSE - 1 && cum[k + 1] < target) k++;
      const span = cum[k + 1] - cum[k] || 1;
      const t = (target - cum[k]) / span;
      const y = ringPts[k][0] + (ringPts[k + 1][0] - ringPts[k][0]) * t;
      const z = ringPts[k][1] + (ringPts[k + 1][1] - ringPts[k][1]) * t;
      positions.push(x, y, z);
      ring.push(yt, yb, hm);
    }
  }

  const index = [];
  for (let i = 0; i < NU; i++) {
    for (let j = 0; j < NV; j++) {
      const a = i * NV + j;
      const b = i * NV + ((j + 1) % NV);
      const c = (i + 1) * NV + j;
      const d = (i + 1) * NV + ((j + 1) % NV);
      index.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aRing', new THREE.Float32BufferAttribute(ring, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  // make sure faces point outwards (winding depends on loft direction)
  const nrm = geo.getAttribute('normal');
  const pos = geo.getAttribute('position');
  let dot = 0;
  for (let v = 0; v < pos.count; v += 97) {
    dot += nrm.getY(v) * (pos.getY(v) - 0.9) + nrm.getZ(v) * pos.getZ(v);
  }
  if (dot < 0) {
    for (let t = 0; t < index.length; t += 3) {
      const tmp = index[t + 1];
      index[t + 1] = index[t + 2];
      index[t + 2] = tmp;
    }
    geo.setIndex(index);
    geo.computeVertexNormals();
  }
  return geo;
}

// Paint zones (glass, lamps, cladding, seams, arches) are resolved per fragment from the
// object-space position so every edge stays crisp at any zoom.
const ZONE_GLSL = /* glsl */ `
  float czAA(float edge, float v) { float w = fwidth(v) * 0.8 + 1e-4; return smoothstep(edge - w, edge + w, v); }
  float czBand(float v, float a, float b) { return czAA(a, v) * (1.0 - czAA(b, v)); }
  float czLine(float v, float c, float hw) { float w = fwidth(v) + 1e-4; return 1.0 - smoothstep(hw, hw + w, abs(v - c)); }
`;

const ZONE_MAIN = /* glsl */ `
  vec3 czP = vP;
  vec3 czN = normalize(vN);
  float czX = abs(czP.z);
  float czYt = vRing.x;
  float czHm = vRing.z;
  float czSide = smoothstep(0.35, 0.65, abs(czN.z));
  // beltline rises from 1.13 m at the A-pillar to 1.26 m, then kicks up at the rear quarter
  float czBelt = 1.13 + 0.054 * clamp(1.1 - czP.x, 0.0, 2.5) + 0.03 * smoothstep(-1.5, -1.8, czP.x);
  float czWinTop = czYt - 0.115; // leaves a white roof strip above the satin DLO line

  float czSideBand = czAA(czBelt, czP.y) * (1.0 - czAA(czWinTop, czP.y)) * czAA(-2.15, czP.x) * (1.0 - czAA(0.12, czP.x));
  float czScreen = czAA(0.12, czP.x) * (1.0 - czAA(1.365, czP.x)) * czAA(czBelt, czP.y);
  float czRearGlass = (1.0 - czAA(-0.45, czN.x)) * czBand(czP.y, 1.25, 1.6) * (1.0 - czAA(0.62, czX)) * (1.0 - czAA(-2.04, czP.x));
  float czGlass = max(max(czSideBand, czScreen), czRearGlass);

  // panes: front door, rear door, rear quarter (pillars stay piano black)
  float czPane = czBand(czP.y, czBelt + 0.02, czWinTop - 0.028) * czSide * (
      czBand(czP.x, -0.07, 1.12 - (czP.y - 1.13) * 1.35) +
      czBand(czP.x, -1.3, -0.14) +
      czBand(czP.x, -1.93 + (czP.y - 1.29) * 0.6, -1.37));

  float czClad = (1.0 - czAA(-0.75, czN.y)) * (1.0 - czAA(0.3, czP.y)); // underside only: the skirt stays body colour
  float czZn = czX / max(czHm, 0.05);

  // ================= PREMIUM TRIM =================
  // ---- front fascia: swept matrix lamps (wrapping onto the fender), L-signature DRL, full-width
  //      light blade over a satin bar, corner intakes, diamond-mesh grille, brushed lip
  float czFront = czAA(0.3, czN.x) * czAA(1.95, czP.x);
  float czLampY = czP.y - 0.06 * smoothstep(0.45, 0.85, czX);
  float czLampF = czAA(2.02, czP.x) * czBand(czLampY, 0.785, 0.85) * czAA(0.45, czX) * czAA(-0.1, czN.x);
  float czSweep = clamp(2.3 - czP.x, 0.0, 1.0);
  float czLampS = czSide * czBand(czP.x, 1.74, 2.34) * czBand(czP.y, 0.83 + czSweep * 0.175, 0.955 + czSweep * 0.02);
  float czLamp = max(czLampF, czLampS);
  float czDrl = czLampF * czBand(czLampY, 0.838, 0.85);
  czDrl = max(czDrl, czLampS * czBand(czP.y, 0.938 + czSweep * 0.02, 0.952 + czSweep * 0.02));
  float czProjS = czLampS * czBand(czP.y, 0.86 + czSweep * 0.1, 0.905 + czSweep * 0.05) * czBand(fract(czP.x * 18.0), 0.25, 0.6) * czAA(2.02, czP.x);
  czDrl = max(czDrl, czAA(2.02, czP.x) * czAA(-0.1, czN.x) * czBand(czX, 0.703, 0.722) * czBand(czLampY, 0.75, 0.85));
  float czProj = czLampF * czBand(czLampY, 0.8, 0.828) * czBand(fract((czX - 0.45) * 22.0), 0.2, 0.6) * (1.0 - czAA(0.69, czX));
  float czBar = czFront * czBand(czP.y, 0.752, 0.768) * (1.0 - czAA(0.45, czX));
  float czSlot = czFront * czBand(czP.y, 0.77, 0.796) * (1.0 - czAA(0.45, czX));
  float czBlade = czFront * czBand(czP.y, 0.779, 0.786) * (1.0 - czAA(0.44, czX));
  float czFangC = 0.66 + (czP.y - 0.33) * 0.3;
  float czFang = czFront * czBand(czP.y, 0.33, 0.62) * czBand(czX, czFangC - 0.05, czFangC + 0.045);
  float czFangBlade = czFang * czBand(czX, czFangC - 0.009, czFangC + 0.004) * czBand(czP.y, 0.36, 0.59);
  float czGrille = czFront * czBand(czP.y, 0.24, 0.35) * (1.0 - czAA(0.58, czX));
  vec2 czMesh = vec2(czP.y + czX, czP.y - czX) * 34.0;
  float czMeshL = czGrille * (1.0 - smoothstep(0.06, 0.14, min(abs(fract(czMesh.x) - 0.5), abs(fract(czMesh.y) - 0.5))));
  float czGrilleRim = czFront * (czBand(czP.y, 0.234, 0.24) + czBand(czP.y, 0.35, 0.356)) * (1.0 - czAA(0.58, czX));
  float czPlateF = czFront * czBand(czP.y, 0.37, 0.5) * (1.0 - czAA(0.25, czX));
  float czLip = czFront * czBand(czP.y, 0.2, 0.232) * (1.0 - czAA(0.78, czX));
  float czFrontLow = czFront * (1.0 - czAA(0.2, czP.y));
  float czSensor = czFront * (1.0 - czAA(0.011, min(length(vec2(czX - 0.33, czP.y - 0.56)), length(vec2(czX - 0.52, czP.y - 0.56)))));
  float czHood = czAA(0.6, czN.y) * czBand(czP.x, 1.45, 2.2) * exp(-pow((czX - 0.43) / 0.018, 2.0));

  // ---- rear: tail lamps wrapping 0.4 m onto the flank, joined by a full-width red blade
  float czRear = (1.0 - czAA(-0.3, czN.x)) * (1.0 - czAA(-2.05, czP.x));
  float czRun = clamp(czP.x + 2.29, 0.0, 0.4);
  float czTailS = czSide * (1.0 - czAA(-1.9, czP.x)) * czBand(czP.y, 1.06 + czRun * 0.23, 1.19 - czRun * 0.03);
  float czTailR = czRear * czBand(czP.y, 1.01, 1.18) * czAA(0.55, czX);
  czTailR = max(czTailR, czRear * czBand(czP.y, 0.95, 1.18) * czAA(0.76, czX));
  float czTail = max(czTailS, czTailR);
  float czTailLine = czTail * (czBand(czP.y, 1.075, 1.082) + czBand(czP.y, 1.115, 1.122) + czBand(czP.y, 1.153, 1.16));
  float czBladeR = czRear * czBand(czP.y, 1.106, 1.116) * (1.0 - czAA(0.56, czX));
  float czBarR = czRear * czBand(czP.y, 1.084, 1.1) * (1.0 - czAA(0.55, czX));
  float czBladeHousing = czRear * czBand(czP.y, 1.1, 1.124) * (1.0 - czAA(0.56, czX));
  float czStop = czRear * czBand(czP.y, 1.585, 1.598) * (1.0 - czAA(0.26, czX));
  float czGate = czRear * (czLine(czX, 0.66, 0.0035) * czBand(czP.y, 0.67, 1.25) + czLine(czP.y, 0.67, 0.0025) * (1.0 - czAA(0.66, czX)));
  float czReflector = czRear * czBand(czP.y, 0.53, 0.555) * czBand(czX, 0.45, 0.78);
  czReflector = max(czReflector, czSide * (1.0 - czAA(-2.18, czP.x)) * czBand(czP.y, 0.46, 0.485));
  float czRearLow = czRear * (1.0 - czAA(0.42, czP.y));
  float czDiffuser = czRear * czBand(czP.y, 0.29, 0.37) * (1.0 - czAA(0.64, czX));
  float czFins = czDiffuser * czBand(fract(czX * 11.0), 0.0, 0.16) * czBand(czP.y, 0.29, 0.355);

  // ---- glass, pillars and roof
  // minimal panoramic glass panel centred on a white roof (reads in the top view)
  float czTop = czAA(0.7, czN.y);
  float czRoof = czTop * czBand(czP.x, -1.28, -0.04) * (1.0 - czAA(0.46, czZn));
  float czRoofFrame = czTop * czBand(czP.x, -1.3, -0.02) * (1.0 - czAA(0.48, czZn)) * (1.0 - czRoof);
  czGlass = max(czGlass, czRoof);
  float czPillar = czSideBand * (1.0 - clamp(czPane, 0.0, 1.0)) * czSide;
  float czPrivacy = 1.0 - czAA(-0.11, czP.x);
  float czSky = smoothstep(czBelt, czWinTop, czP.y);

  float czArch = 0.0;
  czArch = max(czArch, 1.0 - czAA(0.405, length(vec2(czP.x - 1.46, czP.y - 0.35))));
  czArch = max(czArch, 1.0 - czAA(0.405, length(vec2(czP.x + 1.43, czP.y - 0.35))));
  czArch *= czAA(0.55, czX);

  // ---- surfacing: rising shoulder crease and a lower door sculpt line
  float czCreaseY = 1.035 + (0.987 - czP.x) * 0.0563;
  float czCrease = exp(-pow((czP.y - czCreaseY + 0.014) / 0.012, 2.0)) * czBand(czP.x, -1.95, 1.8) * czSide;
  float czSculptY = 0.54 + (0.987 - czP.x) * 0.071;
  float czSculpt = exp(-pow((czP.y - czSculptY + 0.012) / 0.014, 2.0)) * czBand(czP.x, -1.0, 0.98) * czSide;

  // ---- hinged doors: shut lines (rear door wraps the wheel arch), flush handles
  float czSeamY = czBand(czP.y, 0.27, czBelt - 0.004);
  float czSeams = (czLine(czP.x, 0.987, 0.003) + czLine(czP.x, -0.106, 0.003)) * czSeamY;
  czSeams += czLine(czP.x, -1.316, 0.003) * czBand(czP.y, 0.8, czBelt - 0.004);
  czSeams += czLine(length(vec2(czP.x + 1.43, czP.y - 0.35)), 0.47, 0.003) * czAA(-1.43, czP.x) * czBand(czP.y, 0.27, 0.81);
  float czHandleBox = (czBand(czP.x, -0.07, 0.18) * czBand(czP.y, 0.982, 1.022) + czBand(czP.x, -1.21, -0.96) * czBand(czP.y, 1.042, 1.082)) * czSide;
  float czHandle = (czBand(czP.x, -0.064, 0.174) * czBand(czP.y, 0.987, 1.017) + czBand(czP.x, -1.204, -0.966) * czBand(czP.y, 1.047, 1.077)) * czSide;
  czSeams += (czHandleBox - czHandle);
  czSeams *= czSide * (1.0 - czArch);
  czSeams += czGate;

  // ---- satin-metal accents
  float czDloTop = czBand(czP.y, czWinTop - 0.002, czWinTop + 0.013) * czBand(czP.x, -1.95, 1.05) * czSide;
  float czDloBelt = czBand(czP.y, czBelt - 0.013, czBelt + 0.001) * czBand(czP.x, -1.92, 1.2) * czSide;
  float czSill = czBand(czP.y, 0.275, 0.292) * czBand(czP.x, -1.0, 1.02) * czSide;
  float czRail = czBand(czP.y, czYt - 0.03, czYt - 0.004) * czBand(czP.x, -1.65, 0.06) * smoothstep(0.08, 0.3, abs(czN.z));
  float czRailGap = czBand(czP.y, czYt - 0.036, czYt - 0.03) * czBand(czP.x, -1.65, 0.06) * smoothstep(0.08, 0.3, abs(czN.z));
  float czSatin = clamp(czBar + czRail + czRoofFrame + czBarR + czLip + czDiffuser * (1.0 - czFins) + czDloTop + czDloBelt + czSill + czGrilleRim + czFangBlade, 0.0, 1.0);
  float czBright = clamp(czHandle, 0.0, 1.0);
  float czGlossBlack = clamp(czFang * (1.0 - czFangBlade) + czGrille * (1.0 - czMeshL) + czPlateF + czSlot * (1.0 - czBlade) + czBladeHousing * (1.0 - czBladeR), 0.0, 1.0);
  float czDarkTrim = clamp(czFrontLow + czRearLow * (1.0 - czDiffuser), 0.0, 1.0);

  // ---- finish
  vec3 czCol = uBody;
  float czRough = 0.22;
  float czMetal = 0.0;
  float czCC = 1.0;
  float czCCR = 0.03;

  czCol *= 1.0 - czHood * 0.05;
  czCol *= 1.0 - czSensor * 0.12;
  czCol *= 1.0 - czCrease * 0.17 - czSculpt * 0.12;
  czCol = mix(czCol, vec3(0.012), czClad); czRough = mix(czRough, 0.55, czClad); czCC = mix(czCC, 0.25, czClad);
  czCol = mix(czCol, vec3(0.005), czArch); czRough = mix(czRough, 0.95, czArch); czCC = mix(czCC, 0.0, czArch);
  czCol = mix(czCol, vec3(0.009), czDarkTrim); czRough = mix(czRough, 0.5, czDarkTrim); czCC = mix(czCC, 0.2, czDarkTrim);
  czCol = mix(czCol, vec3(0.004), czGlossBlack); czRough = mix(czRough, 0.08, czGlossBlack); czCC = mix(czCC, 1.0, czGlossBlack);
  czCol = mix(czCol, vec3(0.05, 0.052, 0.056), czMeshL); czMetal = mix(czMetal, 0.6, czMeshL); czRough = mix(czRough, 0.35, czMeshL);
  czCol = mix(czCol, vec3(0.032, 0.037, 0.044), czGlass); czRough = mix(czRough, 0.22, czGlass); czCC = mix(czCC, 0.0, czGlass);
  vec3 czPaneCol = mix(vec3(0.05, 0.057, 0.066), vec3(0.14, 0.16, 0.185), czSky) * mix(1.0, 0.82, czPrivacy);
  czCol = mix(czCol, czPaneCol, czPane * czGlass); czRough = mix(czRough, 0.42, czPane * czGlass);
  czCol = mix(czCol, vec3(0.002), czPillar); czRough = mix(czRough, 0.38, czPillar); czCC = mix(czCC, 0.0, czPillar);
  vec3 czPanoCol = mix(vec3(0.05, 0.062, 0.075), vec3(0.15, 0.175, 0.2), smoothstep(-1.28, -0.04, czP.x) * 0.8 + czZn * 0.25);
  czCol = mix(czCol, czPanoCol, czRoof); czRough = mix(czRough, 0.3, czRoof); czCC = mix(czCC, 0.18, czRoof); czCCR = mix(czCCR, 0.12, czRoof);
  czCol = mix(czCol, vec3(0.008, 0.009, 0.012), czLamp); czRough = mix(czRough, 0.05, czLamp); czCC = mix(czCC, 1.0, czLamp);
  czCol = mix(czCol, vec3(0.09, 0.004, 0.004), czTail); czRough = mix(czRough, 0.06, czTail); czCC = mix(czCC, 1.0, czTail);
  czCol = mix(czCol, vec3(0.2, 0.008, 0.008), czReflector);
  czCol = mix(czCol, vec3(0.58, 0.6, 0.63), czSatin); czMetal = mix(czMetal, 1.0, czSatin); czRough = mix(czRough, 0.34, czSatin); czCC = mix(czCC, 0.0, czSatin);
  czCol = mix(czCol, vec3(0.8, 0.82, 0.85), czBright); czMetal = mix(czMetal, 1.0, czBright); czRough = mix(czRough, 0.14, czBright);
  czCol = mix(czCol, czCol * 0.15, clamp(czSeams + czRailGap, 0.0, 1.0));
  float czPaint = (1.0 - czGlass) * (1.0 - czSatin) * (1.0 - czGlossBlack) * (1.0 - czClad) * (1.0 - czDarkTrim) * (1.0 - czArch) * (1.0 - czLamp) * (1.0 - czTail);

  diffuseColor.rgb = czCol;
  roughnessFactor = czRough;
  metalnessFactor = czMetal;
  totalEmissiveRadiance += (czDrl * 1.15 + (czProj + czProjS) * 0.7 + czBlade * 0.9) * vec3(0.86, 0.93, 1.0) * uDrl;
  totalEmissiveRadiance += (czTailLine * 1.5 + czBladeR * 1.6 + czTail * 0.22 + czStop) * vec3(1.0, 0.045, 0.03) * uTail;
`;

function makeBodyMaterial(uniforms) {
  // pearl white: deep clearcoat plus a faint thin-film flop that only shows at grazing angles
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.22,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    iridescence: 0.16,
    iridescenceIOR: 1.35,
    iridescenceThicknessRange: [260, 420],
  });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aRing;\nvarying vec3 vP;\nvarying vec3 vN;\nvarying vec3 vRing;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvP = position;\nvN = normal;\nvRing = aRing;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nvarying vec3 vP;\nvarying vec3 vN;\nvarying vec3 vRing;\nuniform vec3 uBody;\nuniform float uDrl;\nuniform float uTail;\n${ZONE_GLSL}`,
      )
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${ZONE_MAIN}`)
      .replace(
        '#include <lights_physical_fragment>',
        '#include <lights_physical_fragment>\nmaterial.specularF90 = mix(material.specularF90, 0.16, czGlass);\n#ifdef USE_CLEARCOAT\nmaterial.clearcoat = czCC;\nmaterial.clearcoatRoughness = czCCR;\n#endif\n#ifdef USE_IRIDESCENCE\nmaterial.iridescence *= czPaint;\n#endif',
      );
  };
  mat.customProgramCacheKey = () => 'cniq-mpv-body-premium-v6';
  return mat;
}

// ---------- wheels ----------
// Low-profile tyre on a large 10-twin-spoke rim: machined faces, gloss-black pockets, polished lip.
const RIM_R = 0.25;

function tireTexture() {
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#131313';
  g.fillRect(0, 0, c.width, c.height);
  // sidewall rings and rim protector
  g.fillStyle = '#1b1b1b';
  for (const v of [0.06, 0.94]) g.fillRect(0, v * 512 - 3, c.width, 6);
  g.fillStyle = '#171717';
  for (const v of [0.2, 0.8]) g.fillRect(0, v * 512 - 1, c.width, 2);
  // tread: circumferential grooves and angled sipes
  g.fillStyle = '#070707';
  for (const v of [0.468, 0.5, 0.532]) g.fillRect(0, v * 512 - 2.5, c.width, 5);
  g.strokeStyle = '#0a0a0a';
  g.lineWidth = 3;
  for (let x = 0; x < c.width; x += 14) {
    g.beginPath(); g.moveTo(x, 0.43 * 512); g.lineTo(x + 6, 0.465 * 512); g.stroke();
    g.beginPath(); g.moveTo(x + 7, 0.535 * 512); g.lineTo(x + 1, 0.57 * 512); g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function tireGeometry() {
  const R = SPEC.wheelRadius;
  const hw = SPEC.wheelWidth / 2;
  const rim = RIM_R + 0.004;
  const pts = [
    [rim, -hw * 0.84], [rim + 0.016, -hw * 0.98], [R - 0.034, -hw], [R - 0.01, -hw * 0.88],
    [R, -hw * 0.6], [R, hw * 0.6], [R - 0.01, hw * 0.88], [R - 0.034, hw],
    [rim + 0.016, hw * 0.98], [rim, hw * 0.84],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(pts, 96);
  g.rotateX(Math.PI / 2);
  return g;
}

function rimFaceTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  const k = 512 / 0.5; // texture spans -0.25..0.25 m
  g.fillStyle = '#16171a';
  g.fillRect(0, 0, 512, 512);
  const ring = (r0, r1, col) => {
    g.beginPath();
    g.arc(256, 256, r1 * k, 0, Math.PI * 2);
    g.arc(256, 256, r0 * k, 0, Math.PI * 2, true);
    g.fillStyle = col;
    g.fill();
  };
  ring(0.104, 0.226, '#d9dce0'); // machined spoke faces
  ring(0.241, 0.25, '#c9ccd1'); // bright lip edge
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(2, 2);
  tex.offset.set(0.5, 0.5);
  return tex;
}

function rimGeometry() {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, RIM_R - 0.002, 0, Math.PI * 2, false);
  const pairs = 10;
  const twin = 0.055;
  const spokeHalf = 0.0078;
  const hole = (a0, a1, r0, r1) => {
    const o1 = spokeHalf / r1;
    const o0 = spokeHalf / r0;
    const path = new THREE.Path();
    path.absarc(0, 0, r1, a0 + o1, a1 - o1, false);
    const i0 = a0 + o0;
    const i1 = a1 - o0;
    if (i1 > i0) path.absarc(0, 0, r0, i1, i0, true);
    else path.lineTo(Math.cos((a0 + a1) / 2) * r0, Math.sin((a0 + a1) / 2) * r0);
    shape.holes.push(path);
  };
  const step = (Math.PI * 2) / pairs;
  for (let j = 0; j < pairs; j++) {
    const A = j * step + Math.PI / 2;
    hole(A + twin, A + step - twin, 0.098, 0.232);
    hole(A - twin, A + twin, 0.17, 0.226);
  }
  return new THREE.ExtrudeGeometry(shape, {
    depth: 0.02,
    bevelEnabled: true,
    bevelThickness: 0.008,
    bevelSize: 0.005,
    bevelSegments: 3,
    curveSegments: 96,
  });
}

function buildWheel(materials, side) {
  const root = new THREE.Group();
  const spin = new THREE.Group();
  root.add(spin);

  spin.add(new THREE.Mesh(tireGeometry(), materials.rubber));

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(RIM_R, RIM_R, 0.2, 64, 1, true), materials.dark);
  barrel.rotation.x = Math.PI / 2;
  spin.add(barrel);

  // two-tone: machined faces, gloss-black spoke walls
  const rim = new THREE.Mesh(rimGeometry(), [materials.rim, materials.rimDark]);
  rim.position.z = 0.056;
  spin.add(rim);

  const lip = new THREE.Mesh(new THREE.TorusGeometry(RIM_R - 0.004, 0.0065, 10, 128), materials.polish);
  lip.position.z = 0.082;
  spin.add(lip);

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.058, 0.03, 48), materials.satin);
  hub.rotation.x = Math.PI / 2;
  hub.position.z = 0.086;
  spin.add(hub);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.01, 48), materials.gloss);
  cap.rotation.x = Math.PI / 2;
  cap.position.z = 0.1;
  spin.add(cap);

  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.205, 0.024, 64), materials.disc);
  disc.rotation.x = Math.PI / 2;
  spin.add(disc);
  const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.03, 48), materials.dark);
  hat.rotation.x = Math.PI / 2;
  hat.position.z = 0.012;
  spin.add(hat);

  const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.18, 0.07), materials.caliper);
  caliper.position.set(-0.15, 0.07, 0.022);
  caliper.rotation.z = 0.45;
  root.add(caliper);

  if (side < 0) root.rotation.y = Math.PI;
  root.userData.spin = spin;
  root.userData.side = side;
  return root;
}

function shadowTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d');
  g.filter = 'blur(18px)';
  g.fillStyle = 'rgba(0,0,0,0.9)';
  g.beginPath();
  g.ellipse(256, 128, 205, 72, 0, 0, Math.PI * 2);
  g.fill();
  g.filter = 'blur(6px)';
  g.fillStyle = 'rgba(0,0,0,1)';
  g.beginPath();
  g.ellipse(256, 128, 185, 58, 0, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createVehicle() {
  const uniforms = {
    uBody: { value: new THREE.Color(0xf2f1ed) }, // pearl white
    uDrl: { value: 1.2 },
    uTail: { value: 0.6 },
  };

  const materials = {
    body: makeBodyMaterial(uniforms),
    paint: new THREE.MeshPhysicalMaterial({
      color: 0xf2f1ed, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.03,
      iridescence: 0.16, iridescenceIOR: 1.35, iridescenceThicknessRange: [260, 420],
    }),
    rubber: new THREE.MeshStandardMaterial({ map: tireTexture(), roughness: 0.86 }),
    rim: new THREE.MeshStandardMaterial({ map: rimFaceTexture(), metalness: 0.85, roughness: 0.24 }),
    rimDark: new THREE.MeshPhysicalMaterial({ color: 0x0d0e10, metalness: 0.2, roughness: 0.18, clearcoat: 1 }),
    polish: new THREE.MeshStandardMaterial({ color: 0xe6e8eb, metalness: 1, roughness: 0.08 }),
    satin: new THREE.MeshStandardMaterial({ color: 0x9a9ea4, metalness: 1, roughness: 0.34 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1b1b1d, metalness: 0.3, roughness: 0.55 }),
    disc: new THREE.MeshStandardMaterial({ color: 0x80838a, metalness: 1, roughness: 0.38 }),
    caliper: new THREE.MeshStandardMaterial({ color: 0x3b3e44, metalness: 0.7, roughness: 0.32 }),
    gloss: new THREE.MeshPhysicalMaterial({ color: 0x08090a, roughness: 0.08, clearcoat: 1 }),
    lens: new THREE.MeshPhysicalMaterial({ color: 0x3a1d04, roughness: 0.08, clearcoat: 1, emissive: 0xff8a1f, emissiveIntensity: 0.12 }),
  };

  const group = new THREE.Group();
  group.name = 'cniq-mpv';

  const body = new THREE.Mesh(buildBodyGeometry(), materials.body);
  body.name = 'body';
  group.add(body);

  // mirrors
  for (const side of [1, -1]) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), materials.paint);
    cap.scale.set(0.085, 0.064, 0.125);
    cap.position.set(0.83, 1.245, side * 0.975);
    group.add(cap);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.032, 0.14), materials.gloss);
    arm.position.set(0.87, 1.205, side * 0.865);
    group.add(arm);
    // piano-black lower shell and a slim smoked repeater lens on the leading edge
    const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 12, 0, Math.PI * 2, Math.PI * 0.62, Math.PI * 0.38), materials.gloss);
    shell.scale.set(0.087, 0.066, 0.127);
    shell.position.copy(cap.position);
    group.add(shell);
    const lens = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.008, 0.085), materials.lens);
    lens.position.set(0.902, 1.22, side * 1.02);
    group.add(lens);
  }

  // shark-fin antenna
  const fin = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), materials.gloss);
  fin.scale.set(0.13, 0.05, 0.034);
  fin.position.set(-1.66, 1.722, 0);
  group.add(fin);

  // wheels
  const wheels = [];
  for (const x of [SPEC.frontAxle, SPEC.rearAxle]) {
    for (const side of [1, -1]) {
      const w = buildWheel(materials, side);
      w.position.set(x, SPEC.wheelRadius, side * SPEC.track);
      w.userData.front = x > 0;
      group.add(w);
      wheels.push(w);
    }
  }

  // soft contact shadow
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(5.7, 2.55),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.006;
  shadow.renderOrder = 2;
  group.add(shadow);

  group.traverse((o) => {
    if (o.isMesh && o !== shadow) o.castShadow = true;
  });

  function update({ distance = 0, steer = 0, drl = 1.2, tail = 0.6 } = {}) {
    const turn = distance / SPEC.wheelRadius;
    for (const w of wheels) {
      w.userData.spin.rotation.z = -turn * w.userData.side;
      w.rotation.y = (w.userData.side < 0 ? Math.PI : 0) + (w.userData.front ? steer : 0);
    }
    uniforms.uDrl.value = drl;
    uniforms.uTail.value = tail;
  }

  function wheelWorld(front = true, side = 1, target = new THREE.Vector3()) {
    const w = wheels.find((o) => o.userData.front === front && o.userData.side === side);
    return w.getWorldPosition(target);
  }

  return { group, update, wheelWorld, materials, uniforms };
}
