/**
 * Room layout module -- generates structured spatial descriptions from room data,
 * enabling bots to understand room geography for navigation and conversation.
 */

import {
  ROOM_ZONES,
  getBuildingFootprints,
  PLAZA_LANDMARKS,
  ENTRANCE_ZONE,
  ZONE_ACTIONS,
} from "../shared/roomConstants.js";

/**
 * Build a LayoutDescriptor from room data.
 * @param {object} room - Room object with { size, items, gridDivision, id }
 * @returns {object} LayoutDescriptor { roomType, landmarks, zones, entrances, dimensions }
 */
export function buildLayout(room) {
  if (!room) return null;

  const size = room.size ?? [50, 50];
  const gridDivision = room.gridDivision ?? 2;
  const maxGrid = size[0] * gridDivision;
  const isPlaza = size[0] > 30;

  const layout = {
    roomType: isPlaza ? "plaza" : "room",
    dimensions: { width: size[0], height: size[1], maxGrid },
    landmarks: [],
    zones: [],
    entrances: [],
  };

  if (isPlaza) {
    // Plaza layout: derive landmarks from building footprints
    const footprints = getBuildingFootprints(size);
    const gd = gridDivision;

    layout.landmarks = footprints.map((fp, i) => ({
      name: PLAZA_LANDMARKS[i] ?? `Building ${i}`,
      gridCenter: [
        Math.floor((fp.x + fp.w / 2) * gd),
        Math.floor((fp.z + fp.d / 2) * gd),
      ],
      gridBounds: {
        x: [Math.floor(fp.x * gd), Math.floor((fp.x + fp.w) * gd)],
        y: [Math.floor(fp.z * gd), Math.floor((fp.z + fp.d) * gd)],
      },
    }));

    layout.entrances.push({
      name: "Main Entrance",
      area: ENTRANCE_ZONE,
    });
  } else {
    // Generated room: derive zones from ROOM_ZONES template
    const roomItems = room.items ?? [];

    layout.zones = ROOM_ZONES.map((zone) => {
      // Count items within this zone's bounds
      const itemsInZone = roomItems.filter((item) => {
        const [ix, iy] = item.gridPosition ?? [0, 0];
        return (
          ix >= zone.area.x[0] &&
          ix <= zone.area.x[1] &&
          iy >= zone.area.y[0] &&
          iy <= zone.area.y[1]
        );
      });

      return {
        name: zone.name,
        area: zone.area,
        center: [
          Math.floor((zone.area.x[0] + zone.area.x[1]) / 2),
          Math.floor((zone.area.y[0] + zone.area.y[1]) / 2),
        ],
        expectedItems: zone.items.length,
        placedItems: itemsInZone.length,
      };
    });
  }

  return layout;
}

/**
 * Serialize a layout to compact text for LLM consumption.
 * @param {object} layout - LayoutDescriptor from buildLayout()
 * @param {number[]} selfPosition - Bot's current [x, y] grid position
 * @returns {string}
 */
export function serializeLayout(layout, selfPosition) {
  if (!layout) return "";

  const pos = selfPosition ?? [0, 0];
  const lines = [];

  if (layout.roomType === "plaza") {
    const w = layout.dimensions.width;
    const h = layout.dimensions.height;
    const maxG = layout.dimensions.maxGrid;
    lines.push(`[Layout] Plaza (${w}x${h}, grid 0-${maxG - 1}).`);

    // List major landmarks with relative position
    const majorLandmarks = layout.landmarks.filter(
      (l) => !l.name.startsWith("Skyscraper")
    );
    if (majorLandmarks.length > 0) {
      const parts = majorLandmarks.map((l) => {
        const rel = describeRelativePosition(pos, l.gridCenter, maxG);
        return `${l.name} (${rel})`;
      });
      lines.push(`Buildings: ${parts.join(", ")}.`);
    }

    if (layout.entrances.length > 0) {
      const e = layout.entrances[0];
      lines.push(
        `Entrance zone: center [${e.area.x[0]}-${e.area.x[1]}, ${e.area.y[0]}-${e.area.y[1]}].`
      );
    }

    // Where is the bot relative to landmarks?
    const nearest = findNearestLandmark(pos, layout.landmarks);
    if (nearest) {
      lines.push(`You are ${nearest}.`);
    }
  } else {
    // Generated room
    const w = layout.dimensions.width;
    const h = layout.dimensions.height;
    const maxG = layout.dimensions.maxGrid;
    lines.push(`[Layout] Room (${w}x${h}, grid 0-${maxG - 1}).`);

    if (layout.zones.length > 0) {
      const parts = layout.zones.map((z) => {
        const quadrant = describeQuadrant(z.center, maxG);
        return `${z.name} (${quadrant}, ${z.placedItems}/${z.expectedItems} items)`;
      });
      lines.push(`Zones: ${parts.join(", ")}.`);
    }

    // Which zone is the bot in?
    const currentZone = getZoneAt(layout, pos);
    if (currentZone) {
      lines.push(`You are in the ${currentZone.name} zone.`);
      const action = ZONE_ACTIONS[currentZone.name];
      if (action) {
        lines.push(`Zone activities: ${action}.`);
      }
    } else {
      lines.push("You are in an open area.");
    }
  }

  return lines.join(" ");
}

/**
 * Get the zone containing a given position.
 * @param {object} layout - LayoutDescriptor
 * @param {number[]} position - [x, y] grid position
 * @returns {object|null} Zone object or null
 */
export function getZoneAt(layout, position) {
  if (!layout || !layout.zones) return null;
  const [px, py] = position ?? [0, 0];

  return (
    layout.zones.find(
      (z) =>
        px >= z.area.x[0] &&
        px <= z.area.x[1] &&
        py >= z.area.y[0] &&
        py <= z.area.y[1]
    ) ?? null
  );
}

// --- Helper functions ---

/**
 * Describe relative position of a target from the bot's perspective.
 */
function describeRelativePosition(selfPos, targetCenter, maxGrid) {
  const [sx, sy] = selfPos;
  const [tx, ty] = targetCenter;
  const dx = tx - sx;
  const dy = ty - sy;
  const dist = Math.max(Math.abs(dx), Math.abs(dy));

  if (dist < maxGrid * 0.08) return "nearby";

  const parts = [];
  if (dy < -maxGrid * 0.1) parts.push("north");
  else if (dy > maxGrid * 0.1) parts.push("south");
  if (dx < -maxGrid * 0.1) parts.push("west");
  else if (dx > maxGrid * 0.1) parts.push("east");

  if (parts.length === 0) return "nearby";
  return parts.join("-");
}

/**
 * Describe which quadrant a position falls in.
 */
function describeQuadrant(center, maxGrid) {
  const [cx, cy] = center;
  const mid = maxGrid / 2;
  const ns = cy < mid ? "N" : "S";
  const ew = cx < mid ? "W" : "E";
  if (Math.abs(cx - mid) < maxGrid * 0.15 && Math.abs(cy - mid) < maxGrid * 0.15) {
    return "center";
  }
  return ns + ew;
}

/**
 * Find the nearest landmark and describe the bot's position relative to it.
 */
function findNearestLandmark(pos, landmarks) {
  if (!landmarks || landmarks.length === 0) return null;

  let minDist = Infinity;
  let nearest = null;

  for (const lm of landmarks) {
    const [lx, ly] = lm.gridCenter;
    const dist = Math.max(Math.abs(pos[0] - lx), Math.abs(pos[1] - ly));
    if (dist < minDist) {
      minDist = dist;
      nearest = lm;
    }
  }

  if (!nearest) return null;
  if (minDist < 10) return `near the ${nearest.name}`;
  return `near the ${nearest.name} (${describeRelativePosition(pos, nearest.gridCenter, 300)})`;
}
