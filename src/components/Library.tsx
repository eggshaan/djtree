import { useMemo, useState } from 'react';
import { PanelLeftClose, Plus, Search, Star, Waypoints } from 'lucide-react';
import { GenrePicker } from './GenrePicker';
import { SetlistPanel } from './SetlistPanel';
import { genreTone, matchesGenres, normalizeGenre } from '../lib/genres';
import type { Setlist, Track } from '../types';

type Props = {
  tracks: Track[];
  setlists: Setlist[];
  selectedId: number | null;
  activeSetlistId: number | null;
  /** Track ids in the active set, for marking rows in the library tab. */
  setMembers: Set<number>;
  onSelect: (id: number) => void;
  onAdd: () => void;
  onToggleFavorite: (id: number) => void;
  onActivateSetlist: (id: number | null) => void;
  onRenameSetlist: (id: number, name: string) => void;
  onReorderSetlist: (id: number, trackIds: number[]) => void;
  onDeleteSetlist: (id: number) => void;
  onResetSetlistLayout: (id: number) => void;
  onGenerate: () => void;
  onCollapse: () => void;
};

type SortKey = 'bpm' | 'title' | 'artist' | 'key' | 'genre';
type Tab = 'library' | 'sets';

export function Library({
  tracks, setlists, selectedId, activeSetlistId, setMembers,
  onSelect, onAdd, onToggleFavorite, onActivateSetlist, onRenameSetlist,
  onReorderSetlist, onDeleteSetlist, onResetSetlistLayout, onGenerate, onCollapse,
}: Props) {
  const [tab, setTab] = useState<Tab>('library');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('bpm');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [genres, setGenres] = useState<string[]>([]);

  const favoriteCount = useMemo(
    () => tracks.reduce((n, t) => n + (t.favorite ? 1 : 0), 0),
    [tracks],
  );
  const genresInUse = useMemo(() => tracks.map((t) => t.genre ?? ''), [tracks]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let filtered = tracks;
    if (favoritesOnly) filtered = filtered.filter((t) => t.favorite);
    if (genres.length) filtered = filtered.filter((t) => matchesGenres(t.genre ?? '', genres));
    if (q) {
      filtered = filtered.filter((t) =>
        [t.title, t.artist, t.genre, t.music_key ?? '', String(t.bpm)]
          .join(' ')
          .toLowerCase()
          .includes(q),
      );
    }

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      // Favorites float to the top of whatever ordering is active.
      if (!!a.favorite !== !!b.favorite) return a.favorite ? -1 : 1;
      switch (sort) {
        case 'bpm': return a.bpm - b.bpm;
        case 'title': return a.title.localeCompare(b.title);
        case 'artist': return a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title);
        case 'key':
          return (a.music_key ?? 'zz').localeCompare(b.music_key ?? 'zz', undefined, { numeric: true });
        case 'genre':
          // Untagged tracks sink to the bottom rather than leading the list.
          return (a.genre || 'zz').localeCompare(b.genre || 'zz') || a.bpm - b.bpm;
      }
    });
    return sorted;
  }, [tracks, query, sort, favoritesOnly, genres]);

  return (
    <aside className="library">
      <header className="library-header">
        <h1>
          <Waypoints className="logo" size={16} strokeWidth={2} aria-hidden="true" />
          djtree
        </h1>
        <button className="icon-btn" onClick={onCollapse} title="Hide sidebar  [" aria-label="Hide sidebar">
          <PanelLeftClose size={16} />
        </button>
      </header>

      <nav className="side-tabs">
        <button
          className={tab === 'library' ? 'active' : ''}
          onClick={() => {
            setTab('library');
            // Leaving the Sets tab releases the set: the canvas goes back to
            // stored positions rather than leaving a view you can't see the
            // controls for.
            onActivateSetlist(null);
          }}
          aria-pressed={tab === 'library'}
        >
          Library <span className="count">{tracks.length}</span>
        </button>
        <button
          className={tab === 'sets' ? 'active' : ''}
          onClick={() => setTab('sets')}
          aria-pressed={tab === 'sets'}
        >
          Sets <span className="count">{setlists.length}</span>
        </button>
      </nav>

      {tab === 'sets' ? (
        <SetlistPanel
          setlists={setlists}
          tracks={tracks}
          activeId={activeSetlistId}
          onActivate={onActivateSetlist}
          onRename={onRenameSetlist}
          onReorder={onReorderSetlist}
          onDelete={onDeleteSetlist}
          onFocusTrack={onSelect}
          onResetLayout={onResetSetlistLayout}
          onGenerate={onGenerate}
        />
      ) : (
        <>
          <div className="library-add">
            <button className="primary block" onClick={onAdd}>
              <Plus size={15} aria-hidden="true" /> New track
            </button>
          </div>

          <div className="library-controls">
            <div className="search-field">
              <Search size={13} aria-hidden="true" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search title, artist, key…"
              />
            </div>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} title="Sort by">
              <option value="bpm">BPM</option>
              <option value="title">Title</option>
              <option value="artist">Artist</option>
              <option value="key">Key</option>
              <option value="genre">Genre</option>
            </select>
          </div>

          <div className="library-filters">
            <button
              className={`filter-chip ${favoritesOnly ? 'on' : ''}`}
              onClick={() => setFavoritesOnly((v) => !v)}
              aria-pressed={favoritesOnly}
            >
              <Star size={12} fill={favoritesOnly ? 'currentColor' : 'none'} aria-hidden="true" />
              Favorites
              <span className="count">{favoriteCount}</span>
            </button>
            <GenrePicker
              values={genres}
              onChange={setGenres}
              genresInUse={genresInUse}
              multiple
              untagged
              compact
              placeholder="Genre"
            />
          </div>

          <div className="library-list">
            {visible.map((t) => {
              const inSet = setMembers.has(t.id);
              return (
                <div
                  key={t.id}
                  className={[
                    'library-item',
                    selectedId === t.id ? 'selected' : '',
                    t.favorite ? 'favorite' : '',
                    inSet ? 'in-set' : '',
                  ].filter(Boolean).join(' ')}
                >
                  <button className="library-item-main" onClick={() => onSelect(t.id)}>
                    <span className="tag tag-blue li-bpm">
                      {Number.isInteger(t.bpm) ? t.bpm : t.bpm.toFixed(1)}
                    </span>
                    <span className="li-text">
                      <span className="li-title">{t.title}</span>
                      <span className="li-artist">{t.artist || 'Unknown artist'}</span>
                    </span>
                    {t.genre && (
                      <span
                        className={`genre-dot tone-${genreTone(t.genre)}`}
                        title={normalizeGenre(t.genre)}
                      />
                    )}
                    {t.music_key && <span className="tag tag-purple">{t.music_key}</span>}
                  </button>
                  <button
                    className={`li-star ${t.favorite ? 'on' : ''}`}
                    onClick={() => onToggleFavorite(t.id)}
                    title={t.favorite ? 'Remove from favorites' : 'Mark as favorite'}
                    aria-label={t.favorite ? 'Remove from favorites' : 'Mark as favorite'}
                    aria-pressed={!!t.favorite}
                  >
                    <Star size={13} fill={t.favorite ? 'currentColor' : 'none'} />
                  </button>
                </div>
              );
            })}

            {!visible.length && (
              <p className="muted pad">
                {favoritesOnly && favoriteCount === 0
                  ? 'No favorites yet. Star a track to pin it here.'
                  : genres.length
                    ? 'No track carries those genres.'
                    : tracks.length
                      ? 'Nothing matches that search.'
                      : 'Your library is empty.'}
              </p>
            )}
          </div>

          <footer className="library-footer muted">
            {tracks.length} track{tracks.length === 1 ? '' : 's'}
            {favoriteCount > 0 && ` · ${favoriteCount} starred`}
          </footer>
        </>
      )}
    </aside>
  );
}
