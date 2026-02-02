/**
 * Shared room layout constants used by both server and bot code.
 * Server is the source of truth; this module re-exports the canonical definitions
 * so bot-side code can derive spatial awareness without protocol changes.
 */

// Functional zones that bots will gradually fill in (generated rooms)
// Area values are proportions (0-1) relative to the room grid size,
// so they scale correctly for any room size (10x10, 15x15, 20x20, etc.)
export const ROOM_ZONES = [
  // Living area (center-left)
  { name: "Living Area", items: ["rugRounded", "loungeSofa", "tableCoffee", "televisionModern", "loungeChair", "lampRoundFloor", "plant", "speaker"], area: { x: [0.10, 0.45], y: [0.10, 0.40] } },
  // Kitchen (top-right)
  { name: "Kitchen", items: ["kitchenFridge", "kitchenCabinet", "kitchenStove", "kitchenSink", "kitchenBar", "kitchenMicrowave", "toaster", "kitchenBlender", "stoolBar", "stoolBar"], area: { x: [0.55, 0.95], y: [0.05, 0.35] } },
  // Bedroom (bottom-left)
  { name: "Bedroom", items: ["bedDouble", "cabinetBedDrawer", "cabinetBedDrawerTable", "lampSquareTable", "bookcaseClosedWide", "rugRound", "plantSmall", "coatRackStanding"], area: { x: [0.05, 0.40], y: [0.55, 0.95] } },
  // Bathroom (bottom-right)
  { name: "Bathroom", items: ["bathtub", "toiletSquare", "bathroomSink", "bathroomCabinetDrawer", "trashcan", "bathroomMirror"], area: { x: [0.60, 0.95], y: [0.60, 0.95] } },
  // Office/desk area (top-left)
  { name: "Office", items: ["desk", "chairModernCushion", "laptop", "bookcaseOpenLow", "lampSquareFloor", "plantSmall"], area: { x: [0.05, 0.35], y: [0.05, 0.30] } },
  // Dining area (center)
  { name: "Dining", items: ["tableCrossCloth", "chair", "chair", "chair", "chair", "lampRoundTable", "rugSquare"], area: { x: [0.35, 0.65], y: [0.35, 0.60] } },
];

// Scale a zone's proportional area to actual grid coordinates for a given room
export const scaleZoneArea = (zoneArea, room) => {
  const gw = room.size[0] * (room.gridDivision || 2);
  const gh = room.size[1] * (room.gridDivision || 2);
  return {
    x: [Math.floor(zoneArea.x[0] * gw), Math.floor(zoneArea.x[1] * gw)],
    y: [Math.floor(zoneArea.y[0] * gh), Math.floor(zoneArea.y[1] * gh)],
  };
};

// Building footprints for large plaza rooms (world coordinates: [x, z, width, depth])
export const getBuildingFootprints = (sz) => [
  { x: sz[0] / 2 - 6, z: 0, w: 12, d: 10 },       // TownHall (center-north)
  { x: 0, z: sz[1] / 2 - 5, w: 8, d: 10 },          // Apartment (west)
  { x: sz[0] - 8, z: sz[1] / 2 - 5, w: 8, d: 10 },  // ShopBuilding (east)
  { x: 7, z: 7, w: 8, d: 8 },                         // SmallBuilding (NW) — shifted to clear NW skyscraper
  { x: sz[0] - 15, z: 7, w: 8, d: 8 },                // SmallBuilding (NE) — shifted to clear NE skyscraper
  { x: sz[0] / 2 + 11, z: 1, w: 6, d: 6 },            // Skyscraper (beside TownHall, east side)
  { x: 0, z: 0, w: 5, d: 5 },                         // Skyscraper (NW corner)
  { x: sz[0] - 5, z: 0, w: 5, d: 5 },                 // Skyscraper (NE corner)
  { x: 0, z: sz[1] - 5, w: 5, d: 5 },                 // Skyscraper (SW corner)
  { x: sz[0] - 5, z: sz[1] - 5, w: 5, d: 5 },        // Skyscraper (SE corner)
];

// Semantic names for plaza building footprints (same order as getBuildingFootprints)
export const PLAZA_LANDMARKS = [
  "Town Hall",
  "Apartment",
  "Shop",
  "Small Building (NW)",
  "Small Building (NE)",
  "Skyscraper (center-north)",
  "Skyscraper (NW corner)",
  "Skyscraper (NE corner)",
  "Skyscraper (SW corner)",
  "Skyscraper (SE corner)",
];

// Entrance zone for plaza rooms
export const ENTRANCE_ZONE = { x: [46, 52], y: [46, 52] };

// Zone action hints for bot behavior
export const ZONE_ACTIONS = {
  "Living Area": "relax, watch TV, chat with others",
  "Kitchen": "cook, store food, make drinks",
  "Bedroom": "rest, organize belongings, read",
  "Bathroom": "freshen up, tidy up",
  "Office": "work, browse laptop, read books",
  "Dining": "eat, have conversations, socialize",
};

// --- Sims-style needs/motive system ---

export const OBJECT_AFFORDANCES = {
  bedDouble:        { satisfies: { energy: 50 }, duration: 8000, interruptible: true },
  bedSingle:        { satisfies: { energy: 40 }, duration: 7000, interruptible: true },
  kitchenStove:     { satisfies: { hunger: 40 }, duration: 6000, interruptible: false },
  kitchenFridge:    { satisfies: { hunger: 20 }, duration: 3000, interruptible: true },
  loungeSofa:       { satisfies: { energy: 20, fun: 10 }, duration: 5000, interruptible: true },
  loungeChair:      { satisfies: { energy: 15 }, duration: 4000, interruptible: true },
  televisionModern: { satisfies: { fun: 35 }, duration: 6000, interruptible: true },
  televisionVintage:{ satisfies: { fun: 30 }, duration: 6000, interruptible: true },
  bathtub:          { satisfies: { fun: 15, energy: 10 }, duration: 5000, interruptible: true },
  tableCrossCloth:  { satisfies: { social: 15 }, duration: 4000, interruptible: true },
  desk:             { satisfies: { fun: 10 }, duration: 5000, interruptible: true },
  speaker:          { satisfies: { fun: 20 }, duration: 4000, interruptible: true },
  eatSpot:          { satisfies: { hunger: 30, energy: 5 }, duration: 5000, interruptible: true },
};

// Decay per second — tuned so energy drains from 100→0 in ~15 minutes
export const DECAY_RATES = { energy: 0.11, social: 0.09, fun: 0.09, hunger: 0.06 };

export const MOTIVE_CLAMP = { min: 0, max: 100 };

export const TRAITS = {
  lazy:     { decayMod: { energy: 1.5 }, preferences: { bedDouble: 5, bedSingle: 5, loungeSofa: 4, televisionModern: 3 } },
  social:   { decayMod: { social: 1.4 }, preferences: { tableCrossCloth: 5 } },
  creative: { decayMod: { fun: 1.3 }, preferences: { desk: 4, speaker: 3 } },
  glutton:  { decayMod: { hunger: 1.5 }, preferences: { kitchenStove: 5, kitchenFridge: 4 } },
};
