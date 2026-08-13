/**
 * Temporary canvas layouts.
 *
 * These positions are a *view* — they are never written to the database. The
 * canvas interpolates between a track's stored position and its arranged one,
 * so releasing the set restores exactly where you had put everything.
 */

import { NODE_H, NODE_W } from '../components/TrackNode';
import type { Track } from '../types';

export type Positions = Map<number, { x: number; y: number }>;

type Options = {
  /** Tracks per row before wrapping. */
  perRow?: number;
  gapX?: number;
  gapY?: number;
  /** Round to this grid so the arrangement lines up with the dots. */
  grid?: number;
};

/**
 * Lay a setlist out as a readable chain: left to right, wrapping in a serpentine
 * so the last track of one row sits directly above the first of the next and
 * consecutive tracks are always neighbours.
 *
 * The block is centred on the members' existing centre of mass, so the nodes
 * travel the shortest distance to get into formation.
 */
export function arrangeChain(members: Track[], options: Options = {}): Positions {
  const { perRow = 4, gapX = 96, gapY = 104, grid = 24 } = options;
  const positions: Positions = new Map();
  if (!members.length) return positions;

  const stepX = NODE_W + gapX;
  const stepY = NODE_H + gapY;
  const columns = Math.min(perRow, members.length);
  const rows = Math.ceil(members.length / perRow);

  const raw = members.map((_, i) => {
    const row = Math.floor(i / perRow);
    const indexInRow = i % perRow;
    // Odd rows run right-to-left so the chain never jumps across the canvas.
    const column = row % 2 === 0 ? indexInRow : perRow - 1 - indexInRow;
    return { x: column * stepX, y: row * stepY };
  });

  // Centre the formation on where these tracks already are.
  const width = (columns - 1) * stepX;
  const height = (rows - 1) * stepY;
  const centreX = members.reduce((sum, t) => sum + t.x, 0) / members.length;
  const centreY = members.reduce((sum, t) => sum + t.y, 0) / members.length;
  const originX = centreX - width / 2;
  const originY = centreY - height / 2;

  const snap = (v: number) => Math.round(v / grid) * grid;

  members.forEach((track, i) => {
    positions.set(track.id, {
      x: snap(originX + raw[i].x),
      y: snap(originY + raw[i].y),
    });
  });

  return positions;
}
