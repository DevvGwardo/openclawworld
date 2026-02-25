// Pathfinding utilities — A*, grid management
// Extracted from index.js — pure functions reading room.grid

import pathfindingLib from "pathfinding";
import { getBuildingFootprints } from "./shared/roomConstants.js";

const finder = new pathfindingLib.AStarFinder({
  allowDiagonal: true,
  dontCrossCorners: true,
});

export const findPath = (room, start, end) => {
  const maxX = room.size[0] * room.gridDivision - 1;
  const maxY = room.size[1] * room.gridDivision - 1;
  const clamp = (v, max) => Math.max(0, Math.min(max, Math.round(v)));
  const s = [clamp(start[0], maxX), clamp(start[1], maxY)];
  const e = [clamp(end[0], maxX), clamp(end[1], maxY)];
  const gridClone = room.grid.clone();
  const path = finder.findPath(s[0], s[1], e[0], e[1], gridClone);
  return pathfindingLib.Util.compressPath(path);
};

export const markItemOnGrid = (room, item, walkable) => {
  if (item.walkable || item.wall) return;
  const w = item.rotation === 1 || item.rotation === 3 ? item.size[1] : item.size[0];
  const h = item.rotation === 1 || item.rotation === 3 ? item.size[0] : item.size[1];
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      room.grid.setWalkableAt(item.gridPosition[0] + x, item.gridPosition[1] + y, walkable);
    }
  }
};

export const updateGrid = (room) => {
  for (let x = 0; x < room.size[0] * room.gridDivision; x++) {
    for (let y = 0; y < room.size[1] * room.gridDivision; y++) {
      room.grid.setWalkableAt(x, y, true);
    }
  }
  room.items.forEach((item) => {
    markItemOnGrid(room, item, false);
  });
  if (room.size[0] > 30) {
    const footprints = getBuildingFootprints(room.size);
    const gd = room.gridDivision;
    const maxX = room.size[0] * gd;
    const maxZ = room.size[1] * gd;
    footprints.forEach((fp) => {
      const startX = Math.max(0, Math.floor(fp.x * gd));
      const startZ = Math.max(0, Math.floor(fp.z * gd));
      const endX = Math.min(maxX - 1, Math.floor((fp.x + fp.w) * gd));
      const endZ = Math.min(maxZ - 1, Math.floor((fp.z + fp.d) * gd));
      for (let gx = startX; gx <= endX; gx++) {
        for (let gz = startZ; gz <= endZ; gz++) {
          room.grid.setWalkableAt(gx, gz, false);
        }
      }
    });
  }
};

export const addItemToGrid = (room, item) => {
  markItemOnGrid(room, item, false);
};

export const removeItemFromGrid = (room, item) => {
  markItemOnGrid(room, item, true);
  room.items.forEach((other) => {
    if (other === item || other.walkable || other.wall) return;
    const ow = other.rotation === 1 || other.rotation === 3 ? other.size[1] : other.size[0];
    const oh = other.rotation === 1 || other.rotation === 3 ? other.size[0] : other.size[1];
    const iw = item.rotation === 1 || item.rotation === 3 ? item.size[1] : item.size[0];
    const ih = item.rotation === 1 || item.rotation === 3 ? item.size[0] : item.size[1];
    if (
      other.gridPosition[0] < item.gridPosition[0] + iw &&
      other.gridPosition[0] + ow > item.gridPosition[0] &&
      other.gridPosition[1] < item.gridPosition[1] + ih &&
      other.gridPosition[1] + oh > item.gridPosition[1]
    ) {
      markItemOnGrid(room, other, false);
    }
  });
};
