# Design Decisions — CNIQ Scroll Drive

- Entry mode: Screenshot / reference. The user supplied a screen recording of a scroll-driven freight site (side-view truck → rising dark road → overhead road with bends) plus CNIQ poster comps and studio photos of a white MPV.
- Genre: precision / modernist urban
- Director: Jacques Tati
- Film: *Playtime* (1967)
- Niche: Compass Nexus iQ, employee transportation and corporate mobility, Thiruvananthapuram
- Pages: one long-scroll page (10 drive scenes + a 5-shot 3D camera study)
- Major page roles: brand hero → platform → promise → services → sectors → live ops → routing → reliability milestones → airport / intercity → verified invoice → camera study → contact
- Image placeholders: none. The vehicle is a procedural 3D model, so there are no photos.
- Sub-agent delegation plan: none

## Demo Uniqueness Audit

- Previous-work audit: no earlier cinematic-ui demos exist in this repo. The fallback templates most likely to creep in are a left-copy/right-product hero, stacked rounded cards, a dark luxury palette with thin borders, and a pill metadata row.
- Recurring traits to avoid: centred product-on-gradient hero, card grids, glowing gradients.
- Shell-ban list: rounded card grids; split hero with the product on the right; dark-mode luxury shell; marquee logo strip; pill tags.
- Primary composition family: **corridor**. A single road runs through every scene, first as an elevation band, then as a plan-view strip.
- Why this family differs: the page geometry is the road. Copy is pinned to it (on the mat in elevation, beside it in plan) instead of sitting in a stacked section shell.
- Wireframe-level uniqueness test: with colour and type stripped out, the wireframe is still one band that rises, rotates 90° into a strip and bends. No conventional section shell survives.

## Research Notes

### Research Boundary
- Film research is observational input, not a spec: *Playtime*'s value here is its spatial grammar (flat wide frames, choreographed traffic, a grey-white modernist city), not its comedy or plot.
- What is being translated into web language: planimetric wide framing, deep focus (nothing blurred), traffic as choreography, cool neutral materials.
- What must not be flattened into product-template logic: the road is a continuous set, not a decorative divider between sections.

### Research Sources
- Director / film: from general film knowledge (Tati's 70 mm *Playtime*, the "Tativille" glass-and-steel set, the late roundabout sequence). Not web-verified in this session; re-check before reusing this brief elsewhere.
- Niche source 1: the user's CNIQ project brief (services, trip verification chain, vehicle quality profile).
- Niche source 2: the user's poster comps (white field, grey felt mat, CNIQ wordmark, "Reliability at every milestone").

### Film Palette (translated to brand)
- Primary: paper white `#f5f5f3`
- Secondary: felt mat greys `#3c3c3c → #1d1d1d`
- Accent: compass gold `#b8955a` (milestones, live dot), nexus blue `#2a46b0` (link hover)
- Shadow: `#0e0e0e`
- Text: ink `#0e0e0e`, dim `#8a8a8a`

### Director Signatures
1. Planimetric wide frames in which the subject moves laterally across a flat set.
2. Deep focus: every plane is sharp, and the eye is led by layout rather than blur.
3. Traffic choreography: vehicles circle and turn as if in a dance.

### Film Translation Notes
- Framing: side elevation with a long lens (≈150 mm) and a lens shift, so the horizon stays level as the mat rises.
- Rhythm: one screen per beat, with five elevation beats before one continuous crane move.
- Lighting: soft studio environment light, no hard shadows, white field.
- Space: the road is the only architecture, and the white field is the city.
- Materiality: felt-grey mat, pearl-white paint, satin metal, piano black.
