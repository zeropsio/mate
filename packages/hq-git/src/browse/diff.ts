/**
 * What changed between two commits, as a browse page reads it: every file with its counts, and
 * each file's hunks while the page's budget lasts. One `git diff` is read as it streams, so a huge
 * file (a lockfile) costs its first 256 KiB, never the files after it.
 *
 * - At most 300 files; the rest are counted.
 * - A file's patch over 256 KiB is too long to read here.
 * - Hunks come with the answer until 1 MiB of them has; later files come without, each read on
 *   request (`readFileDiff`).
 * - The read stops after 8 MiB of patches, each counted up to its own cap; files past it are too
 *   long to read here.
 * - Renames read as a delete and an add (`--no-renames`), as the change review reads them.
 * - A file whose type changes (file, symlink, submodule) is one listed file; git writes its patch
 *   as a deletion and a creation, and both are that file's hunks.
 *
 * @module browse/diff
 */
import { terminate, type GitRunner } from "../git.ts";

export const DIFF_BUDGET = {
  files: 300,
  filePatchBytes: 256 * 1024,
  autoLoadBytes: 1024 * 1024,
  readBytes: 8 * 1024 * 1024,
} as const;
type DiffBudget = { readonly [K in keyof typeof DIFF_BUDGET]: number };

export type DiffFileStatus = "added" | "modified" | "deleted";

export interface DiffFile {
  readonly path: string;
  readonly status: DiffFileStatus;
  readonly additions: number;
  readonly deletions: number;
  readonly binary: boolean;
  /** The file's patch as git wrote it; none for a binary file, or one not read with the page. */
  readonly hunks: string | null;
  /** Its hunks were left for later: its own read answers them. */
  readonly loadable: boolean;
}

export interface Diff {
  readonly files: ReadonlyArray<DiffFile>;
  /** Every file the diff changes, beyond the ones listed. */
  readonly totalFiles: number;
  readonly filesTruncated: boolean;
}

/** A file's patch as the read met it: its whole size, and its text where the page shows it now. */
interface Section {
  readonly size: number;
  readonly text: string | null;
}

const HEADER = Buffer.from("\ndiff --git ");

/**
 * Splits a streamed patch into its files, wherever its chunks end. A line inside a hunk starts
 * with its sign, so only a file's header starts with `diff --git `.
 */
export class PatchSections {
  readonly sections: Array<Section> = [];
  // A header at the very start follows no newline: this one stands in for it and is dropped.
  private carry: Buffer = Buffer.from("\n");
  private open: { chunks: Array<Buffer>; kept: number; size: number; headers: number } | null =
    null;
  private read = 0;
  private autoLoaded = 0;
  private autoLoading = true;
  private readonly budget: DiffBudget;
  private readonly retyped: ReadonlySet<number>;

  /** `retyped`: the listed files, by index, whose type changes and so own two headers. */
  constructor(budget: DiffBudget = DIFF_BUDGET, retyped: ReadonlySet<number> = new Set()) {
    this.budget = budget;
    this.retyped = retyped;
  }

  /** Takes the next bytes; false once every listed file is read or the read budget is spent. */
  feed(chunk: Uint8Array): boolean {
    const data = Buffer.concat([this.carry, chunk]);
    let from = 0;
    for (let at = data.indexOf(HEADER); at !== -1; at = data.indexOf(HEADER, at + 1)) {
      if (this.open !== null && this.open.headers > 0) {
        this.open.headers--;
        continue;
      }
      this.append(data.subarray(from, at + 1));
      this.close();
      if (this.full()) return false;
      const headers = this.retyped.has(this.sections.length) ? 1 : 0;
      this.open = { chunks: [], kept: 0, size: 0, headers };
      from = at + 1;
    }
    // The last bytes may begin a header the next chunk ends: they wait for it.
    const hold = Math.max(from, data.length - (HEADER.length - 1));
    this.append(data.subarray(from, hold));
    this.carry = Buffer.from(data.subarray(hold));
    return !this.full();
  }

  /** The stream ended whole: its last file is complete. */
  end(): void {
    this.append(this.carry);
    this.carry = Buffer.alloc(0);
    this.close();
  }

  private full() {
    return this.sections.length >= this.budget.files || this.read >= this.budget.readBytes;
  }

  private append(bytes: Buffer) {
    if (this.open === null || bytes.length === 0) return;
    this.open.size += bytes.length;
    const room = this.budget.filePatchBytes + 1 - this.open.kept;
    if (room <= 0) return;
    const kept = bytes.subarray(0, room);
    this.open.chunks.push(Buffer.from(kept));
    this.open.kept += kept.length;
    this.read += kept.length;
  }

  private close() {
    if (this.open === null) return;
    const { chunks, size } = this.open;
    this.open = null;
    let text: string | null = null;
    // A file too long to read here never stops the ones after it from coming with the page.
    if (size <= this.budget.filePatchBytes && this.autoLoading) {
      if (this.autoLoaded + size <= this.budget.autoLoadBytes) {
        text = Buffer.concat(chunks).toString();
        this.autoLoaded += size;
      } else this.autoLoading = false;
    }
    this.sections.push({ size, text });
  }
}

const STATUS: Record<string, DiffFileStatus> = { A: "added", D: "deleted" };

/** `--raw --numstat -z`: every file's status first, then its counts, both in the patch's order. */
const changedFiles = (bytes: Buffer, truncated: boolean) => {
  const fields = bytes.toString().split("\0");
  // A cut read never names a cut record as complete.
  if (truncated) fields.pop();
  const raw: Array<{
    readonly path: string;
    readonly status: DiffFileStatus;
    readonly retyped: boolean;
  }> = [];
  const counts: Array<{ readonly additions: number | null; readonly deletions: number | null }> =
    [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]!;
    if (field.startsWith(":")) {
      const path = fields[i + 1];
      if (path === undefined) break;
      const letter = field.slice(-1);
      raw.push({ path, status: STATUS[letter] ?? "modified", retyped: letter === "T" });
      i++;
    } else if (field !== "") {
      const [added = "", deleted = ""] = field.split("\t");
      counts.push({
        additions: added === "-" ? null : Number(added),
        deletions: deleted === "-" ? null : Number(deleted),
      });
    }
  }
  return raw.flatMap((file, i) => {
    const count = counts[i];
    return count === undefined ? [] : [{ ...file, ...count }];
  });
};

const PATCH = ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--unified=3"];

/** What changed from `base` to `head`, under the page's budget. */
export const readDiff = async (
  git: GitRunner,
  dir: string,
  base: string,
  head: string,
  signal: AbortSignal,
  budget: DiffBudget = DIFF_BUDGET,
): Promise<Diff> => {
  const listed = await git.prefix(
    ["-C", dir, "diff", "--no-renames", "--raw", "--numstat", "-z", base, head, "--"],
    signal,
    1024 * 1024,
  );
  const all = changedFiles(listed.bytes, listed.truncated);
  const shown = all.slice(0, budget.files);
  const retyped = new Set(shown.flatMap((file, i) => (file.retyped ? [i] : [])));
  const sections = new PatchSections(budget, retyped);
  if (shown.length > 0) {
    const process = git.start(["-C", dir, ...PATCH, base, head, "--"], { signal });
    process.child.stdin.end();
    try {
      let whole = true;
      for await (const chunk of process.child.stdout) {
        if (!sections.feed(chunk as Uint8Array)) {
          whole = false;
          break;
        }
      }
      if (whole) {
        await process.done;
        sections.end();
      }
    } finally {
      terminate(process.child);
      await process.done.catch(() => {});
    }
  }
  return {
    files: shown.map(({ path, status, additions, deletions }, i): DiffFile => {
      const binary = additions === null || deletions === null;
      const section = sections.sections[i];
      const readable = !binary && section !== undefined && section.size <= budget.filePatchBytes;
      return {
        path,
        status,
        additions: additions ?? 0,
        deletions: deletions ?? 0,
        binary,
        hunks: readable ? section.text : null,
        loadable: readable && section.text === null,
      };
    }),
    totalFiles: all.length,
    filesTruncated: listed.truncated || all.length > shown.length,
  };
};

/** One file's patch from `base` to `head`; none when it is too long to read here. */
export const readFileDiff = async (
  git: GitRunner,
  dir: string,
  base: string,
  head: string,
  path: string,
  signal: AbortSignal,
  budget: DiffBudget = DIFF_BUDGET,
): Promise<string | null> => {
  const patch = await git.prefix(
    ["-C", dir, ...PATCH, base, head, "--", path],
    signal,
    budget.filePatchBytes,
  );
  return patch.truncated ? null : patch.bytes.toString();
};
