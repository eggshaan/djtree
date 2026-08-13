import { useState } from 'react';
import {
  ChevronDown, ChevronRight, ChevronUp, ListMusic, Plus, RotateCcw, Trash2, Wand2, X,
} from 'lucide-react';
import { tempoFit } from '../lib/match';
import type { Setlist, Track } from '../types';

type Props = {
  setlists: Setlist[];
  tracks: Track[];
  /** The set currently highlighted on the canvas, if any. */
  activeId: number | null;
  onActivate: (id: number | null) => void;
  onRename: (id: number, name: string) => void;
  onReorder: (id: number, trackIds: number[]) => void;
  onDelete: (id: number) => void;
  onFocusTrack: (id: number) => void;
  onResetLayout: (id: number) => void;
  onGenerate: () => void;
};

/**
 * Accordion, not a drill-down: the list of sets and the Generate button stay
 * on screen while one set is expanded, so building a second set never means
 * navigating out of the first.
 */
export function SetlistPanel({
  setlists, tracks, activeId, onActivate, onRename, onReorder, onDelete, onFocusTrack,
  onResetLayout, onGenerate,
}: Props) {
  const byId = new Map(tracks.map((t) => [t.id, t]));

  return (
    <>
      <div className="library-add">
        <button className="primary block" onClick={onGenerate}>
          <Wand2 size={15} aria-hidden="true" /> Generate a set
        </button>
      </div>

      <div className="library-list">
        {setlists.map((list) => {
          const open = activeId === list.id;
          const present = list.track_ids.filter((id) => byId.has(id));
          const bpms = present.map((id) => byId.get(id)!.bpm);
          return (
            <div key={list.id} className={`set-block ${open ? 'open' : ''}`}>
              {/* Open, the name becomes the editable field, so the row must not
                  repeat it — and an input can't live inside a button. */}
              {open ? (
                <div className="set-row set-row-open">
                  <button
                    className="icon-btn tiny-btn"
                    onClick={() => onActivate(null)}
                    title="Collapse"
                    aria-label="Collapse"
                    aria-expanded
                  >
                    <ChevronDown size={13} />
                  </button>
                  <NameField name={list.name} onRename={(name) => onRename(list.id, name)} />
                  <button
                    className="icon-btn danger tiny-btn"
                    onClick={() => {
                      if (window.confirm(`Delete the set "${list.name}"? The tracks themselves stay.`)) {
                        onDelete(list.id);
                        onActivate(null);
                      }
                    }}
                    title="Delete this set"
                    aria-label="Delete this set"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ) : (
                <button
                  className="set-row"
                  onClick={() => onActivate(list.id)}
                  aria-expanded={false}
                >
                  <ChevronRight size={13} className="set-row-chevron" aria-hidden="true" />
                  <span className="set-row-main">
                    <span className="set-row-name">{list.name}</span>
                    <span className="set-row-meta">
                      {present.length} track{present.length === 1 ? '' : 's'}
                      {bpms.length > 1 && ` · ${Math.min(...bpms)}–${Math.max(...bpms)} BPM`}
                    </span>
                  </span>
                </button>
              )}

              {open && (
                <SetEditor
                  setlist={list}
                  byId={byId}
                  tracks={tracks}
                  onReorder={(ids) => onReorder(list.id, ids)}
                  onFocusTrack={onFocusTrack}
                  onResetLayout={() => onResetLayout(list.id)}
                />
              )}
            </div>
          );
        })}

        {!setlists.length && (
          <div className="empty-state">
            <ListMusic size={20} aria-hidden="true" />
            <p>No sets yet.</p>
            <p className="muted small">
              Generate one, or build it by hand after linking tracks on the canvas.
            </p>
          </div>
        )}
      </div>

      <footer className="library-footer muted">
        {setlists.length} set{setlists.length === 1 ? '' : 's'}
      </footer>
    </>
  );
}

/** Editable set name. Keyed by id upstream so switching sets reseeds it. */
function NameField({ name, onRename }: { name: string; onRename: (next: string) => void }) {
  const [value, setValue] = useState(name);
  return (
    <input
      className="set-name-input"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        const trimmed = value.trim();
        if (trimmed && trimmed !== name) onRename(trimmed);
        else if (!trimmed) setValue(name);
      }}
      aria-label="Set name"
    />
  );
}

function SetEditor({
  setlist, byId, tracks, onReorder, onFocusTrack, onResetLayout,
}: {
  setlist: Setlist;
  byId: Map<number, Track>;
  tracks: Track[];
  onReorder: (ids: number[]) => void;
  onFocusTrack: (id: number) => void;
  onResetLayout: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const moved = setlist.positions.length;

  const ids = setlist.track_ids.filter((id) => byId.has(id));
  const items = ids.map((id) => byId.get(id)!);
  const candidates = tracks.filter((t) => !ids.includes(t.id));

  const move = (index: number, delta: number) => {
    const next = [...ids];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onReorder(next);
  };

  return (
    <div className="set-body">
      <ol className="set-items">
        {items.map((track, i) => (
          <li key={track.id}>
            <div className="set-item">
              <span className="set-item-step">{i + 1}</span>
              <button className="set-item-main" onClick={() => onFocusTrack(track.id)}>
                <span className="set-item-title">{track.title}</span>
                <span className="set-item-sub">
                  {fmt(track.bpm)}
                  {track.music_key ? ` · ${track.music_key}` : ''}
                  {track.energy != null ? ` · E${track.energy}` : ''}
                </span>
              </button>
              <span className="set-item-tools">
                <button
                  className="icon-btn tiny-btn"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  title="Move up"
                  aria-label="Move up"
                >
                  <ChevronUp size={13} />
                </button>
                <button
                  className="icon-btn tiny-btn"
                  onClick={() => move(i, 1)}
                  disabled={i === items.length - 1}
                  title="Move down"
                  aria-label="Move down"
                >
                  <ChevronDown size={13} />
                </button>
                <button
                  className="icon-btn tiny-btn danger"
                  onClick={() => onReorder(ids.filter((id) => id !== track.id))}
                  title="Remove from set"
                  aria-label="Remove from set"
                >
                  <X size={13} />
                </button>
              </span>
            </div>
            {i < items.length - 1 && <HopStrip from={track} to={items[i + 1]} />}
          </li>
        ))}
      </ol>

      {!items.length && <p className="muted small set-empty">This set is empty.</p>}

      {moved > 0 && (
        <button className="ghost block set-reset" onClick={onResetLayout}>
          <RotateCcw size={12} aria-hidden="true" />
          Reset layout ({moved} moved)
        </button>
      )}

      {adding ? (
        <div className="set-add">
          <div className="set-add-head">
            <span className="muted small">Add to the end</span>
            <button className="icon-btn tiny-btn" onClick={() => setAdding(false)} aria-label="Cancel">
              <X size={13} />
            </button>
          </div>
          {candidates.map((t) => (
            <button
              key={t.id}
              className="set-add-row"
              onClick={() => { onReorder([...ids, t.id]); setAdding(false); }}
            >
              <span className="set-item-title">{t.title}</span>
              <span className="tag tag-blue">{fmt(t.bpm)}</span>
            </button>
          ))}
          {!candidates.length && <p className="muted small set-empty">Every track is already here.</p>}
        </div>
      ) : (
        <button className="ghost block set-add-btn" onClick={() => setAdding(true)}>
          <Plus size={13} aria-hidden="true" /> Add a track
        </button>
      )}
    </div>
  );
}

/** The mix move between two adjacent entries, so a bad edit is visible immediately. */
function HopStrip({ from, to }: { from: Track; to: Track }) {
  const fit = tempoFit(from, to);
  const off = Math.abs(fit.percent);
  const tone = off <= 3 ? 'good' : off <= 6 ? 'ok' : 'bad';
  return (
    <div className={`set-hop ${tone}`}>
      <span className="set-hop-stem" aria-hidden="true" />
      {off < 0.05 ? 'exact' : `${fit.percent > 0 ? '+' : '−'}${off.toFixed(1)}%`}
      {fit.label ? ` · ${fit.label}` : ''}
    </div>
  );
}

const fmt = (bpm: number) => (Number.isInteger(bpm) ? `${bpm}` : bpm.toFixed(1));
