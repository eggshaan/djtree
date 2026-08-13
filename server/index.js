import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDb, db, dbPath, plain } from './db.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 3001);

const app = express();
app.use(express.json({ limit: '1mb' }));

if (process.env.DJTREE_LOG) {
  app.use((req, _res, next) => {
    if (req.method !== 'GET') console.log(`${req.method} ${req.url}`);
    next();
  });
}

/* ---------------------------------------------------------------- helpers */

class BadRequest extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

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

/** Wraps a handler so thrown errors become clean JSON responses. */
const route = (fn) => (req, res) => {
  try {
    fn(req, res);
  } catch (err) {
    const status = err.status ?? 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: err.message ?? 'internal error' });
  }
};

const getTrack = (trackId) =>
  plain(db.prepare('SELECT * FROM tracks WHERE id = ?').get(trackId));

/* ----------------------------------------------------------------- routes */

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

app.get('/api/graph', route((_req, res) => {
  res.json({
    tracks: db.prepare('SELECT * FROM tracks ORDER BY id').all().map(plain),
    transitions: db.prepare('SELECT * FROM transitions ORDER BY id').all().map(plain),
    setlists: readSetlists(),
  });
}));

app.post('/api/setlists', route((req, res) => {
  const b = req.body ?? {};
  const name = str(b.name, 'name', { max: 120, required: true });
  const notes = str(b.notes, 'notes', { max: 2000 });
  const ids = trackIdList(b.track_ids ?? []);

  db.exec('BEGIN');
  try {
    const info = db
      .prepare('INSERT INTO setlists (name, notes) VALUES (?, ?)')
      .run(name, notes);
    const setlistId = Number(info.lastInsertRowid);
    writeItems(setlistId, ids);
    db.exec('COMMIT');
    res.status(201).json(readSetlists().find((l) => l.id === setlistId));
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}));

app.patch('/api/setlists/:id', route((req, res) => {
  const setlistId = id(req.params.id);
  const existing = db.prepare('SELECT id FROM setlists WHERE id = ?').get(setlistId);
  if (!existing) throw Object.assign(new Error('setlist not found'), { status: 404 });

  const b = req.body ?? {};
  db.exec('BEGIN');
  try {
    const sets = [];
    const args = [];
    if ('name' in b) {
      sets.push('name = ?');
      args.push(str(b.name, 'name', { max: 120, required: true }));
    }
    if ('notes' in b) {
      sets.push('notes = ?');
      args.push(str(b.notes, 'notes', { max: 2000 }));
    }
    if (sets.length) {
      args.push(setlistId);
      db.prepare(`UPDATE setlists SET ${sets.join(', ')} WHERE id = ?`).run(...args);
    }
    if ('track_ids' in b) writeItems(setlistId, trackIdList(b.track_ids));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  res.json(readSetlists().find((l) => l.id === setlistId));
}));

app.delete('/api/setlists/:id', route((req, res) => {
  db.prepare('DELETE FROM setlists WHERE id = ?').run(id(req.params.id));
  res.json({ ok: true });
}));

/**
 * Position overrides for a set view. These live on setlist_items, never on
 * tracks, so dragging inside a set leaves the main canvas exactly as it was.
 */
app.post('/api/setlists/:id/positions', route((req, res) => {
  const setlistId = id(req.params.id);
  if (!db.prepare('SELECT id FROM setlists WHERE id = ?').get(setlistId)) {
    throw Object.assign(new Error('setlist not found'), { status: 404 });
  }
  const items = req.body?.positions;
  if (!Array.isArray(items)) throw new BadRequest('positions must be an array');

  const update = db.prepare(
    'UPDATE setlist_items SET x = ?, y = ? WHERE setlist_id = ? AND track_id = ?',
  );
  db.exec('BEGIN');
  try {
    for (const p of items) {
      // A null pair clears that track back to the computed chain position.
      const hasPoint = p.x !== null && p.y !== null && p.x !== undefined && p.y !== undefined;
      update.run(
        hasPoint ? coord(p.x) : null,
        hasPoint ? coord(p.y) : null,
        setlistId,
        id(p.track_id),
      );
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  res.json(readSetlists().find((l) => l.id === setlistId));
}));

/** Drops every override so the set falls back to the auto chain layout. */
app.delete('/api/setlists/:id/positions', route((req, res) => {
  const setlistId = id(req.params.id);
  db.prepare('UPDATE setlist_items SET x = NULL, y = NULL WHERE setlist_id = ?').run(setlistId);
  res.json(readSetlists().find((l) => l.id === setlistId));
}));

app.post('/api/tracks', route((req, res) => {
  const b = req.body ?? {};
  const info = db
    .prepare(`INSERT INTO tracks
                (title, artist, bpm, music_key, energy, genre, notes, favorite, x, y)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      str(b.title, 'title', { max: 200, required: true }),
      str(b.artist, 'artist', { max: 200 }),
      bpm(b.bpm),
      key(b.music_key),
      intInRange(b.energy, 'energy', 1, 10),
      str(b.genre, 'genre', { max: 80 }),
      str(b.notes, 'notes', { max: 2000 }),
      flag(b.favorite),
      coord(b.x ?? 0),
      coord(b.y ?? 0),
    );
  res.status(201).json(getTrack(Number(info.lastInsertRowid)));
}));

app.patch('/api/tracks/:id', route((req, res) => {
  const trackId = id(req.params.id);
  if (!getTrack(trackId)) throw Object.assign(new Error('track not found'), { status: 404 });

  const b = req.body ?? {};
  const sets = [];
  const args = [];
  const put = (col, value) => { sets.push(`${col} = ?`); args.push(value); };

  if ('title' in b) put('title', str(b.title, 'title', { max: 200, required: true }));
  if ('artist' in b) put('artist', str(b.artist, 'artist', { max: 200 }));
  if ('bpm' in b) put('bpm', bpm(b.bpm));
  if ('music_key' in b) put('music_key', key(b.music_key));
  if ('energy' in b) put('energy', intInRange(b.energy, 'energy', 1, 10));
  if ('genre' in b) put('genre', str(b.genre, 'genre', { max: 80 }));
  if ('notes' in b) put('notes', str(b.notes, 'notes', { max: 2000 }));
  if ('favorite' in b) put('favorite', flag(b.favorite));
  if ('x' in b) put('x', coord(b.x));
  if ('y' in b) put('y', coord(b.y));

  if (sets.length) {
    args.push(trackId);
    db.prepare(`UPDATE tracks SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  }
  res.json(getTrack(trackId));
}));

/** Bulk position save — one call at the end of a drag. */
app.post('/api/tracks/positions', route((req, res) => {
  const items = req.body?.positions;
  if (!Array.isArray(items)) throw new BadRequest('positions must be an array');
  const stmt = db.prepare('UPDATE tracks SET x = ?, y = ? WHERE id = ?');
  db.exec('BEGIN');
  try {
    for (const p of items) stmt.run(coord(p.x), coord(p.y), id(p.id));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  res.json({ ok: true, updated: items.length });
}));

app.delete('/api/tracks/:id', route((req, res) => {
  // Transitions cascade via the foreign key.
  db.prepare('DELETE FROM tracks WHERE id = ?').run(id(req.params.id));
  res.json({ ok: true });
}));

app.post('/api/transitions', route((req, res) => {
  const b = req.body ?? {};
  const from = id(b.from_id);
  const to = id(b.to_id);
  if (from === to) throw new BadRequest('a track cannot transition into itself');
  if (!getTrack(from) || !getTrack(to)) throw new BadRequest('both tracks must exist');

  const existing = plain(
    db.prepare('SELECT * FROM transitions WHERE from_id = ? AND to_id = ?').get(from, to),
  );
  if (existing) return res.status(200).json(existing);

  const info = db
    .prepare(`INSERT INTO transitions
                (from_id, to_id, label, rating, notes, from_cue, to_cue, bars)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      from,
      to,
      str(b.label, 'label', { max: 120 }),
      intInRange(b.rating, 'rating', 1, 5),
      str(b.notes, 'notes', { max: 2000 }),
      cue(b.from_cue, 'from_cue'),
      cue(b.to_cue, 'to_cue'),
      intInRange(b.bars, 'bars', 1, 512),
    );
  res.status(201).json(
    plain(db.prepare('SELECT * FROM transitions WHERE id = ?').get(Number(info.lastInsertRowid))),
  );
}));

app.patch('/api/transitions/:id', route((req, res) => {
  const tid = id(req.params.id);
  const b = req.body ?? {};
  const sets = [];
  const args = [];
  if ('label' in b) { sets.push('label = ?'); args.push(str(b.label, 'label', { max: 120 })); }
  if ('rating' in b) { sets.push('rating = ?'); args.push(intInRange(b.rating, 'rating', 1, 5)); }
  if ('notes' in b) { sets.push('notes = ?'); args.push(str(b.notes, 'notes', { max: 2000 })); }
  if ('from_cue' in b) { sets.push('from_cue = ?'); args.push(cue(b.from_cue, 'from_cue')); }
  if ('to_cue' in b) { sets.push('to_cue = ?'); args.push(cue(b.to_cue, 'to_cue')); }
  if ('bars' in b) { sets.push('bars = ?'); args.push(intInRange(b.bars, 'bars', 1, 512)); }
  if (sets.length) {
    args.push(tid);
    db.prepare(`UPDATE transitions SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  }
  res.json(plain(db.prepare('SELECT * FROM transitions WHERE id = ?').get(tid)));
}));

app.delete('/api/transitions/:id', route((req, res) => {
  db.prepare('DELETE FROM transitions WHERE id = ?').run(id(req.params.id));
  res.json({ ok: true });
}));

/**
 * Reinstate deleted rows with their original ids — the server half of undo.
 *
 * Reusing ids is safe because both tables are INTEGER PRIMARY KEY AUTOINCREMENT,
 * which never hands a deleted id to a new row. Tracks go in before transitions
 * so the foreign keys resolve, and OR IGNORE makes a repeated undo a no-op
 * rather than an error.
 */
app.post('/api/restore', route((req, res) => {
  const tracks = Array.isArray(req.body?.tracks) ? req.body.tracks : [];
  const transitions = Array.isArray(req.body?.transitions) ? req.body.transitions : [];
  const setlists = Array.isArray(req.body?.setlists) ? req.body.setlists : [];

  const insertTrack = db.prepare(
    `INSERT OR IGNORE INTO tracks
       (id, title, artist, bpm, music_key, energy, genre, notes, favorite, x, y, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertTransition = db.prepare(
    `INSERT OR IGNORE INTO transitions
       (id, from_id, to_id, label, rating, notes, from_cue, to_cue, bars, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  db.exec('BEGIN');
  try {
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
    const insertSetlist = db.prepare(
      'INSERT OR IGNORE INTO setlists (id, name, notes, created_at) VALUES (?, ?, ?, ?)',
    );
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
      // Restore any per-set layout the deleted setlist carried.
      if (Array.isArray(l.positions)) {
        const place = db.prepare(
          'UPDATE setlist_items SET x = ?, y = ? WHERE setlist_id = ? AND track_id = ?',
        );
        for (const p of l.positions) {
          place.run(coord(p.x), coord(p.y), setlistId, id(p.track_id));
        }
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  res.json({
    ok: true,
    tracks: tracks.length,
    transitions: transitions.length,
    setlists: setlists.length,
  });
}));

/* -------------------------------------------------- static build (npm start) */

const dist = join(root, 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
}

const server = app.listen(PORT, () => {
  console.log(`djtree api  →  http://localhost:${PORT}`);
  console.log(`database    →  ${dbPath}`);
});

// `node --watch` restarts on every save, so a clean close matters in dev too.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close();
    closeDb();
    process.exit(0);
  });
}
