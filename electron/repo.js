/**
 * Every data operation the app can perform, as plain functions.
 *
 * These used to be Express routes; the desktop build calls them over IPC
 * instead, so the validation stays exactly where it was — at the boundary,
 * before anything reaches SQL. The renderer is still treated as untrusted
 * input, because a bug there should not be able to write a malformed row.
 */

import { db, plain } from './db.js';

class BadRequest extends Error {}

const CAMELOT = /^(?:[1-9]|1[0-2])[AB]$/;

const str = (v, field, { max = 500, required = false } = {}) => {
  if (v === undefined || v === null) {
    if (required) throw new BadRequest(`${field} is required`);
    return '';
  }
  if (typeof v !== 'string') throw new BadRequest(`${field} must be a string`);
  const trimmed = v.trim();
  if (required && !trimmed) throw new BadRequest(`${field} is required`);
  if (trimmed.length > max) throw new BadRequest(`${field} is too long`);
  return trimmed;
};

const bpm = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 20 || n > 400) {
    throw new BadRequest('bpm must be a number between 20 and 400');
  }
  return Math.round(n * 100) / 100;
};

const key = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const k = String(v).trim().toUpperCase();
  if (!CAMELOT.test(k)) throw new BadRequest(`invalid Camelot key: ${v}`);
  return k;
};

const intInRange = (v, field, lo, hi) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) {
    throw new BadRequest(`${field} must be an integer between ${lo} and ${hi}`);
  }
  return n;
};

/** A cue point in whole seconds. Null means "not recorded". */
const cue = (v, field) => intInRange(v, field, 0, 86400);

const flag = (v) => {
  if (v === undefined || v === null || v === '') return 0;
  if (v === true || v === 1 || v === '1' || v === 'true') return 1;
  if (v === false || v === 0 || v === '0' || v === 'false') return 0;
  throw new BadRequest('favorite must be true or false');
};

const coord = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new BadRequest('x/y must be finite numbers');
  // Keep the canvas from being sent to infinity by a bad drag.
  return Math.max(-1e6, Math.min(1e6, n));
};

const id = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new BadRequest('invalid id');
  return n;
};

const path = (v) => {
  if (v === undefined || v === null || v === '') return null;
  return str(v, 'file_path', { max: 1024 });
};

const getTrack = (trackId) =>
  plain(db.prepare('SELECT * FROM tracks WHERE id = ?').get(trackId));

const getTransition = (transitionId) =>
  plain(db.prepare('SELECT * FROM transitions WHERE id = ?').get(transitionId));

/** Runs `fn` inside a transaction, rolling back on any throw. */
function tx(fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/* --------------------------------------------------------------- setlists */

/** Setlists carry their ordered track ids inline — one round trip for the graph. */
function readSetlists() {
  const lists = db.prepare('SELECT * FROM setlists ORDER BY id').all().map(plain);
  const items = db
    .prepare('SELECT setlist_id, track_id, x, y FROM setlist_items ORDER BY setlist_id, position')
    .all();
  const order = new Map();
  const placed = new Map();
  for (const item of items) {
    if (order.has(item.setlist_id)) order.get(item.setlist_id).push(item.track_id);
    else order.set(item.setlist_id, [item.track_id]);
    if (item.x !== null && item.y !== null) {
      const list = placed.get(item.setlist_id) ?? [];
      list.push({ track_id: item.track_id, x: item.x, y: item.y });
      placed.set(item.setlist_id, list);
    }
  }
  return lists.map((l) => ({
    ...l,
    track_ids: order.get(l.id) ?? [],
    positions: placed.get(l.id) ?? [],
  }));
}

const oneSetlist = (setlistId) => readSetlists().find((l) => l.id === setlistId);

/**
 * Replaces a setlist's items wholesale, in order. Caller owns the transaction.
 * Any per-set positions already recorded for tracks that survive the rewrite are
 * carried over, so renaming or appending never discards a layout you arranged.
 */
function writeItems(setlistId, trackIds) {
  const kept = new Map(
    db
      .prepare('SELECT track_id, x, y FROM setlist_items WHERE setlist_id = ?')
      .all(setlistId)
      .filter((r) => r.x !== null && r.y !== null)
      .map((r) => [r.track_id, r]),
  );
  db.prepare('DELETE FROM setlist_items WHERE setlist_id = ?').run(setlistId);
  const insert = db.prepare(
    'INSERT INTO setlist_items (setlist_id, track_id, position, x, y) VALUES (?, ?, ?, ?, ?)',
  );
  trackIds.forEach((rawId, index) => {
    const trackId = id(rawId);
    const prior = kept.get(trackId);
    insert.run(setlistId, trackId, index, prior ? prior.x : null, prior ? prior.y : null);
  });
}

const trackIdList = (v) => {
  if (!Array.isArray(v)) throw new BadRequest('track_ids must be an array');
  if (v.length > 500) throw new BadRequest('a setlist is limited to 500 tracks');
  const ids = v.map(id);
  if (new Set(ids).size !== ids.length) {
    throw new BadRequest('a track cannot appear twice in one setlist');
  }
  const known = new Set(db.prepare('SELECT id FROM tracks').all().map((r) => r.id));
  for (const trackId of ids) {
    if (!known.has(trackId)) throw new BadRequest(`track ${trackId} does not exist`);
  }
  return ids;
};

/* ------------------------------------------------------------- operations */

export function graph() {
  return {
    tracks: db.prepare('SELECT * FROM tracks ORDER BY id').all().map(plain),
    transitions: db.prepare('SELECT * FROM transitions ORDER BY id').all().map(plain),
    setlists: readSetlists(),
  };
}

export function createTrack(draft = {}) {
  const info = db
    .prepare(`INSERT INTO tracks
                (title, artist, bpm, music_key, energy, genre, notes, favorite, x, y, file_path)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      str(draft.title, 'title', { max: 200, required: true }),
      str(draft.artist, 'artist', { max: 200 }),
      bpm(draft.bpm),
      key(draft.music_key),
      intInRange(draft.energy, 'energy', 1, 10),
      str(draft.genre, 'genre', { max: 80 }),
      str(draft.notes, 'notes', { max: 2000 }),
      flag(draft.favorite),
      coord(draft.x ?? 0),
      coord(draft.y ?? 0),
      path(draft.file_path),
    );
  return getTrack(Number(info.lastInsertRowid));
}

export function updateTrack(rawId, patch = {}) {
  const trackId = id(rawId);
  if (!getTrack(trackId)) throw new BadRequest('track not found');

  const sets = [];
  const args = [];
  const put = (col, value) => { sets.push(`${col} = ?`); args.push(value); };

  if ('title' in patch) put('title', str(patch.title, 'title', { max: 200, required: true }));
  if ('artist' in patch) put('artist', str(patch.artist, 'artist', { max: 200 }));
  if ('bpm' in patch) put('bpm', bpm(patch.bpm));
  if ('music_key' in patch) put('music_key', key(patch.music_key));
  if ('energy' in patch) put('energy', intInRange(patch.energy, 'energy', 1, 10));
  if ('genre' in patch) put('genre', str(patch.genre, 'genre', { max: 80 }));
  if ('notes' in patch) put('notes', str(patch.notes, 'notes', { max: 2000 }));
  if ('favorite' in patch) put('favorite', flag(patch.favorite));
  if ('x' in patch) put('x', coord(patch.x));
  if ('y' in patch) put('y', coord(patch.y));
  if ('file_path' in patch) put('file_path', path(patch.file_path));

  if (sets.length) {
    args.push(trackId);
    db.prepare(`UPDATE tracks SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  }
  return getTrack(trackId);
}

/** Bulk position save — one call at the end of a drag. */
export function savePositions(positions) {
  if (!Array.isArray(positions)) throw new BadRequest('positions must be an array');
  const stmt = db.prepare('UPDATE tracks SET x = ?, y = ? WHERE id = ?');
  tx(() => {
    for (const p of positions) stmt.run(coord(p.x), coord(p.y), id(p.id));
  });
  return { ok: true, updated: positions.length };
}

export function deleteTrack(rawId) {
  // Transitions cascade via the foreign key.
  db.prepare('DELETE FROM tracks WHERE id = ?').run(id(rawId));
  return { ok: true };
}

export function createTransition(rawFrom, rawTo, details = {}) {
  const from = id(rawFrom);
  const to = id(rawTo);
  if (from === to) throw new BadRequest('a track cannot transition into itself');
  if (!getTrack(from) || !getTrack(to)) throw new BadRequest('both tracks must exist');

  const existing = plain(
    db.prepare('SELECT * FROM transitions WHERE from_id = ? AND to_id = ?').get(from, to),
  );
  if (existing) return existing;

  const info = db
    .prepare(`INSERT INTO transitions
                (from_id, to_id, label, rating, notes, from_cue, to_cue, bars)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      from,
      to,
      str(details.label, 'label', { max: 120 }),
      intInRange(details.rating, 'rating', 1, 5),
      str(details.notes, 'notes', { max: 2000 }),
      cue(details.from_cue, 'from_cue'),
      cue(details.to_cue, 'to_cue'),
      intInRange(details.bars, 'bars', 1, 512),
    );
  return getTransition(Number(info.lastInsertRowid));
}

export function updateTransition(rawId, patch = {}) {
  const tid = id(rawId);
  const sets = [];
  const args = [];
  const put = (col, value) => { sets.push(`${col} = ?`); args.push(value); };

  if ('label' in patch) put('label', str(patch.label, 'label', { max: 120 }));
  if ('rating' in patch) put('rating', intInRange(patch.rating, 'rating', 1, 5));
  if ('notes' in patch) put('notes', str(patch.notes, 'notes', { max: 2000 }));
  if ('from_cue' in patch) put('from_cue', cue(patch.from_cue, 'from_cue'));
  if ('to_cue' in patch) put('to_cue', cue(patch.to_cue, 'to_cue'));
  if ('bars' in patch) put('bars', intInRange(patch.bars, 'bars', 1, 512));

  if (sets.length) {
    args.push(tid);
    db.prepare(`UPDATE transitions SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  }
  return getTransition(tid);
}

export function deleteTransition(rawId) {
  db.prepare('DELETE FROM transitions WHERE id = ?').run(id(rawId));
  return { ok: true };
}

export function createSetlist(name, trackIds = [], notes = '') {
  const cleanName = str(name, 'name', { max: 120, required: true });
  const cleanNotes = str(notes, 'notes', { max: 2000 });
  const ids = trackIdList(trackIds);

  const setlistId = tx(() => {
    const info = db
      .prepare('INSERT INTO setlists (name, notes) VALUES (?, ?)')
      .run(cleanName, cleanNotes);
    const created = Number(info.lastInsertRowid);
    writeItems(created, ids);
    return created;
  });
  return oneSetlist(setlistId);
}

export function updateSetlist(rawId, patch = {}) {
  const setlistId = id(rawId);
  if (!db.prepare('SELECT id FROM setlists WHERE id = ?').get(setlistId)) {
    throw new BadRequest('setlist not found');
  }
  tx(() => {
    const sets = [];
    const args = [];
    if ('name' in patch) {
      sets.push('name = ?');
      args.push(str(patch.name, 'name', { max: 120, required: true }));
    }
    if ('notes' in patch) {
      sets.push('notes = ?');
      args.push(str(patch.notes, 'notes', { max: 2000 }));
    }
    if (sets.length) {
      args.push(setlistId);
      db.prepare(`UPDATE setlists SET ${sets.join(', ')} WHERE id = ?`).run(...args);
    }
    if ('track_ids' in patch) writeItems(setlistId, trackIdList(patch.track_ids));
  });
  return oneSetlist(setlistId);
}

export function deleteSetlist(rawId) {
  db.prepare('DELETE FROM setlists WHERE id = ?').run(id(rawId));
  return { ok: true };
}

/**
 * Position overrides for a set view. These live on setlist_items, never on
 * tracks, so dragging inside a set leaves the main canvas exactly as it was.
 */
export function saveSetlistPositions(rawId, positions) {
  const setlistId = id(rawId);
  if (!db.prepare('SELECT id FROM setlists WHERE id = ?').get(setlistId)) {
    throw new BadRequest('setlist not found');
  }
  if (!Array.isArray(positions)) throw new BadRequest('positions must be an array');

  const update = db.prepare(
    'UPDATE setlist_items SET x = ?, y = ? WHERE setlist_id = ? AND track_id = ?',
  );
  tx(() => {
    for (const p of positions) {
      // A null pair clears that track back to the computed chain position.
      const hasPoint = p.x !== null && p.y !== null && p.x !== undefined && p.y !== undefined;
      update.run(
        hasPoint ? coord(p.x) : null,
        hasPoint ? coord(p.y) : null,
        setlistId,
        id(p.track_id),
      );
    }
  });
  return oneSetlist(setlistId);
}

/** Drops every override so the set falls back to the auto chain layout. */
export function resetSetlistPositions(rawId) {
  const setlistId = id(rawId);
  db.prepare('UPDATE setlist_items SET x = NULL, y = NULL WHERE setlist_id = ?').run(setlistId);
  return oneSetlist(setlistId);
}

/**
 * Reinstate deleted rows with their original ids — the other half of undo.
 *
 * Reusing ids is safe because both tables are INTEGER PRIMARY KEY AUTOINCREMENT,
 * which never hands a deleted id to a new row. Tracks go in before transitions
 * so the foreign keys resolve, and OR IGNORE makes a repeated undo a no-op
 * rather than an error.
 */
export function restore(tracks = [], transitions = [], setlists = []) {
  const insertTrack = db.prepare(
    `INSERT OR IGNORE INTO tracks
       (id, title, artist, bpm, music_key, energy, genre, notes, favorite, x, y, created_at, file_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertTransition = db.prepare(
    `INSERT OR IGNORE INTO transitions
       (id, from_id, to_id, label, rating, notes, from_cue, to_cue, bars, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertSetlist = db.prepare(
    'INSERT OR IGNORE INTO setlists (id, name, notes, created_at) VALUES (?, ?, ?, ?)',
  );

  tx(() => {
    for (const t of tracks) {
      insertTrack.run(
        id(t.id),
        str(t.title, 'title', { max: 200, required: true }),
        str(t.artist, 'artist', { max: 200 }),
        bpm(t.bpm),
        key(t.music_key),
        intInRange(t.energy, 'energy', 1, 10),
        str(t.genre, 'genre', { max: 80 }),
        str(t.notes, 'notes', { max: 2000 }),
        flag(t.favorite),
        coord(t.x ?? 0),
        coord(t.y ?? 0),
        str(t.created_at, 'created_at', { max: 40 }) || new Date().toISOString(),
        path(t.file_path),
      );
    }
    for (const t of transitions) {
      insertTransition.run(
        id(t.id),
        id(t.from_id),
        id(t.to_id),
        str(t.label, 'label', { max: 120 }),
        intInRange(t.rating, 'rating', 1, 5),
        str(t.notes, 'notes', { max: 2000 }),
        cue(t.from_cue, 'from_cue'),
        cue(t.to_cue, 'to_cue'),
        intInRange(t.bars, 'bars', 1, 512),
        str(t.created_at, 'created_at', { max: 40 }) || new Date().toISOString(),
      );
    }
    for (const l of setlists) {
      const setlistId = id(l.id);
      insertSetlist.run(
        setlistId,
        str(l.name, 'name', { max: 120, required: true }),
        str(l.notes, 'notes', { max: 2000 }),
        str(l.created_at, 'created_at', { max: 40 }) || new Date().toISOString(),
      );
      // Items are positional, so rewrite them rather than merging.
      writeItems(setlistId, Array.isArray(l.track_ids) ? l.track_ids.map(id) : []);
      if (Array.isArray(l.positions)) {
        const place = db.prepare(
          'UPDATE setlist_items SET x = ?, y = ? WHERE setlist_id = ? AND track_id = ?',
        );
        for (const p of l.positions) {
          place.run(coord(p.x), coord(p.y), setlistId, id(p.track_id));
        }
      }
    }
  });

  return { ok: true, tracks: tracks.length, transitions: transitions.length, setlists: setlists.length };
}

/**
 * Write rows read off disk. A file already in the library is updated rather
 * than duplicated — re-importing a folder after retagging it in rekordbox
 * refreshes what changed and leaves your canvas positions and links alone.
 */
export function importTracks(rows = []) {
  if (!Array.isArray(rows)) throw new BadRequest('rows must be an array');

  const byPath = new Map(
    db
      .prepare('SELECT id, file_path FROM tracks WHERE file_path IS NOT NULL')
      .all()
      .map((r) => [r.file_path, r.id]),
  );

  const added = [];
  const updated = [];

  tx(() => {
    for (const row of rows) {
      const filePath = path(row.file_path);
      if (!filePath) throw new BadRequest('every imported row needs a file_path');

      const existingId = byPath.get(filePath);
      if (existingId) {
        // Only fill gaps: a value you corrected by hand outranks the file's tag.
        const current = getTrack(existingId);
        const patch = {};
        if (!current.music_key && row.music_key) patch.music_key = row.music_key;
        if (!current.genre && row.genre) patch.genre = row.genre;
        if (Object.keys(patch).length) updated.push(updateTrack(existingId, patch));
        continue;
      }

      added.push(createTrack({ ...row, file_path: filePath }));
    }
  });

  return { added, updated: updated.length };
}
