/**
 * Optional demo data: `npm run seed`.
 * Refuses to run if the library already has tracks, so it can't clobber yours.
 */
import { db, dbPath } from './db.js';

const TRACKS = [
  // title, artist, bpm, camelot key, energy, genre
  ['Summer', 'Calvin Harris', 128, '9B', 7, 'house'],
  ['Feel So Close', 'Calvin Harris', 128, '4A', 7, 'house'],
  ['Outside', 'Calvin Harris', 124, '10B', 6, 'house'],
  ['Latch', 'Disclosure', 122, '8B', 6, 'house'],
  ['White Noise', 'Disclosure', 126, '11A', 7, 'house'],
  ['Opus', 'Eric Prydz', 126, '9A', 8, 'progressive'],
  ['Generate', 'Eric Prydz', 128, '11A', 8, 'progressive'],
  ['Innerbloom', 'Rufus Du Sol', 120, '10A', 4, 'melodic'],
  ['Losing It', 'Fisher', 126, '5A', 9, 'tech house'],
  ['Move Your Body', 'Ofenbach', 122, '8A', 6, 'tech house'],
  ['Midnight City', 'M83', 105, '1B', 5, 'indie'],
  ['Tell Me Why', 'Supermode', 128, '6A', 9, 'house'],
];

const LAYOUT_X = 320;
const LAYOUT_Y = 130;

const existing = db.prepare('SELECT COUNT(*) AS n FROM tracks').get();
if (existing.n > 0) {
  console.log(`${dbPath} already has ${existing.n} tracks — leaving it alone.`);
  process.exit(0);
}

const insert = db.prepare(
  `INSERT INTO tracks (title, artist, bpm, music_key, energy, genre, x, y)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
);

const ids = TRACKS.map((t, i) =>
  Number(
    insert.run(
      t[0], t[1], t[2], t[3], t[4], t[5],
      (i % 3) * LAYOUT_X,
      Math.floor(i / 3) * LAYOUT_Y,
    ).lastInsertRowid,
  ),
);

const link = db.prepare(
  `INSERT OR IGNORE INTO transitions (from_id, to_id, label, from_cue, to_cue, bars)
   VALUES (?, ?, ?, ?, ?, ?)`,
);
link.run(ids[0], ids[1], 'straight swap', 252, 32, 32);
link.run(ids[0], ids[4], 'build up', 188, 16, 16);

console.log(`Seeded ${ids.length} tracks into ${dbPath}`);
