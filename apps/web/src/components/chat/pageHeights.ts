/**
 * The heights this browser measured its Mate's pages at, by the page's asset: layout it measured
 * itself, never a source's answer, so a page reopened — after a reload too — paints at its height
 * from its first frame instead of moving once it loads. The newest few hundred.
 */
const HEIGHTS_KEY = "mate:page-heights";
const HEIGHTS_KEPT = 200;
const heights = new Map<string, number>();
let heightsRead = false;

function readHeights(): void {
  if (heightsRead) return;
  heightsRead = true;
  try {
    const stored = JSON.parse(globalThis.localStorage?.getItem(HEIGHTS_KEY) ?? "[]") as unknown;
    if (!Array.isArray(stored)) return;
    for (const entry of stored)
      if (Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1] === "number")
        heights.set(entry[0], entry[1]);
  } catch {
    // No storage, or none readable: heights are remembered for this page's life only.
  }
}

/** The height a page last stood at, by its asset; null for a page never drawn here. */
export function rememberedPageHeight(id: string): number | null {
  readHeights();
  return heights.get(id) ?? null;
}

/** Remembers a page's height, so its next first paint is at it (the newest few hundred). */
export function rememberPageHeight(id: string, height: number): void {
  readHeights();
  if (heights.get(id) === height) return;
  heights.delete(id);
  heights.set(id, height);
  while (heights.size > HEIGHTS_KEPT) heights.delete(heights.keys().next().value!);
  try {
    globalThis.localStorage?.setItem(HEIGHTS_KEY, JSON.stringify([...heights]));
  } catch {
    // Full or blocked storage: remembered in memory alone.
  }
}
