# djtree

A node graph for planning DJ sets. Add tracks with their BPM, get ranked
suggestions for what mixes out of them, and wire the good transitions together
so every branch off a track is a setlist u can actually play.

A Mac app. No AI, no API keys, no account, no network calls of any kind — the
matching is arithmetic over ur own library, and that library is a SQLite file in
ur Music folder that u can copy, back up or delete yourself.

Share sets with others by downloading and uploading lightweight json files w/ all ur songs.

## Run it

```bash
npm install
npm run dev
```

That starts Vite and opens the app against it, with dev tools attached and hot
reloading. `npm start` runs the built app instead, and `npm run dist` packages a
`.dmg` into `release/`.

## Your music

**Add music** in the toolbar (or **⌘O**) opens a folder picker and reads the
tags off every audio file inside — title, artist, BPM, key, genre — for `.mp3`,
`.m4a`, `.flac`, `.wav`, `.aiff`, `.ogg` and `.opus`. Nothing is copied or
moved: a track remembers the path where its file already lives.

If your library has been through rekordbox, Serato or Mixed In Key, the BPM and
key are already written into the files and this is the whole import. Keys are
normalized on the way in by the same Camelot parser the track form uses, so
`8A`, `Abm` and `A minor` all land as `8A`.

**A file with no BPM tag is not imported**, and the count of those is reported
when the scan finishes. Every score in the app is built on tempo, so a guessed
BPM would not be a small inaccuracy — it would be a track that lies about what
it mixes into. Add those by hand, or tag them first.

Re-importing a folder is safe and is how you pick up retagging: a file already
in the library is matched on its path and updated rather than duplicated, and
only empty fields are filled — anything you corrected by hand outranks the tag.

## Using it

| Action | How |
| --- | --- |
| Add a track | `New track`, press `n`, or double-click empty grid |
| Import a music folder | `Add music` in the toolbar, or `⌘O` |
| Move a node | Drag it |
| Pan / zoom | Drag the grid · `⌘`/`Ctrl` + scroll, or plain scroll to pan |
| Build a transition | Drag the dot on a node's right edge onto another node, then log the mix |
| Edit a transition | Click the edge — cue points, bars, label, 1–5 rating, notes |
| Star a favorite | The star on a node, library row, or details panel |
| Generate a set | The Generate button, or the Sets tab |
| Undo | `⌘Z` / `Ctrl+Z`, or the Undo button |
| Delete | Select a node or edge, press `Delete` |
| Fit everything on screen | `f`, or the fit button |
| Hide the side panels | `[` and `]` |
| Light / dark | The sun/moon button in the toolbar |

**Linking asks for the mix.** Drawing a link doesn't save one. Every route to a
new transition — dragging the handle onto a node, `Link` on a suggested track,
clicking a set's dashed hop — opens a form that wants three things before it
will write the edge:

| Field | What it is |
| --- | --- |
| Mix out at | Where the blend starts in the outgoing track. `4:12`, or bare seconds |
| Mix in at | Where the incoming track is brought in |
| Blend | How many bars they run together, 1–512 (8/16/32/64 are one click) |

Label, rating and notes stay optional. The form does the tempo maths while
you're in it — what to pitch the incoming track to, and how long the blend
lasts in seconds at that BPM — and the details panel shows all three back as a
cue sheet you can edit later. Drawing a link that already exists skips the form
and just opens the transition it would have duplicated.

Links saved before this existed keep working; they read as `—` / *not recorded*
until you fill them in.

**Favorites.** Starring a track outlines its node in yellow, floats it to the
top of the library regardless of the active sort, and marks it in the match
list so a good candidate is obvious at a glance. The **Favorites** chip above
the library filters down to just the starred ones.

Panel visibility, theme, and match settings persist in `localStorage`.

## Generating sets

The **Generate** button (toolbar, or the Sets tab) opens the generator: pick
which tracks are eligible, how many you want, and the shape of the energy arc —
build, peak, wave, cool down, or steady. It returns a handful of candidate sets
ranked best-first, each hop labelled **rehearsed** (a transition already on your
canvas) or **suggested** (one it proposed). Save one and it appears under
**Sets** in the left sidebar.

Selecting a set **slides its tracks into a connected chain** on the canvas,
numbered in play order, with everything else dimmed and left where it is. The
chain wraps in a serpentine so consecutive tracks are always neighbours, and the
view frames it automatically. Releasing the set glides every node back and
restores the camera to exactly where you were.

Consecutive tracks with no saved transition between them get a **dashed
connector** with the pitch adjustment on it, so the chain reads as one run
instead of breaking wherever a hop hasn't been rehearsed. Click a dashed
connector to save it as a real transition. These only appear while the set is
arranged — over scattered nodes the same lines criss-cross the canvas and read
as noise.

**Each set view is its own workspace.** Drag nodes around inside an arranged set
and the moves are remembered *for that set only* — the main canvas keeps the
positions you placed by hand, and other sets are unaffected. Tracks you haven't
moved stay on the auto chain, and **Reset layout** in the sidebar puts a set back
to it. Every move is undoable.

That separation is in the schema, not just the UI: overrides live on
`setlist_items.x/y` and are null until you drag something. `tracks.x/y` is only
ever written by dragging on the main canvas. Turn the whole behaviour off with
the **Arrange as list** toggle and the set will simply highlight in place.

The sidebar simultaneously opens an editor where you can rename the set, reorder
with the arrows, remove tracks, or add more from the library. The pitch
adjustment between each pair is shown inline, so a bad reorder is visible
immediately. Every edit is undoable.

The search is a **beam search** (`src/lib/generate.ts`): finding the optimal
ordering of n tracks is a longest-path problem and factorial to brute-force, so
it keeps the best 40 partial sets at each position, extends every one by every
legal next track, then prunes back. That's `O(length × beam × pool)` and finds
strong sets reliably — it does not claim to find the single best one.

Set score is hop quality 70%, energy-shape conformance 20%, rehearsed ratio 10%.
If the pool has no tempo bridge to reach your requested length, it says so and
returns the longest set it could actually build rather than padding it.

## The details panel

Select a track and the right panel gives you three views of it:

- **Mixes into** ranks every other track as a candidate to play next. `Link`
  turns a suggestion into a real branch on the canvas.
- **Set paths** walks every branch downstream of the selected track and lists
  each chain as a candidate setlist.
- **Route to** answers the live question: you're playing X, you need to get to
  Y — which chains of transitions you've already saved will take you there?
  Shortest route first, with the pitch adjustment for every hop.

Click any chain to number its nodes on the canvas and dim everything else.

## How the matching works

All of it lives in [`src/lib/match.ts`](src/lib/match.ts) and
[`src/lib/camelot.ts`](src/lib/camelot.ts) — pure functions, no state, easy to
tweak once you disagree with the weights.

**Tempo (70% of the score).** For each candidate it computes the pitch
adjustment needed to lock the incoming track to the outgoing one, and tries
half-time, double-time and 3/2 relationships too — so a 174 BPM track shows up
as a clean match under an 87 BPM one. The score decays from 100 at a perfect
match to 0 at your pitch tolerance (the slider, default ±6%). Anything past the
tolerance is dropped from the list entirely.

**Key (20%).** Keys are normalized to Camelot notation, so you can type `8A`,
`Am`, `A minor` or `F#m` and get the same thing. The wheel is 12 numbers with
`A` = minor and `B` = major; neighbours share most of their notes. Every label
in the UI has a tooltip explaining it, and here they are in full:

| Label | Meaning |
| --- | --- |
| same key | Identical. The safest possible blend. |
| relative maj/min | Same number, opposite letter (8A↔8B). Same notes, different mood. |
| +1 energy up | One step clockwise (8A→9A). Lifts the room. |
| −1 energy down | One step counter-clockwise (8A→7A). Settles it. |
| ±2 whole step | Two steps around. Audible jump, holds over drums. |
| +7 energy boost | Seven steps. A deliberate lift needing a clean swap. |
| diagonal | Adjacent number, opposite letter (8A→9B). Usable, melodies can fight. |
| clashing | Not harmonically related. Mix over percussion or a section with no melody. |

Tempo tags are separate: **exact BPM**, **±X% pitch** (how far the incoming
track must be pitched), **half-time / double-time** (2:1 — beats still line
up), and **3/2 / 2/3** (beats align but the feel changes).

**Energy (10%).** A 1–10 field you set yourself. Flat or a small lift scores
well; a big drop is penalized harder than a big jump, because that's what kills
a set.

Missing data doesn't distort anything — if a track has no key or energy, that
weight is redistributed onto tempo rather than counting as a bad score.

**Routing** (`findRoutes`) walks forward from the track you're on, but only
after a backwards breadth-first sweep from the destination has labelled every
track with its minimum hop distance. That lets it skip any branch that can't
reach the target in the hops remaining, so dead ends are never explored.

## How it's built

The window is a React app; the data lives in SQLite, opened directly by
Electron's main process through Node's built-in `node:sqlite` — no native module
to compile, no server, no port.

`src/api.ts` is the only thing above the boundary that knows storage exists. It
calls `window.djtree`, which `electron/preload.cjs` exposes over
`contextBridge` — Node stays switched off in the page, and the app can do
exactly the calls on that list and nothing else. Each one lands on a function in
`electron/repo.js`, which validates before it touches SQL: the renderer is
treated as untrusted input, so a bug in the UI cannot write a malformed row.

| | |
| --- | --- |
| `electron/main.js` | window, menu, IPC handlers |
| `electron/preload.cjs` | the bridge — the complete list of what the page can do |
| `electron/db.js` | connection, schema, additive migrations, startup backups |
| `electron/repo.js` | every operation, with validation |
| `electron/library.js` | folder scan and tag reading |

## Export and import

The toolbar has download and upload buttons. Export writes the whole library
(tracks, transitions, sets, and per-set layouts) to one JSON file; import adds a
file's contents to your library.

Import **remaps every id** rather than preserving them, so it is safe to run
against a library that already has content — nothing existing is modified or
removed. That also makes it the way to merge two machines' libraries.

## Where your data lives

`~/Music/djtree/djtree.db`, with `~/Music/djtree/backups/` beside it. An
ordinary folder in Finder on purpose — **File → Show Library Folder in Finder**
opens it — so the library is yours to copy to another Mac, drop in a backup, or
throw away. Nothing is hidden inside the `.app`, which the next build would
replace. Four tables: `tracks`, `transitions`, `setlists` and
`setlist_items`. Deleting a track cascades to its transitions and removes it
from any set; deleting a set never touches the tracks in it. Set ordering is an
explicit `position` column, rewritten wholesale on each edit so reordering never
becomes index arithmetic — and that rewrite carries over any per-set `x`/`y`
overrides for tracks that survive it, so renaming or appending never discards a
layout you arranged.

Everything is in that one file — no `-wal`/`-shm` sidecars — so backing up is
just copying `djtree.db`, even with the app open. `DJTREE_DB=/path/to.db` points
it at a different file, `DJTREE_DIR` at a different folder. The app also
snapshots the database into `backups/` on every launch, keeping the last 15.

### Your library is meant to be kept

Nothing in normal use wipes the database, and the app never drops a table.
Schema changes are additive migrations that run once and leave existing rows
untouched, so upgrading never costs you tracks.

**Automatic snapshots.** Every launch copies the database to
`~/Music/djtree/backups/djtree-<timestamp>.db`, keeping the last 15. It skips
the copy when nothing changed since the last one, so opening the app twice in an
evening doesn't churn through the history. To roll back, quit the app and copy a
snapshot over the live file — in Finder, or:

```bash
cp ~/Music/djtree/backups/djtree-2026-08-13T05-17-08.db ~/Music/djtree/djtree.db
```

**Undo** (`⌘Z`) covers every mutation: adding, editing, deleting, moving,
starring, linking and unlinking, up to 50 steps back. Deleting a track takes
its transitions with it, so the undo entry snapshots those too and puts the
whole thing back.

Restoring works because both tables are `INTEGER PRIMARY KEY AUTOINCREMENT`,
which never reissues a deleted id — so `POST /api/restore` can reinstate rows
under their original ids without ever colliding with something created since.
It uses `INSERT OR IGNORE`, so undoing twice is a no-op rather than an error.

There's no redo yet, and the undo stack lives in memory — reloading the page
clears it. The snapshots cover anything the stack can't.

**Run one server at a time.** Two `node server/index.js` processes against the
same database will fight over the port and the file. If writes seem to vanish,
check for strays: `lsof -nP -iTCP:3001 -sTCP:LISTEN`.

Set `DJTREE_LOG=1` to log every write request, which is the quickest way to see
whether the app really issued a delete you didn't expect.

## Layout

```
server/
  db.js       schema + connection
  index.js    REST API
  seed.js     optional demo data
src/
  lib/        matching, Camelot maths, set generation, canvas layout
              (all pure, no React)
  components/ Canvas, TrackNode, Inspector, EdgeInspector, Library,
              SetlistPanel, GeneratorModal, TrackForm, LinkForm, ChainCard
sql/          one-off migrations for the hosted Postgres
  state.ts    graph store — optimistic local writes, server persistence
  api.ts      fetch wrappers
  styles.css  all colour lives in the tokens at the top
```

Theming is two token blocks at the top of `styles.css` — `:root` for light,
`:root[data-theme='dark']` for dark. Nothing below them hardcodes a colour, so
retinting the whole app means editing those two blocks and nothing else.

The accent has four separate roles, because one hue reused everywhere made light
mode read as dark mode's blue dropped onto white: `--accent` for solid fills,
`--accent-on` for text sitting on those fills, `--accent-text` for accent-as-text
against the page ground, and `--accent-bg` for subtle tints. Light uses a vivid
blue carrying white text; dark uses a brighter blue carrying dark text. Both
directions clear WCAG AA.
Icons are [lucide-react](https://lucide.dev), imported per-icon so only the
ones actually used are bundled.

## License

MIT — see [LICENSE](LICENSE).
