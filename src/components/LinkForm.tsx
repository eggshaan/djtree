import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Link2, Star } from 'lucide-react';
import { keyRelation } from '../lib/camelot';
import { tempoFit } from '../lib/match';
import { barsToSeconds, formatTimecode, parseTimecode } from '../lib/time';
import type { Track, TransitionDraft } from '../types';

/** Blend lengths worth one click. Anything else is typed. */
const BAR_PRESETS = [8, 16, 32, 64];

type Props = {
  from: Track;
  to: Track;
  onSubmit: (draft: TransitionDraft) => Promise<void> | void;
  onClose: () => void;
};

/**
 * Stands between dragging two nodes together and the transition being written.
 * A link is a claim that you have actually played the mix, so the form asks for
 * the three things you'd need to play it again — where it leaves, where it
 * comes in, and how long they run together — before it will save.
 */
export function LinkForm({ from, to, onSubmit, onClose }: Props) {
  const [fromCue, setFromCue] = useState('');
  const [toCue, setToCue] = useState('');
  const [bars, setBars] = useState('32');
  const [label, setLabel] = useState('');
  const [rating, setRating] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const firstField = useRef<HTMLInputElement>(null);
  useEffect(() => { firstField.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const fit = tempoFit(from, to);
  const off = Math.abs(fit.percent);
  const key = keyRelation(from.music_key, to.music_key);

  const fromSeconds = parseTimecode(fromCue);
  const toSeconds = parseTimecode(toCue);
  const barCount = /^\d+$/.test(bars.trim()) ? Number(bars.trim()) : NaN;
  const barsValid = Number.isInteger(barCount) && barCount >= 1 && barCount <= 512;

  const ready = fromSeconds !== null && toSeconds !== null && barsValid;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (fromSeconds === null) return setError(`Where does "${from.title}" mix out? Use m:ss.`);
    if (toSeconds === null) return setError(`Where does "${to.title}" come in? Use m:ss.`);
    if (!barsValid) return setError('Blend length must be a whole number of bars, 1 to 512.');

    setBusy(true);
    try {
      await onSubmit({
        from_cue: fromSeconds,
        to_cue: toSeconds,
        bars: barCount,
        label: label.trim(),
        rating,
        notes: notes.trim(),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="modal" onSubmit={submit}>
        <h2><Link2 size={16} aria-hidden="true" /> Log this transition</h2>

        <p className="link-pair">
          <b>{from.title}</b>
          <ArrowRight className="muted" size={13} aria-hidden="true" />
          <b>{to.title}</b>
        </p>

        <p className="callout flush">
          Ride <b>{to.title}</b> at {(to.bpm * (1 + fit.percent / 100)).toFixed(1)} BPM to lock with{' '}
          <b>{from.title}</b>
          {fit.ratio !== 1 ? ` (${fit.label})` : ''} — that's{' '}
          {off < 0.05 ? 'no pitch change' : `${fit.percent >= 0 ? '+' : '−'}${off.toFixed(1)}%`}
          {key ? `, harmonically ${key.label.toLowerCase()}` : ''}.
        </p>

        <div className="row link-row">
          <label>
            Mix out at <span className="hint">in {from.title}</span>
            <input
              ref={firstField}
              value={fromCue}
              onChange={(e) => setFromCue(e.target.value)}
              placeholder="4:12"
              inputMode="numeric"
              className={fromCue.trim() && fromSeconds === null ? 'invalid' : ''}
            />
            <span className="field-note">
              {fromSeconds !== null
                ? `${formatTimecode(fromSeconds)} in`
                : fromCue.trim() ? 'use m:ss' : 'required'}
            </span>
          </label>

          <label>
            Mix in at <span className="hint">in {to.title}</span>
            <input
              value={toCue}
              onChange={(e) => setToCue(e.target.value)}
              placeholder="0:32"
              inputMode="numeric"
              className={toCue.trim() && toSeconds === null ? 'invalid' : ''}
            />
            <span className="field-note">
              {toSeconds !== null
                ? `${formatTimecode(toSeconds)} in`
                : toCue.trim() ? 'use m:ss' : 'required'}
            </span>
          </label>

          <label>
            Blend <span className="hint">bars</span>
            <input
              value={bars}
              onChange={(e) => setBars(e.target.value)}
              inputMode="numeric"
              placeholder="32"
              className={bars.trim() && !barsValid ? 'invalid' : ''}
            />
            <span className="field-note">
              {barsValid
                ? `≈ ${formatTimecode(barsToSeconds(barCount, from.bpm))} at ${from.bpm} BPM`
                : 'required'}
            </span>
          </label>
        </div>

        <div className="bar-presets">
          {BAR_PRESETS.map((n) => (
            <button
              key={n}
              type="button"
              className={`filter-chip ${barCount === n ? 'on' : ''}`}
              onClick={() => setBars(String(n))}
              aria-pressed={barCount === n}
            >
              {n} bars
            </button>
          ))}
        </div>

        <label>
          Label <span className="hint">optional — shown on the edge</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)}
                 placeholder="drop swap on 32" />
        </label>

        <label>
          How well did it land? <span className="hint">optional</span>
          <div className="stars">
            {[1, 2, 3, 4, 5].map((n) => {
              const filled = rating != null && n <= rating;
              return (
                <button
                  key={n}
                  type="button"
                  className={`star ${filled ? 'on' : ''}`}
                  onClick={() => setRating(rating === n ? null : n)}
                  title={`${n} / 5`}
                  aria-label={`Rate ${n} out of 5`}
                >
                  <Star size={16} fill={filled ? 'currentColor' : 'none'} />
                </button>
              );
            })}
          </div>
        </label>

        <label>
          Notes <span className="hint">optional</span>
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Cut bass at the breakdown, bring in on the second 16."
          />
        </label>

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button
            type="submit"
            className="primary"
            disabled={busy || !ready}
            title={ready ? undefined : 'Fill in both cue points and the blend length'}
          >
            Save link
          </button>
        </div>
      </form>
    </div>
  );
}
