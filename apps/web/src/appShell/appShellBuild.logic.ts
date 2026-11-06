/**
 * What a hosted page needs from the asset cache for as long as it runs, computed from the build's
 * own graph (`vite.config.ts` `appShellFilesPlugin`) and embedded in the page it describes
 * (`embedShellFiles`, read back by the worker with `readShellFiles`). The worker keeps a page only
 * once every file listed here is kept, and keeps the replaced page's files beside it: a kept page
 * always boots, and the previous build a tab still runs keeps every chunk it may yet load.
 *
 * **Which chunks.** Every chunk reachable from the entry through static and dynamic imports whose
 * file name changes from build to build: the entry's static closure (app code that changes with
 * every deploy) and every chunk that refers to one of those, directly or through other chunks, by
 * static or dynamic import (a chunk's code names the files it imports, so its own content hash
 * follows theirs). Chunks that refer to none of them (syntax grammars, themes, heic-to) keep their
 * name across builds: the next build ships the same file, so the origin still has it and they stay
 * out. With each listed chunk come its CSS and the files it imports as URLs (workers, wasm, fonts,
 * sounds).
 */

export interface BundleChunk {
  readonly fileName: string;
  readonly isEntry: boolean;
  /** Chunks this one imports statically. */
  readonly imports: readonly string[];
  /** Chunks this one imports dynamically. */
  readonly dynamicImports: readonly string[];
  /** Stylesheets and URL-imported files Vite attaches to this chunk (`viteMetadata`). */
  readonly css: readonly string[];
  readonly assets: readonly string[];
}

/** The files, as root-absolute paths under `base`, that a page may load while it runs. */
export function precacheList(chunks: readonly BundleChunk[], base = "/"): string[] {
  const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const closure = (roots: readonly string[], follow: (chunk: BundleChunk) => readonly string[]) => {
    const seen = new Set<string>();
    const pending = [...roots];
    while (pending.length > 0) {
      const fileName = pending.pop()!;
      const chunk = byFile.get(fileName);
      if (chunk === undefined || seen.has(fileName)) continue;
      seen.add(fileName);
      pending.push(...follow(chunk));
    }
    return seen;
  };
  const entries = chunks.filter((chunk) => chunk.isEntry).map((chunk) => chunk.fileName);
  const reachable = closure(entries, (chunk) => [...chunk.imports, ...chunk.dynamicImports]);
  // Changes with the build: the entry's static closure, then whatever refers to a changing chunk.
  const changing = closure(entries, (chunk) => chunk.imports);
  for (let grew = true; grew;) {
    grew = false;
    for (const chunk of chunks) {
      if (changing.has(chunk.fileName)) continue;
      if ([...chunk.imports, ...chunk.dynamicImports].some((file) => changing.has(file))) {
        changing.add(chunk.fileName);
        grew = true;
      }
    }
  }
  const files = new Set<string>();
  for (const fileName of reachable) {
    if (!changing.has(fileName)) continue;
    const chunk = byFile.get(fileName)!;
    files.add(fileName);
    for (const file of [...chunk.css, ...chunk.assets]) files.add(file);
  }
  return [...files].toSorted().map((fileName) => `${base}${fileName}`);
}
