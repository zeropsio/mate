export function retryAtFromHeader(value: string | undefined, now: number): number | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (/^\d+$/u.test(normalized)) {
    const seconds = Number(normalized);
    const retryAt = now + seconds * 1_000;
    return Number.isSafeInteger(retryAt) ? retryAt : undefined;
  }
  const retryAt = Date.parse(normalized);
  return Number.isFinite(retryAt) && retryAt > now ? retryAt : undefined;
}
