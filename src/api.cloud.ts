/**
 * Cloud backend: Supabase Postgres, spoken to directly from the browser.
 *
 * There is no server of ours in this path. Safety comes from row level security
 * — every table's policy is `auth.uid() = user_id`, so the database itself
 * refuses to return or accept another account's rows. `user_id` defaults to
 * `auth.uid()` in the schema, which is why no insert here sets it: the client
 * cannot claim to be someone else.
 *
 * Multi-row rewrites (reordering a set, undo's restore) go through Postgres
 * functions so they stay atomic, matching the transactions the local backend uses.
 */

import { client } from './supabase';
import type {
  Graph, Setlist, Track, TrackDraft, Transition, TransitionPatch,
} from './types';

const TRACK_COLUMNS =
  'id, title, artist, bpm, music_key, energy, genre, notes, favorite, x, y, created_at';
const TRANSITION_COLUMNS =
  'id, from_id, to_id, label, rating, notes, from_cue, to_cue, bars, created_at';

/** Postgres unique-violation. Used to make linking idempotent. */
const UNIQUE_VIOLATION = '23505';

function fail(context: string, error: { message: string } | null): never {
  throw new Error(`${context}: ${error?.message ?? 'unknown error'}`);
}

type RawSetlist = {
  id: number;
  name: string;
  notes: string;
  created_at: string;
  setlist_items: { track_id: number; position: number; x: number | null; y: number | null }[];
};

/** Flattens the joined items into the ordered ids + sparse overrides the app expects. */
function shapeSetlist(row: RawSetlist): Setlist {
  const items = [...(row.setlist_items ?? [])].sort((a, b) => a.position - b.position);
  return {
    id: row.id,
    name: row.name,
    notes: row.notes,
    created_at: row.created_at,
    track_ids: items.map((i) => i.track_id),
    positions: items
      .filter((i) => i.x !== null && i.y !== null)
      .map((i) => ({ track_id: i.track_id, x: i.x as number, y: i.y as number })),
  };
}

const SETLIST_SELECT = `id, name, notes, created_at,
  setlist_items ( track_id, position, x, y )`;

async function readSetlist(id: number): Promise<Setlist> {
  const { data, error } = await client()
    .from('setlists')
    .select(SETLIST_SELECT)
    .eq('id', id)
    .single();
  if (error) fail('load setlist', error);
  return shapeSetlist(data as unknown as RawSetlist);
}

export const cloudApi = {
  async graph(): Promise<Graph> {
    const db = client();
    const [tracks, transitions, setlists] = await Promise.all([
      db.from('tracks').select(TRACK_COLUMNS).order('id'),
      db.from('transitions').select(TRANSITION_COLUMNS).order('id'),
      db.from('setlists').select(SETLIST_SELECT).order('id'),
    ]);
    if (tracks.error) fail('load tracks', tracks.error);
    if (transitions.error) fail('load transitions', transitions.error);
    if (setlists.error) fail('load setlists', setlists.error);

    return {
      tracks: (tracks.data ?? []) as Track[],
      transitions: (transitions.data ?? []) as Transition[],
      setlists: ((setlists.data ?? []) as unknown as RawSetlist[]).map(shapeSetlist),
    };
  },

  async createTrack(draft: TrackDraft): Promise<Track> {
    const { data, error } = await client()
      .from('tracks')
      .insert({ ...draft, favorite: draft.favorite ?? 0 })
      .select(TRACK_COLUMNS)
      .single();
    if (error) fail('add track', error);
    return data as Track;
  },

  async updateTrack(id: number, patch: Partial<TrackDraft>): Promise<Track> {
    const { data, error } = await client()
      .from('tracks')
      .update(patch)
      .eq('id', id)
      .select(TRACK_COLUMNS)
      .single();
    if (error) fail('save track', error);
    return data as Track;
  },

  async savePositions(positions: { id: number; x: number; y: number }[]) {
    // One statement per node, but a drag only ever commits a single node.
    const db = client();
    for (const p of positions) {
      const { error } = await db.from('tracks').update({ x: p.x, y: p.y }).eq('id', p.id);
      if (error) fail('save position', error);
    }
    return { ok: true } as const;
  },

  async deleteTrack(id: number) {
    const { error } = await client().from('tracks').delete().eq('id', id);
    if (error) fail('delete track', error);
    return { ok: true } as const;
  },

  async createTransition(
    from_id: number,
    to_id: number,
    details: TransitionPatch = {},
  ): Promise<Transition> {
    const db = client();
    const { data, error } = await db
      .from('transitions')
      .insert({ label: '', ...details, from_id, to_id })
      .select(TRANSITION_COLUMNS)
      .single();

    // Linking an already-linked pair is a no-op, not an error.
    if (error?.code === UNIQUE_VIOLATION) {
      const existing = await db
        .from('transitions')
        .select(TRANSITION_COLUMNS)
        .eq('from_id', from_id)
        .eq('to_id', to_id)
        .single();
      if (existing.error) fail('link tracks', existing.error);
      return existing.data as Transition;
    }
    if (error) fail('link tracks', error);
    return data as Transition;
  },

  async updateTransition(id: number, patch: TransitionPatch): Promise<Transition> {
    const { data, error } = await client()
      .from('transitions')
      .update(patch)
      .eq('id', id)
      .select(TRANSITION_COLUMNS)
      .single();
    if (error) fail('save transition', error);
    return data as Transition;
  },

  async deleteTransition(id: number) {
    const { error } = await client().from('transitions').delete().eq('id', id);
    if (error) fail('unlink transition', error);
    return { ok: true } as const;
  },

  async createSetlist(name: string, track_ids: number[], notes = ''): Promise<Setlist> {
    const db = client();
    const created = await db.from('setlists').insert({ name, notes }).select('id').single();
    if (created.error) fail('create set', created.error);

    const id = (created.data as { id: number }).id;
    const { error } = await db.rpc('set_setlist_tracks', {
      p_setlist_id: id,
      p_track_ids: track_ids,
    });
    if (error) fail('save set contents', error);
    return readSetlist(id);
  },

  async updateSetlist(
    id: number,
    patch: { name?: string; notes?: string; track_ids?: number[] },
  ): Promise<Setlist> {
    const db = client();
    const fields: Record<string, unknown> = {};
    if ('name' in patch) fields.name = patch.name;
    if ('notes' in patch) fields.notes = patch.notes;

    if (Object.keys(fields).length) {
      const { error } = await db.from('setlists').update(fields).eq('id', id);
      if (error) fail('save set', error);
    }
    if (patch.track_ids) {
      // Atomic in Postgres, and preserves per-set positions for surviving tracks.
      const { error } = await db.rpc('set_setlist_tracks', {
        p_setlist_id: id,
        p_track_ids: patch.track_ids,
      });
      if (error) fail('save set order', error);
    }
    return readSetlist(id);
  },

  async deleteSetlist(id: number) {
    const { error } = await client().from('setlists').delete().eq('id', id);
    if (error) fail('delete set', error);
    return { ok: true } as const;
  },

  async saveSetlistPositions(
    id: number,
    positions: { track_id: number; x: number | null; y: number | null }[],
  ): Promise<Setlist> {
    const db = client();
    for (const p of positions) {
      const { error } = await db
        .from('setlist_items')
        .update({ x: p.x, y: p.y })
        .eq('setlist_id', id)
        .eq('track_id', p.track_id);
      if (error) fail('save set layout', error);
    }
    return readSetlist(id);
  },

  async resetSetlistPositions(id: number): Promise<Setlist> {
    const { error } = await client()
      .from('setlist_items')
      .update({ x: null, y: null })
      .eq('setlist_id', id);
    if (error) fail('reset set layout', error);
    return readSetlist(id);
  },

  async restore(tracks: Track[], transitions: Transition[], setlists: Setlist[] = []) {
    const { error } = await client().rpc('restore_rows', {
      p_tracks: tracks,
      p_transitions: transitions,
      p_setlists: setlists,
    });
    if (error) fail('undo', error);
    return { ok: true } as const;
  },
};
