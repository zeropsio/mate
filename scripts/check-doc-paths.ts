#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off -- Repository check CLI over the docs' path citations.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

// Every path a doc cites (a markdown link, a path-shaped code span, a bare repository path) must
// name a tracked file or directory, and a `:N` suffix a line that file has. A citation of
// another repository (`zeropsio/<repo>:<path>`) is not checked here.

const ROOT = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
// Upstream's README, kept unmodified (README.md); its relative links are upstream's.
const UNCHECKED_DOC = "docs/upstream-README.md";

const LINK_PATTERN = /\]\(([^)\s#]+)(?:#[^)]*)?\)/g;
const CODE_SPAN_PATTERN = /`([^`\s]+)`/g;
const BARE_PATH_PATTERN =
  /(?<![\w:/.@*-])((?:apps|packages|scripts|docs|\.github)\/[\w./@*{},-]*[\w*}/-](?::\d+(?:-\d+)?)?)/g;
const CROSS_REPO_PATTERN = /^zeropsio\/[\w.-]+:/;
const SCHEME_PATTERN = /^[a-z]+:/;
const UNPATH_PATTERN = /[<>$~|()\s]|^[/@-]/;
const LOCAL_ONLY_SEGMENTS = new Set(["dist", "node_modules"]);
const LOCAL_ONLY_ROOTS = new Set([".t3", ".plans", ".repos"]);
const LINE_SUFFIX_PATTERN = /:(\d+)(?:-(\d+))?$/;
const BARE_DOC_NAME_PATTERN = /^[A-Z][A-Za-z_-]*\.md$/;
const BARE_SOURCE_NAME_PATTERN = /^[\w.-]+\.(ts|tsx|css)$/;

type CitationKind = "link" | "span" | "bare";

const files = NodeChildProcess.execFileSync(
  "git",
  ["ls-files", "-co", "--exclude-standard", "-z"],
  {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  },
)
  .split("\0")
  .filter((path) => path !== "" && NodeFS.existsSync(NodePath.join(ROOT, path)));
const fileSet = new Set(files);
const directorySet = new Set<string>();
const baseNames = new Set<string>();
for (const file of files) {
  baseNames.add(NodePath.posix.basename(file));
  for (let index = file.indexOf("/"); index !== -1; index = file.indexOf("/", index + 1)) {
    directorySet.add(file.slice(0, index));
  }
}
const topLevel = new Set(files.map((file) => file.split("/")[0]));
const lineCounts = new Map<string, number>();

function lineCount(file: string): number {
  const known = lineCounts.get(file);
  if (known !== undefined) return known;
  const text = NodeFS.readFileSync(NodePath.join(ROOT, file), "utf8");
  const count = text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  lineCounts.set(file, count);
  return count;
}

function expandBraces(pattern: string): ReadonlyArray<string> {
  const match = /\{([^{}]*)\}/.exec(pattern);
  if (match === null) return [pattern];
  const before = pattern.slice(0, match.index);
  const after = pattern.slice(match.index + match[0].length);
  return (match[1] ?? "").split(",").flatMap((choice) => expandBraces(before + choice + after));
}

function globPattern(glob: string): RegExp {
  let source = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob.charAt(index);
    if (glob.startsWith("**/", index)) {
      source += "(?:.*/)?";
      index += 2;
    } else if (glob.startsWith("**", index)) {
      source += ".*";
      index += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else {
      source += char.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

/** The repository-relative path a citation names from `base`, or undefined when it leaves the repository. */
function resolveFrom(base: string, path: string): string | undefined {
  const resolved = NodePath.posix.normalize(NodePath.posix.join(base, path)).replace(/\/$/, "");
  if (resolved === ".." || resolved.startsWith("../")) return undefined;
  return resolved;
}

function existsAt(path: string): boolean {
  if (!/[*{]/.test(path)) return fileSet.has(path) || directorySet.has(path) || path === ".";
  return expandBraces(path).some((glob) => {
    const pattern = globPattern(glob);
    return (
      files.some((file) => pattern.test(file)) || [...directorySet].some((dir) => pattern.test(dir))
    );
  });
}

function isPathShaped(path: string): boolean {
  if (path.includes("/")) {
    return topLevel.has(path.split("/")[0]) || (path.endsWith(".md") && !path.startsWith("."));
  }
  return BARE_DOC_NAME_PATTERN.test(path) || BARE_SOURCE_NAME_PATTERN.test(path);
}

function isSkipped(citation: string): boolean {
  if (CROSS_REPO_PATTERN.test(citation) || SCHEME_PATTERN.test(citation)) return true;
  if (UNPATH_PATTERN.test(citation)) return true;
  const segments = citation.split("/");
  return (
    LOCAL_ONLY_ROOTS.has(segments[0] ?? "") ||
    segments.some((segment) => LOCAL_ONLY_SEGMENTS.has(segment))
  );
}

/** Why a citation is dead, "" when dead without a further reason, or undefined when it is live. */
function deadReason(doc: string, kind: CitationKind, citation: string): string | undefined {
  const suffix = LINE_SUFFIX_PATTERN.exec(citation);
  const path = suffix === null ? citation : citation.slice(0, suffix.index);
  const lastLine = suffix === null ? undefined : Number(suffix[2] ?? suffix[1]);
  const docDirectory = NodePath.posix.dirname(doc);
  const bases = kind === "link" ? [docDirectory] : [".", docDirectory];
  const resolved = bases
    .map((base) => resolveFrom(base, path))
    .find((candidate) => candidate !== undefined && existsAt(candidate));
  if (resolved === undefined) {
    if (kind !== "link" && !path.includes("/") && baseNames.has(path)) return undefined;
    return /[*{]/.test(path) ? " (no tracked path matches)" : "";
  }
  if (lastLine === undefined) return undefined;
  if (!fileSet.has(resolved)) return "";
  const count = lineCount(resolved);
  return count >= lastLine ? undefined : ` (file has ${count} lines)`;
}

function citations(line: string): ReadonlyArray<readonly [CitationKind, string]> {
  const found = new Map<string, CitationKind>();
  const add = (kind: CitationKind, raw: string) => {
    const citation = raw.replace(/[.,;]+$/, "");
    if (citation === "" || found.has(citation) || isSkipped(citation)) return;
    if (kind !== "link" && !isPathShaped(citation.replace(LINE_SUFFIX_PATTERN, ""))) return;
    found.set(citation, kind);
  };
  for (const match of line.matchAll(LINK_PATTERN)) add("link", match[1] ?? "");
  for (const match of line.matchAll(CODE_SPAN_PATTERN)) add("span", match[1] ?? "");
  for (const match of line.matchAll(BARE_PATH_PATTERN)) add("bare", match[1] ?? "");
  return [...found].map(([citation, kind]) => [kind, citation] as const);
}

const docs = files
  .filter(
    (file) =>
      file === "AGENTS.md" ||
      file === "CLAUDE.md" ||
      (file.startsWith("docs/") && file.endsWith(".md") && file !== UNCHECKED_DOC),
  )
  .toSorted();

let checked = 0;
let dead = 0;
for (const doc of docs) {
  const lines = NodeFS.readFileSync(NodePath.join(ROOT, doc), "utf8").split("\n");
  lines.forEach((line, index) => {
    for (const [kind, citation] of citations(line)) {
      checked += 1;
      const reason = deadReason(doc, kind, citation);
      if (reason === undefined) continue;
      dead += 1;
      console.log(`${doc}:${index + 1}: ${citation}${reason}`);
    }
  });
}

console.log(`doc paths: ${dead} dead of ${checked} citations`);
process.exitCode = dead > 0 ? 1 : 0;
