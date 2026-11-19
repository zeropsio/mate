/**
 * Decides which conversations to unbind and bind, in order, from what a successful call says
 * about zcp's leases.
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  ForwardCompatibleArray,
  isZeropsLeaseHeld,
  sameZeropsLeaseGroup,
  ZeropsLease,
  ThreadLease,
  type SpiToolCall,
  type ThreadId,
} from "@t3tools/contracts";

/**
 * A change of a conversation's lease: the same commands the conversation's record takes
 * (`BindLease`, `UnbindLease`).
 */
export type LeaseChange =
  | { readonly _tag: "BindLease"; readonly lease: ThreadLease }
  /** The lease the conversation is bound to ended: released, lost, gone, or taken again. */
  | { readonly _tag: "UnbindLease"; readonly ended: string };

/** A conversation bound to a lease, as its record holds it. */
export interface LeaseBinding {
  readonly conversation: ThreadId;
  readonly alias: string;
  /**
   * The lease's branch (null: none) and repository (none where zcp named none): the group whose
   * other leases the conversation is bound to next.
   */
  readonly branch: string | null;
  readonly repo: string | undefined;
  /**
   * When zcp acquired the lease bound (`ThreadLease.acquiredAt`): a read of its alias acquired at
   * another time is another lease. None in a binding recorded before it was kept: such a binding
   * is checked against the last read every binding was checked against (`renewed`).
   */
  readonly acquiredAt: string | undefined;
}

/** The tool a conversation's agent leases a pool container with. */
const LEASE_TOOL = "zerops_lease";

/**
 * A lease a `zerops_lease` call's own result lists: the envelope's, and whether an acquire returned
 * the lease zcp already held for its repository, branch and pool (zcp `docs/spec-workflows.md` §8
 * DP-17) — another conversation's acquire, which moves no binding.
 */
const ZeropsLeaseResult = Schema.Struct({
  ...ZeropsLease.fields,
  reused: Schema.optional(Schema.Boolean),
});
type ZeropsLeaseResult = typeof ZeropsLeaseResult.Type;
const decodeResultLeases = Schema.decodeUnknownOption(ForwardCompatibleArray(ZeropsLeaseResult));
const decodeThreadLease = Schema.decodeUnknownOption(ThreadLease);

/**
 * What a set of leases says, to tell a new read from the same read again: a lease is its alias, its
 * state and when zcp acquired it, since a pool hands a released container out again under the same
 * alias.
 */
export const leasesKey = (leases: ReadonlyArray<ZeropsLease>): string =>
  leases
    .map((lease) => `${lease.alias}\u0000${lease.state}\u0000${lease.acquiredAt ?? ""}`)
    .toSorted()
    .join("\n");

/** A read of zcp's leases the conversations' bindings were checked against. */
export interface CheckedRead {
  /** The read's `leasesKey`; none for a read only kept from before a restart, checked whole again. */
  readonly key: string | undefined;
  /** When zcp acquired each lease the read named, by alias. */
  readonly acquiredAt: ReadonlyMap<string, string>;
}

export const checkedRead = (
  leases: ReadonlyArray<ZeropsLease>,
  key: string | undefined,
): CheckedRead => ({
  key,
  acquiredAt: new Map(
    leases.flatMap((lease) =>
      lease.acquiredAt === undefined ? [] : [[lease.alias, lease.acquiredAt] as const],
    ),
  ),
});

/**
 * The leases a read names held under an alias the checked read named acquired at another time: other
 * leases than the ones bound under it, handed out again while no call of this server read them.
 */
export const renewedLeases = (
  read: ReadonlyArray<ZeropsLease>,
  checked: CheckedRead | undefined,
): ReadonlyArray<string> =>
  read.flatMap((lease) => {
    const before = checked?.acquiredAt.get(lease.alias);
    return isZeropsLeaseHeld(lease.state) &&
      lease.acquiredAt !== undefined &&
      before !== undefined &&
      before !== lease.acquiredAt
      ? [lease.alias]
      : [];
  });

/** A call's own `leases` beside its envelope: the leases the `zerops_lease` call acted on. */
const callLeases = (text: string): ReadonlyArray<ZeropsLeaseResult> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? Option.getOrElse(
        decodeResultLeases((parsed as { readonly leases?: unknown }).leases),
        () => [],
      )
    : [];
};

const argument = (call: SpiToolCall, key: string): string | undefined => {
  const value =
    typeof call.arguments === "object" && call.arguments !== null
      ? (call.arguments as Readonly<Record<string, unknown>>)[key]
      : undefined;
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

/** A lease as a conversation's record binds it; none when it cannot be one. */
const threadLeaseOf = (lease: ZeropsLease): ThreadLease | undefined =>
  Option.getOrUndefined(
    decodeThreadLease({
      alias: lease.alias,
      pool: lease.pool,
      branch: lease.branch === undefined || lease.branch === "" ? null : lease.branch,
      ...(lease.repo === undefined || lease.repo === "" ? {} : { repo: lease.repo }),
      ...(lease.acquiredAt === undefined || lease.acquiredAt === ""
        ? {}
        : { acquiredAt: lease.acquiredAt }),
    }),
  );

/**
 * What an acquire leased: every lease its result lists but the ones zcp already held (`reused`),
 * the first of which binds its conversation — a group acquire lists its leases in its pools' order.
 * A result that lists none of its own leased the one lease of its pool and branch zcp's leases
 * hold. None when it leased nothing, or nothing says which.
 */
const acquiredLeases = (
  call: SpiToolCall,
  text: string,
  read: ReadonlyArray<ZeropsLease> | undefined,
): { readonly lease: ThreadLease; readonly aliases: ReadonlyArray<string> } | undefined => {
  const own = callLeases(text);
  const pool = argument(call, "pool");
  const branch = argument(call, "branch");
  const leased =
    own.length > 0
      ? own.filter((lease) => lease.reused !== true)
      : (read ?? []).filter(
          (lease) =>
            lease.pool === pool &&
            (branch === undefined || lease.branch === branch) &&
            isZeropsLeaseHeld(lease.state),
        );
  const [first] = leased;
  if (first === undefined || (own.length === 0 && leased.length !== 1)) return undefined;
  const lease = threadLeaseOf(first);
  return lease === undefined ? undefined : { lease, aliases: leased.map(({ alias }) => alias) };
};

/** When zcp acquired a lease, in ms; one with no time it says is acquired after every other. */
const acquiredAtMs = (lease: ZeropsLease): number => {
  const at = lease.acquiredAt === undefined ? Number.NaN : Date.parse(lease.acquiredAt);
  return Number.isNaN(at) ? Number.POSITIVE_INFINITY : at;
};

/**
 * What one successful call says of zcp's leases, whoever made it: zcp keeps one set of leases for
 * every conversation (its state is in the shared working directory), so a release, an acquire or
 * a read by one conversation speaks for the leases every other one is bound to.
 */
export interface LeaseFacts {
  /** The leases zcp holds, when this call read them and the read differs from the last one. */
  readonly held?: ReadonlyArray<string>;
  /** zcp's leases as this call read them: where a conversation whose lease ended is bound next. */
  readonly read?: ReadonlyArray<ZeropsLease>;
  /** The leases this call released: the one it names, and each its result says it released. */
  readonly released: ReadonlyArray<string>;
  /**
   * The leases this call read held under an alias the last checked read had of another lease: what
   * says a binding that keeps no `acquiredAt` ended.
   */
  readonly renewed: ReadonlyArray<string>;
  /** This call's read, to check the next one against once every binding was checked against it. */
  readonly checkpoint?: CheckedRead;
  /**
   * The leases this call acquired (`aliases`, never one zcp already held), the one of them its
   * conversation is bound to (`lease`), and that conversation (none: no conversation).
   */
  readonly acquired?: {
    readonly lease: ThreadLease;
    readonly aliases: ReadonlyArray<string>;
    readonly by: ThreadId | undefined;
  };
}

export const leaseFactsOf = (
  call: SpiToolCall,
  text: string,
  read: ReadonlyArray<ZeropsLease> | undefined,
  readChanged: boolean,
  renewed: ReadonlyArray<string>,
  checkpoint: CheckedRead | undefined,
  owner: ThreadId | undefined,
): LeaseFacts => {
  const held =
    read !== undefined && readChanged
      ? read.filter((lease) => isZeropsLeaseHeld(lease.state)).map((lease) => lease.alias)
      : undefined;
  const action = call.name === LEASE_TOOL ? argument(call, "action") : undefined;
  const named = argument(call, "lease");
  // A release of a branch names no lease: its result lists each it released.
  const released =
    action === "release"
      ? [
          ...new Set([
            ...(named === undefined ? [] : [named]),
            ...callLeases(text)
              .filter((lease) => !isZeropsLeaseHeld(lease.state))
              .map((lease) => lease.alias),
          ]),
        ]
      : [];
  const acquired = action === "acquire" ? acquiredLeases(call, text, read) : undefined;
  return {
    ...(held === undefined ? {} : { held }),
    ...(read === undefined ? {} : { read }),
    released,
    renewed,
    ...(checkpoint === undefined ? {} : { checkpoint }),
    ...(acquired === undefined ? {} : { acquired: { ...acquired, by: owner } }),
  };
};

/**
 * The lease changes the facts say to the conversations bound now, in the order they apply: every
 * conversation whose lease ended is unbound first — released, no longer held, acquired again by
 * another, or read under its alias acquired at another time (a pool hands a released container out
 * again under the same alias, so the alias alone never says whose lease it is: the binding is the
 * conversation's that acquired it) — then each is
 * bound to the earliest-acquired lease of its repository and branch this call read still held, if
 * any (a branch spanning several app parts holds one lease per part's pool, and its conversation
 * goes on showing the others; another app's lease of the same branch is another group), never one
 * another conversation acquired in this call; then the
 * conversation that acquired one is bound, which takes it only while it has no lease, and which
 * its own acquire binds rather than its branch's.
 */
export const leaseChangesFor = (
  facts: LeaseFacts,
  bindings: ReadonlyArray<LeaseBinding>,
): ReadonlyArray<{ readonly conversation: ThreadId; readonly change: LeaseChange }> => {
  const { acquired } = facts;
  const acquiredByAnother = (alias: string, conversation: ThreadId) =>
    acquired !== undefined && acquired.aliases.includes(alias) && conversation !== acquired.by;
  // Against the binding's own lease where it keeps when zcp acquired it: the last checked read
  // stays behind while a record cannot be read, and would take the alias's new holder for another
  // lease than its own.
  const renewed = ({ alias, acquiredAt }: LeaseBinding) => {
    if (acquiredAt === undefined) return facts.renewed.includes(alias);
    const now = facts.read?.find((lease) => lease.alias === alias);
    return (
      now !== undefined &&
      isZeropsLeaseHeld(now.state) &&
      now.acquiredAt !== undefined &&
      now.acquiredAt !== acquiredAt
    );
  };
  const ended = bindings.filter(
    (binding) =>
      facts.released.includes(binding.alias) ||
      (facts.held !== undefined && !facts.held.includes(binding.alias)) ||
      renewed(binding) ||
      acquiredByAnother(binding.alias, binding.conversation),
  );
  const boundNext = (binding: LeaseBinding): ThreadLease | undefined => {
    if (acquired !== undefined && binding.conversation === acquired.by) return undefined;
    const earliest = (facts.read ?? [])
      .filter(
        (lease) =>
          lease.alias !== binding.alias &&
          isZeropsLeaseHeld(lease.state) &&
          sameZeropsLeaseGroup(binding, lease) &&
          !facts.released.includes(lease.alias) &&
          !acquiredByAnother(lease.alias, binding.conversation),
      )
      .reduce<ZeropsLease | undefined>(
        (best, lease) =>
          best === undefined || acquiredAtMs(lease) < acquiredAtMs(best) ? lease : best,
        undefined,
      );
    return earliest === undefined ? undefined : threadLeaseOf(earliest);
  };
  const by = acquired?.by;
  return [
    ...ended.map(({ conversation, alias }) => ({
      conversation,
      change: { _tag: "UnbindLease", ended: alias } as const,
    })),
    ...ended.flatMap((binding) => {
      const lease = boundNext(binding);
      return lease === undefined
        ? []
        : [{ conversation: binding.conversation, change: { _tag: "BindLease", lease } as const }];
    }),
    ...(acquired === undefined || by === undefined
      ? []
      : [{ conversation: by, change: { _tag: "BindLease", lease: acquired.lease } as const }]),
  ];
};
