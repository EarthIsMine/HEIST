import type { Player, Phase, Obstacle, Vec2 } from '@heist/shared';
import { MAP_WIDTH, MAP_HEIGHT, PLAYER_RADIUS, PLAYER_SPEED, STEAL_MOVE_SPEED_MULTIPLIER } from '@heist/shared';

export function updatePlayerMovement(player: Player, dt: number, phase: Phase): void {
  if (player.isJailed) return;
  if (player.isStunned) return;
  // break_jail requires standing still; steal allows slow movement
  if (player.channeling === 'break_jail') return;

  // During head_start, cops can't move
  if (phase === 'head_start' && player.team === 'cop') return;

  const dir = player.velocity;
  if (dir.x === 0 && dir.y === 0) return;

  // Normalize
  const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y);
  if (len === 0) return;

  const nx = dir.x / len;
  const ny = dir.y / len;

  const speed = player.channeling === 'steal'
    ? PLAYER_SPEED * STEAL_MOVE_SPEED_MULTIPLIER
    : PLAYER_SPEED;

  player.position.x += nx * speed * dt;
  player.position.y += ny * speed * dt;

  // Clamp to map bounds
  player.position.x = Math.max(
    PLAYER_RADIUS,
    Math.min(MAP_WIDTH - PLAYER_RADIUS, player.position.x),
  );
  player.position.y = Math.max(
    PLAYER_RADIUS,
    Math.min(MAP_HEIGHT - PLAYER_RADIUS, player.position.y),
  );
}

export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function resolveObstacleCollision(player: Player, obstacles: Obstacle[]): void {
  for (const obs of obstacles) {
    const closestX = Math.max(obs.position.x, Math.min(player.position.x, obs.position.x + obs.width));
    const closestY = Math.max(obs.position.y, Math.min(player.position.y, obs.position.y + obs.height));

    const dx = player.position.x - closestX;
    const dy = player.position.y - closestY;
    const distSq = dx * dx + dy * dy;

    if (distSq < PLAYER_RADIUS * PLAYER_RADIUS && distSq > 0) {
      const dist = Math.sqrt(distSq);
      const overlap = PLAYER_RADIUS - dist;
      player.position.x += (dx / dist) * overlap;
      player.position.y += (dy / dist) * overlap;
    }
  }
}

export function hasLineOfSight(from: Vec2, to: Vec2, obstacles: Obstacle[]): boolean {
  for (const obs of obstacles) {
    if (lineIntersectsRect(from, to, obs)) return false;
  }
  return true;
}

function lineIntersectsRect(from: Vec2, to: Vec2, obs: Obstacle): boolean {
  const left = obs.position.x;
  const right = obs.position.x + obs.width;
  const top = obs.position.y;
  const bottom = obs.position.y + obs.height;

  return (
    segmentsIntersect(from, to, { x: left, y: top }, { x: right, y: top }) ||
    segmentsIntersect(from, to, { x: right, y: top }, { x: right, y: bottom }) ||
    segmentsIntersect(from, to, { x: right, y: bottom }, { x: left, y: bottom }) ||
    segmentsIntersect(from, to, { x: left, y: bottom }, { x: left, y: top })
  );
}

function segmentsIntersect(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  return false;
}

function cross(a: Vec2, b: Vec2, c: Vec2): number {
  return (c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x);
}
