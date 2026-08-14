import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import type {
  ImportRow, Setlist, Track, TrackDraft, Transition, TransitionDraft, TransitionPatch,
} from './types';

export type GraphStore = ReturnType<typeof useGraph>;

/** One reversible step. `run` puts the world back the way it was. */
type UndoEntry = { label: string; run: () => Promise<void> };

const UNDO_LIMIT = 50;

/** Fields a track edit can touch — used to snapshot values before a patch. */
const PATCHABLE = [
  'title', 'artist', 'bpm', 'music_key', 'energy', 'genre', 'notes', 'favorite', 'x', 'y',
] as const;

/**
 * Single source of truth for the graph. Reads hit the server once on load;
 * writes update local state optimistically so dragging stays at 60fps.
 *
 * Every mutation pushes its inverse onto an undo stack. The functions that
 * perform an undo deliberately do NOT record, or undo would undo itself.
 */
export function useGraph() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [transitions, setTransitions] = useState<Transition[]>([]);
  const [setlists, setSetlists] = useState<Setlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);

  // Undo closures are created once but run much later, so they read live data
  // through refs rather than capturing a stale render's state.
  const tracksRef = useRef(tracks);
  const transitionsRef = useRef(transitions);
  const setlistsRef = useRef(setlists);
  tracksRef.current = tracks;
  transitionsRef.current = transitions;
  setlistsRef.current = setlists;

  const report = useCallback((err: unknown) => {
    setError(err instanceof Error ? err.message : String(err));
  }, []);

  const record = useCallback((entry: UndoEntry) => {
    setUndoStack((prev) => [...prev, entry].slice(-UNDO_LIMIT));
  }, []);

  useEffect(() => {
    api
      .graph()
      .then((g) => {
        setTracks(g.tracks);
        setTransitions(g.transitions);
        setSetlists(g.setlists ?? []);
      })
      .catch(report)
      .finally(() => setLoading(false));
  }, [report]);

  /* ------------------------------------------------- primitives (no undo) */

  const applyPatch = useCallback(
    async (id: number, patch: Partial<TrackDraft>) => {
      setTracks((prev) => prev.map((t) => (t.id === id ? ({ ...t, ...patch } as Track) : t)));
      try {
        const saved = await api.updateTrack(id, patch);
        setTracks((prev) => prev.map((t) => (t.id === id ? saved : t)));
      } catch (err) {
        report(err);
      }
    },
    [report],
  );

  const applyDeleteTrack = useCallback(
    async (id: number) => {
      setTracks((prev) => prev.filter((t) => t.id !== id));
      setTransitions((prev) => prev.filter((t) => t.from_id !== id && t.to_id !== id));
      try {
        await api.deleteTrack(id);
      } catch (err) {
        report(err);
      }
    },
    [report],
  );

  const applyDeleteTransition = useCallback(
    async (id: number) => {
      setTransitions((prev) => prev.filter((t) => t.id !== id));
      try {
        await api.deleteTransition(id);
      } catch (err) {
        report(err);
      }
    },
    [report],
  );

  const applyRestore = useCallback(
    async (rows: { tracks?: Track[]; transitions?: Transition[]; setlists?: Setlist[] }) => {
      const t = rows.tracks ?? [];
      const tr = rows.transitions ?? [];
      const sl = rows.setlists ?? [];
      setTracks((prev) => {
        const have = new Set(prev.map((x) => x.id));
        return [...prev, ...t.filter((x) => !have.has(x.id))].sort((a, b) => a.id - b.id);
      });
      setTransitions((prev) => {
        const have = new Set(prev.map((x) => x.id));
        return [...prev, ...tr.filter((x) => !have.has(x.id))].sort((a, b) => a.id - b.id);
      });
      setSetlists((prev) => {
        const have = new Set(prev.map((x) => x.id));
        return [...prev, ...sl.filter((x) => !have.has(x.id))].sort((a, b) => a.id - b.id);
      });
      try {
        await api.restore(t, tr, sl);
      } catch (err) {
        report(err);
      }
    },
    [report],
  );

  const applyPositions = useCallback(
    async (positions: { id: number; x: number; y: number }[]) => {
      setTracks((prev) => {
        const moves = new Map(positions.map((p) => [p.id, p]));
        return prev.map((t) => {
          const move = moves.get(t.id);
          return move ? { ...t, x: move.x, y: move.y } : t;
        });
      });
      try {
        await api.savePositions(positions);
      } catch (err) {
        report(err);
      }
    },
    [report],
  );

  /* ------------------------------------------------- public (records undo) */

  const addTrack = useCallback(
    async (draft: TrackDraft) => {
      const track = await api.createTrack(draft);
      setTracks((prev) => [...prev, track]);
      record({
        label: `Add "${track.title}"`,
        run: () => applyDeleteTrack(track.id),
      });
      return track;
    },
    [record, applyDeleteTrack],
  );

  /**
   * Write a scanned folder into the library. One call rather than one per file,
   * so importing a thousand tracks is a single transaction and a single undo
   * step — and re-importing a folder updates instead of duplicating, which is
   * why the count of touched rows comes back separately.
   */
  const importTracks = useCallback(
    async (rows: ImportRow[]) => {
      const result = await api.importTracks(rows);
      if (result.added.length) {
        setTracks((prev) => [...prev, ...result.added]);
        record({
          label: `Import ${result.added.length} track${result.added.length === 1 ? '' : 's'}`,
          run: async () => {
            for (const track of result.added) await applyDeleteTrack(track.id);
          },
        });
      }
      return result;
    },
    [record, applyDeleteTrack],
  );

  const updateTrack = useCallback(
    async (id: number, patch: Partial<TrackDraft>, label?: string) => {
      const before = tracksRef.current.find((t) => t.id === id);
      if (before) {
        const previous: Partial<TrackDraft> = {};
        for (const field of PATCHABLE) {
          if (field in patch) {
            (previous as Record<string, unknown>)[field] = before[field];
          }
        }
        record({
          label: label ?? `Edit "${before.title}"`,
          run: () => applyPatch(id, previous),
        });
      }
      await applyPatch(id, patch);
    },
    [record, applyPatch],
  );

  const toggleFavorite = useCallback(
    (id: number) => {
      const current = tracksRef.current.find((t) => t.id === id);
      if (!current) return;
      const next = current.favorite ? 0 : 1;
      updateTrack(id, { favorite: next }, `${next ? 'Star' : 'Unstar'} "${current.title}"`);
    },
    [updateTrack],
  );

  const removeTrack = useCallback(
    async (id: number) => {
      const track = tracksRef.current.find((t) => t.id === id);
      if (!track) return;
      // Snapshot everything the cascade will take with it: edges, and the
      // position of this track inside any setlist that references it.
      const orphaned = transitionsRef.current.filter(
        (t) => t.from_id === id || t.to_id === id,
      );
      const affected = setlistsRef.current.filter((l) => l.track_ids.includes(id));
      record({
        label: `Delete "${track.title}"`,
        run: () =>
          applyRestore({ tracks: [track], transitions: orphaned, setlists: affected }),
      });
      // Keep local setlists in step with the server-side cascade.
      if (affected.length) {
        setSetlists((prev) =>
          prev.map((l) =>
            l.track_ids.includes(id)
              ? { ...l, track_ids: l.track_ids.filter((t) => t !== id) }
              : l,
          ),
        );
      }
      await applyDeleteTrack(id);
    },
    [record, applyDeleteTrack, applyRestore],
  );

  const moveTrack = useCallback((id: number, x: number, y: number) => {
    setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, x, y } : t)));
  }, []);

  const commitPositions = useCallback(
    (
      positions: { id: number; x: number; y: number }[],
      previous?: { id: number; x: number; y: number }[],
    ) => {
      if (!positions.length) return;
      if (previous?.length) {
        const track = tracksRef.current.find((t) => t.id === positions[0].id);
        record({
          label: `Move "${track?.title ?? 'track'}"`,
          run: () => applyPositions(previous),
        });
      }
      api.savePositions(positions).catch(report);
    },
    [record, applyPositions, report],
  );

  const connect = useCallback(
    async (from_id: number, to_id: number, draft?: TransitionDraft) => {
      if (from_id === to_id) return;
      const existing = transitionsRef.current.some(
        (t) => t.from_id === from_id && t.to_id === to_id,
      );
      try {
        const created = await api.createTransition(from_id, to_id, draft);
        setTransitions((prev) =>
          prev.some((t) => t.id === created.id) ? prev : [...prev, created],
        );
        if (!existing) {
          const to = tracksRef.current.find((t) => t.id === to_id);
          record({
            label: `Link to "${to?.title ?? 'track'}"`,
            run: () => applyDeleteTransition(created.id),
          });
        }
        return created;
      } catch (err) {
        report(err);
        return undefined;
      }
    },
    [record, applyDeleteTransition, report],
  );

  const updateTransition = useCallback(
    async (id: number, patch: TransitionPatch) => {
      const before = transitionsRef.current.find((t) => t.id === id);
      if (before) {
        const previous: TransitionPatch = {
          ...('label' in patch ? { label: before.label } : {}),
          ...('rating' in patch ? { rating: before.rating } : {}),
          ...('notes' in patch ? { notes: before.notes } : {}),
          ...('from_cue' in patch ? { from_cue: before.from_cue } : {}),
          ...('to_cue' in patch ? { to_cue: before.to_cue } : {}),
          ...('bars' in patch ? { bars: before.bars } : {}),
        };
        record({
          label: 'Edit transition',
          run: async () => {
            setTransitions((prev) =>
              prev.map((t) => (t.id === id ? ({ ...t, ...previous } as Transition) : t)),
            );
            await api.updateTransition(id, previous).catch(report);
          },
        });
      }
      setTransitions((prev) =>
        prev.map((t) => (t.id === id ? ({ ...t, ...patch } as Transition) : t)),
      );
      try {
        await api.updateTransition(id, patch);
      } catch (err) {
        report(err);
      }
    },
    [record, report],
  );

  const disconnect = useCallback(
    async (id: number) => {
      const transition = transitionsRef.current.find((t) => t.id === id);
      if (transition) {
        record({
          label: 'Unlink transition',
          run: () => applyRestore({ transitions: [transition] }),
        });
      }
      await applyDeleteTransition(id);
    },
    [record, applyDeleteTransition, applyRestore],
  );

  /* ----------------------------------------------------------- setlists */

  const applySetlistPatch = useCallback(
    async (id: number, patch: { name?: string; notes?: string; track_ids?: number[] }) => {
      setSetlists((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
      try {
        const saved = await api.updateSetlist(id, patch);
        setSetlists((prev) => prev.map((l) => (l.id === id ? saved : l)));
      } catch (err) {
        report(err);
      }
    },
    [report],
  );

  const applyDeleteSetlist = useCallback(
    async (id: number) => {
      setSetlists((prev) => prev.filter((l) => l.id !== id));
      try {
        await api.deleteSetlist(id);
      } catch (err) {
        report(err);
      }
    },
    [report],
  );

  const createSetlist = useCallback(
    async (name: string, trackIds: number[]) => {
      const created = await api.createSetlist(name, trackIds);
      setSetlists((prev) => [...prev, created]);
      record({
        label: `Create set "${created.name}"`,
        run: () => applyDeleteSetlist(created.id),
      });
      return created;
    },
    [record, applyDeleteSetlist],
  );

  const updateSetlist = useCallback(
    async (
      id: number,
      patch: { name?: string; notes?: string; track_ids?: number[] },
      label?: string,
    ) => {
      const before = setlistsRef.current.find((l) => l.id === id);
      if (before) {
        const previous: typeof patch = {};
        if ('name' in patch) previous.name = before.name;
        if ('notes' in patch) previous.notes = before.notes;
        if ('track_ids' in patch) previous.track_ids = [...before.track_ids];
        record({
          label: label ?? `Edit set "${before.name}"`,
          run: () => applySetlistPatch(id, previous),
        });
      }
      await applySetlistPatch(id, patch);
    },
    [record, applySetlistPatch],
  );

  /** Applies per-set position overrides without recording undo. */
  const applySetlistPositions = useCallback(
    async (id: number, positions: { track_id: number; x: number | null; y: number | null }[]) => {
      setSetlists((prev) =>
        prev.map((l) => {
          if (l.id !== id) return l;
          const next = new Map(l.positions.map((p) => [p.track_id, p]));
          for (const p of positions) {
            if (p.x == null || p.y == null) next.delete(p.track_id);
            else next.set(p.track_id, { track_id: p.track_id, x: p.x, y: p.y });
          }
          return { ...l, positions: [...next.values()] };
        }),
      );
      try {
        const saved = await api.saveSetlistPositions(id, positions);
        setSetlists((prev) => prev.map((l) => (l.id === id ? saved : l)));
      } catch (err) {
        report(err);
      }
    },
    [report],
  );

  /**
   * Records the inverse of a set-view move: the tracks' prior overrides, or an
   * explicit clear for tracks that had none.
   */
  const moveInSetlist = useCallback(
    async (id: number, positions: { track_id: number; x: number; y: number }[]) => {
      const list = setlistsRef.current.find((l) => l.id === id);
      if (list) {
        const had = new Map(list.positions.map((p) => [p.track_id, p]));
        const previous = positions.map((p) => {
          const prior = had.get(p.track_id);
          return prior
            ? { track_id: p.track_id, x: prior.x, y: prior.y }
            : { track_id: p.track_id, x: null, y: null };
        });
        record({
          label: `Move in "${list.name}"`,
          run: () => applySetlistPositions(id, previous),
        });
      }
      await applySetlistPositions(id, positions);
    },
    [record, applySetlistPositions],
  );

  const resetSetlistLayout = useCallback(
    async (id: number) => {
      const list = setlistsRef.current.find((l) => l.id === id);
      if (!list || !list.positions.length) return;
      const previous = list.positions.map((p) => ({ ...p }));
      record({
        label: `Reset "${list.name}" layout`,
        run: () => applySetlistPositions(id, previous),
      });
      setSetlists((prev) => prev.map((l) => (l.id === id ? { ...l, positions: [] } : l)));
      try {
        const saved = await api.resetSetlistPositions(id);
        setSetlists((prev) => prev.map((l) => (l.id === id ? saved : l)));
      } catch (err) {
        report(err);
      }
    },
    [record, applySetlistPositions, report],
  );

  const removeSetlist = useCallback(
    async (id: number) => {
      const list = setlistsRef.current.find((l) => l.id === id);
      if (!list) return;
      record({
        label: `Delete set "${list.name}"`,
        run: () => applyRestore({ setlists: [list] }),
      });
      await applyDeleteSetlist(id);
    },
    [record, applyDeleteSetlist, applyRestore],
  );

  /* -------------------------------------------------------------- undo */

  const undo = useCallback(async () => {
    const entry = undoStack[undoStack.length - 1];
    if (!entry) return;
    setUndoStack((prev) => prev.slice(0, -1));
    await entry.run();
    setStatus(`Undid: ${entry.label}`);
  }, [undoStack]);

  // Clear the status line a few seconds after it appears.
  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(null), 3500);
    return () => clearTimeout(timer);
  }, [status]);

  return {
    tracks,
    transitions,
    setlists,
    createSetlist,
    updateSetlist,
    removeSetlist,
    moveInSetlist,
    resetSetlistLayout,
    loading,
    error,
    status,
    /** Transient line in the status toast, cleared after a few seconds. */
    notify: setStatus,
    clearError: () => setError(null),
    undo,
    canUndo: undoStack.length > 0,
    nextUndoLabel: undoStack[undoStack.length - 1]?.label ?? null,
    addTrack,
    importTracks,
    updateTrack,
    toggleFavorite,
    removeTrack,
    moveTrack,
    commitPositions,
    connect,
    updateTransition,
    disconnect,
  };
}

/** Persists a value to localStorage so UI prefs survive a reload. */
export function useStickyState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* private browsing / quota — not worth surfacing */
    }
  }, [key, value]);

  return [value, setValue] as const;
}
