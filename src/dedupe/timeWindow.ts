/**
 * Dedup cascade stage 4 (time window) — see planning doc §7: candidates must fall
 * within +/-6h of each other, so an anniversary piece ("One year since X") doesn't
 * collapse into live coverage of a new, structurally-similar-titled event.
 */

const DEFAULT_WINDOW_HOURS = 6;

export function withinTimeWindow(
  isoA: string,
  isoB: string,
  windowHours: number = DEFAULT_WINDOW_HOURS
): boolean {
  const a = new Date(isoA).getTime();
  const b = new Date(isoB).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  const diffHours = Math.abs(a - b) / (1000 * 60 * 60);
  return diffHours <= windowHours;
}
