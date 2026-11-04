# Compiled Spec — CNIQ Scroll Drive

## Stack
- Three.js 0.170.0 (ES module via import map with SRI), GSAP 3.12.5 + ScrollTrigger (SRI).
- One fixed transparent WebGL canvas between a back layer (ghost type) and the copy layer.
- One master `gsap.timeline` (20.15 s over a 28-viewport track), `scrub: 1`, built per layout through `gsap.matchMedia` (wide ≥ 1:1, narrow portrait).

## Camera rig (`main.js`)
| Param | Meaning |
|-------|---------|
| `s` | Distance along the route (straight → R12 bend → straight) |
| `elev`, `azim` | Spherical camera angles around the target (0/0 = right-side elevation) |
| `fov`, `vw` | Lens and metres visible at the subject; `distance = (vw / aspect) / (2·tan(fov/2))` |
| `sx`, `sy` | Screen position of the composition anchor, enforced with a projection-matrix lens shift |
| `edge` | Anchor on the road front edge (1, elevation) or on the car (0) |
| `follow`, `fx`, `fz` | Track the car or hold a fixed frame |
| `ty`, `ay` | Look-at height and anchor height |
| `wheel` | Retarget to the front wheel |
| `fade` | Road alpha falloff radius (dissolves into the white field in the study) |
| `drl`, `brake` | Lamp intensities |

Wide-layout key values: elevation `vw` 12.2 → 13.6 m; plan `vw` 19 m; bend `vw` 44 m; vertical road `vw` 32 m at `sx` 0.63; study `vw` 8.6 m at 45 mm.
Side-view straight runs to x = 360 m before the R12 bend, so the elevation drive can last 9 s.
Card rails: smoked-glass cards (gradient fill, gold top hairline, mono index, tag chips) translate from 30% to −(scrollWidth − 86%) of the viewport while a gold meter scrubs 0 → 1.
Narrow layout: elevation `vw` 6.3 m; vertical road `vw` 20 m at `sx` 0.73; study copy becomes a bottom sheet.

## Surfaces
- Road: unlit shader, felt value-noise above pixel scale (no sparkle while tracking), 7 m dashes, edge lines, distance alpha fade.
- Mat (road slab face, elevation only): poster grey `0.235 → 0.13` vertical falloff with a darker top lip, 14 m panel seams.
- Vehicle: `MeshPhysicalMaterial` with `onBeforeCompile`; all zones are computed from object-space position and normal with `fwidth` anti-aliasing. Neutral tone mapping and a RoomEnvironment PMREM.

## Typography
- Display: Manrope 800, uppercase, `clamp(30px, 4.3vw, 70px)`, leading 0.98, second line in dim grey.
- Body: Inter 400, 14–17 px. HUD: JetBrains Mono 500, 11 px, 0.14em tracking.

## Motion rules
- Copy enters with `y: 34 → 0` and an autoAlpha stagger of 0.035, and exits upward.
- The HUD uses `mix-blend-mode: difference`, so it inverts over the mat.
- Speed readout = smoothed |Δs/Δt| × 0.42, capped at 96 km/h. The compass needle follows the car's on-screen heading.
- The renderer skips a frame when no rig value changed.

## QA checklist (verified in headless Chromium, SwiftShader)
- [x] 1440×900 and 390×844 at timeline seconds 0–20.15: no console errors
- [x] Both card rails pass fully across the mat; all eight milestones turn gold before the stop
- [x] The road edge stays under the wheels while the mat rises
- [x] The crane-up lands on a plan view with the car upright and facing the direction of travel
- [x] Milestones turn gold as the car passes; copy panels stay legible over the road
