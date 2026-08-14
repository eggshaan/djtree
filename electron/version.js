/** Version comparison for the update check. Kept apart so it can be tested. */

/** "v0.2.1" / "0.2.1" -> [0, 2, 1]. Anything unparsable counts as 0. */
const parts = (version) =>
  String(version ?? '').replace(/^v/i, '').split('.').map((n) => Number.parseInt(n, 10) || 0);

/**
 * True when `candidate` is a higher version than `current`. Compares numeric
 * segments left to right, treating a missing segment as 0 — so 0.2 and 0.2.0
 * are the same version, and 0.10.0 correctly beats 0.9.0.
 */
export function isNewer(candidate, current) {
  const a = parts(candidate);
  const b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}
