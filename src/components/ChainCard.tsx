import type { Track } from '../types';
import { tempoFit, type SetPath } from '../lib/match';

type Props = {
  path: SetPath;
  active: boolean;
  onClick: () => void;
};

/** One candidate setlist: the tracks in order, with the mix move between each. */
export function ChainCard({ path, active, onClick }: Props) {
  return (
    <button className={`chain-card ${active ? 'active' : ''}`} onClick={onClick}>
      <div className="chain-head">
        <span className="chain-count">
          {path.tracks.length} track{path.tracks.length === 1 ? '' : 's'}
        </span>
        <span className="chain-quality">avg fit {Math.round(path.quality)}</span>
      </div>

      <ol className="chain-list">
        {path.tracks.map((track, i) => (
          <li key={`${track.id}-${i}`}>
            <div className="chain-track">
              <span className="chain-step">{i + 1}</span>
              <span className="chain-title">{track.title}</span>
              <span className="tag tag-blue">{format(track.bpm)}</span>
            </div>
            {i < path.tracks.length - 1 && <Hop from={track} to={path.tracks[i + 1]} />}
          </li>
        ))}
      </ol>
    </button>
  );
}

function Hop({ from, to }: { from: Track; to: Track }) {
  const fit = tempoFit(from, to);
  const off = Math.abs(fit.percent);
  const tone = off <= 3 ? 'good' : off <= 6 ? 'ok' : 'bad';
  return (
    <div className={`chain-hop ${tone}`}>
      <span className="chain-arrow" aria-hidden="true" />
      <span>
        {off < 0.05 ? 'exact' : `${fit.percent > 0 ? '+' : '−'}${off.toFixed(1)}%`}
        {fit.label ? ` · ${fit.label}` : ''}
      </span>
    </div>
  );
}

const format = (bpm: number) => (Number.isInteger(bpm) ? `${bpm}` : bpm.toFixed(1));
