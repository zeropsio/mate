/**
 * Create-once project env slots are the birth's journal and arbiter. Tags cannot arbitrate: their
 * PUT replaces the entire list. Read the direct env file, never the lagging project search.
 * No credential value is admitted to a record or an action's receipt.
 */
import * as Schema from "effect/Schema";

import { ZeropsApiError } from "../api.ts";
import type { HqBirthDeps, HqBirthRecord } from "./birth.ts";

export const HQ_BIRTH_RECORD_KEY = "MATE_HQ_BIRTH_RECORD_0";
export const HQ_BIRTH_CLAIM_MS = 90_000;
const PREFIX = "MATE_HQ_BIRTH_";
const Handles = Schema.Record(Schema.String, Schema.String);
const Steps = Schema.Literals([
  "project",
  "services",
  "credential",
  "deploy",
  "domain",
  "anchor",
  "ready",
]);
const Stop = Schema.Struct({ step: Steps, reason: Schema.String, uncertain: Schema.Boolean });
const Record = Schema.Struct({
  step: Schema.Literals([
    "project",
    "services",
    "credential",
    "deploy",
    "domain",
    "anchor",
    "ready",
    "done",
  ]),
  importTag: Schema.NullOr(Schema.String),
  projectId: Schema.NullOr(Schema.String),
  serviceId: Schema.NullOr(Schema.String),
  address: Schema.NullOr(Schema.String),
  appVersionId: Schema.NullOr(Schema.String),
  deployProcessId: Schema.NullOr(Schema.String),
  serviceIds: Schema.optionalKey(Handles),
  importProcessId: Schema.optionalKey(Schema.String),
  importProcesses: Schema.optionalKey(Handles),
  orgTokenId: Schema.optionalKey(Schema.String),
  anchorTokenId: Schema.optionalKey(Schema.String),
  routingId: Schema.optionalKey(Schema.String),
  syncProcessId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  archiveUploaded: Schema.optionalKey(Schema.Boolean),
  coreYaml: Schema.optionalKey(Schema.String),
  attempt: Schema.optionalKey(Schema.Number),
  stopped: Schema.optionalKey(Schema.NullOr(Stop)),
});
const Snapshot = Schema.fromJsonString(
  Schema.Struct({ version: Schema.Literal(1), record: Record }),
);
const Claim = Schema.fromJsonString(Schema.Struct({ owner: Schema.String, until: Schema.Number }));
const Receipt = Schema.fromJsonString(Schema.Struct({ handles: Handles }));
const decodeSnapshot = Schema.decodeSync(Snapshot);
const decodeClaim = Schema.decodeSync(Claim);
const decodeReceipt = Schema.decodeSync(Receipt);
const decodeRefusal = Schema.decodeSync(
  Schema.fromJsonString(Schema.Struct({ reason: Schema.String })),
);
const encodeSnapshot = Schema.encodeSync(Snapshot);
const ACTION_WORDS: Readonly<Record<string, string>> = {
  token: "access token creation",
  regenerate: "access token regeneration",
  org_secret: "access write",
  key_secret: "key write",
  version: "app version creation",
  upload: "archive upload",
  deploy: "deploy",
  routing: "address creation",
  routing_sync: "address sync",
  anchor: "official HQ mark",
};

export const birthSnapshot = (record: HqBirthRecord): string =>
  encodeSnapshot({ version: 1, record });

/** Highest immutable slot, not the last item in the env file's ordering. */
function lastSlot(env: ReadonlyMap<string, string>, kind: string) {
  const pattern = new RegExp(`^${PREFIX}${kind}_(\\d+)$`, "u");
  let last: { index: number; content: string } | undefined;
  for (const [key, content] of env) {
    const match = pattern.exec(key);
    if (match !== null && (last === undefined || Number(match[1]) > last.index)) {
      last = { index: Number(match[1]), content };
    }
  }
  return last;
}

export function readBirthRecord(env: ReadonlyMap<string, string>): HqBirthRecord | undefined {
  const slot = lastSlot(env, "RECORD");
  if (slot === undefined) return undefined;
  try {
    return decodeSnapshot(slot.content).record;
  } catch {
    throw new Error(
      "HQ's setup record cannot be read. Ask an organization admin to inspect its project env in Zerops.",
    );
  }
}

export class HqBirthClaimLost extends Error {
  constructor() {
    super("Another browser is continuing HQ's setup. Open Mate again to follow its progress.");
  }
}
export class HqBirthUncertain extends Error {}

export class HqBirthJournal {
  private claimIndex = -1;
  private recordIndex = -1;
  private readonly owner: string;
  private readonly projectId: string;
  private readonly deps: HqBirthDeps;
  constructor(projectId: string, deps: HqBirthDeps) {
    this.projectId = projectId;
    this.deps = deps;
    this.owner = deps.newBirthId();
  }

  /** A live holder is observed. An expired/released claim is replaced by one atomic unique key. */
  async acquire(moved: (record: HqBirthRecord) => void): Promise<HqBirthRecord> {
    const started = this.deps.now();
    for (;;) {
      const env = await this.deps.platform.readProjectBirthEnv(this.projectId);
      const record = readBirthRecord(env);
      if (record === undefined) {
        if (
          this.deps.now() - started >=
          Math.min(this.deps.waits?.servicesCapMs ?? 90_000, 90_000)
        ) {
          throw new Error(
            "HQ's project has no setup record. Ask an organization admin to inspect it in Zerops.",
          );
        }
        await this.deps.sleep(this.deps.waits?.pollMs ?? 3_000);
        continue;
      }
      moved(record);
      const slot = lastSlot(env, "CLAIM");
      const claim = slot === undefined ? undefined : decodeClaim(slot.content);
      if (claim === undefined || claim.until <= this.deps.now()) {
        const index = (slot?.index ?? -1) + 1;
        try {
          await this.claim(index);
          this.recordIndex = lastSlot(env, "RECORD")!.index;
          // A previous holder may have saved progress between the read and our claim.
          const current = await this.deps.platform.readProjectBirthEnv(this.projectId);
          this.recordIndex = lastSlot(current, "RECORD")!.index;
          return readBirthRecord(current)!;
        } catch (cause) {
          // A collision is ownership contention, not a retried side effect. Every other error stops.
          if (!duplicateSlot(cause)) throw cause;
        }
      }
      if (this.deps.now() - started >= (this.deps.waits?.deployCapMs ?? 15 * 60_000)) {
        throw new Error("Another browser is setting up HQ. Press Again to read its progress.");
      }
      await this.deps.sleep(this.deps.waits?.pollMs ?? 3_000);
    }
  }

  private async append(key: string, content: string): Promise<void> {
    const { processId } = await this.deps.platform.createProjectEnv(this.projectId, key, content);
    if (!processId)
      throw new HqBirthUncertain(
        "Zerops accepted HQ's setup record but returned no process to follow. Press Again to read its recorded progress.",
      );
    const started = this.deps.now();
    for (;;) {
      const status = await this.deps.platform.readProcessStatus(processId);
      if (status === "FINISHED") return;
      if (status === "FAILED" || status === "CANCELED")
        throw new Error(
          `Zerops could not save HQ's setup record (${status}). Inspect its env process in Zerops, then press Again.`,
        );
      if (this.deps.now() - started >= HQ_BIRTH_CLAIM_MS)
        throw new HqBirthUncertain(
          "Saving HQ's setup record took too long. Press Again to follow its recorded progress.",
        );
      await this.deps.sleep(this.deps.waits?.pollMs ?? 3_000);
    }
  }

  private async claim(index: number, until = this.deps.now() + HQ_BIRTH_CLAIM_MS) {
    await this.append(`${PREFIX}CLAIM_${index}`, JSON.stringify({ owner: this.owner, until }));
    this.claimIndex = index;
  }

  async assertOwned(): Promise<void> {
    const slot = lastSlot(await this.deps.platform.readProjectBirthEnv(this.projectId), "CLAIM");
    if (slot === undefined || slot.index !== this.claimIndex) throw new HqBirthClaimLost();
    const claim = decodeClaim(slot.content);
    if (claim.owner !== this.owner || claim.until <= this.deps.now()) throw new HqBirthClaimLost();
    if (claim.until - this.deps.now() < HQ_BIRTH_CLAIM_MS / 2) await this.claim(slot.index + 1);
  }

  async save(record: HqBirthRecord): Promise<void> {
    await this.assertOwned();
    const index = this.recordIndex + 1;
    try {
      await this.append(`${PREFIX}RECORD_${index}`, birthSnapshot(record));
    } catch (cause) {
      if (duplicateSlot(cause)) throw new HqBirthClaimLost();
      throw cause;
    }
    this.recordIndex = index;
  }

  async release(): Promise<void> {
    await this.assertOwned();
    await this.claim(this.claimIndex + 1, 0);
  }

  /**
   * Intent wins a unique slot before a side effect; a receipt retains only handles afterwards.
   * A suspended old holder and a new holder cannot both send the same action, even across expiry.
   * A receipt may be saved after losing ownership: it describes a write already sent, never a new
   * one. A missing receipt stops; neither a stale claim nor Again authorizes replaying it.
   */
  async perform(
    action: string,
    attempt: number,
    handles: Readonly<Record<string, string>>,
    call: () => Promise<Readonly<Record<string, string>>>,
  ): Promise<Readonly<Record<string, string>>> {
    const key = `${PREFIX}ACTION_${action}_${attempt}`;
    const doing = ACTION_WORDS[action] ?? "setup";
    let env = await this.deps.platform.readProjectBirthEnv(this.projectId);
    const started = this.deps.now();
    while (env.has(key)) {
      const receipt = env.get(`${key}_result`);
      if (receipt !== undefined) return decodeReceipt(receipt).handles;
      const refusal = env.get(`${key}_refusal`);
      if (refusal !== undefined) {
        const reason = decodeRefusal(refusal).reason;
        throw new Error(reason);
      }
      if (this.deps.now() - started >= 120_000) {
        throw new HqBirthUncertain(
          `Zerops has not confirmed HQ's ${doing} step. Its recorded handles are in the project's env. Press Again to check for its receipt; inspect the operation in Zerops before taking further action.`,
        );
      }
      await this.assertOwned();
      await this.deps.sleep(this.deps.waits?.pollMs ?? 3_000);
      env = await this.deps.platform.readProjectBirthEnv(this.projectId);
    }
    await this.assertOwned();
    try {
      await this.append(key, JSON.stringify({ state: "started", handles }));
    } catch (cause) {
      if (duplicateSlot(cause)) throw new HqBirthClaimLost();
      throw cause;
    }
    let result: Readonly<Record<string, string>>;
    try {
      // Check again after the intent write: a paused tab does not act with an expired claim.
      await this.assertOwned();
      result = await call();
    } catch (cause) {
      // Intents are never removed. A definite refusal is recorded and a manual Again uses a new
      // attempt; an uncertain outcome must be followed by its own receipt.
      if (
        cause instanceof ZeropsApiError &&
        ["invalid-input", "forbidden", "not-found"].includes(cause.kind)
      ) {
        await this.append(`${key}_refusal`, JSON.stringify({ reason: cause.message }));
        throw cause;
      }
      throw new HqBirthUncertain(
        cause instanceof Error ? cause.message : "Zerops did not confirm this setup step.",
      );
    }
    try {
      await this.append(`${key}_result`, JSON.stringify({ handles: result }));
    } catch {
      throw new HqBirthUncertain(
        `HQ's ${doing} completed, but Zerops did not confirm its receipt. Press Again to read its recorded handles.`,
      );
    }
    return result;
  }
}

/** The platform's unique-key refusal; no arbitrary 400 is considered a claim collision. */
function duplicateSlot(cause: unknown): boolean {
  return (
    cause instanceof ZeropsApiError &&
    cause.kind === "invalid-input" &&
    /not unique/iu.test(cause.message)
  );
}
