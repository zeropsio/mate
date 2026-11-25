/** One menu line directs people to all the kept-code questions. */
export function keptCodeLine(count: number): string | undefined {
  if (count === 0) return undefined;
  return count === 1 ? "1 question about kept code" : `${String(count)} questions about kept code`;
}
