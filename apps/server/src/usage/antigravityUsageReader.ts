// node:sqlite reads live conversation databases while Node fs discovers them.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeTimersPromises from "node:timers/promises";

import type { UsageRecord } from "./usageTranscripts.ts";

type FieldValue = number | bigint | Uint8Array;
type Fields = Map<number, FieldValue[]>;

/** Antigravity stores usage metadata as protobuf, independently of conversation text. */
function fields(bytes: Uint8Array): Fields {
  let offset = 0;
  const result: Fields = new Map();
  const varint = () => {
    let value = 0n;
    for (let shift = 0n; shift < 70n; shift += 7n) {
      const byte = bytes[offset++];
      if (byte === undefined || (shift === 63n && byte > 1)) {
        throw new Error("Invalid Antigravity protobuf varint");
      }
      value |= BigInt(byte & 127) << shift;
      if (byte < 128) {
        return value > BigInt(Number.MAX_SAFE_INTEGER) ? value : Number(value);
      }
    }
    throw new Error("Invalid Antigravity protobuf varint");
  };
  while (offset < bytes.length) {
    const tag = varint();
    if (typeof tag !== "number") throw new Error("Invalid protobuf field");
    const number = Math.floor(tag / 8);
    const wire = tag % 8;
    if (number === 0) throw new Error("Invalid protobuf field");
    let value: FieldValue;
    if (wire === 0) {
      value = varint();
    } else if (wire === 1 || wire === 5 || wire === 2) {
      const length = wire === 2 ? varint() : wire === 1 ? 8 : 4;
      if (typeof length !== "number") throw new Error("Invalid protobuf field length");
      if (length > bytes.length - offset) throw new Error("Truncated protobuf field");
      value = bytes.subarray(offset, offset + length);
      offset += length;
      if (wire !== 2) continue;
    } else {
      throw new Error("Unsupported protobuf wire type");
    }
    const entries = result.get(number) ?? [];
    entries.push(value);
    result.set(number, entries);
  }
  return result;
}

const numberAt = (value: Fields, key: number) => {
  const entry = value.get(key)?.[0];
  return typeof entry === "number" ? entry : 0;
};
const bytesAt = (value: Fields, key: number) => {
  const entry = value.get(key)?.[0];
  return entry instanceof Uint8Array ? entry : undefined;
};
const nested = (value: Fields, key: number) => {
  const bytes = bytesAt(value, key);
  return bytes === undefined ? new Map<number, FieldValue[]>() : fields(bytes);
};
const textAt = (value: Fields, key: number) => {
  const bytes = bytesAt(value, key);
  return bytes === undefined ? "" : new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
};
const timestamp = (value: Fields) => {
  const seconds = numberAt(value, 1);
  return seconds > 0 ? seconds * 1000 + Math.floor(numberAt(value, 2) / 1_000_000) : null;
};

const MODEL_IDS: Record<number, string> = {
  246: "gemini-2.5-pro",
  312: "gemini-2.5-flash",
  313: "gemini-2.5-flash-thinking",
  329: "gemini-2.5-flash-thinking",
  330: "gemini-2.5-flash-lite",
  281: "claude-sonnet-4",
  282: "claude-sonnet-4",
  290: "claude-opus-4",
  291: "claude-opus-4",
  333: "claude-sonnet-4-5",
  334: "claude-sonnet-4-5",
  340: "claude-haiku-4-5",
  341: "claude-haiku-4-5",
  1026: "claude-opus-4-6",
  1035: "claude-sonnet-4-6",
  1016: "gemini-3.1-pro",
  1036: "gemini-3.1-pro",
  1037: "gemini-3.1-pro",
  1018: "gemini-3-flash-preview",
  1084: "gemini-3-flash-preview",
  1047: "gemini-3-flash-preview",
};

function modelName(name: string, id: number): string {
  if (name) {
    const normalized = name
      .toLowerCase()
      .replace(/\s*\([^)]*\)\s*$/, "")
      .replaceAll(" ", "-");
    if (normalized.startsWith("claude-")) {
      return normalized
        .replace(/^claude-(4(?:\.\d+)?)-(sonnet|opus|haiku)/, "claude-$2-$1")
        .replaceAll(".", "-");
    }
    return normalized;
  }
  return MODEL_IDS[id] ?? (id > 0 ? `antigravity-model-${id}` : "");
}

interface Metadata {
  model: string;
  timestampMs: number | null;
  usages: Fields[];
}

function metadata(bytes: Uint8Array, step: boolean): Metadata {
  const root = fields(bytes);
  if (!step && bytesAt(root, 1) === undefined) {
    throw new Error("Missing Antigravity generation metadata");
  }
  const data = step ? root : nested(root, 1);
  const model = step ? nested(data, 24) : data;
  const usage = bytesAt(data, step ? 9 : 4);
  const usages = usage === undefined ? [] : [fields(usage)];
  for (const retry of data.get(step ? 28 : 17) ?? []) {
    if (!(retry instanceof Uint8Array)) throw new Error("Invalid retry metadata");
    const retryUsage = bytesAt(fields(retry), 2);
    if (retryUsage !== undefined) usages.push(fields(retryUsage));
  }
  return {
    model: modelName(
      textAt(model, step ? 12 : 19) || textAt(model, step ? 8 : 21),
      numberAt(model, step ? 1 : 3),
    ),
    timestampMs: step
      ? (timestamp(nested(data, 8)) ?? timestamp(nested(data, 1)))
      : timestamp(nested(nested(data, 9), 4)),
    usages,
  };
}

function blob(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new Error("Invalid Antigravity metadata blob");
  return value;
}

interface UsageCandidate {
  record: UsageRecord;
  keys: readonly string[];
  timestampQuality: number;
}

/** The highest row each usage table had when it was read. */
export interface AntigravityHighWater {
  readonly generation: number;
  readonly step: number;
}
interface DatabaseRead {
  readonly candidates: UsageCandidate[];
  readonly high: AntigravityHighWater;
  /** When the conversation began, when it says. */
  readonly startedAtMs: number | null;
}

async function readDatabase(
  path: string,
  fallbackTimestamp: number,
  after: AntigravityHighWater = { generation: -1, step: -1 },
): Promise<DatabaseRead> {
  const db = new NodeSqlite.DatabaseSync(path, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout = 100; BEGIN");
    const tables = new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => row.name),
    );
    if (!tables.has("gen_metadata") && !tables.has("steps")) {
      throw new Error("Missing Antigravity usage tables");
    }
    const readMetadata = async (query: string, column: string, step: boolean, from: number) => {
      const entries: Array<{ idx: number; entry: Metadata }> = [];
      for (const row of db.prepare(query).iterate(from)) {
        if (typeof row.idx !== "number") throw new Error("Invalid Antigravity metadata index");
        entries.push({ idx: row.idx, entry: metadata(blob(row[column]), step) });
        if (entries.length % 256 === 0) await NodeTimersPromises.setImmediate();
      }
      return entries;
    };
    const generations = tables.has("gen_metadata")
      ? await readMetadata(
          "SELECT idx, data FROM gen_metadata WHERE idx > ? ORDER BY idx",
          "data",
          false,
          after.generation,
        )
      : [];
    let trajectoryTimestamp: number | null = null;
    if (tables.has("trajectory_metadata_blob")) {
      for (const row of db.prepare("SELECT data FROM trajectory_metadata_blob").iterate()) {
        trajectoryTimestamp ??= timestamp(nested(fields(blob(row.data)), 2));
      }
    }
    const steps = tables.has("steps")
      ? await readMetadata(
          "SELECT idx, metadata FROM steps WHERE metadata IS NOT NULL AND idx > ? ORDER BY idx",
          "metadata",
          true,
          after.step,
        )
      : [];
    const sessionId = NodePath.basename(path, ".db");
    const records: UsageCandidate[] = [];
    const generationModels = new Map(generations.map(({ idx, entry }) => [idx, entry.model]));
    for (const [source, entries] of [
      ["step", steps],
      ["generation", generations],
    ] as const) {
      for (const [index, { idx, entry }] of entries.entries()) {
        for (const [usageIndex, usage] of entry.usages.entries()) {
          const outputTokens = Math.max(
            numberAt(usage, 3),
            numberAt(usage, 9) + numberAt(usage, 10),
          );
          const totals = {
            uncachedInputTokens: numberAt(usage, 2),
            cachedInputTokens: numberAt(usage, 5),
            cacheCreationTokens: numberAt(usage, 4),
            outputTokens,
            reasoningTokens: Math.min(outputTokens, numberAt(usage, 9)),
          };
          if (
            totals.uncachedInputTokens +
              totals.cachedInputTokens +
              totals.cacheCreationTokens +
              outputTokens ===
            0
          )
            continue;
          const keys = ([11, 12, 7] as const).flatMap((key) => {
            const id = textAt(usage, key);
            return id ? [`antigravity:${key}:${id}`] : [];
          });
          const record: UsageRecord = {
            provider: "antigravity",
            sessionId,
            timestampMs: entry.timestampMs ?? trajectoryTimestamp ?? fallbackTimestamp,
            model:
              MODEL_IDS[numberAt(usage, 1)] ||
              entry.model ||
              (source === "step" ? generationModels.get(idx) : "") ||
              modelName("", numberAt(usage, 1)) ||
              "antigravity-unknown",
            totals,
            reportedCostUsd: null,
            fast: false,
            dedupeKey: keys[0] ?? `antigravity:${sessionId}:${source}:${index}:${usageIndex}`,
          };
          records.push({
            record,
            keys,
            timestampQuality: entry.timestampMs !== null ? 2 : trajectoryTimestamp !== null ? 1 : 0,
          });
        }
      }
    }
    const highest = (table: string, previous: number) => {
      if (!tables.has(table)) return previous;
      const row = db.prepare(`SELECT max(idx) AS idx FROM ${table}`).get();
      return typeof row?.idx === "number" ? Math.max(row.idx, previous) : previous;
    };
    return {
      candidates: records,
      high: {
        generation: highest("gen_metadata", after.generation),
        step: highest("steps", after.step),
      },
      startedAtMs: trajectoryTimestamp,
    };
  } finally {
    db.close();
  }
}

/** Every conversation database under `roots` once (by real path), and the paths that failed. */
export async function listAntigravityDatabases(
  roots: readonly string[],
): Promise<{ readonly databases: string[]; readonly errors: string[] }> {
  const databases: string[] = [];
  const errors: string[] = [];
  const visited = new Set<string>();
  const walk = async (directory: string): Promise<void> => {
    let entries;
    try {
      entries = await NodeFSP.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") errors.push(directory);
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const path = NodePath.join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.endsWith(".db")) {
        try {
          const canonical = await NodeFSP.realpath(path);
          if (visited.has(canonical)) continue;
          visited.add(canonical);
          databases.push(canonical);
        } catch {
          errors.push(path);
        }
      }
    }
  };
  for (const root of roots) await walk(root);
  return { databases, errors };
}

/** How far a conversation database's usage tables reach, without reading a row of them. */
export function antigravityHighWater(path: string): AntigravityHighWater {
  const db = new NodeSqlite.DatabaseSync(path, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout = 100");
    const tables = new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => row.name),
    );
    const highest = (table: string) => {
      if (!tables.has(table)) return -1;
      const row = db.prepare(`SELECT max(idx) AS idx FROM ${table}`).get();
      return typeof row?.idx === "number" ? row.idx : -1;
    };
    return { generation: highest("gen_metadata"), step: highest("steps") };
  } finally {
    db.close();
  }
}

/**
 * The generations one conversation database added after `after`, merged by shared identity, and
 * how far its tables reach now. A generation without its own clock keeps quality 1 (its
 * conversation's start) or 0 (only the file's time); neither dates it.
 */
export async function readAntigravityDatabase(
  path: string,
  after?: AntigravityHighWater,
): Promise<{
  readonly generations: AntigravityGeneration[];
  readonly high: AntigravityHighWater;
  readonly startedAtMs: number | null;
}> {
  const stat = await NodeFSP.stat(path);
  const read = await readDatabase(path, stat.mtimeMs, after);
  const { groups, identities, find, append } = grouping();
  for (const candidate of read.candidates) append(candidate, 0);
  const groupKeys = new Map<number, string[]>();
  for (const [key, index] of identities) {
    const root = find(index);
    groupKeys.set(root, [...(groupKeys.get(root) ?? []), key]);
  }
  const generations: AntigravityGeneration[] = [];
  for (const [index, group] of groups.entries()) {
    if (group.parent !== index) continue;
    generations.push({
      path,
      record: group.record,
      keys: groupKeys.get(index) ?? [],
      timestampQuality: group.timestampQuality,
    });
  }
  return { generations, high: read.high, startedAtMs: read.startedAtMs };
}

export interface AntigravityGeneration {
  /** The conversation database that owns the generation. */
  readonly path: string;
  readonly record: UsageRecord;
  /** `antigravity:<field>:<id>` identities; empty when the generation carries none. */
  readonly keys: readonly string[];
  /** 2: its own clock, 1: its conversation's, 0: only the database file's time. */
  readonly timestampQuality: number;
}

/** Generations seen under a shared identity, merged into one: the union of what each saw. */
function grouping() {
  const identities = new Map<string, number>();
  const groups: Array<
    UsageCandidate & { parent: number; size: number; owner: number; fileIndex: number }
  > = [];
  const find = (index: number): number => {
    let root = index;
    while (groups[root]!.parent !== root) root = groups[root]!.parent;
    while (index !== root) {
      const parent = groups[index]!.parent;
      groups[index]!.parent = root;
      index = parent;
    }
    return root;
  };
  const merge = (left: number, right: number): number => {
    let a = find(left);
    let b = find(right);
    if (a === b) return a;
    if (groups[a]!.size < groups[b]!.size) [a, b] = [b, a];
    const target = groups[a]!;
    const source = groups[b]!;
    const first = target.owner < source.owner ? target : source;
    const bestTime =
      source.timestampQuality > target.timestampQuality ||
      (source.timestampQuality === target.timestampQuality &&
        source.record.timestampMs < target.record.timestampMs)
        ? source
        : target;
    const x = target.record.totals;
    const y = source.record.totals;
    target.record = {
      ...first.record,
      model:
        first.record.model === "antigravity-unknown"
          ? first === target
            ? source.record.model
            : target.record.model
          : first.record.model,
      timestampMs: bestTime.record.timestampMs,
      totals: {
        uncachedInputTokens: Math.max(x.uncachedInputTokens, y.uncachedInputTokens),
        cachedInputTokens: Math.max(x.cachedInputTokens, y.cachedInputTokens),
        cacheCreationTokens: Math.max(x.cacheCreationTokens, y.cacheCreationTokens),
        outputTokens: Math.max(x.outputTokens, y.outputTokens),
        reasoningTokens: Math.max(x.reasoningTokens, y.reasoningTokens),
      },
    };
    target.timestampQuality = bestTime.timestampQuality;
    target.owner = first.owner;
    target.fileIndex = first.fileIndex;
    target.size += source.size;
    source.parent = a;
    return a;
  };
  const append = (candidate: UsageCandidate, fileIndex: number) => {
    const index = groups.length;
    groups.push({ ...candidate, parent: index, size: 1, owner: index, fileIndex });
    for (const key of candidate.keys) {
      const existing = identities.get(key);
      if (existing !== undefined) merge(index, existing);
      identities.set(key, index);
    }
  };
  return { groups, identities, find, append };
}

/** Reads and merges aliases across every configured Antigravity store before date filtering. */
export async function readAntigravityUsage(
  conversationsDirectories: string | readonly string[],
  sinceMs: number,
) {
  const roots =
    typeof conversationsDirectories === "string"
      ? [conversationsDirectories]
      : conversationsDirectories;
  const files: Array<{ root: string; path: string; records: UsageRecord[] }> = [];
  const errors: string[] = [];
  const { groups, append } = grouping();
  const visited = new Set<string>();
  const walk = async (directory: string, root: string): Promise<void> => {
    let entries;
    try {
      entries = await NodeFSP.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") errors.push(directory);
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const path = NodePath.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(path, root);
      } else if (entry.isFile() && entry.name.endsWith(".db")) {
        try {
          const canonical = await NodeFSP.realpath(path);
          if (visited.has(canonical)) continue;
          visited.add(canonical);
          const stat = await NodeFSP.stat(path);
          const { candidates } = await readDatabase(path, stat.mtimeMs);
          const fileIndex = files.length;
          files.push({ root, path, records: [] });
          for (const [index, candidate] of candidates.entries()) {
            append(candidate, fileIndex);
            if (index % 256 === 255) await NodeTimersPromises.setImmediate();
          }
        } catch {
          errors.push(path);
        }
      }
    }
  };
  for (const root of roots) await walk(root, root);
  for (const [index, group] of groups.entries()) {
    if (group.parent === index && group.record.timestampMs >= sinceMs) {
      files[group.fileIndex]!.records.push(group.record);
    }
  }
  return { files, errors };
}
