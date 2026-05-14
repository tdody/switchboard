export function formatAgo(ts: number): string {
  if (!ts) return "—";
  const diff = Math.max(0, Date.now() - ts);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const mn = Math.floor(s / 60);
  if (mn < 60) return `${mn}m`;
  const h = Math.floor(mn / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

export function formatMem(mb: number): string {
  if (mb < 1024) return `${mb} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}
