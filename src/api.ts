/**
 * The single boundary between the app and the database.
 *
 * Everything above this line — state.ts, lib/, every component — reaches the
 * SQLite file through `window.djtree`, which the preload script exposes and the
 * main process backs with the validating functions in electron/repo.js. There
 * is no server, no account, and nothing to configure.
 */

import type {
  Graph, ImportRow, ImportResult, ScanResult, Setlist, Track, TrackDraft, Transition,
  TransitionPatch,
} from './types';

/** What preload.cjs puts on the window. */
type Bridge = {
  graph: () => Promise<Graph>;
  createTrack: (draft: TrackDraft) => Promise<Track>;
  updateTrack: (id: number, patch: Partial<TrackDraft>) => Promise<Track>;
  savePositions: (positions: { id: number; x: number; y: number }[]) => Promise<{ ok: true }>;
  deleteTrack: (id: number) => Promise<{ ok: true }>;
  createTransition: (
    from_id: number, to_id: number, details?: TransitionPatch,
  ) => Promise<Transition>;
  updateTransition: (id: number, patch: TransitionPatch) => Promise<Transition>;
  deleteTransition: (id: number) => Promise<{ ok: true }>;
  createSetlist: (name: string, track_ids: number[], notes?: string) => Promise<Setlist>;
  updateSetlist: (
    id: number,
    patch: { name?: string; notes?: string; track_ids?: number[] },
  ) => Promise<Setlist>;
  deleteSetlist: (id: number) => Promise<{ ok: true }>;
  saveSetlistPositions: (
    id: number,
    positions: { track_id: number; x: number | null; y: number | null }[],
  ) => Promise<Setlist>;
  resetSetlistPositions: (id: number) => Promise<Setlist>;
  restore: (
    tracks: Track[], transitions: Transition[], setlists?: Setlist[],
  ) => Promise<{ ok: true }>;
  importTracks: (rows: ImportRow[]) => Promise<ImportResult>;
  chooseFolder: () => Promise<ScanResult | null>;
  revealLibrary: () => Promise<{ ok: true }>;
  paths: () => Promise<{ libraryDir: string; dbPath: string }>;
  onMenu: (handler: (action: string) => void) => () => void;
};

declare global {
  interface Window { djtree?: Bridge }
}

/**
 * Opening the built page in a plain browser gives a window with no bridge.
 * Saying so plainly beats a hundred "cannot read property of undefined".
 */
function bridge(): Bridge {
  const found = window.djtree;
  if (!found) {
    throw new Error('djtree has to run as the desktop app — this page has no database behind it.');
  }
  return found;
}

export const api = {
  graph: () => bridge().graph(),
  createTrack: (draft: TrackDraft) => bridge().createTrack(draft),
  updateTrack: (id: number, patch: Partial<TrackDraft>) => bridge().updateTrack(id, patch),
  savePositions: (positions: { id: number; x: number; y: number }[]) =>
    bridge().savePositions(positions),
  deleteTrack: (id: number) => bridge().deleteTrack(id),
  createTransition: (from_id: number, to_id: number, details: TransitionPatch = {}) =>
    bridge().createTransition(from_id, to_id, details),
  updateTransition: (id: number, patch: TransitionPatch) => bridge().updateTransition(id, patch),
  deleteTransition: (id: number) => bridge().deleteTransition(id),
  createSetlist: (name: string, track_ids: number[], notes = '') =>
    bridge().createSetlist(name, track_ids, notes),
  updateSetlist: (id: number, patch: { name?: string; notes?: string; track_ids?: number[] }) =>
    bridge().updateSetlist(id, patch),
  deleteSetlist: (id: number) => bridge().deleteSetlist(id),
  saveSetlistPositions: (
    id: number,
    positions: { track_id: number; x: number | null; y: number | null }[],
  ) => bridge().saveSetlistPositions(id, positions),
  resetSetlistPositions: (id: number) => bridge().resetSetlistPositions(id),
  restore: (tracks: Track[], transitions: Transition[], setlists: Setlist[] = []) =>
    bridge().restore(tracks, transitions, setlists),
  importTracks: (rows: ImportRow[]) => bridge().importTracks(rows),
  chooseFolder: () => bridge().chooseFolder(),
  revealLibrary: () => bridge().revealLibrary(),
  onMenu: (handler: (action: string) => void) => bridge().onMenu(handler),
};

export type Api = typeof api;
