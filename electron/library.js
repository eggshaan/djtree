/**
 * Reading a folder of music off disk.
 *
 * Nothing is copied or moved — a track row stores the path where the file
 * already lives. What gets read is the tags: title, artist, BPM, key, genre.
 * Most DJ libraries have been through rekordbox, Serato or Mixed In Key
 * already, and all three write BPM and key back into the file, so for a
 * prepared library this is the whole import.
 *
 * Files with no BPM tag are handed back separately rather than guessed at,
 * because a wrong BPM is worse than a missing one: it would quietly poison
 * every match score in the app.
 */

import { readdir, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { parseFile } from 'music-metadata';

/** What Chromium and music-metadata both handle without extra tooling. */
const AUDIO = new Set(['.mp3', '.m4a', '.mp4', '.aac', '.flac', '.wav', '.aiff', '.aif', '.ogg', '.opus']);

/** Folders that are never music, and are expensive to walk. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'Backup', 'PIONEER', '.Trash']);

/** Depth-first walk, symlinks not followed, hidden files ignored. */
async function walk(dir, out = [], depth = 0) {
  if (depth > 12) return out;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out; // unreadable folder (permissions) — skip rather than fail the import
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(full, out, depth + 1);
    } else if (entry.isFile() && AUDIO.has(extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

/**
 * BPM as written by whatever tagged the file. Some taggers store "128.00",
 * some "128", some nonsense like "0" — anything outside a plausible range is
 * treated as absent.
 */
function readBpm(common, native) {
  const candidates = [common.bpm];

  // ID3 TBPM is the usual home; some tools only write it in the native frame.
  for (const frames of Object.values(native ?? {})) {
    for (const frame of frames) {
      if (/^(TBPM|bpm|tmpo)$/i.test(frame.id)) candidates.push(frame.value);
    }
  }

  for (const raw of candidates) {
    const n = Number(typeof raw === 'string' ? raw.replace(',', '.') : raw);
    if (Number.isFinite(n) && n >= 20 && n <= 400) return Math.round(n * 100) / 100;
  }
  return null;
}

/**
 * Key as written by the tagger, in whatever notation it used — "8A", "Abm",
 * "F#min". It is passed through untouched; the renderer normalizes it with the
 * same Camelot parser the track form uses, so there is exactly one place that
 * knows how keys are spelled.
 */
function readKey(common, native) {
  if (common.key) return String(common.key);
  for (const frames of Object.values(native ?? {})) {
    for (const frame of frames) {
      if (/^(TKEY|initialkey|initial key)$/i.test(frame.id) && frame.value) {
        return String(frame.value);
      }
    }
  }
  return null;
}

/**
 * Scan a folder and return one candidate row per audio file. The rows are raw:
 * key and genre are still in the file's own spelling, and `bpm` may be null.
 */
export async function scanFolder(dir) {
  const info = await stat(dir).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`${dir} is not a folder`);

  const files = await walk(dir);
  const rows = [];
  const unreadable = [];

  for (const file of files) {
    try {
      const { common, native } = await parseFile(file, { duration: false, skipCovers: true });
      rows.push({
        file_path: file,
        title: (common.title ?? basename(file, extname(file))).slice(0, 200),
        artist: (common.artist ?? '').slice(0, 200),
        bpm: readBpm(common, native),
        music_key: readKey(common, native),
        genre: (common.genre?.[0] ?? '').slice(0, 80),
      });
    } catch {
      unreadable.push(file);
    }
  }

  return { rows, scanned: files.length, unreadable };
}
