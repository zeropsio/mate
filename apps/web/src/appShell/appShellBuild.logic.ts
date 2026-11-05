/**
 * What a hosted page needs from the asset cache to boot and warm, computed from the build's own
 * graph (`vite.config.ts` `appShellFilesPlugin`) and embedded in the page it describes
 * (`embedShellFiles`, read back by the worker with `readShellFiles`). The worker keeps a page only
 * once every file listed here is kept: a kept page can never be a build whose files this browser
 * lacks.
 *
 * The list is the entry's static closure and its CSS, plus the closure of every chunk the app's
 * warmer loads once the page settles (`lib/appChunks.ts`): every route's split code except the
 * maintainer's `/kit`, and every surface declared with `appChunk()`. That is the set a first load
 * after a deploy downloads anyway (~140 files); the rest of the build (diagram renderers, syntax
 * grammars) is fetched on use and kept as it is fetched.
 */

export interface BundleChunk {
  readonly fileName: string;
  readonly isEntry: boolean;
  /** Chunks this one imports statically. */
  readonly imports: readonly string[];
  readonly moduleIds: readonly string[];
  /** Stylesheets Vite attaches to this chunk (`viteMetadata.importedCss`). */
  readonly css: readonly string[];
}

/** Split route code the warmer loads (`router.loadRouteChunk` for every route but `/kit`). */
export function isWarmedRouteModule(id: string): boolean {
  if (!id.includes("?tsr-split")) return false;
  const path = id.slice(0, id.indexOf("?")).replaceAll("\\", "/");
  return !path.endsWith("/routes/kit.tsx");
}

/** The files, as root-absolute paths under `base`, that boot the entry and warm every surface. */
export function precacheList(
  chunks: readonly BundleChunk[],
  warmedModuleIds: ReadonlySet<string>,
  base = "/",
): string[] {
  const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const pending = chunks
    .filter((chunk) => chunk.isEntry || chunk.moduleIds.some((id) => warmedModuleIds.has(id)))
    .map((chunk) => chunk.fileName);
  const files = new Set<string>();
  const seen = new Set<string>();
  while (pending.length > 0) {
    const fileName = pending.pop()!;
    if (seen.has(fileName)) continue;
    seen.add(fileName);
    const chunk = byFile.get(fileName);
    if (chunk === undefined) continue;
    files.add(fileName);
    for (const css of chunk.css) files.add(css);
    pending.push(...chunk.imports);
  }
  return [...files].toSorted().map((fileName) => `${base}${fileName}`);
}
