/** Retain the most recently used idle journals; active readers are never candidates. */
export const pruneIdleScopes = <K, V extends { readonly lastUsed: number }>(
  entries: Map<K, V>,
  idle: (entry: V) => boolean,
  limit: number,
) => {
  if (entries.size <= limit) return;
  const candidates = [...entries]
    .filter(([, entry]) => idle(entry))
    .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
  for (const [key] of candidates.slice(0, Math.max(0, candidates.length - limit)))
    entries.delete(key);
};
