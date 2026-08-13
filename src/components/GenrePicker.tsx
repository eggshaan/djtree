import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Plus, Search, X } from 'lucide-react';
import {
  genreOptions, genreTone, normalizeGenre, sameGenre, UNTAGGED, type GenreOption,
} from '../lib/genres';

type Props = {
  /** Selected genres. Single mode reads the first entry and writes at most one. */
  values: string[];
  onChange: (values: string[]) => void;
  /** Every genre string in the library, used to build the "In your library" group. */
  genresInUse: string[];
  multiple?: boolean;
  /** Offer a "No genre" bucket — filters want it, the track form does not. */
  untagged?: boolean;
  /** Let an unlisted genre be typed in. */
  allowCustom?: boolean;
  placeholder?: string;
  /** Sidebar filters get the tighter chip shape. */
  compact?: boolean;
  id?: string;
};

/**
 * A dropdown over the genre catalog: search, grouped options, keyboard driven,
 * and — in multiple mode — as many genres as you want at once.
 */
export function GenrePicker({
  values,
  onChange,
  genresInUse,
  multiple = false,
  untagged = false,
  allowCustom = false,
  placeholder = 'Pick a genre',
  compact = false,
  id,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);

  const options = useMemo(
    () => genreOptions(genresInUse, { untagged }),
    [genresInUse, untagged],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || o.group.toLowerCase().includes(q),
    );
  }, [options, query]);

  /** Anything typed that isn't already an option can still be used. */
  const custom = useMemo(() => {
    // 80 chars is what the API accepts for a genre; trim rather than 400.
    const typed = query.trim().slice(0, 80);
    if (!allowCustom || !typed) return null;
    const canonical = normalizeGenre(typed);
    return options.some((o) => sameGenre(o.value, canonical)) ? null : canonical;
  }, [allowCustom, query, options]);

  const rows: (GenreOption | { custom: string })[] = useMemo(
    () => (custom ? [{ custom }, ...filtered] : filtered),
    [custom, filtered],
  );

  useEffect(() => { setActive(0); }, [query, open]);

  useEffect(() => {
    if (!open) return;
    field.current?.focus();
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const selected = values.filter(Boolean);
  const isOn = (value: string) => selected.some((v) => v === value || sameGenre(v, value));

  const pick = (value: string) => {
    if (!multiple) {
      onChange(isOn(value) ? [] : [value]);
      setOpen(false);
      setQuery('');
      return;
    }
    onChange(
      isOn(value)
        ? selected.filter((v) => !(v === value || sameGenre(v, value)))
        : [...selected, value],
    );
    setQuery('');
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      // The modal behind this also closes on Escape — the dropdown goes first.
      e.stopPropagation();
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!rows.length) return;
      setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const row = rows[active];
      if (!row) return;
      pick('custom' in row ? row.custom : row.value);
      return;
    }
    if (e.key === 'Backspace' && !query && multiple && selected.length) {
      onChange(selected.slice(0, -1));
    }
  };

  const label = !selected.length
    ? placeholder
    : multiple
      ? `${selected.length} genre${selected.length === 1 ? '' : 's'}`
      : selected[0];

  let lastGroup = '';

  return (
    <div className={`genre-picker ${compact ? 'compact' : ''}`} ref={root}>
      <button
        type="button"
        id={id}
        className={`genre-trigger ${selected.length ? 'on' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="genre-trigger-label">{label}</span>
        {selected.length > 0 && (
          <span
            className="genre-clear"
            role="button"
            tabIndex={-1}
            title="Clear"
            aria-label="Clear genre selection"
            onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); onChange([]); }}
          >
            <X size={12} />
          </span>
        )}
        <ChevronDown size={13} aria-hidden="true" />
      </button>

      {open && (
        <div className="genre-menu" role="listbox" aria-multiselectable={multiple}>
          <div className="genre-search">
            <Search size={12} aria-hidden="true" />
            <input
              ref={field}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={allowCustom ? 'Search or type your own…' : 'Search genres…'}
            />
          </div>

          <div className="genre-options">
            {custom && (
              <button
                type="button"
                className={`genre-option ${active === 0 ? 'active' : ''}`}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => pick(custom)}
                onMouseEnter={() => setActive(0)}
              >
                <span className="genre-check"><Plus size={11} /></span>
                <span className="genre-option-label">Use “{custom}”</span>
              </button>
            )}

            {filtered.map((o, i) => {
              const index = custom ? i + 1 : i;
              const on = isOn(o.value);
              const heading = o.group !== lastGroup ? o.group : null;
              lastGroup = o.group;
              return (
                <div key={`${o.group}:${o.value}`}>
                  {heading && <div className="genre-group">{heading}</div>}
                  <button
                    type="button"
                    role="option"
                    aria-selected={on}
                    className={`genre-option ${on ? 'on' : ''} ${active === index ? 'active' : ''}`}
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => pick(o.value)}
                    onMouseEnter={() => setActive(index)}
                  >
                    <span className="genre-check">{on && <Check size={11} />}</span>
                    <span className={`genre-dot tone-${o.tone}`} aria-hidden="true" />
                    <span className="genre-option-label">{o.label}</span>
                    {o.count != null && <span className="genre-count">{o.count}</span>}
                  </button>
                </div>
              );
            })}

            {!rows.length && <p className="muted pad small">No genre matches “{query.trim()}”.</p>}
          </div>

          {multiple && (
            <footer className="genre-foot">
              <span className="muted small">
                {selected.length ? `${selected.length} selected` : 'Nothing selected — any genre'}
              </span>
              <button type="button" className="ghost tiny" onClick={() => onChange([])}>
                Clear
              </button>
            </footer>
          )}
        </div>
      )}
    </div>
  );
}

/** The selected genres, shown as removable pills under a multi picker. */
export function GenreChips({
  values,
  onRemove,
}: {
  values: string[];
  onRemove: (value: string) => void;
}) {
  if (!values.length) return null;
  return (
    <div className="genre-chips">
      {values.map((v) => (
        <button
          key={v}
          type="button"
          className={`genre-chip tag tag-${toneOf(v)}`}
          onClick={() => onRemove(v)}
          title={`Remove ${labelOf(v)}`}
        >
          {labelOf(v)} <X size={10} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

const labelOf = (value: string) => (value === UNTAGGED ? 'No genre' : value);
const toneOf = (value: string) => (value === UNTAGGED ? 'gray' : genreTone(value));
