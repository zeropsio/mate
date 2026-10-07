/**
 * HQ's setup journal: create-once slots in its new project's env, the birth's record in Zerops
 * rather than in any browser. It is what lets a birth stopped in one browser go on in another and
 * never send one of its writes twice: each write's intent wins a unique slot before it is sent, its
 * receipt keeps its handles after. Tags cannot arbitrate — their PUT replaces the whole list.
 *
 * The journal reads through an executor-side read of the env file (`executors/hqBirthReads.ts`)
 * and writes each slot as an `hq-birth-note` operation run to its end. A claim is a lease on who
 * goes on: renewed at each step, never waited out — a live claim of another browser stops this one
 * at once. No credential value is admitted to a record or a receipt.
 */
import * as Schema from "effect/Schema";

import { HQ_BIRTH_SLOT_TAKEN } from "../../data/operations/hqBirth.ts";
import { ZeropsApiError } from "../api.ts";
import type { HqBirthRecord } from "./birth.ts";

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
  importId: Schema.NullOr(Schema.String),
  projectId: Schema.NullOr(Schema.String),
  serviceId: Schema.NullOr(Schema.String),
  address: Schema.NullOr(Schema.String),
  deployProcessId: Schema.NullOr(Schema.String),
  serviceIds: Schema.optionalKey(Handles),
  orgTokenId: Schema.optionalKey(Schema.String),
  anchorTokenId: Schema.optionalKey(Schema.String),
  syncProcessId: Schema.optionalKey(Schema.NullOr(Schema.String)),
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
  org_token: "access token",
  key_secret: "key write",
  deploy: "deploy",
  routing: "address",
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

/** What the journal reads and writes through. */
export interface HqBirthJournalPorts {
  /** The env file's journal slots, read straight from it, never the lagging project search. */
  readonly read: (projectId: string) => Promise<ReadonlyMap<string, string>>;
  /** One slot written, its env process ended: the `hq-birth-note` operation run to its end. */
  readonly append: (projectId: string, key: string, content: string) => Promise<void>;
  /** The claim's lease alone. */
  readonly now: () => number;
  readonly newId: () => string;
}

export class HqBirthJournal {
  private claimIndex = -1;
  private recordIndex = -1;
  private readonly owner: string;
  private readonly projectId: string;
  private readonly ports: HqBirthJournalPorts;
  constructor(projectId: string, ports: HqBirthJournalPorts) {
    this.projectId = projectId;
    this.ports = ports;
    this.owner = ports.newId();
  }

  /** Taken where nobody holds it, or its holder's lease ran out; a live holder stops this one. */
  async acquire(moved: (record: HqBirthRecord) => void): Promise<HqBirthRecord> {
    const env = await this.ports.read(this.projectId);
    const record = readBirthRecord(env);
    if (record === undefined)
      throw new Error(
        "HQ's project has no setup record. Ask an organization admin to inspect it in Zerops.",
      );
    moved(record);
    const slot = lastSlot(env, "CLAIM");
    const claim = slot === undefined ? undefined : decodeClaim(slot.content);
    if (claim !== undefined && claim.until > this.ports.now()) throw new HqBirthClaimLost();
    await this.claim((slot?.index ?? -1) + 1);
    // A previous holder may have saved progress between the read and our claim.
    const current = await this.ports.read(this.projectId);
    this.recordIndex = lastSlot(current, "RECORD")!.index;
    return readBirthRecord(current)!;
  }

  /** One slot, its taker first: a slot another write took first is ownership lost. */
  private async append(key: string, content: string): Promise<void> {
    try {
      await this.ports.append(this.projectId, key, content);
    } catch (cause) {
      if (cause instanceof Error && cause.message === HQ_BIRTH_SLOT_TAKEN)
        throw new HqBirthClaimLost();
      throw cause;
    }
  }

  private async claim(index: number, until = this.ports.now() + HQ_BIRTH_CLAIM_MS) {
    await this.append(`${PREFIX}CLAIM_${index}`, JSON.stringify({ owner: this.owner, until }));
    this.claimIndex = index;
  }

  async assertOwned(): Promise<void> {
    const slot = lastSlot(await this.ports.read(this.projectId), "CLAIM");
    if (slot === undefined || slot.index !== this.claimIndex) throw new HqBirthClaimLost();
    const claim = decodeClaim(slot.content);
    if (claim.owner !== this.owner || claim.until <= this.ports.now()) throw new HqBirthClaimLost();
    if (claim.until - this.ports.now() < HQ_BIRTH_CLAIM_MS / 2) await this.claim(slot.index + 1);
  }

  async save(record: HqBirthRecord): Promise<void> {
    await this.assertOwned();
    const index = this.recordIndex + 1;
    await this.append(`${PREFIX}RECORD_${index}`, birthSnapshot(record));
    this.recordIndex = index;
  }

  async release(): Promise<void> {
    await this.assertOwned();
    await this.claim(this.claimIndex + 1, 0);
  }

  /**
   * Intent wins a unique slot before a write; a receipt retains only handles afterwards. A
   * suspended old holder and a new holder cannot both send the same write, even across expiry. An
   * intent without its receipt is never waited on and never sent again: it stops uncertain, and
   * neither a stale claim nor Again replays it. A definite refusal is recorded, and Again goes on
   * under a new attempt.
   */
  async perform(
    action: string,
    attempt: number,
    handles: Readonly<Record<string, string>>,
    call: () => Promise<Readonly<Record<string, string>>>,
  ): Promise<Readonly<Record<string, string>>> {
    const key = `${PREFIX}ACTION_${action}_${attempt}`;
    const doing = ACTION_WORDS[action] ?? "setup";
    const env = await this.ports.read(this.projectId);
    if (env.has(key)) {
      const receipt = env.get(`${key}_result`);
      if (receipt !== undefined) return decodeReceipt(receipt).handles;
      const refusal = env.get(`${key}_refusal`);
      if (refusal !== undefined) throw new Error(decodeRefusal(refusal).reason);
      throw new HqBirthUncertain(
        `Zerops has not confirmed HQ's ${doing} step. Its recorded handles are in the project's env. Press Again to check for its receipt; inspect the operation in Zerops before taking further action.`,
      );
    }
    await this.assertOwned();
    await this.append(key, JSON.stringify({ state: "started", handles }));
    let result: Readonly<Record<string, string>>;
    try {
      // Check again after the intent write: a paused tab does not act with an expired claim.
      await this.assertOwned();
      result = await call();
    } catch (cause) {
      // Intents are never removed. An outcome Zerops may have carried out is followed by its own
      // receipt; any other stop is recorded, for Again to go on under a new attempt.
      if (cause instanceof HqBirthClaimLost) throw cause;
      if (cause instanceof ZeropsApiError && cause.kind === "uncertain")
        throw new HqBirthUncertain(cause.message);
      await this.append(
        `${key}_refusal`,
        JSON.stringify({ reason: cause instanceof Error ? cause.message : String(cause) }),
      );
      throw cause;
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
