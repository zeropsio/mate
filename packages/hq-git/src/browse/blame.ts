/**
 * Which commit last changed each line of a file at a commit (`git blame --porcelain`), as runs of
 * lines and the commits they name, each with the file as its parent had it — where blame goes on
 * before the commit. A file past what the caller reads is not blamed, only its size said.
 *
 * @module browse/blame
 */
import * as DateTime from "effect/DateTime";
import type { GitRunner } from "../git.ts";
import { lookupPath } from "./object.ts";

export interface BlameRange {
  readonly start: number;
  readonly count: number;
  readonly commit: string;
}

export interface BlameCommit {
  readonly sha: string;
  readonly subject: string;
  readonly authorName: string;
  readonly authoredAt: string;
  readonly previous?: { readonly sha: string; readonly path: string };
}

export type BlameRead =
  | {
      readonly kind: "blame";
      readonly ranges: ReadonlyArray<BlameRange>;
      readonly commits: ReadonlyArray<BlameCommit>;
    }
  /** Larger than the caller reads: not blamed. */
  | { readonly kind: "too-large"; readonly size: number }
  | { readonly kind: "commit-missing" }
  | { readonly kind: "path-missing" }
  | { readonly kind: "folder" };

const ESCAPES: Readonly<Record<string, number>> = {
  a: 7,
  b: 8,
  t: 9,
  n: 10,
  v: 11,
  f: 12,
  r: 13,
  '"': 34,
  "\\": 92,
};

/** A path as git writes it: in C quotes, with escapes and octal bytes, where it has to be. */
export const unquotePath = (written: string) => {
  if (!written.startsWith('"') || !written.endsWith('"')) return written;
  const bytes: number[] = [];
  const inner = written.slice(1, -1);
  for (let i = 0; i < inner.length; i++) {
    const char = inner[i]!;
    if (char !== "\\") {
      bytes.push(...new TextEncoder().encode(char));
      continue;
    }
    const octal = /^[0-7]{3}/u.exec(inner.slice(i + 1));
    if (octal !== null) {
      bytes.push(Number.parseInt(octal[0], 8));
      i += 3;
    } else {
      bytes.push(ESCAPES[inner[i + 1] ?? ""] ?? 92);
      i += 1;
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
};

const LINE_HEADER = /^([0-9a-f]{40}(?:[0-9a-f]{24})?) \d+ (\d+)(?: (\d+))?$/u;

/**
 * Porcelain blame: per line a header `<commit> <from> <to>`, its group's line count on the first
 * line of a group, the commit's fields the first time the commit appears, then the line itself
 * after a tab. Neighbouring groups of one commit read as one run.
 */
export const parseBlame = (porcelain: string) => {
  const ranges: BlameRange[] = [];
  const commits = new Map<string, { -readonly [K in keyof BlameCommit]: BlameCommit[K] }>();
  const lines = porcelain.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const header = LINE_HEADER.exec(lines[i]!);
    if (header === null) continue;
    const [, sha = "", to = "0", count] = header;
    let commit = commits.get(sha);
    if (commit === undefined) {
      commit = { sha, subject: "", authorName: "", authoredAt: "" };
      commits.set(sha, commit);
    }
    // The commit's fields, up to the line itself.
    for (i++; i < lines.length && !lines[i]!.startsWith("\t"); i++) {
      const field = lines[i]!;
      const space = field.indexOf(" ");
      const key = space < 0 ? field : field.slice(0, space);
      const rest = space < 0 ? "" : field.slice(space + 1);
      if (key === "summary") commit.subject = rest;
      else if (key === "author") commit.authorName = rest;
      else if (key === "author-time")
        commit.authoredAt = DateTime.formatIso(DateTime.makeUnsafe(Number(rest) * 1000));
      else if (key === "previous") {
        const gap = rest.indexOf(" ");
        commit.previous = { sha: rest.slice(0, gap), path: unquotePath(rest.slice(gap + 1)) };
      }
    }
    if (count === undefined) continue;
    const start = Number(to);
    const last = ranges.at(-1);
    if (last !== undefined && last.commit === sha && last.start + last.count === start)
      ranges[ranges.length - 1] = { ...last, count: last.count + Number(count) };
    else ranges.push({ start, count: Number(count), commit: sha });
  }
  return { ranges, commits: [...commits.values()] };
};

export const readBlame = async (
  git: GitRunner,
  dir: string,
  sha: string,
  path: string,
  maxBytes: number,
  signal: AbortSignal,
): Promise<BlameRead> => {
  const found = await lookupPath(git, dir, sha, path, signal);
  if (found.kind !== "found") return found;
  const { object } = found;
  if (object.type === "tree") return { kind: "folder" };
  if (object.type !== "blob" || object.size === null) return { kind: "path-missing" };
  if (object.size > maxBytes) return { kind: "too-large", size: object.size };
  // `sha` is hex (`lookupPath` checked it), never an option; blame reads `--end-of-options` as a path.
  const porcelain = await git.run(["-C", dir, "blame", "--porcelain", sha, "--", path], { signal });
  return { kind: "blame", ...parseBlame(porcelain.toString()) };
};
