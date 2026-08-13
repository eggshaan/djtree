import { memo } from 'react';
import { Star } from 'lucide-react';
import type { Track } from '../types';
import { keyName } from '../lib/camelot';

export const NODE_W = 200;
export const NODE_H = 78;

type Props = {
  track: Track;
  /** Drawn position — may differ from track.x/y while a set is arranged. */
  x: number;
  y: number;
  /** True while a set arrangement is showing, when dragging can't be saved. */
  locked: boolean;
  selected: boolean;
  dragging: boolean;
  linkTarget: boolean;
  linkSource: boolean;
  /** Match score 0..100 when this track is a suggested next play. */
  suggestion: number | null;
  onPath: boolean;
  dimmed: boolean;
  /** Position in the previewed setlist, or -1. */
  pathIndex: number;
  onPointerDown: (e: React.PointerEvent) => void;
  onHandlePointerDown: (e: React.PointerEvent) => void;
  onToggleFavorite: () => void;
};

export const TrackNode = memo(function TrackNode({
  track,
  x,
  y,
  locked,
  selected,
  dragging,
  linkTarget,
  linkSource,
  suggestion,
  onPath,
  dimmed,
  pathIndex,
  onPointerDown,
  onHandlePointerDown,
  onToggleFavorite,
}: Props) {
  const favorite = !!track.favorite;
  const classes = [
    'node',
    locked ? 'locked' : '',
    favorite ? 'favorite' : '',
    selected ? 'selected' : '',
    dragging ? 'dragging' : '',
    linkTarget ? 'link-target' : '',
    linkSource ? 'link-source' : '',
    onPath ? 'on-path' : '',
    dimmed ? 'dimmed' : '',
    suggestion != null ? 'suggested' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={classes}
      data-track-id={track.id}
      style={{
        left: x,
        top: y,
        width: NODE_W,
        height: NODE_H,
        // Stronger tint the better the match.
        ['--suggest' as string]: suggestion != null ? (suggestion / 100).toFixed(2) : '0',
      }}
      onPointerDown={onPointerDown}
    >
      {pathIndex >= 0 && <span className="path-index">{pathIndex + 1}</span>}

      <div className="node-body">
        <div className="node-title" title={track.title}>{track.title}</div>
        <div className="node-artist" title={track.artist}>{track.artist || 'Unknown artist'}</div>
      </div>

      {/* Stops propagation so starring never begins a drag. */}
      <button
        className={`node-star ${favorite ? 'on' : ''}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite();
        }}
        title={favorite ? 'Remove from favorites' : 'Mark as favorite'}
        aria-label={favorite ? 'Remove from favorites' : 'Mark as favorite'}
        aria-pressed={favorite}
      >
        <Star size={13} fill={favorite ? 'currentColor' : 'none'} />
      </button>

      <div className="node-meta">
        <span className="tag tag-blue">{formatBpm(track.bpm)}</span>
        {track.music_key && (
          <span className="tag tag-purple" title={keyName(track.music_key)}>{track.music_key}</span>
        )}
        {track.energy != null && <span className="tag tag-orange">E{track.energy}</span>}
        {suggestion != null && (
          <span className="tag tag-green node-score">{Math.round(suggestion)}</span>
        )}
      </div>

      <div className="handle in" aria-hidden="true" />
      <div
        className="handle out"
        title="Drag to another track to create a transition"
        onPointerDown={onHandlePointerDown}
      />
    </div>
  );
});

const formatBpm = (bpm: number) =>
  Number.isInteger(bpm) ? `${bpm}` : bpm.toFixed(1);
