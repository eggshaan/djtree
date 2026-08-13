/**
 * Setlist generation.
 *
 * Building the best ordering of n tracks is a longest-path problem — brute force
 * is factorial. This runs a beam search instead: keep the best `beamWidth`
 * partial sets at each position, extend every one of them by every legal next
 * track, then prune back down. That's O(length × beamWidth × pool) with a
 * bounded footprint, and it reliably finds strong sets without ever claiming to
 * find the optimal one.
 */

import { genreAffinity, normalizeGenre } from './genres';
import { DEFAULT_SETTINGS, pairScore, type MatchSettings, type TempoFit } from './match';
import type { Track } from '../types';

/** Shape of the energy arc across the set, not a single target level. */
export type EnergyShape = 'build' | 'peak' | 'wave' | 'cool' | 'steady';

export const ENERGY_SHAPES: { id: EnergyShape; label: string; blurb: string }[] = [
  { id: 'build', label: 'Build', blurb: 'Starts low, climbs to the top' },
  { id: 'peak', label: 'Peak', blurb: 'Rises to a peak, eases back down' },
  { id: 'wave', label: 'Wave', blurb: 'Lifts and drops, then lifts again' },
  { id: 'cool', label: 'Cool down', blurb: 'Opens hot, winds down' },
  { id: 'steady', label: 'Steady', blurb: 'Holds one level throughout' },
];

/** How hard to punish a track sitting away from its position's target energy. */
const ENERGY_DEVIATION = 12;
/** Search-time nudge toward transitions already saved on the canvas. */
const SAVED_BONUS = 15;
/** Search-time nudge toward staying inside a genre, scaled by `genreCohesion`. */
const GENRE_BONUS = 14;
/** Score given when a track has no energy value — neutral, neither reward nor penalty. */
const UNKNOWN_ENERGY = 70;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Target energy (1..10) for position `index` of a `length`-track set. */
export function energyTarget(
  shape: EnergyShape,
  index: number,
  length: number,
  baseline: number,
): number {
  const t = length <= 1 ? 0 : index / (length - 1);
  let value: number;
  switch (shape) {
    case 'build': value = 3 + t * 6; break;
    case 'cool': value = 9 - t * 6; break;
    case 'peak': value = 9 - 4 * (2 * t - 1) ** 2; break;
    case 'wave': value = 6 + 2.5 * Math.sin(2 * Math.PI * t); break;
    case 'steady': value = baseline; break;
  }
  return clamp(value, 1, 10);
}

const energyScore = (track: Track, target: number) =>
  track.energy == null
    ? UNKNOWN_ENERGY
    : Math.max(0, 100 - Math.abs(track.energy - target) * ENERGY_DEVIATION);

/** Genres the set actually visits, first appearance first, untagged ignored. */
function distinctGenres(tracks: Track[]): string[] {
  const seen: string[] = [];
  for (const t of tracks) {
    const genre = normalizeGenre(t.genre ?? '');
    if (genre && !seen.includes(genre)) seen.push(genre);
  }
  return seen;
}

/** Median energy of the pool, used as the "steady" target. */
function baselineEnergy(pool: Track[]): number {
  const values = pool.map((t) => t.energy).filter((e): e is number => e != null).sort((a, b) => a - b);
  if (!values.length) return 6;
  const mid = Math.floor(values.length / 2);
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

export type Hop = {
  from: Track;
  to: Track;
  /** Pure composite score, 0..100 — what gets displayed. */
  score: number;
  /** True when this exact transition already exists on the canvas. */
  saved: boolean;
  tempo: TempoFit;
  keyLabel: string | null;
};

export type GeneratedSet = {
  tracks: Track[];
  hops: Hop[];
  /** 0..100 overall: hop quality 70, energy-shape fit 20, rehearsed ratio 10. */
  score: number;
  energyFit: number;
  savedCount: number;
  /** Distinct genres the set touches, in play order. */
  genres: string[];
};

export type GenerateOptions = {
  pool: Track[];
  length: number;
  shape: EnergyShape;
  transitions: { from_id: number; to_id: number }[];
  settings?: MatchSettings;
  /**
   * 0..1. How much to favour neighbours that share a genre or a genre family.
   * It only steers the search — the score shown for a hop stays pure mixability.
   */
  genreCohesion?: number;
  beamWidth?: number;
  results?: number;
};

export type GenerateResult = {
  sets: GeneratedSet[];
  /** Longest set actually achievable — below `requested` when tempo gaps block it. */
  reachedLength: number;
  requested: number;
};

type Partial = {
  tracks: Track[];
  hops: Hop[];
  ids: Set<number>;
  /** Search ranking, includes the saved-transition bonus. */
  rank: number;
};

/** Displayed score: pure hop quality, energy-shape conformance, rehearsed ratio. */
function finalScore(p: Partial, shape: EnergyShape, length: number, baseline: number) {
  const hopMean = p.hops.length ? mean(p.hops.map((h) => h.score)) : 100;
  const energyFit = mean(
    p.tracks.map((t, i) => energyScore(t, energyTarget(shape, i, length, baseline))),
  );
  const savedRatio = p.hops.length ? p.hops.filter((h) => h.saved).length / p.hops.length : 0;
  return {
    score: hopMean * 0.7 + energyFit * 0.2 + savedRatio * 100 * 0.1,
    energyFit,
  };
}

export function generateSetlists({
  pool,
  length,
  shape,
  transitions,
  settings = DEFAULT_SETTINGS,
  genreCohesion = 0,
  beamWidth = 40,
  results = 5,
}: GenerateOptions): GenerateResult {
  const requested = clamp(Math.round(length), 2, Math.max(2, pool.length));
  if (pool.length < 2) return { sets: [], reachedLength: pool.length, requested };

  const baseline = baselineEnergy(pool);
  const savedEdges = new Set(transitions.map((t) => `${t.from_id}>${t.to_id}`));

  const cohesion = clamp(genreCohesion, 0, 1);

  // Ranking for a partial set, used only to prune the beam.
  const rankOf = (p: Partial) => {
    const hopMean = p.hops.length
      ? mean(p.hops.map((h) =>
          h.score
          + (h.saved ? SAVED_BONUS : 0)
          + cohesion * GENRE_BONUS * genreAffinity(h.from.genre ?? '', h.to.genre ?? ''),
        ))
      : 100;
    const energyFit = mean(
      p.tracks.map((t, i) => energyScore(t, energyTarget(shape, i, requested, baseline))),
    );
    return hopMean * 0.75 + energyFit * 0.25;
  };

  let beam: Partial[] = pool.map((track) => {
    const p: Partial = { tracks: [track], hops: [], ids: new Set([track.id]), rank: 0 };
    p.rank = rankOf(p);
    return p;
  });
  beam.sort((a, b) => b.rank - a.rank);
  beam = beam.slice(0, beamWidth);

  // Deepest beam we managed to fill, in case the target length is unreachable.
  let deepest = beam;

  for (let step = 1; step < requested; step++) {
    const next: Partial[] = [];

    for (const p of beam) {
      const last = p.tracks[p.tracks.length - 1];
      for (const cand of pool) {
        if (p.ids.has(cand.id)) continue;
        const pair = pairScore(last, cand, settings);
        if (!pair) continue; // tempo gap too wide to ride

        const saved = savedEdges.has(`${last.id}>${cand.id}`);
        const hop: Hop = {
          from: last,
          to: cand,
          score: pair.score,
          saved,
          tempo: pair.tempo,
          keyLabel: pair.key?.label ?? null,
        };
        const child: Partial = {
          tracks: [...p.tracks, cand],
          hops: [...p.hops, hop],
          ids: new Set(p.ids).add(cand.id),
          rank: 0,
        };
        child.rank = rankOf(child);
        next.push(child);
      }
    }

    if (!next.length) break; // nothing can be extended; keep what we have
    next.sort((a, b) => b.rank - a.rank);
    beam = next.slice(0, beamWidth);
    deepest = beam;
  }

  const reachedLength = deepest[0]?.tracks.length ?? 0;

  // Pick spread-out winners rather than five variations on one idea.
  const scored = deepest
    .map((p) => {
      const { score, energyFit } = finalScore(p, shape, requested, baseline);
      return {
        tracks: p.tracks,
        hops: p.hops,
        score,
        energyFit,
        savedCount: p.hops.filter((h) => h.saved).length,
        genres: distinctGenres(p.tracks),
      } satisfies GeneratedSet;
    })
    .sort((a, b) => b.score - a.score);

  const chosen: GeneratedSet[] = [];
  const openerCount = new Map<number, number>();
  const seen = new Set<string>();

  for (const set of scored) {
    if (chosen.length >= results) break;
    // One track is not a set. If nothing could be bridged, return nothing and
    // let `reachedLength` explain why.
    if (set.tracks.length < 2) continue;
    const signature = set.tracks.map((t) => t.id).join('>');
    if (seen.has(signature)) continue;
    const opener = set.tracks[0].id;
    if ((openerCount.get(opener) ?? 0) >= 2) continue;
    seen.add(signature);
    openerCount.set(opener, (openerCount.get(opener) ?? 0) + 1);
    chosen.push(set);
  }

  return { sets: chosen, reachedLength, requested };
}
