# Town Plaza -> City Upgrade Spec

## Scope
This is a planning/spec document only. No code or asset changes are included.

## Can I See The Plaza?
I cannot directly "look" at a running 3D scene in this environment the same way a player does in-browser.
I can inspect the actual scene/layout code and live room data, which is what this plan is based on.

Inputs reviewed:
- `client/src/components/Room.jsx` (plaza geometry, buildings, interactions)
- `server/shared/roomConstants.js` (building footprints, blocked areas)
- `server/rooms.json` (active plaza room data)
- `client/src/components/Minimap.jsx` (what players currently perceive top-down)

## Current State (What Exists Today)
1. Plaza footprint is large: `size: [150, 150]`, `gridDivision: 2`.
2. Core buildings exist (Town Hall, Apartment, Shop, two small buildings, five skyscrapers).
3. Ground is mostly a single flat gray plane with limited material variation.
4. Item density is low for map scale: `30` plaza items, mostly benches/plants/lamps.
5. Placeable items are concentrated near lower grid coordinates (roughly first third of the map), leaving large empty areas.
6. Landmark interactivity is minimal: Apartments clickable, Town Hall mostly decorative, Shop represented by building.
7. Minimap labels only major footprints; no district/road identity is conveyed.

## Why It Still Feels Like A Town Instead Of A City
1. No street hierarchy (no clear avenues, blocks, lanes, crossings).
2. No zoning signal (civic/commercial/residential/mixed-use reads weakly).
3. Empty spatial scale reduces perceived urban density.
4. Missing city props: curb lines, traffic furniture, signage clusters, transit cues.
5. Lighting and night-readability are not used to create urban atmosphere.

## City Upgrade Goals
1. Make navigation read like a city grid in under 5 seconds.
2. Increase perceived density without harming pathfinding.
3. Keep social hotspots (Town Hall, Apartments, Shop) active and legible.
4. Preserve performance by reusing existing assets first; add new assets only where impact is high.

## Proposed Design Direction
### 1) Street + Block Framework (Highest Impact)
Create a simple city skeleton before adding props.

- Add one N-S primary boulevard through Town Hall axis.
- Add one E-W connector through Apartments-Shop axis.
- Add a perimeter ring road near plaza edge.
- Use contrasting materials/colors for:
  - Roadway
  - Sidewalk
  - Civic plaza tile
- Add 4 major crosswalks at boulevard intersections.

Outcome: immediate "city" read from camera and minimap.

### 2) District Zoning
Define 4 readable districts so the plaza has urban purpose.

- North/Civic Core: Town Hall forecourt + bulletin board square.
- East/Commercial Strip: Shop frontage + market seating.
- West/Residential Edge: Apartment entry court + benches + greenery.
- South/Transit + Social: open plaza for gathering/events.

Outcome: players feel intentional city planning instead of random landmarks.

### 3) Density Pass (Reuse Existing Item Catalog)
Use existing placeables to increase urban cadence without new models first.

- Lighting rhythm: place `lampSquareFloor` or `lampRoundFloor` every 10-14 grid units on sidewalks.
- Streetscape rhythm: bench + planter clusters every 18-24 grid units.
- Pocket plazas: use `rugSquare`/`rugRectangle` as paved islands under seating clusters.
- Social corners: add 3-4 micro seating hubs using benches and low tables.

Outcome: map feels inhabited and city-like at human scale.

### 4) Skyline + Landmark Composition
Keep current buildings, but improve silhouette logic.

- Concentrate tallest forms behind Town Hall and at diagonal corners.
- Keep apartment/shop edges medium-height and readable from spawn area.
- Reserve open sightline from center plaza to Town Hall front.

Outcome: stronger city skyline depth without new traversal complexity.

### 5) City Atmosphere Layer
Add atmosphere after layout is solved.

- Increase nighttime legibility with stronger emissive window/lamp accents.
- Add subtle fog/haze depth so distant buildings separate from foreground.
- Use warm-cool contrast (warm social hubs, cooler ambient streets).

Outcome: city mood, especially during low-light sessions.

## Technical Constraints To Respect
1. Pathfinding blocks building footprints from `getBuildingFootprints`; roads/walkways must remain clear around these rectangles.
2. Current plaza detection logic is `map.size[0] > 30`; keep city logic behind this condition.
3. Existing items are mostly interior props; "city furniture" beyond benches/plants/lamps may require new assets.
4. Minimap currently draws landmark footprints from a hardcoded/duplicated footprint list; district overlays would need synchronized updates.

## Implementation Phasing (Recommended)
### Phase 1: Layout Readability (No New Assets)
1. Introduce street/sidewalk material zones.
2. Reposition existing benches/plants/lamps to support boulevards + districts.
3. Add district naming in minimap labels.

Acceptance checks:
- Player can identify north-south boulevard and town center immediately.
- Empty-space perception reduced significantly.

### Phase 2: Urban Density + Social Nodes
1. Add repeated lamp/bench/planter cadence across all districts.
2. Create 3-5 intentional social hubs with seating patterns.
3. Refine building orientation for skyline composition.

Acceptance checks:
- No district feels empty during normal movement.
- Social congregation points emerge naturally.

### Phase 3: Atmosphere + Polish
1. Lighting pass for day/night readability.
2. Fog/haze and color grading tweaks.
3. Optional new city props (signs, barriers, kiosks, transit markers) if needed.

Acceptance checks:
- Scene reads as "small city plaza" both in static view and while moving.

## Suggested Placement Blueprint (Grid-Oriented)
Use current `150x150` scale as a practical template:

1. Primary boulevard: center corridor around `x ~= 75`, running full `z` length.
2. Cross boulevard: center corridor around `z ~= 75`, running full `x` length.
3. Civic square: rectangle in front of Town Hall (north-center).
4. Commercial strip: east side around shop footprint plus south spillover.
5. Residential court: west side around apartment footprint.
6. South event zone: open central-south rectangle for gatherings/emotes.

## Risks
1. Over-blocking walkable cells with decorative items can hurt movement quality.
2. Too many unique props may hurt draw performance on lower-end clients.
3. If minimap remains unlabeled by district, city intent may still be unclear.

## Success Metrics
1. Navigation clarity: new players identify 3 named areas quickly.
2. Engagement: players cluster in at least 2 distinct social hubs.
3. Visual density: no major dead zones in minimap occupancy heat.
4. Atmosphere: city identity is recognizable from a single screenshot.

## Next Spec Add-On (Optional)
If you want, I can produce a second document with exact per-item placement coordinates for a first "city pass" using only existing assets in your catalog.
