# djtree — demo video script

Two cuts: a **3-minute walkthrough** that covers every feature, and a
**45-second version** for a LinkedIn post. Same recording session — shoot the
long one, cut the short one out of it.

---

## Before you record

**The library is the demo.** Nothing sinks a tool video faster than "Song 1,
Song 2, Song 3". Record against real tracks you actually own, ideally 25–40 of
them, with BPM and key filled in and **at least six saved transitions** so the
canvas already looks like a graph when the video opens. Build that the day
before, not on camera.

Prepare, in this order:

1. A library with a **visible cluster of linked tracks** — one track with three
   branches off it is the shot that explains the whole idea in one second.
2. **Two or three genres** actually tagged (House, Tech House, Disco), so the
   genre filter and the coloured dots have something to do.
3. **One saved set** already in the Sets tab, plus room to make another live.
4. A **separate folder of 8–15 audio files** for the import scene — see the
   warning below.
5. Star two or three tracks so the Favorites chip isn't empty.

> **The import warning, for your machine specifically.** When I tested the
> scanner against your `~/Downloads` audio, **none of those files carried a BPM
> or key tag** — they're YouTube rips. djtree refuses to guess a BPM, so
> importing that folder shows "0 added, 12 skipped (no BPM tag)", which reads as
> broken on camera. Either point the import at a folder that has been through
> rekordbox, Serato or Mixed In Key, or tag a handful by hand first. If you
> can't, flip it into a feature and say the line in Scene 2B.

**Capture settings**

| | |
| --- | --- |
| Window | Full screen or 1440×900, both side panels open |
| Theme | Dark. Switch to light for two seconds in Scene 8, then back |
| Recording | ⌘⇧5, "Record Selected Portion", show mouse clicks on |
| Do Not Disturb | On. A Slack banner mid-take costs you the whole take |
| Dev tools | Closed (`npm start`, not `npm run dev`) |
| Zoom | Canvas at 100% to start — `f` fits everything, but 100% reads better |
| Audio | Record voice separately and lay it under; narrating while clicking makes both worse |

Delete `~/Music/djtree/backups/` chatter isn't needed — nobody sees the
filesystem except in Scene 9, where you want it looking tidy.

---

## The 3-minute cut

Times are cumulative. "**Do**" is what happens on screen; "**Say**" is voiceover.

### 1 · Open on the graph — 0:00–0:15

**Do.** Start on the canvas, already populated. Slowly pan left to right across
a cluster with visible branches. Don't click anything yet.

**Say.** "Every DJ set-planning tool I've used gives you one thing: a list, in
one order. But that's not how a set works. You get to a track, and there are
three places you could go next depending on the room. This is djtree — your
library as a graph, where every branch is a set you could actually play."

### 2A · Import a folder — 0:15–0:35

**Do.** Click **Add music** in the toolbar. Native folder picker. Choose the
prepared folder. Let the toast land: *"12 tracks added · 3 already here,
refreshed"*.

**Say.** "It reads your files. Title, artist, BPM, key, genre, straight off the
tags — if your library has been through rekordbox or Mixed In Key, that's the
whole import. Nothing gets copied or moved; a track just remembers where its
file lives."

### 2B · The refusal (only if your files are untagged) — +0:06

**Do.** Let the "skipped (no BPM tag)" count show. Point at it.

**Say.** "Anything without a BPM tag it refuses to import rather than guess.
Every score in this app is built on tempo — a made-up BPM isn't a small
inaccuracy, it's a track lying to you about what it mixes into."

### 3 · The library — 0:35–0:50

**Do.** Type two letters in search, clear it. Change sort to **Key**. Open the
**Genre** dropdown, tick *House* and *Tech House*, watch the list narrow. Clear
it. Tap the **Favorites** chip.

**Say.** "The sidebar is the boring part done properly — search, sort by BPM,
key or genre, filter by any combination of genres, star the ones you reach for."

### 4 · What mixes into what — 0:50–1:15

**Do.** Click one track. Let the details panel fill. Scroll the **Mixes into**
list slowly so the reason tags are readable — *exact BPM*, *−1.6% pitch*, *same
key*, *+1 energy up*. Drag the **pitch tolerance** slider from 6% to 3% and let
the list shrink. Toggle **Key** off and on.

**Say.** "Pick a track and it ranks everything else against it. Tempo is seventy
percent of that score — it works out the pitch adjustment to lock them together
and checks half-time and double-time too, so a 174 drum-and-bass track shows up
under an 87 hip-hop track. Key is twenty percent, on the Camelot wheel. Energy
is the last ten. No model, no API — it's the arithmetic you'd do in your head,
done for every track at once."

### 5 · Log a real mix — 1:15–1:45

**Do.** Drag from the dot on a node's right edge onto another node. The link
form opens. Type a cue point as `4:12`, another as `0:32`, click the **32**
bars preset. Watch the tempo maths update. Give it 4 stars. Save. The edge
appears on the canvas. Click the edge once to show the cue sheet in the panel.

**Say.** "When you find a blend that works, you log it. Where you mix out, where
you bring the next one in, how many bars they run together — it does the tempo
maths while you type, and hands it back as a cue sheet next time. That's the
part no other planner does. It doesn't just score pairs; it remembers what you
actually played."

### 6 · Move things around — 1:45–2:00

**Do.** ⌘-click three nodes, drag one — all three move together. Press ⌘Z.
Everything snaps back in one step. Hover the Undo button so the label
("Undo: Move 3 tracks") is visible.

**Say.** "⌘-click to grab several and they move as a group. Undo goes back
fifty steps, and it knows what it's undoing."

### 7 · Generate a set — 2:00–2:35

**Do.** Click **Generate**. In the genre picker tick two genres. Tick two songs
in the checklist. Type `8` in the number box. Pick the **Peak** energy shape.
Hit **Generate**. Scroll the results.

**Say.** "Or let it build one. Pick the genres to draw from, tick the songs you
already know you want, and say how long. Everything you ticked is in the final
set — it fills the rest from your library, shaped to an energy arc: build,
peak, wave, cool down. Each hop is labelled: *rehearsed* means it's a transition
you've already saved, *suggested* means it invented that one and you should try
it before you trust it."

> Ordering *n* tracks optimally is factorial. If anyone asks in the comments:
> it's a beam search, forty partial sets wide, scored on hop quality, energy
> fit and how much of it you've rehearsed.

### 8 · The set on the canvas — 2:35–2:55

**Do.** Save the set. It appears in **Sets**. Click it — the tracks slide into a
numbered chain and the view pans to them. Point out a **dashed** connector.
Click it, save the transition, watch it turn solid. Drag one node inside the
set; click **Reset layout**. Toggle light mode for two seconds and back.

**Say.** "Saving a set arranges it as a chain, in play order, without moving
anything on your real canvas. Dashed lines are the hops you haven't rehearsed
yet — click one to log it. And the set has its own layout: drag things around in
here and your main graph is untouched."

### 9 · It's yours — 2:55–3:10

**Do.** **File → Show Library Folder in Finder**. The Finder window shows
`djtree.db` and `backups/`. Then the export button, showing the JSON file land
in Downloads.

**Say.** "No account, no server, no subscription. Your library is one SQLite
file in your Music folder — copy it, back it up, move it to another Mac. It
snapshots itself every time you open it, and the whole thing exports to JSON
you can hand to a friend. The only thing it ever sends anywhere is a check for
a new version when it opens."

### 10 · Close — 3:10–3:20

**Do.** Back to the full canvas. Press `f` to fit everything. Hold.

**Say.** "djtree. It's free, it's open source, and the link's below."

---

## The 45-second cut

For LinkedIn, where nobody watches past ten seconds without a reason. Pull these
straight out of the long take.

| Time | From | On screen | Say |
| --- | --- | --- | --- |
| 0:00–0:08 | Scene 1 | Pan across the branching graph | "Most DJ set planners give you one running order. A set doesn't work like that." |
| 0:08–0:16 | Scene 4 | Click a track, matches fill the panel | "Pick a track, and it ranks everything that mixes out of it — tempo, key, energy." |
| 0:16–0:26 | Scene 5 | The link form, cue points, bars | "Log the blends that actually work — cue points, bar count — and it remembers." |
| 0:26–0:38 | Scene 7 | Generate → results scrolling | "Tick the songs you know you want and it builds the set around them, marking which hops you've rehearsed and which it made up." |
| 0:38–0:45 | Scene 10 | Fit view, hold | "Free, open source, runs entirely on your Mac. Link below." |

---

## Things that film badly — avoid these

- **Empty states.** Never let the canvas, the library or a result list be empty
  on camera unless you're deliberately demoing the empty state.
- **The genre dropdown scrolled to the catalog.** Open it on a library that has
  genres in use, so the top of the list reads *In your library* with counts
  rather than a wall of genres nobody tagged.
- **Slow imports.** Scan a folder of 10–15 files, not 500. Tag reading is fast
  but a long list scrolling past looks like lag.
- **Narrating while clicking.** Record the screen silently, then voice over.
- **The quarantine step.** Don't show the install in the demo video. It needs
  its own 20-second clip, or a line in the description — dropped into a feature
  demo it reads as a warning.
- **Talking about the beam search early.** Nobody has bought in yet at 0:20.
  Keep the implementation for the last third, or the comments.

## Lower-third captions, if you use them

`Reads BPM and key from your files` · `Ranked matches, not guesses` ·
`Log the mixes that work` · `⌘-click to move a group` ·
`Locks your picks, fills the rest` · `rehearsed vs suggested` ·
`One SQLite file. No account.`
