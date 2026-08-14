/**
 * Turning scanned files into tracks.
 *
 * The scanner hands back whatever the tags said. This is where those strings
 * meet the app's own rules — the same Camelot parser the track form uses, the
 * same genre normalizer the dropdown uses — so an imported track is
 * indistinguishable from one typed in by hand.
 *
 * A file with no readable BPM is not imported. Every score in the app is built
 * on tempo, so a made-up number would not be a small inaccuracy; it would be a
 * track that lies about what it mixes into. Those come back as `skipped` for
 * the caller to report.
 */

import { parseKey } from './camelot';
import { normalizeGenre } from './genres';
import type { ImportRow, ScannedFile } from '../types';

export type PreparedImport = {
  rows: ImportRow[];
  /** Files that carried no usable BPM tag, in the order they were found. */
  skipped: ScannedFile[];
};

export type GridSpec = {
  /** Top-left corner for the first new node, in canvas coordinates. */
  origin: { x: number; y: number };
  /** Node size plus the gap you want between them. */
  step: { x: number; y: number };
  /** How many per row before wrapping. */
  columns: number;
};

/**
 * Lay the newcomers out in a block rather than stacking them all at one point.
 * Nothing is auto-arranged after this — where a track lands is where it stays
 * until you drag it.
 */
export function prepareImport(files: ScannedFile[], grid: GridSpec): PreparedImport {
  const rows: ImportRow[] = [];
  const skipped: ScannedFile[] = [];

  for (const file of files) {
    if (file.bpm == null) {
      skipped.push(file);
      continue;
    }

    const index = rows.length;
    rows.push({
      file_path: file.file_path,
      title: file.title.trim() || 'Untitled',
      artist: file.artist.trim(),
      bpm: file.bpm,
      // parseKey understands both notations, so "8A" and "Abm" land identically.
      music_key: file.music_key ? parseKey(file.music_key) : null,
      genre: normalizeGenre(file.genre ?? ''),
      x: grid.origin.x + (index % grid.columns) * grid.step.x,
      y: grid.origin.y + Math.floor(index / grid.columns) * grid.step.y,
    });
  }

  return { rows, skipped };
}

/** One line summarising what an import did, for the status toast. */
export function importSummary({
  added,
  updated,
  skipped,
  unreadable,
}: {
  added: number;
  updated: number;
  skipped: number;
  unreadable: number;
}): string {
  if (!added && !updated && !skipped && !unreadable) return 'Nothing to import — no audio files found.';

  const parts: string[] = [];
  if (added) parts.push(`${added} track${added === 1 ? '' : 's'} added`);
  if (updated) parts.push(`${updated} already here, refreshed`);
  if (!added && !updated) parts.push('nothing new');
  if (skipped) parts.push(`${skipped} skipped (no BPM tag)`);
  if (unreadable) parts.push(`${unreadable} unreadable`);
  return parts.join(' · ');
}
