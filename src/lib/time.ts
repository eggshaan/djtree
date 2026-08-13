/**
 * Cue points as DJs write them. Stored as whole seconds; typed as `m:ss` — or
 * as bare seconds, because plenty of players show a countdown rather than a
 * position and typing `90` is faster than converting it.
 */

/** Longest cue we'll take: 24 hours, well past any track or DJ set. */
const MAX_SECONDS = 86_400;

/** Seconds, or null when the text isn't a timecode this understands. */
export function parseTimecode(input: string): number | null {
  const text = input.trim();
  if (!text) return null;

  const clock = /^(\d+):([0-5]?\d(?:\.\d+)?)$/.exec(text);
  const seconds = clock
    ? Number(clock[1]) * 60 + Number(clock[2])
    : /^\d+(?:\.\d+)?$/.test(text)
      ? Number(text)
      : NaN;

  if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAX_SECONDS) return null;
  return Math.round(seconds);
}

/** Seconds -> `m:ss`, or `h:mm:ss` once a track runs past the hour. */
export function formatTimecode(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** How long `bars` of 4/4 lasts at `bpm`. */
export function barsToSeconds(bars: number, bpm: number): number {
  if (!bpm) return 0;
  return (bars * 4 * 60) / bpm;
}
