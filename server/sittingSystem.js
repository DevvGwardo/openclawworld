// Sitting system — seat tracking and spot computation
// Extracted from index.js
// unsitCharacter accepts a broadcastFn instead of capturing io from closure

export const DEFAULT_SIT_FACING_OFFSET = Math.PI;

export const ensureSeatMaps = (room) => {
  if (!(room.seatOccupancy instanceof Map)) room.seatOccupancy = new Map();
  if (!(room.characterSeats instanceof Map)) room.characterSeats = new Map();
};

export const normalizeAngle = (a) => {
  const twoPi = Math.PI * 2;
  let x = a % twoPi;
  if (x <= -Math.PI) x += twoPi;
  else if (x > Math.PI) x -= twoPi;
  return x;
};

export const getSitSpots = (room, item, sittable, facingOffset = DEFAULT_SIT_FACING_OFFSET) => {
  const rot = item.rotation || 0;
  const w = rot === 1 || rot === 3 ? item.size[1] : item.size[0];
  const h = rot === 1 || rot === 3 ? item.size[0] : item.size[1];
  const gx = item.gridPosition[0];
  const gy = item.gridPosition[1];
  const maxX = room.size[0] * room.gridDivision - 1;
  const maxY = room.size[1] * room.gridDivision - 1;
  const seatHeight = sittable.seatHeight;

  const spots = [];
  let seatIdx = 0;

  // Front edge (gy + h side)
  for (let x = 0; x < w; x++) {
    const adjX = gx + x;
    const adjY = gy + h;
    const seatX = gx + x;
    const seatY = gy + h - 1;
    const faceRot = normalizeAngle(0 + facingOffset);
    if (adjY <= maxY) {
      spots.push({ walkTo: [adjX, adjY], seatPos: [seatX, seatY], seatHeight, seatRotation: faceRot, seatIdx: seatIdx++ });
    }
  }
  // Back edge (gy - 1 side)
  for (let x = 0; x < w; x++) {
    const adjX = gx + x;
    const adjY = gy - 1;
    const seatX = gx + x;
    const seatY = gy;
    const faceRot = normalizeAngle(Math.PI + facingOffset);
    if (adjY >= 0) {
      spots.push({ walkTo: [adjX, adjY], seatPos: [seatX, seatY], seatHeight, seatRotation: faceRot, seatIdx: seatIdx++ });
    }
  }
  // Left edge (gx - 1 side)
  for (let y = 0; y < h; y++) {
    const adjX = gx - 1;
    const adjY = gy + y;
    const seatX = gx;
    const seatY = gy + y;
    const faceRot = normalizeAngle(-Math.PI / 2 + facingOffset);
    if (adjX >= 0) {
      spots.push({ walkTo: [adjX, adjY], seatPos: [seatX, seatY], seatHeight, seatRotation: faceRot, seatIdx: seatIdx++ });
    }
  }
  // Right edge (gx + w side)
  for (let y = 0; y < h; y++) {
    const adjX = gx + w;
    const adjY = gy + y;
    const seatX = gx + w - 1;
    const seatY = gy + y;
    const faceRot = normalizeAngle(Math.PI / 2 + facingOffset);
    if (adjX <= maxX) {
      spots.push({ walkTo: [adjX, adjY], seatPos: [seatX, seatY], seatHeight, seatRotation: faceRot, seatIdx: seatIdx++ });
    }
  }

  return spots;
};

export const unsitCharacter = (room, characterId, broadcastFn) => {
  if (!room) return;
  ensureSeatMaps(room);
  const seatInfo = room.characterSeats.get(characterId);
  if (!seatInfo) return;
  room.seatOccupancy.delete(`${seatInfo.itemIndex}-${seatInfo.seatIdx}`);
  room.characterSeats.delete(characterId);
  if (broadcastFn) broadcastFn(room.id, "playerUnsit", { id: characterId });
};
