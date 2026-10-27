/**
 * Parses the newline-terminated lines of an append-only JSON-lines log. A
 * trailing fragment has no newline yet, so it is left out until its writer
 * completes it.
 */
export function parseCompleteJsonLines(content: string): Array<Record<string, unknown>> {
  const end = content.lastIndexOf("\n");
  if (end === -1) return [];
  return content
    .slice(0, end)
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
