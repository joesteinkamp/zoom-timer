/** mm:ss, or h:mm:ss past an hour. Always rounds up so "0:01" is a real second. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return h > 0 ? `${h}:${mm}:${String(s).padStart(2, '0')}` : `${mm}:${String(s).padStart(2, '0')}`;
}

/** "just now" / "2m ago" -- used by the finished state. */
export function formatAgo(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}

/** Accepts "5", "5:00", "90s", "2m30s". Returns ms, or null if unparseable. */
export function parseDuration(input: string): number | null {
  const raw = input.trim().toLowerCase();
  if (!raw) return null;

  const colon = /^(\d{1,2}):([0-5]?\d)$/.exec(raw);
  if (colon) return (Number(colon[1]) * 60 + Number(colon[2])) * 1000;

  const compound = /^(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?$/.exec(raw);
  if (compound && (compound[1] || compound[2])) {
    return (Number(compound[1] ?? 0) * 60 + Number(compound[2] ?? 0)) * 1000;
  }

  // A bare number means minutes -- that is what people mean in a meeting.
  const bare = /^\d+(?:\.\d+)?$/.exec(raw);
  if (bare) return Math.round(Number(raw) * 60 * 1000);

  return null;
}
