/**
 * The web's binding to the account runtime's Mate environments (DESIGN §7.3): the post-grant
 * stage the host binds once the epoch's first grant built it — what surfaces ask of it — and the
 * hooks surfaces read each Mate through: projections of what the Mate adapter wrote to the
 * account's store (`mateLinks`). Nothing here holds a fact of its own.
 *
 * Closing the account lifetime unbinds it at once: a reader after sign-out sees no environments.
 */
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type {
  AtomCommand,
  AtomCommandOptions,
  AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type {
  AccountEnvironments,
  CloseOffHold,
} from "@t3tools/client-runtime/zerops/account/runtime";
import { normalizeOrigin, type ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { CapabilityRefusal, OrganizationRef } from "@t3tools/client-runtime/zerops/data";
import {
  mateOfEnvironmentAtom,
  shownMateLinksAtom,
  type MateLinkValue,
} from "@t3tools/client-runtime/data";
import type { IdentityExchangeReason } from "@t3tools/client-runtime/zerops/diagnostics";
import {
  environmentTarget,
  indexDescriptors,
  isTerminalReachability,
  reachabilityPhrase,
  resolveEnvironment,
  selectReachability,
  type ConnectOutcome,
  type DescriptorIndex,
  type EnvironmentMachine,
  type TargetKey,
} from "@t3tools/client-runtime/zerops/environments";
import type { ZeropsIdentityExchangeResult } from "@t3tools/client-runtime/zerops/identityExchange";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";
import { useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";

import { useAtomCommand } from "../state/use-atom-command";
import { hqMatesAtom, hqProjectOf, hqProjectAtom } from "../state/zerops";
import { invalidateZerops } from "./accountInvalidations";
import { onAccountLifetimeClose } from "./accountLifetime";
import { useInventoryCandidates } from "./inventoryContext";
import { batchedPerTask } from "./taskBatch";

// ── The binding ──────────────────────────────────────────────────────────────────────────────

let bound: AccountEnvironments | null = null;
const listeners = new Set<() => void>();
/** Readers waiting for the stage, answered when one is bound. */
let waiting: Array<(environments: AccountEnvironments) => void> = [];

function publish(next: AccountEnvironments | null): void {
  bound = next;
  if (next !== null) {
    const answered = waiting;
    waiting = [];
    for (const answer of answered) answer(next);
  }
  for (const listener of listeners) listener();
}

onAccountLifetimeClose(() => {
  waiting = [];
  if (bound !== null) publish(null);
});

/**
 * Makes `environments` — the open account's post-grant stage — the one surfaces read. Returns the
 * way to unbind it, which leaves a newer binding alone.
 */
export function bindAccountEnvironments(environments: AccountEnvironments): () => void {
  publish(environments);
  return () => {
    if (bound === environments) publish(null);
  };
}

/** The bound stage; null before the epoch's first grant and after sign-out. */
export function currentAccountEnvironments(): AccountEnvironments | null {
  return bound;
}

/** The bound stage, once there is one. */
export function accountEnvironmentsReady(): Promise<AccountEnvironments> {
  if (bound !== null) return Promise.resolve(bound);
  return new Promise((resolve) => {
    waiting.push(resolve);
  });
}

function subscribeBinding(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The bound stage, re-read when it is bound or unbound. */
export function useAccountEnvironments(): AccountEnvironments | null {
  return useSyncExternalStore(
    subscribeBinding,
    currentAccountEnvironments,
    currentAccountEnvironments,
  );
}

/**
 * One snapshot of the bound stage, re-read after its publications — once per task, however many
 * a reconnect lands in it; `empty` while none is.
 */
export function useAccountEnvironmentsSnapshot<T>(
  read: (environments: AccountEnvironments) => T,
  empty: T,
): T {
  const environments = useAccountEnvironments();
  const subscribe = useCallback(
    (listener: () => void) => {
      if (environments === null) return () => undefined;
      const batched = batchedPerTask(listener);
      const unsubscribe = environments.subscribe(batched.notify);
      return () => {
        unsubscribe();
        batched.cancel();
      };
    },
    [environments],
  );
  const snapshot = useCallback(
    () => (environments === null ? empty : read(environments)),
    [empty, environments, read],
  );
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

// ── What surfaces read ───────────────────────────────────────────────────────────────────────

/** Every Mate target's environment machine (§4.4), as the account's store holds it. */
export function useEnvironmentMachines(): ReadonlyMap<TargetKey, EnvironmentMachine> {
  return useAtomValue(shownMateLinksAtom).machines;
}

/** Each Mate shown, as the account's store holds it: its machines, and whether it is read now. */
export function useMateLinkValues(): ReadonlyMap<TargetKey, MateLinkValue> {
  return useAtomValue(shownMateLinksAtom).targets;
}

/** The descriptor index over every present target (§4.8). */
export function useDescriptorIndex(): DescriptorIndex {
  const links = useAtomValue(shownMateLinksAtom);
  return useMemo(() => indexDescriptors(links.machines, links.containers), [links]);
}

/**
 * Where the Mate serving an environment is, as this tab read it: its project, the organization
 * that lists it and its address. Undefined while no Mate read names the environment.
 */
export function useMateOfEnvironment(environmentId: string | null | undefined):
  | {
      readonly projectId: string;
      readonly orgId: string | null;
      readonly origin: string | null;
    }
  | undefined {
  const mate = useAtomValue(environmentId == null ? NO_MATE : mateOfEnvironmentAtom(environmentId));
  return mate ?? undefined;
}

const NO_MATE = Atom.make(null);

const NO_CLOSE_OFF_HOLDS: ReadonlyMap<string, CloseOffHold> = new Map();
const closeOffHoldsOf = (environments: AccountEnvironments) => environments.closeOffHolds();

/** The projects whose Mate the close-off gate holds, and why (`closeOffGate`). */
export function useCloseOffHolds(): ReadonlyMap<string, CloseOffHold> {
  return useAccountEnvironmentsSnapshot(closeOffHoldsOf, NO_CLOSE_OFF_HOLDS);
}

const NO_DETAIL_PROJECTS: ReadonlySet<string> = new Set();
const detailProjectsOf = (environments: AccountEnvironments) => environments.detailProjects();

/** Deployment reads share the active detail scopes, rather than following cached sidebar rows. */
export function useDetailProjects(): ReadonlySet<string> {
  return useAccountEnvironmentsSnapshot(detailProjectsOf, NO_DETAIL_PROJECTS);
}

/** The screen or route's refused inventory read, and one manual new attempt. */
export function useMateDetailRead(
  projectId: string | null,
  environmentId: EnvironmentId | null = null,
) {
  const account = useAccountEnvironments();
  const hqProject = useAtomValue(
    environmentId === null ? NO_DETAIL_PROJECT : hqProjectAtom(environmentId),
  );
  const mate = useMateOfEnvironment(environmentId);
  const project = projectId ?? hqProject ?? mate?.projectId ?? null;
  const read = useCallback(
    (environments: AccountEnvironments) =>
      project === null ? null : environments.detailFailure(project),
    [project],
  );
  const failure = useAccountEnvironmentsSnapshot(read, null);
  const again = useCallback(() => {
    if (account !== null && project !== null) account.retryDetail(project);
  }, [account, project]);
  return { failure, again };
}

const NO_DETAIL_PROJECT = Atom.make<string | null>(null);

// ── An action's lease ────────────────────────────────────────────────────────────────────────

/**
 * How long an action waits for the Mate it holds to connect before it is sent anyway: twice the
 * p90 of an open as measured (15 s), the bound a command waits for its capability too.
 */
export const MATE_HOLD_WAIT_MS = 30_000;

/**
 * What an action's lease reaches: the stage's `hold`, and the Mates as the account's store holds
 * them — read now, and heard as they change.
 */
export interface HeldEnvironments {
  readonly hold: AccountEnvironments["hold"];
  readonly machines: () => ReadonlyMap<TargetKey, EnvironmentMachine>;
  readonly subscribe: (listener: () => void) => () => void;
}

/** The stage's lease over the Mates as `registry` holds them; null while no stage is bound. */
export function heldEnvironments(
  environments: AccountEnvironments | null,
  registry: AtomRegistry.AtomRegistry,
): HeldEnvironments | null {
  if (environments === null) return null;
  return {
    hold: environments.hold,
    machines: () => registry.get(shownMateLinksAtom).machines,
    subscribe: (listener) => registry.subscribe(shownMateLinksAtom, listener),
  };
}

/**
 * Whether a command for `environmentId` can go: its Mate's link is up on that environment's
 * credential, or nothing would bring it up — no Mate is named for it (`named`: HQ names its
 * project), or the one named settled on a verdict no wait changes.
 */
function readyToSend(
  environments: HeldEnvironments,
  environmentId: EnvironmentId,
  named: boolean,
): boolean {
  const target = environmentTarget(environments.machines(), environmentId);
  if (target === undefined) return !named;
  const { credential, link } = target.machine;
  if (credential.kind === "held" && credential.environmentId === environmentId) {
    if (link.phase === "connected") return true;
  }
  return isTerminalReachability(selectReachability(target.machine, environmentId));
}

/** Resolves once a command for `environmentId` can go, or after `MATE_HOLD_WAIT_MS`. */
function untilReadyToSend(
  environments: HeldEnvironments,
  environmentId: EnvironmentId,
  named: boolean,
): Promise<void> {
  if (readyToSend(environments, environmentId, named)) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      unsubscribe();
      resolve();
    };
    const timer = setTimeout(done, MATE_HOLD_WAIT_MS);
    const unsubscribe = environments.subscribe(() => {
      if (readyToSend(environments, environmentId, named)) done();
    });
  });
}

/**
 * Runs `command` with the Mate of `environmentId` held connected — an action's lease (A9): a
 * command sent from outside the Mate's own view (a menu's Stop, a clone's Retry, a chat's rename)
 * connects a parked Mate, or one this browser never registered that HQ names (`named`), and is
 * sent once its link is up — a command on a link that is not fails at once — or once it waited
 * `MATE_HOLD_WAIT_MS`. It lets the Mate go however the command ends. Where no account is bound,
 * the command runs as it is.
 */
export async function whileMateHeld<T>(
  environments: HeldEnvironments | null,
  environmentId: EnvironmentId,
  command: () => Promise<T>,
  options: { readonly named?: boolean } = {},
): Promise<T> {
  const release = environments?.hold(environmentId);
  try {
    if (environments !== null) {
      await untilReadyToSend(environments, environmentId, options.named ?? false);
    }
    return await command();
  } finally {
    release?.();
  }
}

/**
 * Holds the Mate of `environmentId` connected for as long as a surface names it — the jump box's
 * picked Mate, a running clone's toast — and lets it go once it names another, or none (null).
 */
export function useMateHeld(environmentId: EnvironmentId | null): void {
  const environments = useAccountEnvironments();
  useEffect(() => {
    if (environments === null || environmentId === null) return;
    return environments.hold(environmentId);
  }, [environments, environmentId]);
}

/**
 * A Mate's command as a surface outside its own view sends it: with its action lease, once its
 * Mate is connected. HQ's word is read as it is sent, so no surface re-renders on HQ's every word.
 */
export function useMateCommand<A, E, W extends { readonly environmentId: EnvironmentId }>(
  command: AtomCommand<W, A, E>,
  options?: string | AtomCommandOptions,
): (value: W) => Promise<AtomCommandResult<A, E | CapabilityRefusal>> {
  const send = useAtomCommand(command, options);
  const environments = useAccountEnvironments();
  const atoms = useContext(RegistryContext);
  return useCallback(
    (value: W) =>
      whileMateHeld(heldEnvironments(environments, atoms), value.environmentId, () => send(value), {
        named: hqProjectOf(atoms.get(hqMatesAtom), value.environmentId) !== null,
      }),
    [atoms, environments, send],
  );
}

// ── The user's Connect ───────────────────────────────────────────────────────────────────────

/** The verdicts a retry of the same Connect does not change. */
const TERMINAL_CONNECT: ReadonlySet<string> = new Set([
  "gone",
  "replaced",
  "refused-role",
  "refused-configuration",
  "refused-credential",
  "update-required",
  "update-unavailable",
  "no-address",
]);

/** A settled Connect as the projects page reads it. */
export function connectResult(outcome: ConnectOutcome): ZeropsIdentityExchangeResult {
  switch (outcome._tag) {
    case "Connected":
      return { _tag: "Success", environmentId: outcome.environmentId };
    case "Closed":
      return { _tag: "Failure", error: "This account session has ended.", retryable: false };
    case "NotConnected": {
      const verdict = outcome.reachability;
      const text = reachabilityPhrase(verdict, { nowMs: Date.now(), mateName: "This Mate" }).text;
      const upgrade = verdict.kind === "update-required" || verdict.kind === "update-unavailable";
      return {
        _tag: "Failure",
        error: `Could not connect to this container. ${text ?? ""}`.trim(),
        retryable: !TERMINAL_CONNECT.has(verdict.kind),
        ...(upgrade
          ? {
              upgradeRequired: true,
              ...(outcome.descriptor === null
                ? {}
                : { serverVersion: outcome.descriptor.serverVersion }),
            }
          : {}),
      };
    }
  }
}

/**
 * What a Connect names: a Mate's target, when the caller knows it (a birth's harden found its
 * service), or the origin a person saw the Mate at, with the organization it was seen in.
 */
export type MateConnectTarget =
  | { readonly key: TargetKey }
  | { readonly origin: string; readonly organization: OrganizationRef | null };

/**
 * The user's Connect: a demand on the account's exchange driver, which runs the exchange,
 * installs the credential and answers with the environment — or with why it did not. A target
 * key is connected as it is: while its presence is unknown the driver waits on it and answers a
 * retryable verdict. An origin the inventory does not list yet is presence unknown too (§0A law
 * 3), never absence: the answer is retryable, and the organization named is read again.
 */
export async function connectMate(input: {
  readonly environments: AccountEnvironments | null;
  readonly candidates: ReadonlyArray<Pick<ZeropsCandidate, "key" | "containerOrigin">>;
  readonly target: MateConnectTarget;
  readonly reason: IdentityExchangeReason;
}): Promise<ZeropsIdentityExchangeResult> {
  const { target } = input;
  let key: TargetKey;
  if ("key" in target) {
    key = target.key;
  } else {
    const origin = normalizeOrigin(target.origin);
    const candidate = input.candidates.find(
      (entry) => entry.containerOrigin && normalizeOrigin(entry.containerOrigin) === origin,
    );
    if (candidate === undefined) {
      if (target.organization !== null) {
        invalidateZerops({ topic: "inventory", organization: target.organization });
      }
      return {
        _tag: "Failure",
        error: "This Mate isn't listed in your projects yet. Try again in a moment.",
        retryable: true,
      };
    }
    key = candidate.key;
  }
  if (input.environments === null) return connectResult({ _tag: "Closed" });
  return connectResult(await input.environments.connect(key, input.reason));
}

/**
 * The listed Mate of the project HQ names for an environment: its service's target, never the
 * project's own row, whose key is the project alone.
 */
export function hqNamedTarget(
  machines: ReadonlyMap<TargetKey, EnvironmentMachine>,
  projectId: string | null,
): { readonly key: TargetKey; readonly machine: EnvironmentMachine } | undefined {
  if (projectId === null) return undefined;
  for (const [key, machine] of machines) {
    if (key.startsWith(`${projectId}:`)) return { key, machine };
  }
  return undefined;
}

/**
 * The target a Mate link's verdict speaks for, as the route gate finds it: the one a machine or a
 * descriptor names for the environment, else the listed Mate of the project HQ names for it.
 */
export function tryAgainTarget(input: {
  readonly machines: ReadonlyMap<TargetKey, EnvironmentMachine>;
  readonly index: DescriptorIndex;
  readonly environmentId: EnvironmentId;
  /** The project HQ names for the environment (`hqProjectOf`); null where it names none. */
  readonly hqProject: string | null;
}): TargetKey | undefined {
  return (
    resolveEnvironment(input.machines, input.index, input.environmentId)?.key ??
    hqNamedTarget(input.machines, input.hqProject)?.key
  );
}

/**
 * A Mate link's *Try now* and *Try again*, by the environment a surface shows: the user's Connect
 * on the target its verdict speaks for (`tryAgainTarget`) — its exchange started over, or its link
 * asked again. Nothing while no target names it.
 */
export function useTryMateAgain(): (environmentId: EnvironmentId) => void {
  const environments = useAccountEnvironments();
  const atoms = useContext(RegistryContext);
  return useCallback(
    (environmentId: EnvironmentId) => {
      if (environments === null) return;
      const { machines, containers } = atoms.get(shownMateLinksAtom);
      const key = tryAgainTarget({
        machines,
        index: indexDescriptors(machines, containers),
        environmentId,
        hqProject: hqProjectOf(atoms.get(hqMatesAtom), environmentId),
      });
      if (key !== undefined) void environments.connect(key, "user");
    },
    [atoms, environments],
  );
}

/** The user's Connect as a surface asks it; `reason` names the exchange in diagnostics. */
export function useConnectMate(reason: IdentityExchangeReason) {
  const environments = useAccountEnvironments();
  const candidates = useInventoryCandidates();

  return useCallback(
    (target: MateConnectTarget): Promise<ZeropsIdentityExchangeResult> =>
      connectMate({ environments, candidates, target, reason }),
    [environments, candidates, reason],
  );
}
