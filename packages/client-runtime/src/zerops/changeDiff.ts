/**
 * A change you can read: a pull request's unified diff, file by file.
 *
 * Nowhere in the app could a pull request's diff be read before merging it
 * (pass 16's audit): a person merged on a title and a check's colour. The
 * review lists the files with their +/− and opens a file's diff in place, so
 * it needs the diff Gitea hands over (`/pulls/{index}.diff`) as lines a row
 * can draw — each with its number on the side it belongs to, the hunk's
 * header kept as git wrote it.
 *
 * Keyed by the path a file has after the change — a deleted file's last path —
 * which is the name Gitea's file listing (`/pulls/{index}/files`) uses, so a
 * row finds its diff by the name it already shows.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module changeDiff
 */

export interface ChangeDiffLine {
  readonly kind: "context" | "add" | "del";
  /** Its number before the change; `null` for an added line. */
  readonly oldLine: number | null;
  /** Its number after the change; `null` for a removed line. */
  readonly newLine: number | null;
  /** The line itself, without the sign git put in front of it. */
  readonly text: string;
}

export interface ChangeDiffHunk {
  /** `@@ -10,7 +10,8 @@ import { web } …` — git's own line, what a reader places a hunk by. */
  readonly header: string;
  readonly lines: ReadonlyArray<ChangeDiffLine>;
}

export interface ChangeDiffFile {
  readonly path: string;
  /** The path it had before a rename or a copy. */
  readonly previousPath: string | undefined;
  /** Git said only that it differs: there are no lines to show. */
  readonly binary: boolean;
  readonly hunks: ReadonlyArray<ChangeDiffHunk>;
}

const FILE_HEADER = /^diff --git (.+)$/u;
const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u;

/** A path as git wrote it: quoted and octal-escaped when it holds anything unusual. */
function unquote(raw: string): string {
  if (!raw.startsWith('"') || !raw.endsWith('"')) return raw;
  const bytes: Array<number> = [];
  const body = raw.slice(1, -1);
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index] ?? "";
    if (character !== "\\") {
      for (const byte of new TextEncoder().encode(character)) bytes.push(byte);
      continue;
    }
    const next = body[index + 1] ?? "";
    const octal = /^[0-7]{3}/u.exec(body.slice(index + 1));
    if (octal !== null) {
      bytes.push(Number.parseInt(octal[0], 8));
      index += 3;
      continue;
    }
    const escaped: Record<string, string> = { n: "\n", t: "\t", '"': '"', "\\": "\\" };
    for (const byte of new TextEncoder().encode(escaped[next] ?? next)) bytes.push(byte);
    index += 1;
  }
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

/** `a/src/x.ts` → `src/x.ts`; `/dev/null` stays what it is. */
function stripSide(path: string): string {
  const plain = unquote(path.trim());
  return plain.startsWith("a/") || plain.startsWith("b/") ? plain.slice(2) : plain;
}

/**
 * The two paths of a `diff --git` line. Unquoted paths may hold spaces, so the
 * line is split where its second half repeats the first — a file that was not
 * renamed — and at ` b/` otherwise.
 */
function headerPaths(rest: string): { readonly from: string; readonly to: string } {
  if (rest.startsWith('"')) {
    const end = rest.indexOf('" ', 1);
    if (end !== -1)
      return { from: stripSide(rest.slice(0, end + 1)), to: stripSide(rest.slice(end + 2)) };
  }
  const half = (rest.length - 1) / 2;
  if (Number.isInteger(half) && rest.slice(2, half) === rest.slice(half + 3)) {
    return { from: stripSide(rest.slice(0, half)), to: stripSide(rest.slice(half + 1)) };
  }
  const split = rest.indexOf(" b/");
  return split === -1
    ? { from: stripSide(rest), to: stripSide(rest) }
    : { from: stripSide(rest.slice(0, split)), to: stripSide(rest.slice(split + 1)) };
}

interface OpenFile {
  from: string;
  to: string;
  renamedFrom: string | undefined;
  binary: boolean;
  deleted: boolean;
  hunks: Array<{ header: string; lines: Array<ChangeDiffLine> }>;
}

/** Every file the diff changes, by the path it has after the change, in git's order. */
export function parseChangeDiff(text: string): ReadonlyMap<string, ChangeDiffFile> {
  const files = new Map<string, ChangeDiffFile>();
  let file: OpenFile | undefined;
  let oldLine = 0;
  let newLine = 0;

  const close = () => {
    if (file === undefined) return;
    const path = file.deleted ? file.from : file.to;
    const previous =
      file.renamedFrom ?? (file.from !== file.to && !file.deleted ? file.from : undefined);
    files.set(path, {
      path,
      previousPath: previous === "/dev/null" ? undefined : previous,
      binary: file.binary,
      hunks: file.hunks,
    });
    file = undefined;
  };

  for (const line of text.split("\n")) {
    const header = FILE_HEADER.exec(line);
    if (header !== null) {
      close();
      const { from, to } = headerPaths(header[1] ?? "");
      file = { from, to, renamedFrom: undefined, binary: false, deleted: false, hunks: [] };
      continue;
    }
    if (file === undefined) continue;
    const hunk = file.hunks.at(-1);
    const open = hunk !== undefined;
    if (!open || line.startsWith("@@")) {
      const range = HUNK_HEADER.exec(line);
      if (range !== null) {
        oldLine = Number(range[1]);
        newLine = Number(range[2]);
        file.hunks.push({ header: line, lines: [] });
        continue;
      }
      if (line.startsWith("deleted file mode")) file.deleted = true;
      else if (line.startsWith("rename from ")) file.renamedFrom = unquote(line.slice(12));
      else if (line.startsWith("rename to ")) file.to = unquote(line.slice(10));
      else if (line.startsWith("Binary files ") || line === "GIT binary patch") file.binary = true;
      else if (line.startsWith("--- ")) {
        const from = stripSide(line.slice(4));
        if (from !== "/dev/null") file.from = from;
      } else if (line.startsWith("+++ ")) {
        const to = stripSide(line.slice(4));
        if (to === "/dev/null") file.deleted = true;
        else file.to = to;
      }
      continue;
    }
    const sign = line[0];
    const body = line.slice(1);
    if (sign === "+") {
      hunk.lines.push({ kind: "add", oldLine: null, newLine, text: body });
      newLine += 1;
    } else if (sign === "-") {
      hunk.lines.push({ kind: "del", oldLine, newLine: null, text: body });
      oldLine += 1;
    } else if (sign === " ") {
      hunk.lines.push({ kind: "context", oldLine, newLine, text: body });
      oldLine += 1;
      newLine += 1;
    }
    // `\ No newline at end of file`, and the empty line a diff ends on, are no lines of code.
  }
  close();
  return files;
}

/** A path as a row draws it: the folder dimmed, the file's own name in full. */
export function changeFileParts(path: string): { readonly dir: string; readonly name: string } {
  const slash = path.lastIndexOf("/");
  return slash === -1
    ? { dir: "", name: path }
    : { dir: path.slice(0, slash + 1), name: path.slice(slash + 1) };
}
