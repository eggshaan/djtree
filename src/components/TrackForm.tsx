import { useEffect, useRef, useState } from 'react';
import { GenrePicker } from './GenrePicker';
import { keyName, parseKey } from '../lib/camelot';
import { normalizeGenre } from '../lib/genres';
import type { Track, TrackDraft } from '../types';

type Props = {
  /** Existing track when editing, null when adding. */
  track: Track | null;
  /** Where a newly created node lands on the canvas. */
  position: { x: number; y: number };
  /** Every genre already used in the library, so the dropdown lists them first. */
  genresInUse: string[];
  onSubmit: (draft: TrackDraft) => Promise<void> | void;
  onClose: () => void;
};

export function TrackForm({ track, position, genresInUse, onSubmit, onClose }: Props) {
  const [title, setTitle] = useState(track?.title ?? '');
  const [artist, setArtist] = useState(track?.artist ?? '');
  const [bpm, setBpm] = useState(track ? String(track.bpm) : '');
  const [keyInput, setKeyInput] = useState(track?.music_key ?? '');
  const [energy, setEnergy] = useState(track?.energy != null ? String(track.energy) : '');
  const [genre, setGenre] = useState(() => normalizeGenre(track?.genre ?? ''));
  const [notes, setNotes] = useState(track?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const firstField = useRef<HTMLInputElement>(null);
  useEffect(() => { firstField.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const parsedKey = keyInput.trim() ? parseKey(keyInput) : null;
  const keyInvalid = keyInput.trim().length > 0 && parsedKey === null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const bpmValue = Number(bpm);
    if (!title.trim()) return setError('Title is required.');
    if (!Number.isFinite(bpmValue) || bpmValue < 20 || bpmValue > 400) {
      return setError('BPM must be between 20 and 400.');
    }
    if (keyInvalid) return setError(`Could not read "${keyInput}" as a key.`);

    const energyValue = energy.trim() ? Number(energy) : null;
    if (energyValue != null && (!Number.isInteger(energyValue) || energyValue < 1 || energyValue > 10)) {
      return setError('Energy must be a whole number from 1 to 10.');
    }

    setBusy(true);
    try {
      await onSubmit({
        title: title.trim(),
        artist: artist.trim(),
        bpm: bpmValue,
        music_key: parsedKey,
        energy: energyValue,
        genre: normalizeGenre(genre),
        notes: notes.trim(),
        x: track?.x ?? position.x,
        y: track?.y ?? position.y,
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
        <h2>{track ? 'Edit track' : 'Add track'}</h2>

        <label>
          Title
          <input ref={firstField} value={title} onChange={(e) => setTitle(e.target.value)}
                 placeholder="Summer" />
        </label>

        <label>
          Artist
          <input value={artist} onChange={(e) => setArtist(e.target.value)}
                 placeholder="Calvin Harris" />
        </label>

        <div className="row">
          <label>
            BPM
            <input value={bpm} onChange={(e) => setBpm(e.target.value)}
                   inputMode="decimal" placeholder="128" />
          </label>

          <label>
            Key <span className="hint">optional</span>
            <input value={keyInput} onChange={(e) => setKeyInput(e.target.value)}
                   placeholder="8A or Am"
                   className={keyInvalid ? 'invalid' : ''} />
            <span className="field-note">
              {parsedKey ? `${parsedKey} · ${keyName(parsedKey)}` : keyInvalid ? 'unrecognized' : ' '}
            </span>
          </label>

          <label>
            Energy <span className="hint">1–10</span>
            <input value={energy} onChange={(e) => setEnergy(e.target.value)}
                   inputMode="numeric" placeholder="7" />
          </label>
        </div>

        <label>
          Genre <span className="hint">optional</span>
          <GenrePicker
            values={genre ? [genre] : []}
            onChange={(next) => setGenre(next[0] ?? '')}
            genresInUse={genresInUse}
            allowCustom
            placeholder="Pick a genre"
          />
        </label>

        <label>
          Notes <span className="hint">cue points, intro length, whatever you need</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </label>

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={busy}>
            {track ? 'Save' : 'Add track'}
          </button>
        </div>
      </form>
    </div>
  );
}
