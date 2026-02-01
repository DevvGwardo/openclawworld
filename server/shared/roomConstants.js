/**
 * Shared room layout constants used by both server and bot code.
 * Server is the source of truth; this module re-exports the canonical definitions
 * so bot-side code can derive spatial awareness without protocol changes.
 */

// Functional zones that bots will gradually fill in (generated rooms)
export const ROOM_ZONES = [
  // Living area (center-left)
  { name: "Living Area", items: ["rugRounded", "loungeSofa", "tableCoffee", "televisionModern", "loungeChair", "lampRoundFloor", "plant", "speaker"], area: { x: [10, 40], y: [10, 35] } },
  // Kitchen (top-right)
  { name: "Kitchen", items: ["kitchenFridge", "kitchenCabinet", "kitchenStove", "kitchenSink", "kitchenBar", "kitchenMicrowave", "toaster", "kitchenBlender", "stoolBar", "stoolBar"], area: { x: [55, 90], y: [5, 30] } },
  // Bedroom (bottom-left)
  { name: "Bedroom", items: ["bedDouble", "cabinetBedDrawer", "cabinetBedDrawerTable", "lampSquareTable", "bookcaseClosedWide", "rugRound", "plantSmall", "coatRackStanding"], area: { x: [5, 35], y: [55, 90] } },
  // Bathroom (bottom-right)
  { name: "Bathroom", items: ["bathtub", "toiletSquare", "bathroomSink", "bathroomCabinetDrawer", "trashcan", "bathroomMirror"], area: { x: [60, 90], y: [60, 90] } },
  // Office/desk area (top-left)
  { name: "Office", items: ["desk", "chairModernCushion", "laptop", "bookcaseOpenLow", "lampSquareFloor", "plantSmall"], area: { x: [5, 30], y: [5, 25] } },
  // Dining area (center)
  { name: "Dining", items: ["tableCrossCloth", "chair", "chair", "chair", "chair", "lampRoundTable", "rugSquare"], area: { x: [35, 60], y: [35, 55] } },
];

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
