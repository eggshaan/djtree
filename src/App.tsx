import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Download, FolderOpen, Moon, PanelLeftOpen, PanelRightOpen, RotateCcw, Sun, Upload, Wand2, X,
} from 'lucide-react';
import { api } from './api';
import { Canvas, fitView } from './components/Canvas';
import { EdgeInspector } from './components/EdgeInspector';
import { GeneratorModal } from './components/GeneratorModal';
import { Inspector } from './components/Inspector';
import { Library } from './components/Library';
import { LinkForm } from './components/LinkForm';
import { TrackForm } from './components/TrackForm';
import { NODE_H, NODE_W } from './components/TrackNode';
import { importSummary, prepareImport } from './lib/import';
import { arrangeChain, type Positions } from './lib/layout';
import { download, importBundle, parseBundle, toBundle } from './lib/transfer';
import {
  DEFAULT_SETTINGS,
  findRoutes,
  rankMatches,
  tracePaths,
  type MatchSettings,
} from './lib/match';
import { useGraph, useStickyState } from './state';
import type { Track, TrackDraft, Viewport } from './types';

/** How many suggested next tracks get tinted on the canvas. */
const SUGGESTION_COUNT = 6;

type Theme = 'light' | 'dark';

export default function App() {
  return <Workspace />;
}

function Workspace() {
  const graph = useGraph();
  const stageRef = useRef<HTMLElement>(null);

  const [viewport, setViewport] = useState<Viewport>({ x: 60, y: 60, k: 1 });
  // Read inside effects that must not re-run on every pan.
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<number | null>(null);
  const [previewPath, setPreviewPath] = useState<number[]>([]);
  const [routeTargetId, setRouteTargetId] = useState<number | null>(null);
  const [form, setForm] = useState<{ track: Track | null; x: number; y: number } | null>(null);
  /** A link that's been drawn but not yet saved — the form is filling it in. */
  const [pendingLink, setPendingLink] = useState<{ fromId: number; toId: number } | null>(null);
  const [activeSetlistId, setActiveSetlistId] = useState<number | null>(null);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  /** In-flight drag inside a set view, held locally so it runs at 60fps. */
  const [layoutDraft, setLayoutDraft] = useState<Positions>(() => new Map());
  const fileInput = useRef<HTMLInputElement>(null);

  const [settings, setSettings] = useStickyState<MatchSettings>('djtree:settings', DEFAULT_SETTINGS);
  const [snapToGrid, setSnapToGrid] = useStickyState('djtree:snap', true);
  const [arrangeSets, setArrangeSets] = useStickyState('djtree:arrange', true);
  const [showLibrary, setShowLibrary] = useStickyState('djtree:library', true);
  const [showInspector, setShowInspector] = useStickyState('djtree:inspector', true);
  const [theme, setTheme] = useStickyState<Theme>(
    'djtree:theme',
    typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light',
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const { tracks, transitions, setlists } = graph;

  const activeSetlist = useMemo(
    () => setlists.find((l) => l.id === activeSetlistId) ?? null,
    [setlists, activeSetlistId],
  );

  /* The active set drives the canvas highlight, so a set and a traced path
   * never fight over the same channel — selecting a set clears any preview. */
  const setMemberIds = useMemo(() => {
    const known = new Set(tracks.map((t) => t.id));
    return (activeSetlist?.track_ids ?? []).filter((id) => known.has(id));
  }, [activeSetlist, tracks]);

  const highlightIds = setMemberIds.length ? setMemberIds : previewPath;

  /**
   * Selecting a set slides its tracks into a readable chain. These positions are
   * never saved — clearing the set animates everything back to where you left it.
   */
  const setLayout = useMemo(() => {
    if (!arrangeSets || setMemberIds.length < 2) return null;
    const byId = new Map(tracks.map((t) => [t.id, t]));
    const members = setMemberIds.map((id) => byId.get(id)!).filter(Boolean);
    if (members.length < 2) return null;

    // Auto chain first, then anything you dragged in this set, then the live drag.
    const positions = arrangeChain(members);
    for (const p of activeSetlist?.positions ?? []) {
      if (positions.has(p.track_id)) positions.set(p.track_id, { x: p.x, y: p.y });
    }
    for (const [id, p] of layoutDraft) {
      if (positions.has(id)) positions.set(id, p);
    }
    return positions;
  }, [arrangeSets, setMemberIds, tracks, activeSetlist, layoutDraft]);

  // A different set means a different workspace; drop any half-finished drag.
  useEffect(() => { setLayoutDraft(new Map()); }, [activeSetlistId]);

  /** Every genre string on file, so pickers can list what you actually use. */
  const genresInUse = useMemo(() => tracks.map((t) => t.genre ?? ''), [tracks]);

  const selected = useMemo(
    () => tracks.find((t) => t.id === selectedId) ?? null,
    [tracks, selectedId],
  );
  const selectedEdge = useMemo(
    () => transitions.find((t) => t.id === selectedEdgeId) ?? null,
    [transitions, selectedEdgeId],
  );

  /* ------------------------------------------------------------ derived */

  const connectedIds = useMemo(() => {
    const set = new Set<number>();
    if (selectedId == null) return set;
    for (const t of transitions) if (t.from_id === selectedId) set.add(t.to_id);
    return set;
  }, [transitions, selectedId]);

  const matches = useMemo(
    () => (selected ? rankMatches(selected, tracks, connectedIds, settings) : []),
    [selected, tracks, connectedIds, settings],
  );

  const suggestions = useMemo(() => {
    const map = new Map<number, number>();
    for (const m of matches.slice(0, SUGGESTION_COUNT)) map.set(m.track.id, m.score);
    return map;
  }, [matches]);

  const branches = useMemo(() => {
    if (selectedId == null) return [];
    const byId = new Map(tracks.map((t) => [t.id, t]));
    return transitions
      .filter((t) => t.from_id === selectedId)
      .map((transition) => ({ transition, to: byId.get(transition.to_id)! }))
      .filter((b) => b.to);
  }, [transitions, tracks, selectedId]);

  const paths = useMemo(
    () => (selected ? tracePaths(selected, tracks, transitions) : []),
    [selected, tracks, transitions],
  );

  const routes = useMemo(() => {
    if (!selected || routeTargetId == null) return [];
    const target = tracks.find((t) => t.id === routeTargetId);
    return target ? findRoutes(selected, target, tracks, transitions) : [];
  }, [selected, routeTargetId, tracks, transitions]);

  /* ------------------------------------------------------------ actions */

  const centerOn = useCallback((track: Track) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    setViewport((v) => ({
      ...v,
      x: rect.width / 2 - (track.x + NODE_W / 2) * v.k,
      y: rect.height / 2 - (track.y + NODE_H / 2) * v.k,
    }));
  }, []);

  const focusTrack = useCallback(
    (id: number) => {
      const track = tracks.find((t) => t.id === id);
      if (!track) return;
      setSelectedId(id);
      setSelectedEdgeId(null);
      centerOn(track);
    },
    [tracks, centerOn],
  );

  /**
   * Every way of drawing a link — dragging a handle onto a node, clicking a
   * suggested next track, clicking a set's dashed hop — lands here. Nothing is
   * written until the form has the cue sheet; an already-linked pair skips the
   * form and just opens the transition it would have duplicated.
   */
  const requestLink = useCallback(
    (fromId: number, toId: number) => {
      if (fromId === toId) return;
      const existing = transitions.find((t) => t.from_id === fromId && t.to_id === toId);
      if (existing) {
        setSelectedId(null);
        setSelectedEdgeId(existing.id);
        setShowInspector(true);
        return;
      }
      setPendingLink({ fromId, toId });
    },
    [transitions, setShowInspector],
  );

  // A different starting track invalidates whatever destination was picked.
  useEffect(() => { setRouteTargetId(null); }, [selectedId]);

  /*
   * Frame the chain when a set is arranged, and put the camera back where it was
   * when the set is released — otherwise the nodes fly home to somewhere
   * off-screen and you lose your place.
   */
  const cameraBeforeArrange = useRef<Viewport | null>(null);
  const wasArranged = useRef(false);
  useEffect(() => {
    const isArranged = !!setLayout;
    if (isArranged && !wasArranged.current) {
      cameraBeforeArrange.current = viewportRef.current;
      setViewport(fitView(tracks, stageRef.current, setLayout));
    } else if (!isArranged && wasArranged.current) {
      const saved = cameraBeforeArrange.current;
      if (saved) setViewport(saved);
      cameraBeforeArrange.current = null;
    }
    wasArranged.current = isArranged;
    // Only the arrange transition should move the camera, not every track edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setLayout]);

  /** Where a brand new node should land: beside the selection, else mid-view. */
  const nextSpot = useCallback(() => {
    if (selected) {
      const siblings = transitions.filter((t) => t.from_id === selected.id).length;
      return { x: selected.x + NODE_W + 100, y: selected.y + siblings * (NODE_H + 32) };
    }
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: Math.round((rect.width / 2 - viewport.x) / viewport.k - NODE_W / 2),
      y: Math.round((rect.height / 2 - viewport.y) / viewport.k - NODE_H / 2),
    };
  }, [selected, transitions, viewport]);

  const openAdd = useCallback(() => {
    const spot = nextSpot();
    setForm({ track: null, x: spot.x, y: spot.y });
  }, [nextSpot]);

  /**
   * Pick a folder, read the tags, write what came back. New nodes land in a
   * block under whatever is already on the canvas, so an import never buries
   * the graph you have been building.
   */
  const [importing, setImporting] = useState(false);
  const importFolder = useCallback(async () => {
    if (importing) return;
    setImporting(true);
    try {
      const scan = await api.chooseFolder();
      if (!scan) return; // dialog dismissed

      const bottom = tracks.length ? Math.max(...tracks.map((t) => t.y)) + NODE_H + 120 : 0;
      const { rows, skipped } = prepareImport(scan.rows, {
        origin: { x: 0, y: bottom },
        step: { x: NODE_W + 60, y: NODE_H + 48 },
        columns: Math.max(4, Math.ceil(Math.sqrt(scan.rows.length))),
      });

      const result = rows.length
        ? await graph.importTracks(rows)
        : { added: [], updated: 0 };

      graph.notify(
        importSummary({
          added: result.added.length,
          updated: result.updated,
          skipped: skipped.length,
          unreadable: scan.unreadable.length,
        }),
      );
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }, [importing, tracks, graph]);

  // File → Add Music Folder… reaches the same code path as the button.
  useEffect(() => api.onMenu((action) => {
    if (action === 'import') void importFolder();
  }), [importFolder]);

  const submitForm = useCallback(
    async (draft: TrackDraft) => {
      if (form?.track) {
        await graph.updateTrack(form.track.id, draft);
      } else {
        const created = await graph.addTrack(draft);
        setSelectedId(created.id);
      }
    },
    [form, graph],
  );

  const deleteSelected = useCallback(() => {
    if (selectedEdge) {
      graph.disconnect(selectedEdge.id);
      setSelectedEdgeId(null);
      return;
    }
    if (!selected) return;
    const linked = transitions.filter(
      (t) => t.from_id === selected.id || t.to_id === selected.id,
    ).length;
    const message = linked
      ? `Delete "${selected.title}" and its ${linked} transition${linked === 1 ? '' : 's'}?`
      : `Delete "${selected.title}"?`;
    if (!window.confirm(message)) return;
    graph.removeTrack(selected.id);
    setSelectedId(null);
    setPreviewPath([]);
  }, [selected, selectedEdge, transitions, graph]);

  /* ---------------------------------------------------------- keyboard */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing =
        el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (typing) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        graph.undo();
        return;
      }

      switch (e.key) {
        case 'Escape':
          setSelectedId(null);
          setSelectedEdgeId(null);
          setPreviewPath([]);
          break;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          deleteSelected();
          break;
        case '[':
          setShowLibrary((v) => !v);
          break;
        case ']':
          setShowInspector((v) => !v);
          break;
        case 'n':
          if (e.metaKey || e.ctrlKey) return;
          e.preventDefault();
          openAdd();
          break;
        case 'f':
          if (e.metaKey || e.ctrlKey) return;
          e.preventDefault();
          setViewport(fitView(tracks, stageRef.current, setLayout));
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deleteSelected, openAdd, tracks, setLayout, setShowLibrary, setShowInspector, graph]);

  /* ------------------------------------------------------------- render */

  if (graph.loading) {
    return <div className="boot">Loading your library…</div>;
  }

  return (
    <div className="app">
      {showLibrary && (
        <Library
          tracks={tracks}
          setlists={setlists}
          selectedId={selectedId}
          activeSetlistId={activeSetlistId}
          setMembers={new Set(setMemberIds)}
          onSelect={focusTrack}
          onAdd={openAdd}
          onToggleFavorite={graph.toggleFavorite}
          onActivateSetlist={(id) => {
            setActiveSetlistId(id);
            if (id != null) setPreviewPath([]);
          }}
          onRenameSetlist={(id, name) => graph.updateSetlist(id, { name }, 'Rename set')}
          onReorderSetlist={(id, trackIds) =>
            graph.updateSetlist(id, { track_ids: trackIds }, 'Edit set order')
          }
          onDeleteSetlist={graph.removeSetlist}
          onResetSetlistLayout={graph.resetSetlistLayout}
          onGenerate={() => setGeneratorOpen(true)}
          onCollapse={() => setShowLibrary(false)}
        />
      )}

      <main className="stage" ref={stageRef}>
        <div className="toolbar">
          {!showLibrary && (
            <button
              className="icon-btn"
              onClick={() => setShowLibrary(true)}
              title="Show library  ["
              aria-label="Show library"
            >
              <PanelLeftOpen size={16} />
            </button>
          )}

          <button className="ghost tiny" onClick={() => setGeneratorOpen(true)} title="Generate a set">
            <Wand2 size={13} aria-hidden="true" /> Generate
          </button>

          <button
            className="ghost tiny"
            onClick={importFolder}
            disabled={importing}
            title="Read a folder of audio files into the library  (⌘O)"
          >
            <FolderOpen size={13} aria-hidden="true" /> {importing ? 'Reading…' : 'Add music'}
          </button>

          <button
            className="ghost tiny"
            onClick={graph.undo}
            disabled={!graph.canUndo}
            title={
              graph.nextUndoLabel
                ? `Undo: ${graph.nextUndoLabel}  (⌘Z)`
                : 'Nothing to undo'
            }
          >
            <RotateCcw size={13} aria-hidden="true" /> Undo
          </button>

          <label className="toggle small">
            <input
              type="checkbox"
              checked={snapToGrid}
              onChange={(e) => setSnapToGrid(e.target.checked)}
            />
            Snap to grid
          </label>

          {activeSetlist ? (
            <>
              <span className="toolbar-chip">
                Showing <b>{activeSetlist.name}</b>
                <button
                  className="icon-btn tiny-btn"
                  onClick={() => setActiveSetlistId(null)}
                  title="Stop showing this set"
                  aria-label="Stop showing this set"
                >
                  <X size={12} />
                </button>
              </span>
              <label
                className="toggle small"
                title="Slide this set's tracks into a chain. Dragging here moves them inside this set only — the main canvas is untouched."
              >
                <input
                  type="checkbox"
                  checked={arrangeSets}
                  onChange={(e) => setArrangeSets(e.target.checked)}
                />
                Arrange as list
              </label>
            </>
          ) : previewPath.length > 0 && (
            <button className="ghost tiny" onClick={() => setPreviewPath([])}>
              Clear highlight
            </button>
          )}

          <span className="spacer" />

          <span className="muted small counts">
            {tracks.length} tracks · {transitions.length} transitions
          </span>

          <button
            className="icon-btn"
            onClick={() => download(toBundle({ tracks, transitions, setlists }))}
            title="Export the whole library as JSON"
            aria-label="Export library"
          >
            <Download size={15} />
          </button>

          <button
            className="icon-btn"
            onClick={() => fileInput.current?.click()}
            title="Import a djtree export (adds to this library)"
            aria-label="Import library"
          >
            <Upload size={15} />
          </button>

          <button
            className="icon-btn"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          {!showInspector && (
            <button
              className="icon-btn"
              onClick={() => setShowInspector(true)}
              title="Show panel  ]"
              aria-label="Show panel"
            >
              <PanelRightOpen size={16} />
            </button>
          )}
        </div>

        <Canvas
          tracks={tracks}
          transitions={transitions}
          viewport={viewport}
          setViewport={setViewport}
          selectedId={selectedId}
          selectedEdgeId={selectedEdgeId}
          snapToGrid={snapToGrid}
          suggestions={suggestions}
          highlightPath={highlightIds}
          layout={setLayout}
          onSelect={setSelectedId}
          onSelectEdge={setSelectedEdgeId}
          onMove={graph.moveTrack}
          onCommit={graph.commitPositions}
          onLayoutMove={(id, x, y) =>
            setLayoutDraft((prev) => new Map(prev).set(id, { x, y }))
          }
          onLayoutCommit={(id, x, y) => {
            if (activeSetlistId == null) return;
            // The optimistic store update takes over from the draft immediately.
            graph.moveInSetlist(activeSetlistId, [{ track_id: id, x, y }]);
            setLayoutDraft((prev) => {
              const next = new Map(prev);
              next.delete(id);
              return next;
            });
          }}
          onConnect={requestLink}
          onCreateAt={(x, y) => setForm({ track: null, x, y })}
          onToggleFavorite={graph.toggleFavorite}
        />
      </main>

      {showInspector &&
        (selectedEdge ? (
          <EdgeInspector
            transition={selectedEdge}
            from={tracks.find((t) => t.id === selectedEdge.from_id)!}
            to={tracks.find((t) => t.id === selectedEdge.to_id)!}
            onUpdate={(patch) => graph.updateTransition(selectedEdge.id, patch)}
            onDelete={() => {
              graph.disconnect(selectedEdge.id);
              setSelectedEdgeId(null);
            }}
            onFocus={focusTrack}
            onCollapse={() => setShowInspector(false)}
          />
        ) : (
          <Inspector
            track={selected}
            allTracks={tracks}
            matches={matches}
            paths={paths}
            routes={routes}
            routeTargetId={routeTargetId}
            onRouteTarget={setRouteTargetId}
            branches={branches}
            settings={settings}
            setSettings={setSettings}
            previewPath={previewPath}
            onPreviewPath={setPreviewPath}
            onConnect={(toId) => selected && requestLink(selected.id, toId)}
            onDisconnect={graph.disconnect}
            onFocus={focusTrack}
            onToggleFavorite={graph.toggleFavorite}
            onEdit={() => selected && setForm({ track: selected, x: selected.x, y: selected.y })}
            onDelete={deleteSelected}
            onCollapse={() => setShowInspector(false)}
          />
        ))}

      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = ''; // let the same file be picked again
          if (!file) return;
          try {
            const bundle = parseBundle(await file.text());
            const count = bundle.tracks.length;
            if (!window.confirm(
              `Add ${count} track${count === 1 ? '' : 's'} from this export to your library? `
              + 'Nothing already here is changed or removed.',
            )) return;
            const result = await importBundle(bundle);
            window.location.reload(); // simplest way to resync every id
            void result;
          } catch (err) {
            window.alert(err instanceof Error ? err.message : String(err));
          }
        }}
      />

      {generatorOpen && (
        <GeneratorModal
          tracks={tracks}
          transitions={transitions}
          settings={settings}
          onSave={async (name, trackIds) => {
            const created = await graph.createSetlist(name, trackIds);
            setActiveSetlistId(created.id);
            setPreviewPath([]);
            setShowLibrary(true);
          }}
          onClose={() => setGeneratorOpen(false)}
        />
      )}

      {pendingLink && (() => {
        const from = tracks.find((t) => t.id === pendingLink.fromId);
        const to = tracks.find((t) => t.id === pendingLink.toId);
        // A track deleted while the form was open leaves nothing to link.
        if (!from || !to) return null;
        return (
          <LinkForm
            from={from}
            to={to}
            onSubmit={async (draft) => {
              const created = await graph.connect(from.id, to.id, draft);
              // connect() reports failures as a toast; keep the form and the
              // typed cue sheet up rather than closing over a lost save.
              if (!created) throw new Error('That link could not be saved.');
              setSelectedId(null);
              setSelectedEdgeId(created.id);
              setShowInspector(true);
            }}
            onClose={() => setPendingLink(null)}
          />
        );
      })()}

      {form && (
        <TrackForm
          track={form.track}
          position={{ x: form.x, y: form.y }}
          genresInUse={genresInUse}
          onSubmit={submitForm}
          onClose={() => setForm(null)}
        />
      )}

      {graph.error && (
        <div className="toast" role="alert">
          <span>{graph.error}</span>
          <button className="icon-btn" onClick={graph.clearError} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}

      {graph.status && !graph.error && (
        <div className="toast info" role="status">
          <RotateCcw size={13} aria-hidden="true" />
          <span>{graph.status}</span>
        </div>
      )}
    </div>
  );
}
