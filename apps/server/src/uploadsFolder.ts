// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

/**
 * The Mate's uploads folder: every file a person sends, kept under its own
 * name where they and the agent find it. The folder holds the agent's own copy
 * (copy-on-write where the filesystem offers it), never a link to the stored
 * attachment: the agent may edit, move or remove its file and the person's
 * attachment, and its download in the conversation, stay as sent.
 *
 * All of it is asynchronous and bounded: at most two copies run at once on
 * the whole server (a copy holds one of Node's few I/O threads, which every
 * other file and DNS call shares), a send waits for all of its copies until
 * one deadline, and a file not kept by then is pointed at where it is stored,
 * with the reason in the agent's line. A copy still waiting for its turn at
 * the deadline is never made.
 */

const NAME_MAX_BYTES = 255;
const EXTENSION_MAX_BYTES = 32;
const KEEP_TIMEOUT_MS = 20_000;
const COPIES_AT_ONCE = 2;
const PARTIAL_MAX_AGE_MS = 60 * 60 * 1000;
const PARTIAL_PREFIX = ".partial-";

// C0 and C1 controls, line and paragraph separators, the marks, embeddings,
// overrides and isolates that reorder text (a right-to-left override turns
// "txt.exe" into "exe.txt"), tag characters that hide words, and the brackets
// that end or fake the agent's line.
const UNSAFE_CHARACTERS =
  // oxlint-disable-next-line no-control-regex -- control characters are what it removes.
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\u{E0000}-\u{E007F}[\]]/gu;

const byteLength = (text: string) => Buffer.byteLength(text, "utf8");

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function cutToBytes(text: string, budget: number): string {
  let cut = "";
  let used = 0;
  for (const { segment } of graphemes.segment(text)) {
    const size = byteLength(segment);
    if (used + size > budget) break;
    cut += segment;
    used += size;
  }
  return cut;
}

/**
 * A sent file's name as a plain file in the folder (`n` > 1 numbers another
 * file of that name): no folders, no controls, at most 255 bytes cut between
 * characters, its extension kept.
 */
export function uploadsFileName(name: string, n = 1): string {
  const suffix = n === 1 ? "" : `-${n}`;
  const base = (name.split(/[\\/]/u).pop() ?? "").replace(UNSAFE_CHARACTERS, "").trim();
  if (/^\.*$/u.test(base)) return `file${suffix}`;
  const rawExtension = NodePath.extname(base);
  const extension = byteLength(rawExtension) > EXTENSION_MAX_BYTES ? "" : rawExtension;
  const stem = base.slice(0, base.length - extension.length);
  return `${cutToBytes(stem, NAME_MAX_BYTES - byteLength(suffix + extension))}${suffix}${extension}`;
}

interface SentAttachment {
  readonly type: string;
  readonly name: string;
  readonly source?: { readonly _tag: string } | undefined;
}

/** Where the agent is told an attachment is, and why it is not in the folder when it should be. */
export interface AgentPlace {
  readonly path: string;
  readonly note?: string;
}

const isSentFile = (attachment: SentAttachment) =>
  attachment.type === "file" && attachment.source?._tag !== "pasted-text";

const errorCode = (cause: unknown) => (cause as NodeJS.ErrnoException | undefined)?.code;

function reasonOf(cause: unknown): string {
  if (cause instanceof PastDeadline) return "it waited too long for its turn to be copied";
  switch (errorCode(cause)) {
    case "ENAMETOOLONG":
      return "its name is too long for the folder";
    case "EILSEQ":
      return "its name cannot be written there";
    case "EACCES":
    case "EPERM":
    case "EROFS":
      return "the folder cannot be written";
    case "ENOSPC":
    case "EDQUOT":
      return "the disk is full";
    case "ENOTDIR":
    case "EEXIST":
      return "something else stands where the folder should be";
    default:
      return cause instanceof Error ? cause.message : String(cause);
  }
}

const notKept = (reason: string) => `not copied to the uploads folder: ${reason}`;

const tookTooLong = (timeoutMs: number) => `it took longer than ${Math.round(timeoutMs / 1000)} s`;

/**
 * The record of where a stored attachment was kept, so the same file finds its
 * place again: its name, and the copy's inode, size and modification time, so
 * a copy the agent changed or replaced is never taken for it.
 */
interface KeptRecord {
  readonly name: string;
  readonly ino: number;
  readonly size: number;
  readonly mtimeMs: number;
}

const recordPath = (indexDir: string, storedPath: string) =>
  NodePath.join(
    indexDir,
    NodeCrypto.createHash("sha256").update(storedPath).digest("hex").slice(0, 40),
  );

async function readRecord(indexDir: string, storedPath: string): Promise<KeptRecord | null> {
  try {
    const record = JSON.parse(
      await NodeFSP.readFile(recordPath(indexDir, storedPath), "utf8"),
    ) as Partial<KeptRecord> | null;
    const { ino, mtimeMs, name, size } = record ?? {};
    if (typeof name !== "string" || name.length === 0 || /[\\/]/u.test(name)) return null;
    if (typeof ino !== "number" || typeof size !== "number" || typeof mtimeMs !== "number") {
      return null;
    }
    return { name, ino, size, mtimeMs };
  } catch {
    return null;
  }
}

/** The recorded copy, when it still stands as it was made. */
async function recordedCopy(uploadsDir: string, record: KeptRecord): Promise<string | null> {
  const path = NodePath.join(uploadsDir, record.name);
  try {
    const stat = await NodeFSP.lstat(path);
    return stat.isFile() &&
      stat.ino === record.ino &&
      stat.size === record.size &&
      stat.mtimeMs === record.mtimeMs
      ? path
      : null;
  } catch {
    return null;
  }
}

/** Best effort: without its record the copy still stands, the next send just copies again. */
async function writeRecord(indexDir: string, storedPath: string, uploadsDir: string, name: string) {
  try {
    const stat = await NodeFSP.lstat(NodePath.join(uploadsDir, name));
    const record: KeptRecord = { name, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs };
    await NodeFSP.mkdir(indexDir, { recursive: true });
    await NodeFSP.writeFile(recordPath(indexDir, storedPath), JSON.stringify(record));
  } catch {
    // The file is kept; only its place is not remembered.
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await NodeFSP.lstat(path);
    return true;
  } catch {
    return false;
  }
}

const NUMBERED_NAMES_MAX = 10_000;

function* candidateNames(name: string, recorded: string | null): Generator<string> {
  if (recorded !== null) yield recorded;
  for (let n = 1; n <= NUMBERED_NAMES_MAX; n += 1) yield uploadsFileName(name, n);
}

class PastDeadline extends Error {}

/** A send's deadline: passed once the send stopped waiting for its copies. */
interface Deadline {
  passed: boolean;
}

// The copies running on the whole server, and the ones waiting their turn.
let copying = 0;
const waitingToCopy: Array<() => void> = [];
const slotsFull = () => copying >= COPIES_AT_ONCE;

/** Runs `copy` in one of the server's copy slots, unless `deadline` passed while it waited. */
async function inCopySlot<A>(deadline: Deadline, copy: () => Promise<A>): Promise<A> {
  while (slotsFull()) {
    await new Promise<void>((resolve) => waitingToCopy.push(resolve));
  }
  if (deadline.passed) {
    waitingToCopy.shift()?.();
    throw new PastDeadline();
  }
  copying += 1;
  try {
    return await copy();
  } finally {
    copying -= 1;
    waitingToCopy.shift()?.();
  }
}

/**
 * The copy is made under a hidden name and then linked into place (an atomic
 * "create unless taken"), so the agent never meets half a file and two sends
 * never take one name.
 */
async function keepOne(input: {
  readonly uploadsDir: string;
  readonly indexDir: string;
  readonly attachment: SentAttachment;
  readonly storedPath: string;
  readonly deadline: Deadline;
}): Promise<AgentPlace> {
  const { attachment, deadline, indexDir, storedPath, uploadsDir } = input;
  const record = await readRecord(indexDir, storedPath);
  const kept = record === null ? null : await recordedCopy(uploadsDir, record);
  if (kept !== null) return { path: kept };
  await NodeFSP.mkdir(uploadsDir, { recursive: true });
  const partial = NodePath.join(uploadsDir, `${PARTIAL_PREFIX}${NodeCrypto.randomUUID()}`);
  try {
    await inCopySlot(deadline, () =>
      NodeFSP.copyFile(
        storedPath,
        partial,
        NodeFSP.constants.COPYFILE_EXCL | NodeFSP.constants.COPYFILE_FICLONE,
      ),
    );
    for (const name of candidateNames(attachment.name, record?.name ?? null)) {
      const candidate = NodePath.join(uploadsDir, name);
      try {
        await NodeFSP.link(partial, candidate);
      } catch (cause) {
        if (errorCode(cause) === "EEXIST") continue;
        throw cause;
      }
      await writeRecord(indexDir, storedPath, uploadsDir, name);
      return { path: candidate };
    }
    throw new Error("every name it could take is taken");
  } finally {
    await NodeFSP.rm(partial, { force: true });
  }
}

// One attachment is kept by one send at a time, so a file sent twice at once
// lands once.
const keeping = new Map<string, Promise<AgentPlace>>();

function keepSerially(input: Parameters<typeof keepOne>[0]): Promise<AgentPlace> {
  const previous = keeping.get(input.storedPath) ?? Promise.resolve<AgentPlace | null>(null);
  const next = previous.then(
    () => keepOne(input),
    () => keepOne(input),
  );
  keeping.set(input.storedPath, next);
  const forget = () => {
    if (keeping.get(input.storedPath) === next) keeping.delete(input.storedPath);
  };
  next.then(forget, forget);
  return next;
}

async function placeOf(input: Parameters<typeof keepOne>[0]): Promise<AgentPlace> {
  const { attachment, storedPath } = input;
  if (!isSentFile(attachment)) return { path: storedPath };
  // Nothing stored, nothing to keep: the adapter reports the missing file.
  if (!(await exists(storedPath))) return { path: storedPath };
  try {
    return await keepSerially(input);
  } catch (cause) {
    return { path: storedPath, note: notKept(reasonOf(cause)) };
  }
}

/**
 * Where the agent is told each attachment of a send is: a sent file in the
 * uploads folder (spec.pdf, then spec-2.pdf for another file of that name, the
 * same place again for the same file while its copy stands as it was made),
 * anything else where it is stored.
 */
export function keepSentFiles(input: {
  readonly uploadsDir: string;
  readonly indexDir: string;
  readonly items: ReadonlyArray<{
    readonly attachment: SentAttachment;
    readonly storedPath: string;
  }>;
  readonly timeoutMs?: number;
}): Effect.Effect<ReadonlyArray<AgentPlace>> {
  const timeoutMs = input.timeoutMs ?? KEEP_TIMEOUT_MS;
  return Effect.suspend(() => {
    // One deadline for all of a send's copies, those waiting their turn too:
    // every copy is waited for from one moment for one bound, and the send
    // stops waiting, passing the deadline, once each is kept or out of time.
    const deadline: Deadline = { passed: false };
    return Effect.forEach(
      input.items,
      (item) =>
        Effect.promise(() =>
          placeOf({ ...item, uploadsDir: input.uploadsDir, indexDir: input.indexDir, deadline }),
        ).pipe(
          Effect.timeoutOption(Duration.millis(timeoutMs)),
          Effect.map((placed) =>
            Option.getOrElse(placed, () => ({
              path: item.storedPath,
              note: notKept(tookTooLong(timeoutMs)),
            })),
          ),
        ),
      { concurrency: "unbounded" },
    ).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          deadline.passed = true;
        }),
      ),
    );
  });
}

/**
 * Removes the hidden halves of copies a server stopped in the middle of, an
 * hour old or more (a younger one may be a copy still running).
 */
export async function sweepPartialUploads(input: {
  readonly uploadsDir: string;
  readonly nowMs: number;
}): Promise<{ readonly deleted: number }> {
  let entries: string[];
  try {
    entries = await NodeFSP.readdir(input.uploadsDir);
  } catch {
    return { deleted: 0 };
  }
  let deleted = 0;
  for (const entry of entries) {
    if (!entry.startsWith(PARTIAL_PREFIX)) continue;
    const path = NodePath.join(input.uploadsDir, entry);
    try {
      const stat = await NodeFSP.lstat(path);
      if (!stat.isFile() || input.nowMs - stat.mtimeMs < PARTIAL_MAX_AGE_MS) continue;
      await NodeFSP.rm(path, { force: true });
      deleted += 1;
    } catch {
      // Gone already, or not ours to remove.
    }
  }
  return { deleted };
}
