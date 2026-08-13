import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Sparkles, Star, Wand2 } from 'lucide-react';
import { GenreChips, GenrePicker } from './GenrePicker';
import {
  ENERGY_SHAPES,
  energyTarget,
  generateSetlists,
  type EnergyShape,
  type GeneratedSet,
} from '../lib/generate';
import { genreTone, matchesGenres, normalizeGenre } from '../lib/genres';
import type { MatchSettings } from '../lib/match';
import type { Track, Transition } from '../types';

type Props = {
  tracks: Track[];
  transitions: Transition[];
  settings: MatchSettings;
  onSave: (name: string, trackIds: number[]) => Promise<void> | void;
  onClose: () => void;
};

export function GeneratorModal({ tracks, transitions, settings, onSave, onClose }: Props) {
  const [genres, setGenres] = useState<string[]>([]);
  const [cohesion, setCohesion] = useState(true);
  const [pool, setPool] = useState<Set<number>>(() => new Set(tracks.map((t) => t.id)));
  const [length, setLength] = useState(() => Math.min(6, Math.max(2, tracks.length)));
  const [shape, setShape] = useState<EnergyShape>('build');
  const [results, setResults] = useState<GeneratedSet[] | null>(null);
  const [reached, setReached] = useState<{ got: number; want: number } | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  /** Where a ⇧-click measures its range from. */
  const anchor = useRef<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const genresInUse = useMemo(() => tracks.map((t) => t.genre ?? ''), [tracks]);

  /** The rows the picker shows: everything, narrowed by the genre filter. */
  const listed = useMemo(
    () => tracks.filter((t) => matchesGenres(t.genre ?? '', genres)),
    [tracks, genres],
  );

  /* Choosing genres is the first question, so it re-stocks the song list rather
   * than quietly leaving a selection from the previous genre behind. */
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    setPool(new Set(listed.map((t) => t.id)));
    anchor.current = null;
    // Only a change of genre re-stocks; editing the pool by hand must not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genres]);

  const poolTracks = useMemo(
    () => listed.filter((t) => pool.has(t.id)),
    [listed, pool],
  );
  const maxLength = Math.max(2, poolTracks.length);

  /**
   * Finder-style selection: a plain click takes just that track, ⌘/Ctrl-click
   * toggles one, ⇧-click adds everything between it and the last click.
   */
  const clickRow = (e: React.MouseEvent, id: number, index: number) => {
    const additive = e.metaKey || e.ctrlKey;
    const ranged = e.shiftKey && anchor.current != null;

    if (ranged) {
      const start = listed.findIndex((t) => t.id === anchor.current);
      if (start >= 0) {
        const [lo, hi] = start < index ? [start, index] : [index, start];
        const span = listed.slice(lo, hi + 1).map((t) => t.id);
        setPool((prev) => {
          const next = new Set(prev);
          for (const trackId of span) next.add(trackId);
          return next;
        });
        return;
      }
    }

    anchor.current = id;
    if (additive) {
      setPool((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      return;
    }
    // A bare click means "just this one" — the quick buttons above put the rest back.
    setPool(new Set([id]));
  };

  const selectAll = () => {
    setPool(new Set(listed.map((t) => t.id)));
    anchor.current = null;
  };

  const run = () => {
    const outcome = generateSetlists({
      pool: poolTracks,
      length: Math.min(length, maxLength),
      shape,
      transitions,
      settings,
      genreCohesion: cohesion ? 1 : 0,
    });
    setResults(outcome.sets);
    setReached(
      outcome.reachedLength < outcome.requested
        ? { got: outcome.reachedLength, want: outcome.requested }
        : null,
    );
    setChosen(outcome.sets.length ? 0 : null);
    setName(defaultName(shape, outcome.sets[0]?.tracks.length ?? 0, genres));
  };

  const save = async () => {
    if (chosen == null || !results?.[chosen]) return;
    setBusy(true);
    try {
      await onSave(name.trim() || 'Untitled set', results[chosen].tracks.map((t) => t.id));
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal-wide">
        <header className="gen-head">
          <h2><Wand2 size={16} aria-hidden="true" /> Generate a set</h2>
          <p className="muted small">
            Beam search over your library. It prefers transitions you've already saved and
            marks any it had to invent.
          </p>
        </header>

        {!results ? (
          <>
            <section className="gen-genres">
              <div className="gen-block-head">
                <h3>Which genres</h3>
                <span className="muted small">
                  {genres.length ? `${listed.length} matching tracks` : 'Any genre'}
                </span>
              </div>
              <div className="gen-genre-row">
                <GenrePicker
                  values={genres}
                  onChange={setGenres}
                  genresInUse={genresInUse}
                  multiple
                  untagged
                  placeholder="Any genre — pick one or more"
                />
                <label
                  className={`toggle ${cohesion ? 'on' : ''}`}
                  title="Prefer moving between tracks that sit in the same genre or family, instead of jumping rooms mid-set."
                >
                  <input
                    type="checkbox"
                    checked={cohesion}
                    onChange={(e) => setCohesion(e.target.checked)}
                  />
                  Keep genres close
                </label>
              </div>
              <GenreChips
                values={genres}
                onRemove={(v) => setGenres(genres.filter((g) => g !== v))}
              />
            </section>

            <div className="gen-grid">
              <section className="gen-block">
                <div className="gen-block-head">
                  <h3>Use these tracks</h3>
                  <div className="gen-quick">
                    <button className="ghost tiny" onClick={selectAll}>All</button>
                    <button className="ghost tiny" onClick={() => { setPool(new Set()); anchor.current = null; }}>
                      None
                    </button>
                    <button
                      className="ghost tiny"
                      onClick={() => {
                        setPool(new Set(listed.filter((t) => t.favorite).map((t) => t.id)));
                        anchor.current = null;
                      }}
                    >
                      <Star size={11} aria-hidden="true" /> Starred
                    </button>
                  </div>
                </div>
                <div
                  className="gen-pool"
                  tabIndex={-1}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
                      e.preventDefault();
                      selectAll();
                    }
                  }}
                >
                  {listed.map((t, i) => {
                    const on = pool.has(t.id);
                    const genre = normalizeGenre(t.genre ?? '');
                    return (
                      <button
                        key={t.id}
                        className={`pool-row ${on ? 'on' : ''}`}
                        onClick={(e) => clickRow(e, t.id, i)}
                        aria-pressed={on}
                      >
                        <span className="pool-check">{on && <Check size={12} />}</span>
                        <span className="pool-title">{t.title}</span>
                        {genre && <span className={`tag tag-${genreTone(genre)} pool-genre`}>{genre}</span>}
                        <span className="tag tag-blue">{fmt(t.bpm)}</span>
                        {t.music_key && <span className="tag tag-purple">{t.music_key}</span>}
                        {t.energy != null && <span className="tag tag-orange">E{t.energy}</span>}
                      </button>
                    );
                  })}

                  {!listed.length && (
                    <p className="muted pad small">No track carries the genres you picked.</p>
                  )}
                </div>
                <p className="muted small pool-hint">
                  {poolTracks.length} of {listed.length} selected · click picks one,
                  ⌘-click adds, ⇧-click adds a range
                </p>
              </section>

              <section className="gen-block">
                <h3>How many tracks</h3>
                <div className="gen-length">
                  <input
                    type="range"
                    min={2}
                    max={maxLength}
                    value={Math.min(length, maxLength)}
                    onChange={(e) => setLength(Number(e.target.value))}
                  />
                  <span className="gen-length-value">{Math.min(length, maxLength)}</span>
                </div>

                <h3>Energy shape</h3>
                <div className="gen-shapes">
                  {ENERGY_SHAPES.map((s) => (
                    <button
                      key={s.id}
                      className={`shape-card ${shape === s.id ? 'on' : ''}`}
                      onClick={() => setShape(s.id)}
                      aria-pressed={shape === s.id}
                    >
                      <ShapeSpark shape={s.id} />
                      <span className="shape-label">{s.label}</span>
                      <span className="shape-blurb">{s.blurb}</span>
                    </button>
                  ))}
                </div>
              </section>
            </div>

            <div className="modal-actions">
              <button type="button" className="ghost" onClick={onClose}>Cancel</button>
              <button
                type="button"
                className="primary"
                onClick={run}
                disabled={poolTracks.length < 2}
                title={poolTracks.length < 2 ? 'Pick at least two tracks' : undefined}
              >
                <Sparkles size={14} aria-hidden="true" /> Generate
              </button>
            </div>
          </>
        ) : (
          <>
            {reached && (
              <p className="gen-warn">
                Could only chain {reached.got} of the {reached.want} tracks you asked for — the rest
                of your pool has no tempo bridge within ±{settings.tolerance}%. Widen the tolerance
                in the details panel, or add tracks that sit between them.
              </p>
            )}

            {!results.length ? (
              <p className="muted pad">
                No set came out of that pool. Two tracks need to be within ±{settings.tolerance}% of
                each other (or a half/double-time multiple) before they can sit next to each other.
              </p>
            ) : (
              <div className="gen-results">
                {results.map((set, i) => (
                  <button
                    key={i}
                    className={`result-card ${chosen === i ? 'on' : ''}`}
                    onClick={() => { setChosen(i); setName(defaultName(shape, set.tracks.length, genres)); }}
                    aria-pressed={chosen === i}
                  >
                    <div className="result-head">
                      <span className="result-score">{Math.round(set.score)}</span>
                      <span className="result-meta">
                        {set.tracks.length} tracks
                        <span className="muted"> · energy fit {Math.round(set.energyFit)}</span>
                        <span className="muted"> · {set.savedCount}/{set.hops.length} rehearsed</span>
                        {set.genres.length > 0 && (
                          <span className="muted"> · {set.genres.join(', ')}</span>
                        )}
                      </span>
                    </div>
                    <ol className="result-list">
                      {set.tracks.map((t, j) => (
                        <li key={t.id}>
                          <div className="result-track">
                            <span className="result-step">{j + 1}</span>
                            <span className="result-title">{t.title}</span>
                            {t.genre && (
                              <span className={`tag tag-${genreTone(t.genre)}`}>
                                {normalizeGenre(t.genre)}
                              </span>
                            )}
                            <span className="tag tag-blue">{fmt(t.bpm)}</span>
                            {t.energy != null && <span className="tag tag-orange">E{t.energy}</span>}
                          </div>
                          {j < set.hops.length && <HopRow hop={set.hops[j]} />}
                        </li>
                      ))}
                    </ol>
                  </button>
                ))}
              </div>
            )}

            <div className="gen-save">
              <label className="stack">
                Name this set
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Friday warm-up"
                  disabled={chosen == null}
                />
              </label>
            </div>

            <div className="modal-actions">
              <button type="button" className="ghost" onClick={() => setResults(null)}>Back</button>
              <button
                type="button"
                className="primary"
                onClick={save}
                disabled={chosen == null || busy}
              >
                Save set
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function HopRow({ hop }: { hop: GeneratedSet['hops'][number] }) {
  const off = Math.abs(hop.tempo.percent);
  const tone = off <= 3 ? 'good' : off <= 6 ? 'ok' : 'bad';
  return (
    <div className={`result-hop ${tone}`}>
      <span className="hop-stem" aria-hidden="true" />
      <span className={`hop-badge ${hop.saved ? 'saved' : 'new'}`}>
        {hop.saved ? 'rehearsed' : 'suggested'}
      </span>
      <span className="hop-detail">
        {off < 0.05 ? 'exact' : `${hop.tempo.percent > 0 ? '+' : '−'}${off.toFixed(1)}%`}
        {hop.tempo.label ? ` · ${hop.tempo.label}` : ''}
        {hop.keyLabel ? ` · ${hop.keyLabel}` : ''}
      </span>
    </div>
  );
}

/** Tiny sparkline of the energy arc, drawn from the same function the search uses. */
function ShapeSpark({ shape }: { shape: EnergyShape }) {
  const points = Array.from({ length: 13 }, (_, i) => {
    const value = energyTarget(shape, i, 13, 6);
    const x = (i / 12) * 46 + 2;
    const y = 22 - ((value - 1) / 9) * 18;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg viewBox="0 0 50 26" className="spark" aria-hidden="true">
      <polyline points={points} />
    </svg>
  );
}

const fmt = (bpm: number) => (Number.isInteger(bpm) ? `${bpm}` : bpm.toFixed(1));

const defaultName = (shape: EnergyShape, count: number, genres: string[]) => {
  const label = ENERGY_SHAPES.find((s) => s.id === shape)?.label ?? 'Set';
  const genre = genres.length === 1 && genres[0].trim() ? `${genres[0]} ` : '';
  return count ? `${genre}${label} · ${count} tracks` : `${genre}${label}`;
};
