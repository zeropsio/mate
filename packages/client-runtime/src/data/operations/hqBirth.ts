/**
 * HQ's own birth, at Zerops: HQ cannot execute it, so every write it makes is Zerops's — a slot of
 * its setup journal in its project's env, its access (its organization token and its key), its
 * domain routed and in place, and the mark that makes it the organization's official HQ. Each that
 * asks Zerops first where it stands (a variable held, a token or a routing of its name) writes
 * only what is not there yet. A slot written and a sync started end as their processes do, read in
 * HQ's project history while they run; the rest are done once Zerops answers. Zerops keeps no
 * request ids: a lost answer stays uncertain and is never sent again blindly.
 *
 * @module data/operations/hqBirth
 */
import type { HqBirthOutcome, HqBirthRecord } from "../../zerops/hq/birth.ts";
import type { OperationKind } from "./kind.ts";
import { historyHolding, reflectedByProcess, settledByProcess } from "./processEnd.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "hq-birth": {
      readonly orgId: string;
      readonly zeropsApi: string;
      readonly again: boolean;
    };
    /** One create-once slot of HQ's setup journal, in its project's env. */
    readonly "hq-birth-note": {
      readonly orgId: string;
      readonly projectId: string;
      readonly key: string;
      readonly content: string;
    };
    /** Core's working token, minted (or its value regenerated) and written to HQ's service. */
    readonly "hq-org-token": {
      readonly orgId: string;
      readonly projectId: string;
      readonly serviceId: string;
    };
    /** Core's key for its environments' deploy tokens, drawn and written to HQ's service. */
    readonly "hq-key-secret": {
      readonly orgId: string;
      readonly serviceId: string;
    };
    /** HQ's domain routed to its service and put in place. */
    readonly "route-hq-domain": {
      readonly orgId: string;
      readonly projectId: string;
      readonly serviceId: string;
      readonly domain: string;
    };
    /** The organization's mark naming HQ's project and address its official HQ. */
    readonly "mark-official-hq": {
      readonly orgId: string;
      readonly projectId: string;
      readonly address: string;
    };
  }
  interface OperationResults {
    readonly "hq-birth": {
      readonly record: HqBirthRecord;
      readonly failed: Extract<HqBirthOutcome, { readonly ok: false }> | null;
    };
    /** The token written; `null` where HQ's service held its variable already. */
    readonly "hq-org-token": { readonly tokenId: string | null };
    /** The sync that puts the domain in place; `null` where it was in place, or Zerops named none. */
    readonly "route-hq-domain": { readonly processId: string | null };
    /** The mark, made now or there already. */
    readonly "mark-official-hq": { readonly tokenId: string };
  }
}

/** What a slot whose name another write took first is refused with: the journal's arbiter. */
export const HQ_BIRTH_SLOT_TAKEN = "Another browser wrote this HQ setup record first.";

export const hqBirthNote: OperationKind<"hq-birth-note"> = {
  kind: "hq-birth-note",
  executor: "zerops",
  reflected: (read, _intent, receipt) => reflectedByProcess(read, receipt),
  settledBy: (read, _intent, receipt) =>
    settledByProcess(
      read,
      receipt,
      (process) =>
        `Zerops could not save HQ's setup record (${process.status}). Inspect its env process in Zerops, then press Again.`,
    ),
  observedIn: (intent, receipt) => historyHolding(intent.projectId, receipt),
};

export const hqOrgToken: OperationKind<"hq-org-token"> = {
  kind: "hq-org-token",
  executor: "zerops",
  reflected: () => true,
};

export const hqKeySecret: OperationKind<"hq-key-secret"> = {
  kind: "hq-key-secret",
  executor: "zerops",
  reflected: () => true,
};

export const routeHqDomain: OperationKind<"route-hq-domain"> = {
  kind: "route-hq-domain",
  executor: "zerops",
  reflected: (read, _intent, receipt) =>
    receipt.outcome.kind !== "pending" || reflectedByProcess(read, receipt),
  settledBy: (read, _intent, receipt) =>
    settledByProcess(
      read,
      receipt,
      () =>
        "Zerops could not put HQ's domain in place. Inspect its sync process in Zerops, then press Again.",
    ),
  observedIn: (intent, receipt) => historyHolding(intent.projectId, receipt),
};

export const markOfficialHq: OperationKind<"mark-official-hq"> = {
  kind: "mark-official-hq",
  executor: "zerops",
  reflected: () => true,
};

export const hqBirth: OperationKind<"hq-birth"> = {
  kind: "hq-birth",
  executor: "zerops",
  reflected: () => false,
};

export const HQ_BIRTH_KINDS = [
  hqBirth,
  hqBirthNote,
  hqOrgToken,
  hqKeySecret,
  routeHqDomain,
  markOfficialHq,
] as const;
