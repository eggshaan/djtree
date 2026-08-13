/**
 * Camelot wheel helpers.
 *
 * The wheel is 12 numbers x 2 letters: A = minor, B = major. Keys that sit
 * next to each other on the wheel share most of their notes, which is why
 * DJs use it — 8A into 9A works, 8A into 3B fights.
 */

export type Camelot = { num: number; letter: 'A' | 'B' };

const PITCH_CLASS: Record<string, number> = {
  C: 0, 'C#': 1, DB: 1, D: 2, 'D#': 3, EB: 3, E: 4, FB: 4, F: 5,
  'F#': 6, GB: 6, G: 7, 'G#': 8, AB: 8, A: 9, 'A#': 10, BB: 10, B: 11, CB: 11,
};

// Indexed by pitch class 0..11 (C, C#, D, ...).
const MINOR_BY_PC = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];
const MAJOR_BY_PC = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];

const NAME_BY_PC = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

/**
 * Accepts Camelot ("8A", "8a"), Open Key ("1m"/"1d" is *not* supported), or a
 * musical key name ("Am", "A min", "F#m", "Gb major", "C"). Returns normalized
 * Camelot like "8A", or null if it can't be parsed.
 */
export function parseKey(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  // Camelot: 1A .. 12B
  const camelot = /^(\d{1,2})\s*([ABab])$/.exec(raw);
  if (camelot) {
    const num = Number(camelot[1]);
    if (num >= 1 && num <= 12) return `${num}${camelot[2].toUpperCase()}`;
    return null;
  }

  // Musical key: note + optional accidental + optional quality
  const musical = /^([A-Ga-g])\s*([#♯b♭]?)\s*(.*)$/.exec(raw);
  if (!musical) return null;

  const accidental = musical[2].replace('♯', '#').replace('♭', 'b');
  const note = (musical[1].toUpperCase() + accidental).toUpperCase();
  const pc = PITCH_CLASS[note];
  if (pc === undefined) return null;

  const quality = musical[3].toLowerCase().replace(/[\s.\-_]/g, '');
  const isMinor =
    quality === 'm' || quality.startsWith('min') || quality === '-' || quality === 'moll';
  const isMajor = quality === '' || quality.startsWith('maj') || quality === 'dur';
  if (!isMinor && !isMajor) return null;

  return isMinor ? `${MINOR_BY_PC[pc]}A` : `${MAJOR_BY_PC[pc]}B`;
}

export function toCamelot(value: string | null): Camelot | null {
  if (!value) return null;
  const m = /^(\d{1,2})([AB])$/.exec(value.trim().toUpperCase());
  if (!m) return null;
  const num = Number(m[1]);
  if (num < 1 || num > 12) return null;
  return { num, letter: m[2] as 'A' | 'B' };
}

/** "8A" -> "A minor" — for showing the human-readable name next to the code. */
export function keyName(value: string | null): string {
  const c = toCamelot(value);
  if (!c) return '';
  const table = c.letter === 'A' ? MINOR_BY_PC : MAJOR_BY_PC;
  const pc = table.indexOf(c.num);
  if (pc < 0) return '';
  return `${NAME_BY_PC[pc]} ${c.letter === 'A' ? 'minor' : 'major'}`;
}

/** Shortest distance around the 12-hour wheel. */
export const wheelDistance = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 12;
  return Math.min(d, 12 - d);
};

export type KeyRelation = {
  /** 0..100 — how well `to` sits under `from` harmonically. */
  score: number;
  label: string;
  /** Plain-English explanation, surfaced as a tooltip. */
  detail: string;
};

/**
 * Standard harmonic-mixing rules, scored so the match list can sort by them.
 * Anything outside the classic moves still gets a floor score — plenty of
 * transitions work over a percussive intro regardless of key.
 */
export function keyRelation(from: string | null, to: string | null): KeyRelation | null {
  const a = toCamelot(from);
  const b = toCamelot(to);
  if (!a || !b) return null;

  if (a.num === b.num && a.letter === b.letter) {
    return { score: 100, label: 'same key', detail: 'Identical key — the safest possible blend.' };
  }
  if (a.num === b.num) {
    return {
      score: 92,
      label: 'relative maj/min',
      detail: `${from} and ${to} share the same notes in opposite modes. Blends cleanly and shifts the mood.`,
    };
  }

  if (a.letter === b.letter) {
    const step = (((b.num - a.num) % 12) + 12) % 12;
    if (step === 1) {
      return { score: 90, label: '+1 energy up',
        detail: 'One step clockwise on the Camelot wheel — lifts the energy.' };
    }
    if (step === 11) {
      return { score: 88, label: '−1 energy down',
        detail: 'One step counter-clockwise — settles the energy.' };
    }
    if (step === 2) {
      return { score: 62, label: '+2 whole step',
        detail: 'Two steps around the wheel. An audible jump, but it holds over drums.' };
    }
    if (step === 10) {
      return { score: 58, label: '−2 whole step',
        detail: 'Two steps back around the wheel. Audible, but it holds over drums.' };
    }
    if (step === 7) {
      return { score: 60, label: '+7 energy boost',
        detail: 'Seven steps around the wheel — a deliberate lift that needs a clean swap.' };
    }
  }

  // Diagonal neighbours (e.g. 8A -> 9B) are usable but need care.
  if (wheelDistance(a.num, b.num) === 1) {
    return {
      score: 45,
      label: 'diagonal',
      detail: 'Adjacent number but the opposite mode — workable, though melodies can fight.',
    };
  }

  return {
    score: 20,
    label: 'clashing',
    detail: `${from} and ${to} aren't harmonically related. Mix over percussion or a section with no melody.`,
  };
}
