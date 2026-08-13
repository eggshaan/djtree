/**
 * Transition scoring. Pure functions over the track list — no network, no model,
 * just the arithmetic a DJ does in their head.
 */

import { keyRelation } from './camelot';
import type { Track } from '../types';

/**
 * Tempo relationships worth considering when leaving track A for track B.
 * `penalty` shaves the score for moves that are technically in sync but
 * musically a bigger jump than a straight tempo match.
 */
const DOUBLE = 'Tempos lock at a 2:1 ratio — every beat still lines up.';
const THREE_TWO = 'Tempos lock at a 3:2 ratio. Beats align but the feel changes; use carefully.';

const RATIOS: { r: number; label: string; penalty: number; detail: string }[] = [
  { r: 1, label: '', penalty: 0, detail: '' },
  { r: 2, label: 'double-time', penalty: 6, detail: DOUBLE },
  { r: 0.5, label: 'half-time', penalty: 6, detail: DOUBLE },
  { r: 1.5, label: '3/2', penalty: 22, detail: THREE_TWO },
  { r: 2 / 3, label: '2/3', penalty: 22, detail: THREE_TWO },
];

export type MatchSettings = {
  /** Max pitch adjustment, in percent, you're willing to ride. */
  tolerance: number;
  /** Fold key compatibility into the score. */
  useKey: boolean;
  /** Fold the energy delta into the score. */
  useEnergy: boolean;
  /** Allow half/double-time and 3/2 tempo relationships. */
  allowMultiples: boolean;
};

export const DEFAULT_SETTINGS: MatchSettings = {
  tolerance: 6,
  useKey: true,
  useEnergy: true,
  allowMultiples: true,
};

export type TempoFit = {
  /** Tempo ratio applied to the outgoing track. */
  ratio: number;
  /** Pitch adjustment needed on the incoming track, in percent (signed). */
  percent: number;
  /** e.g. "double-time" — empty for a straight tempo match. */
  label: string;
  /** Plain-English explanation of the ratio, surfaced as a tooltip. */
  detail: string;
  score: number;
};

/**
 * Best way to line up `to` underneath `from`, considering half/double time.
 * `percent` is how far the incoming track has to be pitched: positive means
 * speed it up.
 */
export function tempoFit(
  from: Track,
  to: Track,
  settings: MatchSettings = DEFAULT_SETTINGS,
): TempoFit {
  const ratios = settings.allowMultiples ? RATIOS : RATIOS.slice(0, 1);
  const tolerance = Math.max(0.1, settings.tolerance);

  let best: TempoFit | null = null;
  for (const { r, label, penalty, detail } of ratios) {
    const target = from.bpm * r;
    const percent = ((target - to.bpm) / to.bpm) * 100;
    const off = Math.abs(percent);
    // 100 at a perfect match, decaying to 0 at the tolerance limit.
    const raw = off >= tolerance ? 0 : 100 * (1 - off / tolerance) ** 1.25;
    const score = Math.max(0, raw - penalty);
    if (!best || score > best.score) {
      best = { ratio: r, percent, label, detail, score };
    }
  }
  return best!;
}

export type EnergyFit = { delta: number; score: number } | null;

export function energyFit(from: Track, to: Track): EnergyFit {
  if (from.energy == null || to.energy == null) return null;
  const delta = to.energy - from.energy;
  // Flat is ideal, a one-step lift is nearly as good, a big drop kills a set.
  const cost = delta >= 0 ? delta * 12 : Math.abs(delta) * 18;
  return { delta, score: Math.max(0, 100 - cost) };
}

export type MatchReason = {
  label: string;
  tone: 'good' | 'ok' | 'bad';
  /** Shown on hover so the shorthand explains itself. */
  detail: string;
};

export type Match = {
  track: Track;
  /** 0..100 overall. */
  score: number;
  tempo: TempoFit;
  key: { score: number; label: string } | null;
  energy: EnergyFit;
  reasons: MatchReason[];
  /** True when a transition from -> to already exists in the graph. */
  connected: boolean;
};

export type PairScore = {
  /** 0..100 composite. */
  score: number;
  tempo: TempoFit;
  key: { score: number; label: string; detail: string } | null;
  energy: EnergyFit;
};

/**
 * The composite score for playing `to` after `from`, or null when the tempo
 * lands outside the pitch range you'd actually ride.
 *
 * Weights are 70 / 20 / 10, but the divisor only counts the terms that exist —
 * a track with no key entered is judged on tempo alone across the same 0..100
 * range rather than being penalised for missing data.
 */
export function pairScore(
  from: Track,
  to: Track,
  settings: MatchSettings = DEFAULT_SETTINGS,
): PairScore | null {
  const tempo = tempoFit(from, to, settings);
  if (tempo.score <= 0) return null;

  const key = settings.useKey ? keyRelation(from.music_key, to.music_key) : null;
  const energy = settings.useEnergy ? energyFit(from, to) : null;

  let total = tempo.score * 0.7;
  let weight = 0.7;
  if (key) { total += key.score * 0.2; weight += 0.2; }
  if (energy) { total += energy.score * 0.1; weight += 0.1; }

  return { score: total / weight, tempo, key, energy };
}

/**
 * Score every other track as a candidate to play *after* `from`.
 * Weights shift onto tempo whenever key or energy data is missing, so a
 * half-filled library still ranks sensibly.
 */
export function rankMatches(
  from: Track,
  all: Track[],
  connectedIds: Set<number>,
  settings: MatchSettings = DEFAULT_SETTINGS,
): Match[] {
  const matches: Match[] = [];

  for (const to of all) {
    if (to.id === from.id) continue;

    const pair = pairScore(from, to, settings);
    if (!pair) continue; // outside the pitch range you'd actually ride
    const { score, tempo, key, energy } = pair;

    const reasons: MatchReason[] = [];
    const off = Math.abs(tempo.percent);
    const ridden = (to.bpm * (1 + tempo.percent / 100)).toFixed(1);
    reasons.push({
      label:
        off < 0.05
          ? 'exact BPM'
          : `${tempo.percent > 0 ? '+' : '−'}${off.toFixed(1)}% pitch`,
      tone: off <= 3 ? 'good' : off <= 6 ? 'ok' : 'bad',
      detail:
        off < 0.05
          ? 'Tempos already match — no pitch adjustment needed.'
          : `Play ${to.title} at ${ridden} BPM (${tempo.percent > 0 ? 'speed it up' : 'slow it down'} `
            + `${off.toFixed(1)}%) to lock with ${from.title}.`,
    });
    if (tempo.label) reasons.push({ label: tempo.label, tone: 'ok', detail: tempo.detail });
    if (key) {
      reasons.push({
        label: key.label,
        tone: key.score >= 85 ? 'good' : key.score >= 45 ? 'ok' : 'bad',
        detail: key.detail,
      });
    }
    if (energy && energy.delta !== 0) {
      reasons.push({
        label: `energy ${energy.delta > 0 ? '+' : ''}${energy.delta}`,
        tone: Math.abs(energy.delta) <= 1 ? 'good' : Math.abs(energy.delta) <= 3 ? 'ok' : 'bad',
        detail:
          `${to.title} is ${Math.abs(energy.delta)} ${energy.delta > 0 ? 'above' : 'below'} `
          + `${from.title} on your 1–10 energy scale.`,
      });
    }

    matches.push({
      track: to,
      score,
      tempo,
      key,
      energy,
      reasons,
      connected: connectedIds.has(to.id),
    });
  }

  return matches.sort((a, b) => b.score - a.score);
}

/* ------------------------------------------------------------- set paths */

export type SetPath = {
  tracks: Track[];
  /** Average score of every hop along the path. */
  quality: number;
};

/** Adjacency lists in both directions, built once per query. */
function buildAdjacency(transitions: { from_id: number; to_id: number }[]) {
  const forward = new Map<number, number[]>();
  const reverse = new Map<number, number[]>();
  const push = (map: Map<number, number[]>, key: number, value: number) => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };
  for (const t of transitions) {
    push(forward, t.from_id, t.to_id);
    push(reverse, t.to_id, t.from_id);
  }
  return { forward, reverse };
}

/**
 * "I'm playing X, get me to Y" — every route through transitions you've
 * already saved, shortest first.
 *
 * Walking forward blindly explodes combinatorially, so this first runs a BFS
 * backwards from the target to learn each track's minimum hop distance, then
 * only explores neighbours that can still reach the target within the hops
 * remaining. Dead ends are never entered at all.
 */
export function findRoutes(
  from: Track,
  to: Track,
  tracks: Track[],
  transitions: { from_id: number; to_id: number }[],
  { maxHops = 6, maxRoutes = 12 }: { maxHops?: number; maxRoutes?: number } = {},
): SetPath[] {
  if (from.id === to.id) return [];
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const { forward, reverse } = buildAdjacency(transitions);

  // Minimum hops from each track to the target.
  const distance = new Map<number, number>([[to.id, 0]]);
  let frontier = [to.id];
  while (frontier.length) {
    const next: number[] = [];
    for (const id of frontier) {
      const d = distance.get(id)!;
      if (d >= maxHops) continue;
      for (const prev of reverse.get(id) ?? []) {
        if (!distance.has(prev)) {
          distance.set(prev, d + 1);
          next.push(prev);
        }
      }
    }
    frontier = next;
  }

  if (!distance.has(from.id)) return [];

  const routes: SetPath[] = [];

  const walk = (chain: Track[], seen: Set<number>, scores: number[]) => {
    if (routes.length >= maxRoutes) return;
    const current = chain[chain.length - 1];

    if (current.id === to.id) {
      routes.push({
        tracks: [...chain],
        quality: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
      });
      return;
    }

    const remaining = maxHops - (chain.length - 1);
    for (const nextId of forward.get(current.id) ?? []) {
      if (seen.has(nextId)) continue;
      const track = byId.get(nextId);
      // Skip anything that can't reach the target in the hops we have left.
      const d = distance.get(nextId);
      if (!track || d === undefined || d > remaining - 1) continue;

      seen.add(nextId);
      chain.push(track);
      scores.push(tempoFit(current, track).score);
      walk(chain, seen, scores);
      scores.pop();
      chain.pop();
      seen.delete(nextId);
    }
  };

  walk([from], new Set([from.id]), []);

  return routes.sort(
    (a, b) => a.tracks.length - b.tracks.length || b.quality - a.quality,
  );
}

/**
 * Walk every branch downstream of `root` and return each chain as a candidate
 * setlist. Cycles are cut at the repeated track so an A→B→A loop can't run away.
 */
export function tracePaths(
  root: Track,
  tracks: Track[],
  transitions: { from_id: number; to_id: number }[],
  { maxDepth = 12, maxPaths = 40 }: { maxDepth?: number; maxPaths?: number } = {},
): SetPath[] {
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const { forward: outgoing } = buildAdjacency(transitions);

  const paths: SetPath[] = [];

  const walk = (chain: Track[], seen: Set<number>, scores: number[]) => {
    if (paths.length >= maxPaths) return;
    const current = chain[chain.length - 1];
    const next = (outgoing.get(current.id) ?? []).filter((id) => !seen.has(id) && byId.has(id));

    if (next.length === 0 || chain.length >= maxDepth) {
      if (chain.length > 1) {
        const quality = scores.length
          ? scores.reduce((a, b) => a + b, 0) / scores.length
          : 0;
        paths.push({ tracks: [...chain], quality });
      }
      return;
    }

    for (const id of next) {
      const track = byId.get(id)!;
      seen.add(id);
      chain.push(track);
      scores.push(tempoFit(current, track).score);
      walk(chain, seen, scores);
      scores.pop();
      chain.pop();
      seen.delete(id);
    }
  };

  walk([root], new Set([root.id]), []);
  return paths.sort((a, b) => b.tracks.length - a.tracks.length || b.quality - a.quality);
}
