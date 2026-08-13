/**
 * Whole-library export and import.
 *
 * Two jobs. It is the migration path between the local SQLite build and the
 * hosted one, and it is the backup story in cloud mode — Supabase's free tier
 * has no automatic backups, so this replaces the on-start snapshots the local
 * server makes.
 *
 * Ids are deliberately *not* preserved on import: the target may already be
 * using them. Everything is remapped, which keeps an import safe to run against
 * a library that already has content.
 */

import { api } from '../api';
import type { Graph, Setlist, Track, Transition } from '../types';

const FORMAT = 'djtree.library';
const VERSION = 1;

export type Bundle = {
  format: typeof FORMAT;
  version: number;
  exported_at: string;
  tracks: Track[];
  transitions: Transition[];
  setlists: Setlist[];
};

export function toBundle(graph: Graph): Bundle {
  return {
    format: FORMAT,
    version: VERSION,
    exported_at: new Date().toISOString(),
    tracks: graph.tracks,
    transitions: graph.transitions,
    setlists: graph.setlists,
  };
}

export function download(bundle: Bundle) {
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `djtree-${bundle.exported_at.slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function parseBundle(text: string): Bundle {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  const b = raw as Partial<Bundle>;
  if (b.format !== FORMAT) throw new Error("That doesn't look like a djtree export.");
  if (typeof b.version !== 'number' || b.version > VERSION) {
    throw new Error(`That export is version ${b.version}; this build reads up to ${VERSION}.`);
  }
  if (!Array.isArray(b.tracks)) throw new Error('That export has no tracks in it.');
  return {
    format: FORMAT,
    version: b.version,
    exported_at: typeof b.exported_at === 'string' ? b.exported_at : '',
    tracks: b.tracks,
    transitions: Array.isArray(b.transitions) ? b.transitions : [],
    setlists: Array.isArray(b.setlists) ? b.setlists : [],
  };
}

export type ImportResult = { tracks: number; transitions: number; setlists: number; skipped: number };

/**
 * Adds a bundle's contents to whichever backend is live, remapping every id.
 * Additive: nothing already in the library is modified or removed.
 */
export async function importBundle(bundle: Bundle): Promise<ImportResult> {
  const idMap = new Map<number, number>();
  let skipped = 0;

  for (const t of bundle.tracks) {
    const created = await api.createTrack({
      title: t.title,
      artist: t.artist ?? '',
      bpm: t.bpm,
      music_key: t.music_key ?? null,
      energy: t.energy ?? null,
      genre: t.genre ?? '',
      notes: t.notes ?? '',
      favorite: t.favorite ?? 0,
      x: t.x ?? 0,
      y: t.y ?? 0,
    });
    idMap.set(t.id, created.id);
  }

  let transitions = 0;
  for (const tr of bundle.transitions) {
    const from = idMap.get(tr.from_id);
    const to = idMap.get(tr.to_id);
    if (from === undefined || to === undefined) { skipped++; continue; }
    // Cue points and bars only exist in exports taken after links started
    // asking for them; older bundles carry none, and stay that way.
    await api.createTransition(from, to, {
      label: tr.label ?? '',
      rating: tr.rating ?? null,
      notes: tr.notes ?? '',
      from_cue: tr.from_cue ?? null,
      to_cue: tr.to_cue ?? null,
      bars: tr.bars ?? null,
    });
    transitions++;
  }

  let setlists = 0;
  for (const list of bundle.setlists) {
    const ids = (list.track_ids ?? [])
      .map((id) => idMap.get(id))
      .filter((id): id is number => id !== undefined);
    if (!ids.length) { skipped++; continue; }

    const created = await api.createSetlist(list.name, ids, list.notes ?? '');
    const overrides = (list.positions ?? [])
      .map((p) => {
        const mapped = idMap.get(p.track_id);
        return mapped === undefined ? null : { track_id: mapped, x: p.x, y: p.y };
      })
      .filter((p): p is { track_id: number; x: number; y: number } => p !== null);
    if (overrides.length) await api.saveSetlistPositions(created.id, overrides);
    setlists++;
  }

  return { tracks: idMap.size, transitions, setlists, skipped };
}
