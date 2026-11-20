/** Values keyed by what they say and how often it came before: stable as a list only grows. */
export function keyedByOccurrence(
  values: ReadonlyArray<string>,
): ReadonlyArray<{ readonly key: string; readonly value: string }> {
  const seen = new Map<string, number>();
  return values.map((value) => {
    const occurrence = seen.get(value) ?? 0;
    seen.set(value, occurrence + 1);
    return { key: `${value}#${occurrence}`, value };
  });
}
