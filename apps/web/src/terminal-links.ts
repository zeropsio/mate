import { isMacPlatform } from "./lib/utils";

type TerminalLinkKind = "url" | "path";

interface TerminalLinkMatch {
  kind: TerminalLinkKind;
  text: string;
  start: number;
  end: number;
}

export interface TerminalBufferLineLike {
  readonly isWrapped?: boolean;
  translateToString(trimRight?: boolean): string;
}

interface WrappedTerminalLinkLineSegment {
  bufferLineNumber: number;
  text: string;
  startIndex: number;
  endIndex: number;
}

interface WrappedTerminalLinkLine {
  text: string;
  segments: ReadonlyArray<WrappedTerminalLinkLineSegment>;
}

const URL_PATTERN = /https?:\/\/[^\s"'`<>]+/giu;
// A TypeScript `file(3,10): error TS…` location counts only before its diagnostic.
// A bare `name.ext` needs `:line:col` or a TypeScript location after it, so prose and `host:port`
// stay text; it starts only at a word boundary so hover detection never rescans a run's suffixes.
const FILE_PATH_PATTERN =
  /(?:~\/|\.{1,2}\/|\/|(?<![\w.-])[A-Za-z]:[\\/]|\\\\)[^\s"'`<>]+|(?<![A-Za-z0-9._-])[A-Za-z0-9._-]+(?:(?:\/[A-Za-z0-9._-]+)+|\.[A-Za-z][A-Za-z0-9_-]*(?=:\d+:\d|\(\d+,\d+\):\s+(?:error|warning) TS\d+:))(?:(?::\d+){1,2}|\(\d+,\d+\)(?=:\s+(?:error|warning) TS\d+:))?/g;
const TYPESCRIPT_DIAGNOSTIC_AFTER_PATH = /^:\s+(?:error|warning) TS\d+:/u;
// The tail of an SCP-style Git remote such as `git@github.com:acme/widgets.git` is not a path.
// Only a path wholly inside the tail is dropped, so `src/contact@support.vue:12:3` keeps its link.
const SCP_REMOTE_PATTERN = /(?<![\w.@-])[\w.-]+@[\w.-]+:[^\s"'`<>]+/gu;
const TRAILING_PUNCTUATION_PATTERN = /[.,;!?]+$/;
// Paths also drop a trailing colon: compilers end `file:line:col:` with one.
const TRAILING_PATH_PUNCTUATION_PATTERN = /[.,;:!?]+$/;

function trimClosingDelimiters(value: string, kind: TerminalLinkKind): string {
  const output = value.replace(
    kind === "path" ? TRAILING_PATH_PUNCTUATION_PATTERN : TRAILING_PUNCTUATION_PATTERN,
    "",
  );
  if (output.length === 0) return output;
  let end = output.length;

  // One count per delimiter: hover detection runs this every frame, and recounting per trimmed
  // character made a long run of `)` quadratic.
  const trimUnbalanced = (open: string, close: string) => {
    if (output[end - 1] !== close) return;
    let excess = output.split(close).length - output.split(open).length;
    while (excess > 0 && output[end - 1] === close) {
      end -= 1;
      excess -= 1;
    }
  };

  trimUnbalanced("(", ")");
  trimUnbalanced("[", "]");
  trimUnbalanced("{", "}");
  return output.slice(0, end);
}

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

function collectMatches(
  line: string,
  kind: TerminalLinkKind,
  pattern: RegExp,
  existing: TerminalLinkMatch[],
): TerminalLinkMatch[] {
  const matches: TerminalLinkMatch[] = [];
  pattern.lastIndex = 0;

  for (const rawMatch of line.matchAll(pattern)) {
    const raw = rawMatch[0];
    const start = rawMatch.index ?? -1;
    if (start < 0 || raw.length === 0) continue;

    const trimmed = trimClosingDelimiters(raw, kind);
    if (trimmed.length === 0) continue;
    if (kind === "path" && isTerminalUrl(trimmed)) continue;

    const candidate: TerminalLinkMatch = {
      kind,
      text:
        kind === "path" && TYPESCRIPT_DIAGNOSTIC_AFTER_PATH.test(line.slice(start + trimmed.length))
          ? trimmed.replace(/\((\d+),(\d+)\)$/, ":$1:$2")
          : trimmed,
      start,
      end: start + trimmed.length,
    };

    const collides = [...existing, ...matches].some((other) => overlaps(candidate, other));
    if (collides) continue;

    matches.push(candidate);
  }

  return matches;
}

function isWindowsAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || isWindowsAbsolutePath(value);
}

function isWindowsPathStyle(value: string): boolean {
  return isWindowsAbsolutePath(value) || /[A-Za-z]:\\/.test(value);
}

function joinPath(base: string, next: string, separator: "/" | "\\"): string {
  const cleanBase = base.replace(/[\\/]+$/, "");
  if (separator === "\\") {
    return `${cleanBase}\\${next.replaceAll("/", "\\")}`;
  }
  return `${cleanBase}/${next.replace(/^\/+/, "")}`;
}

function inferHomeFromCwd(cwd: string): string | undefined {
  const posixUser = cwd.match(/^\/Users\/([^/]+)/);
  if (posixUser?.[1]) {
    return `/Users/${posixUser[1]}`;
  }

  const posixHome = cwd.match(/^\/home\/([^/]+)/);
  if (posixHome?.[1]) {
    return `/home/${posixHome[1]}`;
  }

  const windowsUser = cwd.match(/^([A-Za-z]:\\Users\\[^\\]+)/);
  if (windowsUser?.[1]) {
    return windowsUser[1];
  }

  return undefined;
}

export function splitPathAndPosition(value: string): {
  path: string;
  line: string | undefined;
  column: string | undefined;
} {
  let path = value;
  let column: string | undefined;
  let line: string | undefined;

  const columnMatch = path.match(/:(\d+)$/);
  if (!columnMatch?.[1]) {
    return { path, line: undefined, column: undefined };
  }

  column = columnMatch[1];
  path = path.slice(0, -columnMatch[0].length);

  const lineMatch = path.match(/:(\d+)$/);
  if (lineMatch?.[1]) {
    line = lineMatch[1];
    path = path.slice(0, -lineMatch[0].length);
  } else {
    line = column;
    column = undefined;
  }

  return { path, line, column };
}

export function extractTerminalLinks(line: string): TerminalLinkMatch[] {
  const urlMatches = collectMatches(line, "url", URL_PATTERN, []);
  const remoteTails = Array.from(line.matchAll(SCP_REMOTE_PATTERN), (match) => ({
    start: match.index + match[0].indexOf(":") + 1,
    end: match.index + match[0].length,
  }));
  const pathMatches = collectMatches(line, "path", FILE_PATH_PATTERN, urlMatches).filter(
    (match) => !remoteTails.some((tail) => match.start >= tail.start && match.end <= tail.end),
  );
  return [...urlMatches, ...pathMatches].toSorted((a, b) => a.start - b.start);
}

export function isTerminalUrl(value: string): boolean {
  return /^https?:\/\//iu.test(value);
}

/**
 * Explicit OSC 8 targets may be `file://` URIs; everything else is a path relative to `cwd`.
 * Null for a file on another machine: after `ssh appdev` in a Mate's terminal, `ls --hyperlink`
 * names appdev's own paths, which the Mate would open from its own disk.
 */
export function resolveTerminalLinkTarget(
  text: string,
  cwd: string,
  serverHostname: string | undefined,
): string | null {
  const fileUrl = parseTerminalFileUrl(text);
  if (fileUrl === null) return resolvePathLinkTarget(text, cwd);
  const windows = isWindowsPathStyle(cwd);
  const local = fileUrl.host === "" || isServerHost(fileUrl.host, serverHostname);
  // Only Windows reaches another machine's files by name, as a UNC path.
  if (!local && !windows) return null;
  const path = windows
    ? local
      ? fileUrl.path.replace(/^\/(?=[A-Za-z]:)/, "") // The URL parser writes `C:/x` as `/C:/x`.
      : `\\\\${fileUrl.host}${fileUrl.path.replaceAll("/", "\\")}`
    : fileUrl.path;
  const position = fileUrl.hash.match(/^#L(\d+)(?:C(\d+))?$/iu);
  if (!position?.[1]) return path;
  return `${path}:${position[1]}${position[2] ? `:${position[2]}` : ""}`;
}

/** The host producers such as GNU `ls` put in the URI: the server's own name, short or full. */
function isServerHost(host: string, serverHostname: string | undefined): boolean {
  if (!serverHostname) return false;
  const name = host.toLowerCase();
  const server = serverHostname.toLowerCase();
  return name === server || name === server.split(".")[0] || name.split(".")[0] === server;
}

function parseTerminalFileUrl(text: string): { host: string; path: string; hash: string } | null {
  if (!/^file:\/\//iu.test(text)) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const path = safeDecodeURIComponent(url.pathname);
  if (path.length === 0) return null;
  const host = url.hostname.toLowerCase() === "localhost" ? "" : url.hostname;
  return { host, path, hash: url.hash };
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function collectWrappedTerminalLinkLine(
  bufferLineNumber: number,
  getLine: (bufferLineIndex: number) => TerminalBufferLineLike | null | undefined,
): WrappedTerminalLinkLine | null {
  const anchorLine = getLine(bufferLineNumber - 1);
  if (!anchorLine) return null;

  let startBufferLineNumber = bufferLineNumber;
  let startLine = anchorLine;

  while (startBufferLineNumber > 1 && startLine.isWrapped) {
    const previousLine = getLine(startBufferLineNumber - 2);
    if (!previousLine) return null;
    startBufferLineNumber -= 1;
    startLine = previousLine;
  }

  const segments: WrappedTerminalLinkLineSegment[] = [];
  let nextStartIndex = 0;
  let currentBufferLineNumber = startBufferLineNumber;

  while (true) {
    const currentLine = getLine(currentBufferLineNumber - 1);
    if (!currentLine) break;

    const nextLine = getLine(currentBufferLineNumber);
    const hasWrappedContinuation = nextLine?.isWrapped === true;
    const text = currentLine.translateToString(!hasWrappedContinuation);

    segments.push({
      bufferLineNumber: currentBufferLineNumber,
      text,
      startIndex: nextStartIndex,
      endIndex: nextStartIndex + text.length,
    });
    nextStartIndex += text.length;

    if (!hasWrappedContinuation) break;
    currentBufferLineNumber += 1;
  }

  return {
    text: segments.map((segment) => segment.text).join(""),
    segments,
  };
}

export function isTerminalLinkActivation(
  event: Pick<MouseEvent, "metaKey" | "ctrlKey">,
  platform = typeof navigator === "undefined" ? "" : navigator.platform,
): boolean {
  if (platform.length === 0) return false;
  return isMacPlatform(platform)
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
}

export function resolvePathLinkTarget(rawPath: string, cwd: string): string {
  const { path, line, column } = splitPathAndPosition(rawPath);

  let resolvedPath = path;
  if (path.startsWith("~/")) {
    const home = inferHomeFromCwd(cwd);
    if (home) {
      const separator: "/" | "\\" = isWindowsPathStyle(home) ? "\\" : "/";
      resolvedPath = joinPath(home, path.slice(2), separator);
    }
  } else if (!isAbsolutePath(path)) {
    const separator: "/" | "\\" = isWindowsPathStyle(cwd) ? "\\" : "/";
    resolvedPath = joinPath(cwd, path, separator);
  }

  if (!line) return resolvedPath;
  return `${resolvedPath}:${line}${column ? `:${column}` : ""}`;
}
