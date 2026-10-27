#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off preferSchemaOverJson:off -- production bundle inspection.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeZlib from "node:zlib";

interface ManifestChunk {
  readonly file: string;
  readonly imports?: ReadonlyArray<string>;
}

/** Static imports are fetched with a surface; dynamic imports belong to its next demand. */
export function surfaceFiles(
  manifest: Readonly<Record<string, ManifestChunk>>,
  keys: ReadonlyArray<string>,
): string[] {
  const files = new Set<string>();
  const visit = (key: string) => {
    const chunk = manifest[key];
    if (!chunk) throw new Error(`Missing build manifest entry: ${key}`);
    if (files.has(chunk.file)) return;
    files.add(chunk.file);
    chunk.imports?.forEach(visit);
  };
  keys.forEach(visit);
  return [...files].sort();
}

if (import.meta.main) {
  const directory = NodePath.resolve(process.argv[2] ?? "apps/web/dist");
  const manifest = JSON.parse(
    NodeFS.readFileSync(NodePath.join(directory, ".vite/manifest.json"), "utf8"),
  ) as Record<string, ManifestChunk>;
  const route = (name: string) => `src/routes/${name}.tsx?tsr-split=component`;
  const entry = ["index.html"];
  const menu = [
    ...entry,
    route("_chat"),
    route("_chat.index"),
    "src/components/zerops/ZeropsProjectsPage.tsx",
  ];
  const conversation = [
    ...entry,
    route("_chat"),
    route("_chat.index"),
    route("_chat.$environmentId.$threadId"),
  ];
  for (const [surface, keys] of [
    ["Sign-in", entry],
    ["Menu / projects", menu],
    ["Plain conversation", conversation],
  ] as const) {
    const files = surfaceFiles(manifest, keys);
    const sources = files.map((file) => NodeFS.readFileSync(NodePath.join(directory, file)));
    console.log(
      `${surface}: ${sources.reduce((sum, source) => sum + source.byteLength, 0)} decoded, ${sources.reduce((sum, source) => sum + NodeZlib.gzipSync(source, { level: 9 }).byteLength, 0)} gzip bytes (${files.length} JS chunks)`,
    );
  }
  console.log(
    "Module composition: build with T3CODE_WEB_ANALYZE=1; see dist/bundle-composition.json (module lengths before chunk minification).",
  );
}
