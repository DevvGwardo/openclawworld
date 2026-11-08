/**
 * Curated layout data for City Pack props in the plaza scene.
 *
 * Coordinates are world-space (matching Room.jsx building positions).
 * Plaza size is 150x150 world units (300x300 grid, gridDivision=2).
 *
 * Districts:
 *   civic        — North zone, near Town Hall
 *   commercial   — East zone, near Shop
 *   residential  — West zone, near Apartments
 *   transit      — South zone, social/transit hubs
 *
 * Currently uses existing project models (BackgroundBuilding, Skyscraper, SmallBuilding)
 * as stand-in city props. Replace `src` paths with real City Pack GLBs once ingested.
 */

// --- Core structures: large buildings that define the city skyline ---
export const PLAZA_CITYPACK_PROPS_CORE = [
  // Civic district — north, flanking Town Hall
  {
    id: "civic-bldg-west-01",
    src: "/models/BackgroundBuilding.glb",
    position: [30, 0, 4],
    rotationY: 0,
    scale: 4.5,
    district: "civic",
    blocksPath: false,
  },
  {
    id: "civic-bldg-east-01",
    src: "/models/BackgroundBuilding.glb",
    position: [120, 0, 4],
    rotationY: Math.PI,
    scale: 4.5,
    district: "civic",
    blocksPath: false,
  },

  // Commercial district — east side, flanking Shop
  {
    id: "commercial-bldg-north-01",
    src: "/models/BackgroundBuilding.glb",
    position: [140, 0, 30],
    rotationY: -Math.PI / 2,
    scale: 3.8,
    district: "commercial",
    blocksPath: false,
  },
  {
    id: "commercial-bldg-south-01",
    src: "/models/BackgroundBuilding.glb",
    position: [140, 0, 110],
    rotationY: -Math.PI / 2,
    scale: 4.0,
    district: "commercial",
    blocksPath: false,
  },

  // Residential district — west side, flanking Apartments
  {
    id: "residential-bldg-north-01",
    src: "/models/BackgroundBuilding.glb",
    position: [4, 0, 30],
    rotationY: Math.PI / 2,
    scale: 3.8,
    district: "residential",
    blocksPath: false,
  },
  {
    id: "residential-bldg-south-01",
    src: "/models/BackgroundBuilding.glb",
    position: [4, 0, 110],
    rotationY: Math.PI / 2,
    scale: 4.0,
    district: "residential",
    blocksPath: false,
  },

  // Transit district — south edge
  {
    id: "transit-bldg-center-01",
    src: "/models/BackgroundBuilding.glb",
    position: [75, 0, 145],
    rotationY: Math.PI,
    scale: 5.0,
    district: "transit",
    blocksPath: false,
  },
];

// --- Edge props: smaller buildings along the perimeter ---
export const PLAZA_CITYPACK_PROPS_EDGES = [
  // North edge fill
  {
    id: "civic-edge-01",
    src: "/models/SmallBuilding.glb",
    position: [45, 0, 2],
    rotationY: 0,
    scale: 3.5,
    district: "civic",
    blocksPath: false,
  },
  {
    id: "civic-edge-02",
    src: "/models/SmallBuilding.glb",
    position: [105, 0, 2],
    rotationY: 0,
    scale: 3.5,
    district: "civic",
    blocksPath: false,
  },

  // East edge fill
  {
    id: "commercial-edge-01",
    src: "/models/SmallBuilding.glb",
    position: [146, 0, 55],
    rotationY: -Math.PI / 2,
    scale: 3.0,
    district: "commercial",
    blocksPath: false,
  },
  {
    id: "commercial-edge-02",
    src: "/models/SmallBuilding.glb",
    position: [146, 0, 90],
    rotationY: -Math.PI / 2,
    scale: 3.2,
    district: "commercial",
    blocksPath: false,
  },

  // West edge fill
  {
    id: "residential-edge-01",
    src: "/models/SmallBuilding.glb",
    position: [2, 0, 55],
    rotationY: Math.PI / 2,
    scale: 3.0,
    district: "residential",
    blocksPath: false,
  },
  {
    id: "residential-edge-02",
    src: "/models/SmallBuilding.glb",
    position: [2, 0, 90],
    rotationY: Math.PI / 2,
    scale: 3.2,
    district: "residential",
    blocksPath: false,
  },

  // South edge fill
  {
    id: "transit-edge-west-01",
    src: "/models/SmallBuilding.glb",
    position: [30, 0, 146],
    rotationY: Math.PI,
    scale: 3.5,
    district: "transit",
    blocksPath: false,
  },
  {
    id: "transit-edge-east-01",
    src: "/models/SmallBuilding.glb",
    position: [120, 0, 146],
    rotationY: Math.PI,
    scale: 3.5,
    district: "transit",
    blocksPath: false,
  },
];

// --- Detail props: street-level elements for visual density ---
// These use Skyscraper models as stand-ins for city detail elements.
// Replace with actual city-pack detail models (benches, signs, planters, etc.) once available.
export const PLAZA_CITYPACK_PROPS_DETAILS = [
  // Civic district details
  {
    id: "civic-detail-01",
    src: "/models/Skyscraper.glb",
    position: [55, 0, 15],
    rotationY: Math.PI / 4,
    scale: 2.5,
    district: "civic",
    blocksPath: false,
  },
  {
    id: "civic-detail-02",
    src: "/models/Skyscraper.glb",
    position: [95, 0, 15],
    rotationY: -Math.PI / 4,
    scale: 2.5,
    district: "civic",
    blocksPath: false,
  },

  // Commercial district details
  {
    id: "commercial-detail-01",
    src: "/models/Skyscraper.glb",
    position: [135, 0, 45],
    rotationY: -Math.PI / 2,
    scale: 2.0,
    district: "commercial",
    blocksPath: false,
  },
  {
    id: "commercial-detail-02",
    src: "/models/Skyscraper.glb",
    position: [135, 0, 100],
    rotationY: -Math.PI / 2,
    scale: 2.0,
    district: "commercial",
    blocksPath: false,
  },

  // Residential district details
  {
    id: "residential-detail-01",
    src: "/models/Skyscraper.glb",
    position: [15, 0, 45],
    rotationY: Math.PI / 2,
    scale: 2.0,
    district: "residential",
    blocksPath: false,
  },
  {
    id: "residential-detail-02",
    src: "/models/Skyscraper.glb",
    position: [15, 0, 100],
    rotationY: Math.PI / 2,
    scale: 2.0,
    district: "residential",
    blocksPath: false,
  },

  // Transit hub details — south center
  {
    id: "transit-detail-01",
    src: "/models/Skyscraper.glb",
    position: [50, 0, 140],
    rotationY: Math.PI,
    scale: 2.2,
    district: "transit",
    blocksPath: false,
  },
  {
    id: "transit-detail-02",
    src: "/models/Skyscraper.glb",
    position: [100, 0, 140],
    rotationY: Math.PI,
    scale: 2.2,
    district: "transit",
    blocksPath: false,
  },
];
