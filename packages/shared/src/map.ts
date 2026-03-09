import type { Vec2, Storage, Jail, Obstacle } from './types.js';
import { COINS_PER_STORAGE } from './constants.js';

export const STORAGE_POSITIONS: Vec2[] = [
  { x: 480, y: 360 },
  { x: 1920, y: 360 },
  { x: 2160, y: 1200 },
  { x: 1920, y: 2040 },
  { x: 480, y: 2040 },
  { x: 240, y: 1200 },
];

export function createStorages(): Storage[] {
  return STORAGE_POSITIONS.map((pos, i) => ({
    id: `storage_${i}`,
    position: pos,
    radius: 70,
    totalCoins: COINS_PER_STORAGE,
    remainingCoins: COINS_PER_STORAGE,
  }));
}

export const COP_SPAWNS: Vec2[] = [
  { x: 1200, y: 1100 },
  { x: 1200, y: 1300 },
];

export const THIEF_SPAWNS: Vec2[] = [
  { x: 240, y: 240 },
  { x: 2160, y: 240 },
  { x: 2160, y: 2160 },
  { x: 240, y: 2160 },
];

export const JAIL_CONFIG: Jail = {
  position: { x: 1200, y: 1200 },
  radius: 250,
  inmates: [],
};

export const OBSTACLES: Obstacle[] = [
  // ============================================================
  // Storage rooms: U-shaped enclosures (3 walls, 1 open entrance)
  // Opening faces AWAY from center so cops can't see in from jail
  // Interior ~160x160, wall thickness 20
  // ============================================================

  // Storage 0 (480,360) - open UP (toward map edge)
  { id: 'r0_l', position: { x: 380, y: 260 }, width: 20, height: 200 },
  { id: 'r0_r', position: { x: 560, y: 260 }, width: 20, height: 200 },
  { id: 'r0_b', position: { x: 380, y: 440 }, width: 200, height: 20 },

  // Storage 1 (1920,360) - open UP
  { id: 'r1_l', position: { x: 1820, y: 260 }, width: 20, height: 200 },
  { id: 'r1_r', position: { x: 2000, y: 260 }, width: 20, height: 200 },
  { id: 'r1_b', position: { x: 1820, y: 440 }, width: 200, height: 20 },

  // Storage 2 (2160,1200) - open RIGHT
  { id: 'r2_t', position: { x: 2060, y: 1100 }, width: 200, height: 20 },
  { id: 'r2_l', position: { x: 2060, y: 1100 }, width: 20, height: 200 },
  { id: 'r2_b', position: { x: 2060, y: 1280 }, width: 200, height: 20 },

  // Storage 3 (1920,2040) - open DOWN
  { id: 'r3_t', position: { x: 1820, y: 1940 }, width: 200, height: 20 },
  { id: 'r3_l', position: { x: 1820, y: 1940 }, width: 20, height: 200 },
  { id: 'r3_r', position: { x: 2000, y: 1940 }, width: 20, height: 200 },

  // Storage 4 (480,2040) - open DOWN
  { id: 'r4_t', position: { x: 380, y: 1940 }, width: 200, height: 20 },
  { id: 'r4_l', position: { x: 380, y: 1940 }, width: 20, height: 200 },
  { id: 'r4_r', position: { x: 560, y: 1940 }, width: 20, height: 200 },

  // Storage 5 (240,1200) - open LEFT
  { id: 'r5_t', position: { x: 140, y: 1100 }, width: 200, height: 20 },
  { id: 'r5_r', position: { x: 320, y: 1100 }, width: 20, height: 200 },
  { id: 'r5_b', position: { x: 140, y: 1280 }, width: 200, height: 20 },

];
