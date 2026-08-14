/**
 * The database: one SQLite file, opened directly by the main process.
 *
 * It lives in ~/Music/djtree so it is an ordinary folder you can open in
 * Finder — copy it, back it up, drop it on another Mac, or point DJTREE_DB
 * somewhere else entirely. Nothing here is hidden inside the .app bundle,
 * which would be wiped by the next update.
 */

import { DatabaseSync } from 'node:sqlite';
import {
  copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const libraryDir = process.env.DJTREE_DIR ?? join(homedir(), 'Music', 'djtree');
export const dbPath = process.env.DJTREE_DB ?? join(libraryDir, 'djtree.db');
mkdirSync(dirname(dbPath), { recursive: true });

/** How many startup snapshots to keep before the oldest is dropped. */
const KEEP_BACKUPS = 15;

/**
 * Snapshot the database before opening it. Runs on every start, but skips when
 * nothing has changed since the last snapshot, so repeated launches during a
 * quiet evening don't churn through the history.
 */
function snapshot() {
  if (!existsSync(dbPath) || statSync(dbPath).size === 0) return;

  const dir = join(dirname(dbPath), 'backups');
  mkdirSync(dir, { recursive: true });

  const existing = readdirSync(dir)
    .filter((f) => f.startsWith('djtree-') && f.endsWith('.db'))
    .sort();

  const newest = existing.at(-1);
  if (newest && statSync(join(dir, newest)).mtimeMs >= statSync(dbPath).mtimeMs) return;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const created = `djtree-${stamp}.db`;
  copyFileSync(dbPath, join(dir, created));

  for (const stale of [...existing, created].slice(0, -KEEP_BACKUPS)) {
    try {
      unlinkSync(join(dir, stale));
    } catch {
      /* already gone */
    }
  }
}

snapshot();

export const db = new DatabaseSync(dbPath);

/*
 * Deliberately NOT WAL mode. WAL buys concurrent readers during a write, which
 * a single-user app with a handful of writes a minute has no use for. What it
 * costs is real: committed rows live in a `-wal` sidecar until a checkpoint, so
 * copying djtree.db on its own silently loses recent work, and a `-wal` left
 * behind by a hard kill can be judged stale on the next open and dropped
 * wholesale. A rollback journal keeps everything in the one file — which
 * matters more here than it did on a server, because the whole point is that
 * you can drag that one file out of Finder and have your library.
 */
db.exec('PRAGMA journal_mode = DELETE');
db.exec('PRAGMA synchronous = FULL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

/** Flushes and releases the file so a restart never inherits a dirty journal. */
export function closeDb() {
  try {
    db.close();
  } catch {
    /* already closed */
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS tracks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    artist      TEXT    NOT NULL DEFAULT '',
    bpm         REAL    NOT NULL,
    music_key   TEXT,              -- normalized Camelot, e.g. '8A'
    energy      INTEGER,           -- 1..10, optional
    genre       TEXT    NOT NULL DEFAULT '',
    notes       TEXT    NOT NULL DEFAULT '',
    favorite    INTEGER NOT NULL DEFAULT 0,
    x           REAL    NOT NULL DEFAULT 0,
    y           REAL    NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS transitions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id     INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    to_id       INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    label       TEXT    NOT NULL DEFAULT '',
    rating      INTEGER,           -- 1..5, optional
    notes       TEXT    NOT NULL DEFAULT '',
    from_cue    INTEGER,           -- seconds into the outgoing track
    to_cue      INTEGER,           -- seconds into the incoming track
    bars        INTEGER,           -- how long the two run together
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (from_id, to_id)
  );

  CREATE INDEX IF NOT EXISTS idx_transitions_from ON transitions(from_id);
  CREATE INDEX IF NOT EXISTS idx_transitions_to   ON transitions(to_id);

  CREATE TABLE IF NOT EXISTS setlists (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    notes       TEXT    NOT NULL DEFAULT '',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- Ordering is an explicit position column; a set is rewritten wholesale on
  -- every edit, which keeps reordering from turning into index arithmetic.
  CREATE TABLE IF NOT EXISTS setlist_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    setlist_id  INTEGER NOT NULL REFERENCES setlists(id) ON DELETE CASCADE,
    track_id    INTEGER NOT NULL REFERENCES tracks(id)   ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    x           REAL,
    y           REAL,
    UNIQUE (setlist_id, position)
  );

  CREATE INDEX IF NOT EXISTS idx_items_setlist ON setlist_items(setlist_id);
`);

/*
 * Migrations: additive only, so a database created by an older build keeps
 * every row it already has. Each entry runs once, when its column is missing.
 */
const trackColumns = db.prepare('PRAGMA table_info(tracks)').all().map((c) => c.name);

if (!trackColumns.includes('favorite')) {
  db.exec('ALTER TABLE tracks ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0');
  console.log('migration: added tracks.favorite');
}

/*
 * Where the audio actually is. Null for anything typed in by hand, which is why
 * the uniqueness lives in an index rather than the column: SQLite lets a UNIQUE
 * index hold any number of NULLs, so hand-entered tracks never collide, while
 * importing the same folder twice updates rather than duplicates.
 */
if (!trackColumns.includes('file_path')) {
  db.exec('ALTER TABLE tracks ADD COLUMN file_path TEXT');
  console.log('migration: added tracks.file_path');
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_tracks_file ON tracks(file_path)');

const transitionColumns = db.prepare('PRAGMA table_info(transitions)').all().map((c) => c.name);
if (!transitionColumns.includes('bars')) {
  db.exec('ALTER TABLE transitions ADD COLUMN from_cue INTEGER');
  db.exec('ALTER TABLE transitions ADD COLUMN to_cue INTEGER');
  db.exec('ALTER TABLE transitions ADD COLUMN bars INTEGER');
  console.log('migration: added transitions.from_cue / .to_cue / .bars');
}

const itemColumns = db.prepare('PRAGMA table_info(setlist_items)').all().map((c) => c.name);
if (!itemColumns.includes('x')) {
  db.exec('ALTER TABLE setlist_items ADD COLUMN x REAL');
  db.exec('ALTER TABLE setlist_items ADD COLUMN y REAL');
  console.log('migration: added setlist_items.x / .y');
}

/** node:sqlite returns null-prototype objects; re-shape them for structured clone. */
export const plain = (row) => (row ? { ...row } : row);
