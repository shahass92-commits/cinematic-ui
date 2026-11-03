// Procedural white MPV used by every scene (side view, top view and the 3D camera study).
// Built from lofted cross-sections so the silhouette reads correctly from any camera angle.
// No third-party branding is modelled. Units: metres. Forward = +X, up = +Y, right side = +Z.
import * as THREE from 'three';

export const SPEC = {
  length: 4.72,
  width: 1.82,
  height: 1.645,
  frontAxle: 1.46,
  rearAxle: -1.38,
  wheelRadius: 0.335,
  wheelWidth: 0.235,
  track: 0.8, // wheel centre offset from the centre line
};

const HALF_L = SPEC.length / 2;
const HALF_W = SPEC.width / 2;

// Side profile (x, y), front to rear. Top line and bottom line are sampled separately.
const TOP = [
  [2.36, 0.62], [2.355, 0.8], [2.33, 0.9], [2.27, 0.965], [2.1, 1.0], [1.8, 1.06],
  [1.5, 1.112], [1.32, 1.145], [1.1, 1.25], [0.85, 1.37], [0.6, 1.49], [0.4, 1.572],
  [0.25, 1.612], [0.0, 1.634], [-1.0, 1.645], [-1.8, 1.64], [-2.05, 1.618], [-2.13, 1.588],
  [-2.18, 1.5], [-2.25, 1.3], [-2.31, 1.12], [-2.345, 0.95], [-2.36, 0.76],
];
const BOTTOM = [
  [2.36, 0.58], [2.35, 0.4], [2.33, 0.27], [2.25, 0.225], [2.0, 0.21], [1.6, 0.19],
  [1.0, 0.168], [-1.0, 0.168], [-1.6, 0.19], [-2.05, 0.24], [-2.28, 0.28], [-2.34, 0.37],
  [-2.36, 0.72],
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

const BELT = 1.1;
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
  // beltline: 1.10 at the A-pillar, 1.15 mid-cabin, kicking up to 1.19 at the rear quarter
  float czBelt = 1.1 + 0.05 * smoothstep(0.8, -0.2, czP.x) + 0.04 * smoothstep(-1.55, -1.95, czP.x);
  float czWinTop = czYt - 0.075;

  float czSideBand = czAA(czBelt, czP.y) * (1.0 - czAA(czWinTop, czP.y)) * czAA(-2.15, czP.x) * (1.0 - czAA(0.36, czP.x));
  float czScreen = czAA(0.36, czP.x) * (1.0 - czAA(1.3, czP.x)) * czAA(czBelt, czP.y);
  float czRearGlass = (1.0 - czAA(-0.45, czN.x)) * czBand(czP.y, 1.16, 1.555) * (1.0 - czAA(czHm * 0.8, czX));
  float czGlass = max(max(czSideBand, czScreen), czRearGlass);

  // panes inside the black band (pillars and frames stay jet black)
  float czPane = czBand(czP.y, czBelt + 0.022, czWinTop - 0.03) * czSide * (
      czBand(czP.x, 0.07, 0.86 - (czP.y - 1.1) * 1.5) +
      czBand(czP.x, -1.02, -0.11) +
      czBand(czP.x, -1.93 + (czP.y - 1.2) * 0.35, -1.1));

  float czClad = max(1.0 - czAA(0.29, czP.y), 1.0 - czAA(-0.4, czN.y));
  float czZn = czX / max(czHm, 0.05); // 0 at the centre line, 1 at the body side (valid away from nose/tail tips)

  // ================= PREMIUM TRIM =================
  // ---- front fascia: matrix lamps with L-shaped DRL, full-width light blade over a satin bar,
  //      diamond-mesh grille, satin-bladed corner intakes, brushed lip, flush parking sensors
  float czFront = czAA(0.3, czN.x) * czAA(1.95, czP.x);
  float czLampY = czP.y - 0.05 * smoothstep(0.4, 0.86, czX);
  float czLamp = czAA(2.02, czP.x) * czBand(czLampY, 0.84, 0.905) * czAA(0.4, czX) * czAA(-0.1, czN.x);
  float czDrl = czLamp * czBand(czLampY, 0.889, 0.902);
  czDrl = max(czDrl, czAA(2.02, czP.x) * czAA(-0.1, czN.x) * czBand(czX, 0.703, 0.722) * czBand(czLampY, 0.80, 0.902));
  float czProj = czLamp * czBand(czLampY, 0.852, 0.877) * czBand(fract((czX - 0.38) * 22.0), 0.2, 0.6) * (1.0 - czAA(0.69, czX));
  float czBar = czFront * czBand(czP.y, 0.864, 0.882) * (1.0 - czAA(0.42, czX));
  float czSlot = czFront * czBand(czP.y, 0.884, 0.912) * (1.0 - czAA(0.42, czX));
  float czBlade = czFront * czBand(czP.y, 0.894, 0.901) * (1.0 - czAA(0.41, czX));
  float czFangC = 0.68 + (czP.y - 0.38) * 0.3;
  float czFang = czFront * czBand(czP.y, 0.38, 0.63) * czBand(czX, czFangC - 0.05, czFangC + 0.045);
  float czFangBlade = czFang * czBand(czX, czFangC - 0.009, czFangC + 0.004) * czBand(czP.y, 0.41, 0.6);
  float czGrille = czFront * czBand(czP.y, 0.29, 0.395) * (1.0 - czAA(0.58, czX));
  vec2 czMesh = vec2(czP.y + czX, czP.y - czX) * 34.0;
  float czMeshL = czGrille * (1.0 - smoothstep(0.06, 0.14, min(abs(fract(czMesh.x) - 0.5), abs(fract(czMesh.y) - 0.5))));
  float czGrilleRim = czFront * (czBand(czP.y, 0.283, 0.29) + czBand(czP.y, 0.395, 0.401)) * (1.0 - czAA(0.58, czX));
  float czPlateF = czFront * czBand(czP.y, 0.43, 0.535) * (1.0 - czAA(0.25, czX));
  float czLip = czFront * czBand(czP.y, 0.236, 0.262) * (1.0 - czAA(0.78, czX));
  float czFrontLow = czFront * (1.0 - czAA(0.236, czP.y));
  float czSensor = czFront * (1.0 - czAA(0.011, min(length(vec2(czX - 0.33, czP.y - 0.575)), length(vec2(czX - 0.52, czP.y - 0.575)))));
  float czHood = czAA(0.6, czN.y) * czBand(czP.x, 1.4, 2.22) * exp(-pow((czX - 0.43) / 0.018, 2.0));

  // ---- rear: L-lamps joined by a full-width red light blade, satin garnish, finned diffuser,
  //      piano-black spoiler lip, high stop lamp
  float czRear = (1.0 - czAA(-0.3, czN.x)) * (1.0 - czAA(-2.05, czP.x));
  float czTail = czBand(czP.y, 0.965, 1.055) * (1.0 - czAA(-2.0, czP.x)) * czAA(0.46, czX);
  czTail = max(czTail, czRear * czBand(czP.y, 0.9, 1.055) * czAA(0.72, czX));
  float czTailLine = czTail * (czBand(czP.y, 0.99, 0.997) + czBand(czP.y, 1.012, 1.018) + czBand(czP.y, 1.034, 1.04));
  float czBladeR = czRear * czBand(czP.y, 1.009, 1.017) * (1.0 - czAA(0.47, czX));
  float czBarR = czRear * czBand(czP.y, 0.984, 0.998) * (1.0 - czAA(0.46, czX));
  float czBladeHousing = czRear * czBand(czP.y, 0.999, 1.027) * (1.0 - czAA(0.47, czX));
  float czStop = czRear * czBand(czP.y, 1.528, 1.542) * (1.0 - czAA(0.26, czX));
  float czGate = czRear * (czLine(czX, 0.6, 0.0035) * czBand(czP.y, 0.6, 1.16) + czLine(czP.y, 0.6, 0.0025) * (1.0 - czAA(0.6, czX)));
  float czReflector = czRear * czBand(czP.y, 0.47, 0.492) * czBand(czX, 0.45, 0.76);
  float czRearLow = czRear * (1.0 - czAA(0.4, czP.y));
  float czDiffuser = czRear * czBand(czP.y, 0.255, 0.315) * (1.0 - czAA(0.64, czX));
  float czFins = czDiffuser * czBand(fract(czX * 11.0), 0.0, 0.16) * czBand(czP.y, 0.255, 0.3);
  float czSpoiler = czAA(0.25, czN.y) * (1.0 - czAA(-2.0, czP.x)) * czAA(czYt - 0.03, czP.y);

  // ---- glass, pillars and roof
  float czRoof = czAA(0.7, czN.y) * czBand(czP.x, -1.78, 0.4) * (1.0 - czAA(0.64, czZn));
  float czRoofFrame = czAA(0.7, czN.y) * czBand(czP.x, -1.8, 0.42) * czBand(czZn, 0.64, 0.665);
  czGlass = max(czGlass, czRoof);
  float czPillar = czSideBand * (1.0 - clamp(czPane, 0.0, 1.0)) * czSide;
  float czPrivacy = 1.0 - czAA(-0.11, czP.x);
  float czSky = smoothstep(czBelt, czWinTop, czP.y);

  float czArch = 0.0;
  czArch = max(czArch, 1.0 - czAA(0.392, length(vec2(czP.x - 1.46, czP.y - 0.335))));
  czArch = max(czArch, 1.0 - czAA(0.392, length(vec2(czP.x + 1.38, czP.y - 0.335))));
  czArch *= czAA(0.55, czX);

  // ---- flush detailing: shut lines, flush handles, charge flap
  float czSeamY = czBand(czP.y, 0.3, czBelt - 0.004);
  float czSeams = (czLine(czP.x, 1.02 - (czP.y - 0.3) * 0.05, 0.003) + czLine(czP.x, -0.06, 0.003) + czLine(czP.x, -1.16 + (czP.y - 0.3) * 0.12, 0.003)) * czSeamY;
  czSeams += czLine(czP.y, czBelt - 0.04, 0.0025) * czBand(czP.x, -2.02, -1.1);
  czSeams += (czLine(czP.y, 0.86, 0.0025) + czLine(czP.y, 0.98, 0.0025)) * czBand(czP.x, -1.74, -1.56);
  czSeams += (czLine(czP.x, -1.74, 0.0025) + czLine(czP.x, -1.56, 0.0025)) * czBand(czP.y, 0.86, 0.98);
  float czHandleBox = (czBand(czP.x, 0.05, 0.23) + czBand(czP.x, -1.0, -0.83)) * czBand(czP.y, 0.941, 0.965) * czSide;
  float czHandle = (czBand(czP.x, 0.056, 0.224) + czBand(czP.x, -0.994, -0.836)) * czBand(czP.y, 0.945, 0.961) * czSide;
  czSeams += (czHandleBox - czHandle) * 1.0;
  czSeams *= czSide * (1.0 - czArch);
  czSeams += czGate;

  // ---- satin-metal accents
  float czDloTop = czBand(czP.y, czWinTop - 0.002, czWinTop + 0.013) * czBand(czP.x, -2.1, 0.37) * czSide;
  float czDloBelt = czBand(czP.y, czBelt - 0.013, czBelt + 0.001) * czBand(czP.x, -2.12, 0.98) * czSide;
  float czSill = czBand(czP.y, 0.298, 0.312) * czBand(czP.x, -0.98, 1.05) * czSide;
  float czFender = czBand(czP.y, 0.742, 0.754) * czBand(czP.x, 0.78, 0.94) * czSide;
  float czRail = czBand(czP.y, czYt - 0.055, czYt - 0.032) * czBand(czP.x, -2.0, 0.3) * smoothstep(0.15, 0.4, abs(czN.z));
  float czRailGap = czBand(czP.y, czYt - 0.06, czYt - 0.055) * czBand(czP.x, -2.0, 0.3) * smoothstep(0.15, 0.4, abs(czN.z));
  float czSatin = clamp(czBar + czRail + czBarR + czLip + czDiffuser * (1.0 - czFins) + czDloTop + czDloBelt + czSill + czFender + czGrilleRim + czFangBlade + czRoofFrame, 0.0, 1.0);
  float czBright = clamp(czHandle, 0.0, 1.0);
  float czGlossBlack = clamp(czFang * (1.0 - czFangBlade) + czGrille * (1.0 - czMeshL) + czPlateF + czSlot * (1.0 - czBlade) + czBladeHousing * (1.0 - czBladeR) + czSpoiler, 0.0, 1.0);
  float czDarkTrim = clamp(czFrontLow + czRearLow * (1.0 - czDiffuser), 0.0, 1.0);

  // ---- finish
  vec3 czCol = uBody;
  float czRough = 0.22;
  float czMetal = 0.0;
  float czCC = 1.0;
  float czCCR = 0.03;

  czCol *= 1.0 - czHood * 0.05;
  czCol *= 1.0 - czSensor * 0.12;
  czCol = mix(czCol, vec3(0.012), czClad); czRough = mix(czRough, 0.55, czClad); czCC = mix(czCC, 0.25, czClad);
  czCol = mix(czCol, vec3(0.005), czArch); czRough = mix(czRough, 0.95, czArch); czCC = mix(czCC, 0.0, czArch);
  czCol = mix(czCol, vec3(0.009), czDarkTrim); czRough = mix(czRough, 0.5, czDarkTrim); czCC = mix(czCC, 0.2, czDarkTrim);
  czCol = mix(czCol, vec3(0.004), czGlossBlack); czRough = mix(czRough, 0.08, czGlossBlack); czCC = mix(czCC, 1.0, czGlossBlack);
  czCol = mix(czCol, vec3(0.05, 0.052, 0.056), czMeshL); czMetal = mix(czMetal, 0.6, czMeshL); czRough = mix(czRough, 0.35, czMeshL);
  // glass: pillars piano black, panes with depth; rear cabin in privacy tint
  czCol = mix(czCol, vec3(0.0025), czGlass); czRough = mix(czRough, 0.28, czGlass); czCC = mix(czCC, 0.35, czGlass); czCCR = mix(czCCR, 0.1, czGlass);
  vec3 czPaneCol = mix(vec3(0.01, 0.011, 0.013), vec3(0.03, 0.033, 0.038), czSky) * mix(1.0, 0.62, czPrivacy);
  czCol = mix(czCol, czPaneCol, czPane * czGlass); czRough = mix(czRough, 0.22, czPane * czGlass);
  czCol = mix(czCol, vec3(0.002), czPillar); czRough = mix(czRough, 0.07, czPillar); czCC = mix(czCC, 1.0, czPillar); czCCR = mix(czCCR, 0.02, czPillar);
  czRough = mix(czRough, 0.26, czRoof); czCC = mix(czCC, 0.3, czRoof); czCol = mix(czCol, vec3(0.005), czRoof);
  // lamps
  czCol = mix(czCol, vec3(0.008, 0.009, 0.012), czLamp); czRough = mix(czRough, 0.05, czLamp); czCC = mix(czCC, 1.0, czLamp);
  czCol = mix(czCol, vec3(0.09, 0.004, 0.004), czTail); czRough = mix(czRough, 0.06, czTail); czCC = mix(czCC, 1.0, czTail);
  czCol = mix(czCol, vec3(0.2, 0.008, 0.008), czReflector);
  // satin metal and bright handle inserts
  czCol = mix(czCol, vec3(0.58, 0.6, 0.63), czSatin); czMetal = mix(czMetal, 1.0, czSatin); czRough = mix(czRough, 0.34, czSatin); czCC = mix(czCC, 0.0, czSatin);
  czCol = mix(czCol, vec3(0.8, 0.82, 0.85), czBright); czMetal = mix(czMetal, 1.0, czBright); czRough = mix(czRough, 0.14, czBright);
  czCol = mix(czCol, czCol * 0.15, clamp(czSeams + czRailGap, 0.0, 1.0));
  float czPaint = (1.0 - czGlass) * (1.0 - czSatin) * (1.0 - czGlossBlack) * (1.0 - czClad) * (1.0 - czDarkTrim) * (1.0 - czArch) * (1.0 - czLamp) * (1.0 - czTail);

  diffuseColor.rgb = czCol;
  roughnessFactor = czRough;
  metalnessFactor = czMetal;
  totalEmissiveRadiance += (czDrl * 1.15 + czProj * 0.7 + czBlade * 0.9) * vec3(0.86, 0.93, 1.0) * uDrl;
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
        '#include <lights_physical_fragment>\nmaterial.specularF90 = mix(material.specularF90, 0.42, czGlass);\n#ifdef USE_CLEARCOAT\nmaterial.clearcoat = czCC;\nmaterial.clearcoatRoughness = czCCR;\n#endif\n#ifdef USE_IRIDESCENCE\nmaterial.iridescence *= czPaint;\n#endif',
      );
  };
  mat.customProgramCacheKey = () => 'cniq-mpv-body-premium-v1';
  return mat;
}

// ---------- wheels ----------
// Low-profile tyre on a large 10-twin-spoke rim: machined faces, gloss-black pockets, polished lip.
const RIM_R = 0.256;

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
    rim: new THREE.MeshStandardMaterial({ color: 0xd2d5da, metalness: 1, roughness: 0.2 }),
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
    cap.position.set(0.8, 1.19, side * 0.985);
    group.add(cap);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.032, 0.14), materials.gloss);
    arm.position.set(0.84, 1.15, side * 0.875);
    group.add(arm);
    // piano-black lower shell and a slim smoked repeater lens on the leading edge
    const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 12, 0, Math.PI * 2, Math.PI * 0.62, Math.PI * 0.38), materials.gloss);
    shell.scale.set(0.087, 0.066, 0.127);
    shell.position.copy(cap.position);
    group.add(shell);
    const lens = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.008, 0.085), materials.lens);
    lens.position.set(0.872, 1.165, side * 1.03);
    group.add(lens);
  }

  // shark-fin antenna
  const fin = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), materials.gloss);
  fin.scale.set(0.13, 0.05, 0.034);
  fin.position.set(-1.72, 1.658, 0);
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
