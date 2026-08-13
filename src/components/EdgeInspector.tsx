import { useEffect, useState } from 'react';
import { ArrowRight, PanelRightClose, Star, Unlink } from 'lucide-react';
import type { Track, Transition, TransitionPatch } from '../types';
import { tempoFit } from '../lib/match';
import { keyRelation } from '../lib/camelot';
import { barsToSeconds, formatTimecode, parseTimecode } from '../lib/time';

type Props = {
  transition: Transition;
  from: Track;
  to: Track;
  onUpdate: (patch: TransitionPatch) => void;
  onDelete: () => void;
  onFocus: (id: number) => void;
  onCollapse: () => void;
};

/** Empty when the value was never recorded, so the field reads as blank not "0:00". */
const cueText = (seconds: number | null) => (seconds == null ? '' : formatTimecode(seconds));

export function EdgeInspector({
  transition, from, to, onUpdate, onDelete, onFocus, onCollapse,
}: Props) {
  const [label, setLabel] = useState(transition.label);
  const [notes, setNotes] = useState(transition.notes);
  const [fromCue, setFromCue] = useState(() => cueText(transition.from_cue));
  const [toCue, setToCue] = useState(() => cueText(transition.to_cue));
  const [bars, setBars] = useState(() => (transition.bars == null ? '' : String(transition.bars)));

  // Re-seed the fields when a different edge gets selected.
  useEffect(() => {
    setLabel(transition.label);
    setNotes(transition.notes);
    setFromCue(cueText(transition.from_cue));
    setToCue(cueText(transition.to_cue));
    setBars(transition.bars == null ? '' : String(transition.bars));
  }, [
    transition.id, transition.label, transition.notes,
    transition.from_cue, transition.to_cue, transition.bars,
  ]);

  /**
   * Cue fields save on blur, and a value that doesn't parse is put back rather
   * than written — clearing one on purpose is how you say "not recorded".
   */
  const commitCue = (
    text: string,
    field: 'from_cue' | 'to_cue',
    reset: (value: string) => void,
  ) => {
    const trimmed = text.trim();
    const seconds = trimmed ? parseTimecode(trimmed) : null;
    if (trimmed && seconds === null) return reset(cueText(transition[field]));
    reset(cueText(seconds));
    if (seconds !== transition[field]) onUpdate({ [field]: seconds } as TransitionPatch);
  };

  const commitBars = () => {
    const trimmed = bars.trim();
    const value = /^\d+$/.test(trimmed) ? Number(trimmed) : null;
    const valid = value === null ? !trimmed : value >= 1 && value <= 512;
    if (!valid) return setBars(transition.bars == null ? '' : String(transition.bars));
    setBars(value == null ? '' : String(value));
    if (value !== transition.bars) onUpdate({ bars: value });
  };

  const fit = tempoFit(from, to);
  const key = keyRelation(from.music_key, to.music_key);
  const off = Math.abs(fit.percent);

  return (
    <aside className="inspector">
      <header className="panel-header">
        <span className="panel-title">Transition</span>
        <button className="icon-btn" onClick={onCollapse} title="Hide panel  ]" aria-label="Hide panel">
          <PanelRightClose size={16} />
        </button>
      </header>

      <div className="inspector-title">
        <div className="inspector-heading">
          <h2 className="edge-heading">
            <button className="link" onClick={() => onFocus(from.id)}>{from.title}</button>
            <ArrowRight className="muted" size={14} aria-hidden="true" />
            <button className="link" onClick={() => onFocus(to.id)}>{to.title}</button>
          </h2>
        </div>
        <div className="inspector-actions">
          <button className="ghost danger" onClick={onDelete}>
            <Unlink size={13} aria-hidden="true" /> Unlink
          </button>
        </div>
      </div>

      {/* Three stats, not four — "relative maj/min" needs the width. */}
      <div className="stat-row">
        <Stat label="Out" value={`${from.bpm}`} tone="blue" />
        <Stat label="In" value={`${to.bpm}`} tone="blue" />
        <Stat
          label="Pitch"
          value={`${fit.percent >= 0 ? '+' : '−'}${off.toFixed(1)}%`}
          sub={fit.label || 'same tempo'}
          tone={off <= 3 ? 'green' : off <= 6 ? 'yellow' : 'red'}
        />
      </div>

      {/* The cue sheet the link was logged with, at a glance. */}
      <div className="stat-row">
        <Stat
          label="Mix out"
          value={transition.from_cue == null ? '—' : formatTimecode(transition.from_cue)}
          sub={from.title}
        />
        <Stat
          label="Mix in"
          value={transition.to_cue == null ? '—' : formatTimecode(transition.to_cue)}
          sub={to.title}
        />
        <Stat
          label="Blend"
          value={transition.bars == null ? '—' : `${transition.bars} bars`}
          sub={
            transition.bars == null
              ? 'not recorded'
              : `≈ ${formatTimecode(barsToSeconds(transition.bars, from.bpm))}`
          }
        />
      </div>

      <p className="callout">
        Ride <b>{to.title}</b> at {(to.bpm * (1 + fit.percent / 100)).toFixed(1)} BPM to lock with{' '}
        <b>{from.title}</b>
        {fit.ratio !== 1 ? ` (${fit.label})` : ''}.
        {key && (
          <>
            {' '}Harmonically that's <span className={`tag ${keyTone(key.score)}`}>{key.label}</span>.
          </>
        )}
      </p>

      <section className="section">
        <h3>Cue sheet</h3>
        <div className="cue-fields">
          <label className="stack">
            Mix out at
            <input
              value={fromCue}
              onChange={(e) => setFromCue(e.target.value)}
              onBlur={() => commitCue(fromCue, 'from_cue', setFromCue)}
              placeholder="4:12"
              inputMode="numeric"
            />
          </label>
          <label className="stack">
            Mix in at
            <input
              value={toCue}
              onChange={(e) => setToCue(e.target.value)}
              onBlur={() => commitCue(toCue, 'to_cue', setToCue)}
              placeholder="0:32"
              inputMode="numeric"
            />
          </label>
          <label className="stack">
            Bars
            <input
              value={bars}
              onChange={(e) => setBars(e.target.value)}
              onBlur={commitBars}
              placeholder="32"
              inputMode="numeric"
            />
          </label>
        </div>

        <label className="stack">
          Label <span className="hint">shown on the edge</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => label !== transition.label && onUpdate({ label })}
            placeholder="drop swap on 32"
          />
        </label>

        <label className="stack">
          Rating
          <div className="stars">
            {[1, 2, 3, 4, 5].map((n) => {
              const filled = transition.rating != null && n <= transition.rating;
              return (
                <button
                  key={n}
                  className={`star ${filled ? 'on' : ''}`}
                  onClick={() => onUpdate({ rating: transition.rating === n ? null : n })}
                  title={`${n} / 5`}
                  aria-label={`Rate ${n} out of 5`}
                >
                  <Star size={16} fill={filled ? 'currentColor' : 'none'} />
                </button>
              );
            })}
          </div>
        </label>

        <label className="stack">
          Notes
          <textarea
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => notes !== transition.notes && onUpdate({ notes })}
            placeholder="Cut bass at the breakdown, bring in on the second 16."
          />
        </label>
      </section>
    </aside>
  );
}

const keyTone = (score: number) =>
  score >= 85 ? 'tag-green' : score >= 45 ? 'tag-yellow' : 'tag-red';

function Stat({ label, value, sub, tone }: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${tone ? `tone-${tone}` : ''}`}>{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}
