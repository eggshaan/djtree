import { useEffect, useMemo, useState } from 'react';
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
  /** Tracks you insist on. Empty by default — the search picks freely. */
  const [locked, setLocked] = useState<Set<number>>(() => new Set());
  const [length, setLength] = useState(() => Math.min(6, Math.max(2, tracks.length)));
  const [shape, setShape] = useState<EnergyShape>('build');
  const [results, setResults] = useState<GeneratedSet[] | null>(null);
  const [reached, setReached] = useState<{ got: number; want: number } | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const genresInUse = useMemo(() => tracks.map((t) => t.genre ?? ''), [tracks]);

  /** What the search may draw on: the library, narrowed by the genre filter. */
  const pool = useMemo(
    () => tracks.filter((t) => matchesGenres(t.genre ?? '', genres)),
    [tracks, genres],
  );

  /*
   * Rows to show: the filtered library plus anything locked in, so a track you
   * insisted on never disappears behind a genre you picked afterwards.
   */
  const listed = useMemo(() => {
    const shown = new Set(pool.map((t) => t.id));
    return tracks.filter((t) => shown.has(t.id) || locked.has(t.id));
  }, [tracks, pool, locked]);

  const lockedTracks = useMemo(() => tracks.filter((t) => locked.has(t.id)), [tracks, locked]);

  /*
   * The slider runs the length of everything the search can reach — the whole
   * library, unless a genre filter narrows it — never the number of boxes you
   * ticked. Locking tracks raises the floor, not the ceiling.
   */
  const reachable = useMemo(() => {
    const ids = new Set(pool.map((t) => t.id));
    for (const id of locked) ids.add(id);
    return ids.size;
  }, [pool, locked]);
  const maxLength = Math.max(2, reachable);
  const minLength = Math.max(2, lockedTracks.length);
  const wanted = Math.min(Math.max(length, minLength), maxLength);

  /** A row is a checkbox: tick it and that track is in the set for certain. */
  const toggle = (id: number) =>
    setLocked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const run = () => {
    const outcome = generateSetlists({
      pool,
      required: lockedTracks,
      length: wanted,
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
                  <h3>Songs you definitely want</h3>
                  <div className="gen-quick">
                    <button className="ghost tiny" onClick={() => setLocked(new Set())}>Clear</button>
                    <button
                      className="ghost tiny"
                      onClick={() => setLocked(new Set(listed.filter((t) => t.favorite).map((t) => t.id)))}
                    >
                      <Star size={11} aria-hidden="true" /> Starred
                    </button>
                  </div>
                </div>
                <div className="gen-pool">
                  {listed.map((t) => {
                    const on = locked.has(t.id);
                    const genre = normalizeGenre(t.genre ?? '');
                    return (
                      <button
                        key={t.id}
                        className={`pool-row ${on ? 'on' : ''}`}
                        onClick={() => toggle(t.id)}
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
                  {lockedTracks.length
                    ? `${lockedTracks.length} locked in — the rest gets filled from your library`
                    : 'Tick anything you know you want. Leave it empty and the search picks freely.'}
                </p>
              </section>

              <section className="gen-block">
                <h3>How many tracks</h3>
                <div className="gen-length">
                  <input
                    type="range"
                    min={minLength}
                    max={maxLength}
                    value={wanted}
                    onChange={(e) => setLength(Number(e.target.value))}
                    aria-label="How many tracks"
                  />
                  <input
                    className="gen-length-number"
                    type="number"
                    min={minLength}
                    max={maxLength}
                    value={wanted}
                    onChange={(e) => {
                      // Let the field empty out while typing; commit on blur.
                      const n = Number(e.target.value);
                      if (Number.isFinite(n) && e.target.value !== '') setLength(n);
                    }}
                    onBlur={(e) => {
                      const n = Number(e.target.value);
                      setLength(Number.isFinite(n) && n > 0 ? Math.min(Math.max(n, minLength), maxLength) : minLength);
                    }}
                    aria-label="How many tracks"
                  />
                </div>
                <p className="muted small">
                  Out of {maxLength} reachable
                  {genres.length ? ' in these genres' : ' in your library'}
                  {lockedTracks.length ? ` · at least ${minLength}, the ones you locked in` : ''}
                </p>

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
                disabled={reachable < 2}
                title={reachable < 2 ? 'Two tracks have to be reachable' : undefined}
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
