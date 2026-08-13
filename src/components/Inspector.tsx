import { useMemo, useState } from 'react';
import { Link2, PanelRightClose, Pencil, Star, Trash2, Unlink } from 'lucide-react';
import type { Track, Transition } from '../types';
import type { Match, MatchSettings, SetPath } from '../lib/match';
import { keyName } from '../lib/camelot';
import { genreTone, normalizeGenre } from '../lib/genres';
import { ChainCard } from './ChainCard';

type Tab = 'matches' | 'paths' | 'route';

type Props = {
  track: Track | null;
  allTracks: Track[];
  matches: Match[];
  paths: SetPath[];
  routes: SetPath[];
  routeTargetId: number | null;
  onRouteTarget: (id: number | null) => void;
  branches: { transition: Transition; to: Track }[];
  settings: MatchSettings;
  setSettings: React.Dispatch<React.SetStateAction<MatchSettings>>;
  previewPath: number[];
  onPreviewPath: (ids: number[]) => void;
  onConnect: (toId: number) => void;
  onDisconnect: (transitionId: number) => void;
  onFocus: (id: number) => void;
  onToggleFavorite: (id: number) => void;
  onEdit: () => void;
  onDelete: () => void;
  onCollapse: () => void;
};

export function Inspector({
  track,
  allTracks,
  matches,
  paths,
  routes,
  routeTargetId,
  onRouteTarget,
  branches,
  settings,
  setSettings,
  previewPath,
  onPreviewPath,
  onConnect,
  onDisconnect,
  onFocus,
  onToggleFavorite,
  onEdit,
  onDelete,
  onCollapse,
}: Props) {
  const [tab, setTab] = useState<Tab>('matches');

  const sameAs = (ids: number[]) =>
    previewPath.length === ids.length && previewPath.every((v, i) => v === ids[i]);

  const targets = useMemo(
    () =>
      allTracks
        .filter((t) => t.id !== track?.id)
        .sort((a, b) => a.title.localeCompare(b.title)),
    [allTracks, track],
  );

  if (!track) {
    return (
      <aside className="inspector">
        <header className="panel-header">
          <span className="panel-title">Details</span>
          <button className="icon-btn" onClick={onCollapse} title="Hide panel  ]" aria-label="Hide panel">
            <PanelRightClose size={16} />
          </button>
        </header>
        <p className="muted pad">Select a track to see what mixes out of it.</p>
        <ul className="tips">
          <li><kbd>Double-click</kbd> the grid to add a track there</li>
          <li><kbd>Drag</kbd> a node to move it, drag the grid to pan</li>
          <li><kbd>Drag the dot</kbd> on a node's right edge onto another to link them</li>
          <li><kbd>⌘</kbd>/<kbd>Ctrl</kbd> + scroll to zoom, <kbd>f</kbd> to fit</li>
          <li><kbd>[</kbd> and <kbd>]</kbd> hide the side panels</li>
          <li><kbd>Delete</kbd> removes the selected node or edge</li>
        </ul>
      </aside>
    );
  }

  return (
    <aside className="inspector">
      <header className="panel-header">
        <span className="panel-title">Details</span>
        <button className="icon-btn" onClick={onCollapse} title="Hide panel  ]">›</button>
      </header>

      <div className="inspector-title">
        <div className="inspector-heading">
          <h2>{track.title}</h2>
          <p className="muted">{track.artist || 'Unknown artist'}</p>
        </div>
        <div className="inspector-actions">
          <button
            className={`icon-btn star-btn ${track.favorite ? 'on' : ''}`}
            onClick={() => onToggleFavorite(track.id)}
            title={track.favorite ? 'Remove from favorites' : 'Mark as favorite'}
            aria-label={track.favorite ? 'Remove from favorites' : 'Mark as favorite'}
            aria-pressed={!!track.favorite}
          >
            <Star size={15} fill={track.favorite ? 'currentColor' : 'none'} />
          </button>
          <button className="ghost" onClick={onEdit}>
            <Pencil size={13} aria-hidden="true" /> Edit
          </button>
          <button className="icon-btn danger" onClick={onDelete} title="Delete track" aria-label="Delete track">
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <div className="stat-row">
        <Stat label="BPM" value={format(track.bpm)} tone="blue" />
        <Stat label="Key" value={track.music_key ?? '—'} sub={keyName(track.music_key)} tone="purple" />
        <Stat label="Energy" value={track.energy != null ? `${track.energy}` : '—'} tone="orange" />
        <Stat
          label="Genre"
          value={normalizeGenre(track.genre ?? '') || '—'}
          tone={track.genre ? genreTone(track.genre) : undefined}
        />
      </div>

      {track.notes && <p className="notes">{track.notes}</p>}

      <nav className="tabs">
        <TabButton active={tab === 'matches'} onClick={() => setTab('matches')}
                   label="Mixes into" count={matches.length} />
        <TabButton active={tab === 'paths'} onClick={() => setTab('paths')}
                   label="Set paths" count={paths.length} />
        <TabButton active={tab === 'route'} onClick={() => setTab('route')} label="Route to" />
      </nav>

      {tab === 'matches' && (
        <>
          <div className="settings">
            <label className="slider">
              <span>Pitch tolerance <b>±{settings.tolerance}%</b></span>
              <input
                type="range" min={1} max={16} step={0.5} value={settings.tolerance}
                onChange={(e) => setSettings((s) => ({ ...s, tolerance: Number(e.target.value) }))}
              />
            </label>
            <div className="toggles">
              <Toggle label="Key" checked={settings.useKey}
                      onChange={(v) => setSettings((s) => ({ ...s, useKey: v }))} />
              <Toggle label="Energy" checked={settings.useEnergy}
                      onChange={(v) => setSettings((s) => ({ ...s, useEnergy: v }))} />
              <Toggle label="½ / 2×" checked={settings.allowMultiples}
                      onChange={(v) => setSettings((s) => ({ ...s, allowMultiples: v }))} />
            </div>
          </div>

          {branches.length > 0 && (
            <section className="section">
              <h3>Saved branches</h3>
              {branches.map(({ transition, to }) => (
                <div key={transition.id} className="branch-row">
                  <button className="link" onClick={() => onFocus(to.id)}>{to.title}</button>
                  <span className="tag tag-blue">{format(to.bpm)}</span>
                  <button
                    className="icon-btn danger"
                    onClick={() => onDisconnect(transition.id)}
                    title="Remove this branch"
                    aria-label="Remove this branch"
                  >
                    <Unlink size={13} />
                  </button>
                </div>
              ))}
            </section>
          )}

          <section className="section">
            {matches.map((m) => (
              <div key={m.track.id} className={`match ${m.connected ? 'connected' : ''}`}>
                <div className="match-score" data-band={band(m.score)}>{Math.round(m.score)}</div>
                <div className="match-main">
                  <span className="match-name">
                    {!!m.track.favorite && (
                      <Star className="match-star" size={11} fill="currentColor" aria-label="Favorite" />
                    )}
                    <button className="link" onClick={() => onFocus(m.track.id)}>{m.track.title}</button>
                  </span>
                  <div className="muted small">
                    {m.track.artist || 'Unknown artist'} · {format(m.track.bpm)}
                    {m.track.music_key ? ` · ${m.track.music_key}` : ''}
                  </div>
                  <div className="reasons">
                    {m.reasons.map((r, i) => (
                      <span key={i} className={`tag reason-${r.tone} explain`} title={r.detail}>
                        {r.label}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  className={`tiny ${m.connected ? 'ghost' : 'primary'}`}
                  disabled={m.connected}
                  onClick={() => onConnect(m.track.id)}
                  title={m.connected ? 'Already linked' : 'Save this transition'}
                >
                  <Link2 size={12} aria-hidden="true" /> {m.connected ? 'Linked' : 'Link'}
                </button>
              </div>
            ))}
            {!matches.length && (
              <p className="muted pad">
                Nothing lands within ±{settings.tolerance}%. Widen the tolerance or add more tracks.
              </p>
            )}
          </section>
        </>
      )}

      {tab === 'paths' && (
        <section className="section">
          <p className="section-intro">
            Every branch leading out of <b>{track.title}</b>, as a set you could play.
          </p>
          {paths.map((p, i) => {
            const ids = p.tracks.map((t) => t.id);
            const active = sameAs(ids);
            return (
              <ChainCard
                key={i}
                path={p}
                active={active}
                onClick={() => onPreviewPath(active ? [] : ids)}
              />
            );
          })}
          {!paths.length && (
            <p className="muted pad">
              No branches out of this track yet. Link it to something and the setlists show up here.
            </p>
          )}
        </section>
      )}

      {tab === 'route' && (
        <section className="section">
          <p className="section-intro">
            You're on <b>{track.title}</b>. Where do you need to get to?
          </p>

          <select
            className="route-target"
            value={routeTargetId ?? ''}
            onChange={(e) => onRouteTarget(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Pick a destination…</option>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title} — {format(t.bpm)}
                {t.music_key ? ` ${t.music_key}` : ''}
              </option>
            ))}
          </select>

          {routeTargetId != null && (
            <div className="route-results">
              {routes.map((p, i) => {
                const ids = p.tracks.map((t) => t.id);
                const active = sameAs(ids);
                return (
                  <ChainCard
                    key={i}
                    path={p}
                    active={active}
                    onClick={() => onPreviewPath(active ? [] : ids)}
                  />
                );
              })}
              {!routes.length && (
                <p className="muted pad">
                  No route yet — there's no chain of saved transitions from here to there.
                  Link a few more pairs and it'll open up.
                </p>
              )}
            </div>
          )}
        </section>
      )}
    </aside>
  );
}

function TabButton({ active, onClick, label, count }: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
}) {
  return (
    <button className={active ? 'active' : ''} onClick={onClick}>
      {label}
      {count != null && <span className="count">{count}</span>}
    </button>
  );
}

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

function Toggle({ label, checked, onChange }: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className={`toggle ${checked ? 'on' : ''}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

const format = (bpm: number) => (Number.isInteger(bpm) ? `${bpm}` : bpm.toFixed(1));
const band = (score: number) => (score >= 75 ? 'high' : score >= 50 ? 'mid' : 'low');
