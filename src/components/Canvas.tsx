import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize, ZoomIn, ZoomOut } from 'lucide-react';
import type { Positions } from '../lib/layout';
import type { Track, Transition, Viewport } from '../types';
import { tempoFit } from '../lib/match';
import { TrackNode, NODE_H, NODE_W } from './TrackNode';

export const GRID = 24;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.5;
/** How long nodes take to slide into and out of a set arrangement. */
const ARRANGE_MS = 480;

/**
 * Eases a 0..1 value toward `active`. The tween lives in React state rather than
 * CSS because the SVG edges are recomputed from node positions every frame — a
 * CSS transition would glide the nodes while the edges snapped instantly.
 */
function useTween(active: boolean, duration = ARRANGE_MS) {
  const [t, setT] = useState(active ? 1 : 0);
  /*
   * The live value is tracked in a ref that is only ever written from inside the
   * animation loop or an effect — never during render. Writing it during render
   * meant a render React discarded could leave the next animation starting from
   * a value that was never committed, stranding the tween part-way.
   */
  const value = useRef(t);

  useEffect(() => {
    const target = active ? 1 : 0;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      value.current = target;
      setT(target);
      return;
    }
    if (value.current === target) return;

    const from = value.current;
    let frame = 0;
    const started = performance.now();
    const settle = () => {
      value.current = target;
      setT(target);
    };
    const step = (now: number) => {
      const p = Math.min(1, (now - started) / duration);
      const eased = 1 - (1 - p) ** 3; // easeOutCubic
      const next = p >= 1 ? target : from + (target - from) * eased;
      value.current = next;
      setT(next);
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);

    /*
     * The animation is a nicety; arriving is not. requestAnimationFrame is
     * paused entirely while the tab is hidden, so without this a background
     * switch mid-slide would strand every node half-arranged. This guarantees
     * the end state; if the frames did run it's already there and a no-op.
     */
    const guarantee = setTimeout(settle, duration + 80);

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(guarantee);
    };
  }, [active, duration]);

  return t;
}

type Interaction =
  | { type: 'pan'; pointerX: number; pointerY: number; originX: number; originY: number }
  | {
      type: 'drag';
      /** The node under the pointer. Its snapped position sets the group's offset. */
      primary: number;
      /** Everything moving — the whole selection when the primary is part of one. */
      ids: number[];
      /** World point where the drag began. */
      origin: { x: number; y: number };
      /** Where each node sat before the drag, so the move can be undone. */
      start: Map<number, { x: number; y: number }>;
      moved: boolean;
      /** True when the drag edits the set view's layout, not the track itself. */
      inLayout: boolean;
    }
  | { type: 'link'; fromId: number; x: number; y: number; overId: number | null };

type Props = {
  tracks: Track[];
  transitions: Transition[];
  viewport: Viewport;
  setViewport: React.Dispatch<React.SetStateAction<Viewport>>;
  /** Every selected node. Dragging any one of them drags all of them. */
  selectedIds: Set<number>;
  selectedEdgeId: number | null;
  snapToGrid: boolean;
  /** trackId -> match score, used to tint suggested next tracks. */
  suggestions: Map<number, number>;
  /** Ordered track ids of the setlist being previewed. */
  highlightPath: number[];
  /**
   * Temporary positions for an arranged setlist, or null for stored positions.
   * Never persisted — releasing the set slides everything home.
   */
  layout: Positions | null;
  /** `additive` is a ⌘/⇧-click: add to or remove from the selection. */
  onSelect: (id: number | null, additive?: boolean) => void;
  onSelectEdge: (id: number | null) => void;
  onMove: (id: number, x: number, y: number) => void;
  onCommit: (
    positions: { id: number; x: number; y: number }[],
    previous?: { id: number; x: number; y: number }[],
  ) => void;
  /** Live drag inside a set view — local only, no persistence. */
  onLayoutMove: (moves: { id: number; x: number; y: number }[]) => void;
  /** Drag finished inside a set view; persist to that set's overrides. */
  onLayoutCommit: (moves: { id: number; x: number; y: number }[]) => void;
  onConnect: (fromId: number, toId: number) => void;
  onCreateAt: (x: number, y: number) => void;
  onToggleFavorite: (id: number) => void;
};

export function Canvas({
  tracks,
  transitions,
  viewport,
  setViewport,
  selectedIds,
  selectedEdgeId,
  snapToGrid,
  suggestions,
  highlightPath,
  layout,
  onSelect,
  onSelectEdge,
  onMove,
  onCommit,
  onLayoutMove,
  onLayoutCommit,
  onConnect,
  onCreateAt,
  onToggleFavorite,
}: Props) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [interaction, setInteraction] = useState<Interaction | null>(null);

  const byId = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);

  // Hold the last arrangement so releasing a set has somewhere to animate from.
  const lastLayout = useRef<Positions | null>(null);
  if (layout) lastLayout.current = layout;
  const arrangeT = useTween(!!layout);
  const arranged = arrangeT > 0.001;

  /** Where a node is drawn right now: stored position, blended toward the set layout. */
  const posOf = useCallback(
    (track: Track) => {
      const target = arranged ? lastLayout.current?.get(track.id) : undefined;
      if (!target) return { x: track.x, y: track.y };
      return {
        x: track.x + (target.x - track.x) * arrangeT,
        y: track.y + (target.y - track.y) * arrangeT,
      };
    },
    [arranged, arrangeT],
  );

  /** Screen (client) coords -> world coords. */
  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = surfaceRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - viewport.x) / viewport.k,
        y: (clientY - rect.top - viewport.y) / viewport.k,
      };
    },
    [viewport],
  );

  /* ------------------------------------------------------------ pointers */

  const onSurfacePointerDown = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.surface) return;
    onSelect(null);
    onSelectEdge(null);
    setInteraction({
      type: 'pan',
      pointerX: e.clientX,
      pointerY: e.clientY,
      originX: viewport.x,
      originY: viewport.y,
    });
  };

  const startNodeDrag = (e: React.PointerEvent, track: Track) => {
    e.stopPropagation();
    const additive = e.metaKey || e.ctrlKey || e.shiftKey;

    /*
     * Grabbing a node that is already part of a selection moves the whole
     * selection — the Finder rule. Grabbing anything else selects just it, so a
     * plain drag never silently carries nodes you forgot were selected.
     */
    const group = additive || selectedIds.has(track.id)
      ? new Set(selectedIds).add(track.id)
      : new Set([track.id]);

    onSelect(track.id, additive);
    onSelectEdge(null);

    // Mid-animation the displayed position is a blend, so wait for it to settle.
    const inLayout = !!layout && arrangeT > 0.99;
    if (arranged && !inLayout) return;
    // A ⌘-click that deselects the node shouldn't then drag it.
    if (additive && selectedIds.has(track.id)) return;

    const start = new Map<number, { x: number; y: number }>();
    for (const id of group) {
      const member = byId.get(id);
      if (member) start.set(id, inLayout ? posOf(member) : { x: member.x, y: member.y });
    }

    setInteraction({
      type: 'drag',
      primary: track.id,
      ids: [...start.keys()],
      origin: toWorld(e.clientX, e.clientY),
      start,
      moved: false,
      inLayout,
    });
  };

  const startLink = (e: React.PointerEvent, track: Track) => {
    e.stopPropagation();
    const p = toWorld(e.clientX, e.clientY);
    setInteraction({ type: 'link', fromId: track.id, x: p.x, y: p.y, overId: null });
  };

  useEffect(() => {
    if (!interaction) return;

    const move = (e: PointerEvent) => {
      if (interaction.type === 'pan') {
        setViewport((v) => ({
          ...v,
          x: interaction.originX + (e.clientX - interaction.pointerX),
          y: interaction.originY + (e.clientY - interaction.pointerY),
        }));
        return;
      }

      const p = toWorld(e.clientX, e.clientY);

      if (interaction.type === 'drag') {
        // One delta for the whole group, so relative spacing survives the drag.
        const dx = p.x - interaction.origin.x;
        const dy = p.y - interaction.origin.y;
        const moves = interaction.ids.flatMap((id) => {
          const from = interaction.start.get(id);
          return from ? [{ id, x: from.x + dx, y: from.y + dy }] : [];
        });

        if (interaction.inLayout) onLayoutMove(moves);
        else for (const m of moves) onMove(m.id, m.x, m.y);
        if (!interaction.moved) setInteraction({ ...interaction, moved: true });
        return;
      }

      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const hit = el?.closest<HTMLElement>('[data-track-id]');
      const overId = hit ? Number(hit.dataset.trackId) : null;
      setInteraction({
        ...interaction,
        x: p.x,
        y: p.y,
        overId: overId === interaction.fromId ? null : overId,
      });
    };

    const up = () => {
      if (interaction.type === 'drag' && interaction.moved) {
        const primary = byId.get(interaction.primary);
        const from = interaction.start.get(interaction.primary);
        if (primary && from) {
          /*
           * Snapping is measured on the node you were actually holding and then
           * applied to the group as one offset. Snapping each node on its own
           * would quietly re-space a selection that was already arranged.
           */
          const live = interaction.inLayout ? posOf(primary) : { x: primary.x, y: primary.y };
          const snapX = snapToGrid ? Math.round(live.x / GRID) * GRID : live.x;
          const snapY = snapToGrid ? Math.round(live.y / GRID) * GRID : live.y;
          const dx = snapX - from.x;
          const dy = snapY - from.y;

          const next = interaction.ids.flatMap((id) => {
            const base = interaction.start.get(id);
            return base ? [{ id, x: base.x + dx, y: base.y + dy }] : [];
          });
          const previous = interaction.ids.flatMap((id) => {
            const base = interaction.start.get(id);
            return base ? [{ id, x: base.x, y: base.y }] : [];
          });

          if (interaction.inLayout) {
            if (snapToGrid) onLayoutMove(next);
            onLayoutCommit(next);
          } else {
            if (snapToGrid) for (const m of next) onMove(m.id, m.x, m.y);
            onCommit(next, previous);
          }
        }
      }
      if (interaction.type === 'link' && interaction.overId != null) {
        onConnect(interaction.fromId, interaction.overId);
      }
      setInteraction(null);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [
    interaction, byId, snapToGrid, toWorld, posOf,
    onMove, onCommit, onLayoutMove, onLayoutCommit, onConnect, setViewport,
  ]);

  /* --------------------------------------------------------------- zoom */

  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;

      // Trackpad pinch arrives as ctrlKey+wheel; plain wheel scrolls the canvas.
      if (e.ctrlKey || e.metaKey) {
        setViewport((v) => {
          const k = clamp(v.k * Math.exp(-e.deltaY * 0.01), MIN_ZOOM, MAX_ZOOM);
          const scale = k / v.k;
          return { k, x: px - (px - v.x) * scale, y: py - (py - v.y) * scale };
        });
      } else {
        setViewport((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setViewport]);

  /* -------------------------------------------------------------- render */

  const pathEdges = useMemo(() => {
    const set = new Set<string>();
    for (let i = 0; i < highlightPath.length - 1; i++) {
      set.add(`${highlightPath[i]}->${highlightPath[i + 1]}`);
    }
    return set;
  }, [highlightPath]);

  const pathNodes = useMemo(() => new Set(highlightPath), [highlightPath]);

  const savedPairs = useMemo(
    () => new Set(transitions.map((t) => `${t.from_id}>${t.to_id}`)),
    [transitions],
  );

  /**
   * Consecutive members of the highlighted set that have no saved transition
   * between them. These get a dashed connector so the chain reads as one run
   * instead of breaking wherever a hop hasn't been rehearsed yet.
   *
   * Only drawn while the set is arranged: over scattered nodes the same lines
   * criss-cross the canvas and read as noise rather than a running order.
   */
  const ghostHops = useMemo(() => {
    if (!arranged) return [];
    const hops: { from: Track; to: Track }[] = [];
    for (let i = 0; i < highlightPath.length - 1; i++) {
      const fromId = highlightPath[i];
      const toId = highlightPath[i + 1];
      if (savedPairs.has(`${fromId}>${toId}`)) continue;
      const from = byId.get(fromId);
      const to = byId.get(toId);
      if (from && to) hops.push({ from, to });
    }
    return hops;
  }, [arranged, highlightPath, savedPairs, byId]);

  const transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.k})`;

  return (
    <div
      ref={surfaceRef}
      className={`canvas ${interaction?.type === 'pan' ? 'panning' : ''}`}
      data-surface="true"
      onPointerDown={onSurfacePointerDown}
      onDoubleClick={(e) => {
        if (e.target !== e.currentTarget) return;
        const p = toWorld(e.clientX, e.clientY);
        onCreateAt(Math.round(p.x - NODE_W / 2), Math.round(p.y - NODE_H / 2));
      }}
      style={{
        backgroundSize: `${GRID * viewport.k}px ${GRID * viewport.k}px`,
        backgroundPosition: `${viewport.x}px ${viewport.y}px`,
      }}
    >
      <svg className="edges" aria-hidden="true">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5"
                  markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
          {/* A marker can't inherit the referencing path's colour, so the
              provisional arrowhead names the accent explicitly. */}
          <marker id="arrow-ghost" viewBox="0 0 10 10" refX="9" refY="5"
                  markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent)" />
          </marker>
        </defs>
        <g style={{ transform, transformOrigin: '0 0' }}>
          {transitions.map((t) => {
            const from = byId.get(t.from_id);
            const to = byId.get(t.to_id);
            if (!from || !to) return null;

            const a = posOf(from);
            const b = posOf(to);
            const x1 = a.x + NODE_W;
            const y1 = a.y + NODE_H / 2;
            const x2 = b.x;
            const y2 = b.y + NODE_H / 2;
            const bend = Math.max(40, Math.abs(x2 - x1) * 0.5);
            const d = `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;

            const fit = tempoFit(from, to);
            const off = Math.abs(fit.percent);
            const tone = off <= 3 ? 'good' : off <= 6 ? 'ok' : 'bad';
            const onPath = pathEdges.has(`${t.from_id}->${t.to_id}`);
            const classes = [
              'edge',
              `tone-${tone}`,
              selectedEdgeId === t.id ? 'selected' : '',
              onPath ? 'on-path' : '',
              highlightPath.length && !onPath ? 'dimmed' : '',
            ].join(' ');

            const label = t.label || (fit.label ? fit.label : `${off.toFixed(1)}%`);

            return (
              <g key={t.id} className={classes}>
                <path
                  className="edge-hit"
                  d={d}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onSelectEdge(t.id);
                    onSelect(null);
                  }}
                />
                <path className="edge-line" d={d} markerEnd="url(#arrow)" />
                <text className="edge-label" x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 8}>
                  {label}
                </text>
              </g>
            );
          })}

          {ghostHops.map(({ from, to }) => {
            const a = posOf(from);
            const b = posOf(to);
            const x1 = a.x + NODE_W;
            const y1 = a.y + NODE_H / 2;
            const x2 = b.x;
            const y2 = b.y + NODE_H / 2;
            const bend = Math.max(40, Math.abs(x2 - x1) * 0.5);
            const d = `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;

            const fit = tempoFit(from, to);
            const off = Math.abs(fit.percent);

            return (
              <g
                className="edge ghost-edge"
                key={`ghost-${from.id}-${to.id}`}
                style={{ opacity: arrangeT }}
              >
                <title>
                  {`${from.title} → ${to.title} isn't saved yet. Click to add it as a transition.`}
                </title>
                <path
                  className="edge-hit"
                  d={d}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onConnect(from.id, to.id);
                  }}
                />
                <path className="edge-line" d={d} markerEnd="url(#arrow-ghost)" />
                <text className="edge-label" x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 8}>
                  {off < 0.05 ? 'exact' : `${fit.percent > 0 ? '+' : '−'}${off.toFixed(1)}%`}
                </text>
              </g>
            );
          })}

          {interaction?.type === 'link' && (() => {
            const from = byId.get(interaction.fromId);
            if (!from) return null;
            const origin = posOf(from);
            const x1 = origin.x + NODE_W;
            const y1 = origin.y + NODE_H / 2;
            const bend = Math.max(40, Math.abs(interaction.x - x1) * 0.5);
            return (
              <path
                className="edge-line linking"
                d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${interaction.x - bend} ${interaction.y}, ${interaction.x} ${interaction.y}`}
                markerEnd="url(#arrow)"
              />
            );
          })()}
        </g>
      </svg>

      <div className="world" style={{ transform }}>
        {tracks.map((track) => {
          const p = posOf(track);
          return (
          <TrackNode
            key={track.id}
            track={track}
            x={p.x}
            y={p.y}
            locked={arranged && !(!!layout && arrangeT > 0.99)}
            selected={selectedIds.has(track.id)}
            dragging={interaction?.type === 'drag' && interaction.ids.includes(track.id)}
            linkTarget={interaction?.type === 'link' && interaction.overId === track.id}
            linkSource={interaction?.type === 'link' && interaction.fromId === track.id}
            suggestion={suggestions.get(track.id) ?? null}
            onPath={pathNodes.has(track.id)}
            dimmed={highlightPath.length > 0 && !pathNodes.has(track.id)}
            pathIndex={highlightPath.indexOf(track.id)}
            onPointerDown={(e) => startNodeDrag(e, track)}
            onHandlePointerDown={(e) => startLink(e, track)}
            onToggleFavorite={() => onToggleFavorite(track.id)}
          />
          );
        })}
      </div>

      <div className="zoom-controls">
        <button
          onClick={() => setViewport((v) => zoomAround(v, surfaceRef.current, 1.2))}
          title="Zoom in"
          aria-label="Zoom in"
        >
          <ZoomIn size={15} />
        </button>
        <button
          onClick={() => setViewport((v) => zoomAround(v, surfaceRef.current, 1 / 1.2))}
          title="Zoom out"
          aria-label="Zoom out"
        >
          <ZoomOut size={15} />
        </button>
        <button
          onClick={() => setViewport(fitView(tracks, surfaceRef.current, layout))}
          title="Fit all tracks  (f)"
          aria-label="Fit all tracks"
        >
          <Maximize size={15} />
        </button>
        <span className="zoom-level">{Math.round(viewport.k * 100)}%</span>
      </div>

      {tracks.length === 0 && (
        <div className="canvas-empty">
          <p>No tracks yet.</p>
          <p className="muted">Double-click anywhere on the grid to add one.</p>
        </div>
      )}
    </div>
  );
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function zoomAround(v: Viewport, el: HTMLElement | null, factor: number): Viewport {
  const rect = el?.getBoundingClientRect();
  const px = (rect?.width ?? 0) / 2;
  const py = (rect?.height ?? 0) / 2;
  const k = clamp(v.k * factor, MIN_ZOOM, MAX_ZOOM);
  const scale = k / v.k;
  return { k, x: px - (px - v.x) * scale, y: py - (py - v.y) * scale };
}

/**
 * Slides the view onto `tracks` without touching the zoom.
 *
 * Selecting a set used to call `fitView`, which reads the whole library's
 * bounding box — so opening a four-track set zoomed all the way out to wherever
 * your furthest unrelated node happened to sit. This only pans: the nodes stay
 * exactly the size you were working at, and the set arrives in the middle.
 */
export function centerOnTracks(
  tracks: Track[],
  el: HTMLElement | null,
  positions: Positions | null,
  current: Viewport,
): Viewport {
  if (!tracks.length) return current;
  const rect = el?.getBoundingClientRect();
  const width = rect?.width ?? 1200;
  const height = rect?.height ?? 800;

  const at = (t: Track) => positions?.get(t.id) ?? { x: t.x, y: t.y };
  const minX = Math.min(...tracks.map((t) => at(t).x));
  const minY = Math.min(...tracks.map((t) => at(t).y));
  const maxX = Math.max(...tracks.map((t) => at(t).x + NODE_W));
  const maxY = Math.max(...tracks.map((t) => at(t).y + NODE_H));

  return {
    k: current.k,
    x: width / 2 - ((minX + maxX) / 2) * current.k,
    y: height / 2 - ((minY + maxY) / 2) * current.k,
  };
}

/**
 * Frames every track. `positions` overrides stored coordinates so fitting while
 * a set is arranged frames what's actually on screen.
 */
export function fitView(
  tracks: Track[],
  el: HTMLElement | null,
  positions?: Positions | null,
): Viewport {
  const rect = el?.getBoundingClientRect();
  const width = rect?.width ?? 1200;
  const height = rect?.height ?? 800;
  if (!tracks.length) return { x: width / 2 - NODE_W / 2, y: height / 2 - NODE_H / 2, k: 1 };

  const at = (t: Track) => positions?.get(t.id) ?? { x: t.x, y: t.y };
  const pad = 80;
  const minX = Math.min(...tracks.map((t) => at(t).x));
  const minY = Math.min(...tracks.map((t) => at(t).y));
  const maxX = Math.max(...tracks.map((t) => at(t).x + NODE_W));
  const maxY = Math.max(...tracks.map((t) => at(t).y + NODE_H));

  const k = clamp(
    Math.min((width - pad * 2) / (maxX - minX || 1), (height - pad * 2) / (maxY - minY || 1)),
    MIN_ZOOM,
    1.2,
  );
  return {
    k,
    x: width / 2 - ((minX + maxX) / 2) * k,
    y: height / 2 - ((minY + maxY) / 2) * k,
  };
}
