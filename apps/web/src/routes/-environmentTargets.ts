/**
 * The route gate's input and every link into an environment (DESIGN §4.4, §4.8), read off the
 * account runtime's machine per Mate target through `selectReachability`, the one verdict: a
 * route and the links into it agree on which environments are worth opening. An environment no
 * machine names is looked up in the descriptor index, then in HQ's index of the Mates the reader
 * observes (`hqProjectAtom`, A9). The route's environment is the runtime's too: it exchanges the
 * route's target first. Cached descriptors do not start discovery reads of other projects.
 */
import { useAtomValue } from "@effect/atom-react";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { Instant } from "@t3tools/client-runtime/zerops/environments";
import {
  environmentLinkable,
  mateLink,
  resolveEnvironment,
  routeDeadlineRuns,
  routePreviewAtom,
  routeTargetPastDeadline,
  selectConversation,
  type ConversationAccess,
  type ConversationView,
  selectReachability,
  type DescriptorIndex,
  type EnvironmentMachine,
  type MateLink,
  type Reachability,
  type RouteContent,
  type RouteHqWait,
  type RoutePreview,
  type RouteTarget,
  type TargetKey,
} from "@t3tools/client-runtime/zerops/environments";
import {
  hqIndexWord,
  listedProjectAtom,
  rosterAnswered,
  shownCanonicalHqListNavigationAtom,
  type HqIndexWord,
  type ProjectValue,
} from "@t3tools/client-runtime/data";
import type { EnvironmentShellState } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";
import { useCallback, useContext, useEffect, useMemo, useReducer, useState } from "react";

import { useEnvironments } from "../state/environments";
import { environmentShell } from "../state/shell";
import { hqProjectAtom } from "../state/zerops";
import { useClientSettings } from "../hooks/useSettings";
import { useHqOutage, type hqOutage, type HqOutage } from "../zerops/hqNavigation";
import { useZeropsMate } from "../zerops/useZeropsMates";
import { STILL_READING_PATIENCE_MS } from "@t3tools/client-runtime/zerops/projections";
import {
  hqNamedTarget,
  useAccountEnvironments,
  useDescriptorIndex,
  useEnvironmentMachines,
} from "../zerops/accountEnvironments";
import { useAccountOrgId, useProjection } from "../zerops/accountData";
import { conversationAccess, InventoryContext } from "../zerops/inventoryContext";
import { useZeropsSession, type ZeropsOrganizationStatus } from "../zerops/ZeropsSessionProvider";

const NO_SHELL = Atom.make<EnvironmentShellState>({
  snapshot: Option.none(),
  status: "empty",
  error: Option.none(),
}).pipe(Atom.withLabel("route-gate:no-environment"));
const NO_PROJECT = Atom.make<string | null>(null).pipe(Atom.withLabel("route-gate:no-project"));
const ANSWERED = Atom.make(true).pipe(Atom.withLabel("route-gate:no-listing-read"));
const HQ_DUE = Atom.make<HqIndexWord>("due").pipe(Atom.withLabel("route-gate:no-hq"));
/** HQ as a route that does not wait on it reads it: answering, so nothing of it is said. */
const HQ_ANSWERING = Atom.make<Parameters<typeof hqOutage>[0]>({
  link: { kind: "live" },
  refusal: null,
  retrying: false,
  capped: false,
  slow: false,
  structure: null,
}).pipe(Atom.withLabel("route-gate:hq-answering"));
const NO_ROW = Atom.make<ProjectValue | null>(null).pipe(Atom.withLabel("route-gate:no-row"));
const NO_PREVIEW = Atom.make<RoutePreview | null>(null).pipe(
  Atom.withLabel("route-gate:no-preview"),
);

export type Machines = ReadonlyMap<TargetKey, EnvironmentMachine>;

export type RouteOrganization = "chosen" | "choosing" | "not-chosen";

/**
 * What is read of the project HQ names for the route's environment: `none` where HQ (or what
 * this account remembered of it) names none; `reading` until its reads answer whether it holds a
 * Mate; `without-mate` once they read it without one — its services, or the listing read again
 * after HQ named it, without the project; `with-mate` once a Mate is read there.
 */
export type NamedProject =
  | "none"
  | "reading"
  | "without-mate"
  | "with-mate"
  /** Only HQ can name it, and has not: what the wait says of HQ meanwhile. */
  | { readonly hq: RouteHqWait };

/**
 * `NamedProject` from the reads: the project HQ names, whether the Zerops listing's latest read
 * answered (`rosterAnswered`) and lists it, and its rows as read (`routePreviewAtom`). Absence is
 * claimed only on that evidence: a listing that answered with the project but not yet its
 * services says nothing of its Mate. An environment nothing remembers is named by HQ alone — the
 * Zerops listing never carries environments — so it is absent only once every Mate HQ places
 * named its environment, was refused or never connected (`hqIndexWord`) and none names this one.
 * Until then it waits: HQ's outage in the menu's words (`hqOutage`) — with the way back to the
 * projects once past the route's deadline — else past that deadline that HQ has not confirmed
 * it, HQ slow in the menu's sense (`scopeSlow`), else the plain opening line — never that the
 * conversation is gone. An absence the route said is not taken back while HQ still
 * names nothing: its index waiting again later is no evidence the conversation is there.
 */
export function namedProject(input: {
  readonly hqProject: string | null;
  /** Where HQ's index of the reader's Mates stands for the organization (`hqIndexWord`). */
  readonly hqIndex: HqIndexWord;
  /** What the menu says of HQ now (`hqOutage`), null while HQ answers. */
  readonly hqOutage: Pick<HqOutage, "kind" | "line" | "again"> | null;
  /** HQ's answer has been due for this route past the route's deadline for it. */
  readonly overdue: boolean;
  /** The route already said, on HQ's answer, that the environment is absent. */
  readonly absenceSaid: boolean;
  /** The organization the account shows: a project another one owns is not listed here. */
  readonly orgId: string | null;
  readonly listingAnswered: boolean;
  /** The project's own row as the account holds it, from the listing or a read ahead of it. */
  readonly row: Pick<ProjectValue, "clientId"> | null;
  readonly rows: ReadonlyArray<Pick<ZeropsCandidate, "service">> | null;
}): NamedProject {
  if (input.hqProject === null) {
    // No organization shown: no HQ answers for one, and the organization's choice speaks.
    if (input.orgId === null || input.absenceSaid || input.hqIndex === "answered") return "none";
    const outage = input.hqOutage;
    if (outage !== null && outage.kind !== "slow") {
      const { line, again } = outage;
      return { hq: { kind: "outage", line, again, overdue: input.overdue } };
    }
    if (input.overdue) return { hq: { kind: "unconfirmed" } };
    if (input.hqIndex === "slow" || outage?.kind === "slow") return { hq: { kind: "slow" } };
    return "reading";
  }
  if (input.rows !== null)
    return input.rows.some((row) => row.service !== undefined) ? "with-mate" : "without-mate";
  const listed = input.row !== null && input.row.clientId === input.orgId;
  // HQ naming a project the listing lacks has it read again (`placedRowsWanted`): until
  // that read answers, the listing's silence is not absence.
  return input.listingAnswered && !listed ? "without-mate" : "reading";
}

/**
 * The gate joins HQ, cached descriptor and installed credentials by id. An unknown route waits
 * for active-organization navigation, then offers a definite unavailable state or org picker.
 */
export function routeTarget(input: {
  readonly machines: Machines;
  readonly index: DescriptorIndex;
  readonly environmentId: EnvironmentId;
  /** The listed Mate HQ names for the environment (`hqNamedTarget`), where no machine does. */
  readonly hqNamed?: { readonly machine: EnvironmentMachine } | undefined;
  /** What is read of the project HQ names for the environment (`namedProject`). */
  readonly named: NamedProject;
  /** The inventory is read under verified access, not loading or failing. */
  readonly inventoryKnown: boolean;
  readonly organization: RouteOrganization;
  readonly content: RouteContent;
}): RouteTarget {
  const found = resolveEnvironment(input.machines, input.index, input.environmentId);
  if (found !== undefined) {
    return { kind: "resolved", reachability: found.reachability, content: input.content };
  }
  if (input.hqNamed !== undefined) {
    // As the descriptor index's own find: a machine holding another environment's credential
    // speaks for that one, and the route waits for its descriptor.
    const { machine } = input.hqNamed;
    return {
      kind: "resolved",
      reachability:
        machine.credential.kind === "held"
          ? { kind: "connecting", waitingOn: "descriptor" }
          : selectReachability(machine, input.environmentId),
      content: input.content,
    };
  }
  // A project HQ names is read through before its Mate is said to be absent: a Mate read there
  // whose machine has not taken it in yet is on its way, not missing. Without a chosen
  // organization no inventory is read at all, so its unread state is no reading on its way.
  const discovering =
    input.organization === "choosing" ||
    (input.organization === "chosen" && !input.inventoryKnown) ||
    input.named === "reading" ||
    input.named === "with-mate";
  if (discovering) return { kind: "unresolved", discovery: "pending" };
  if (typeof input.named === "object")
    return { kind: "unresolved", discovery: "hq", hq: input.named.hq };
  return {
    kind: "unresolved",
    discovery: input.organization === "not-chosen" ? "no-organization" : "settled",
  };
}

/**
 * Whether `ms` has passed since `key` began to be waited on. A wait that ends (no key) or moves
 * to another key clears its spent window, so a later wait on the same key starts afresh.
 */
function usePatienceSpent(key: string | null, ms: number): boolean {
  const [spent, setSpent] = useState<string | null>(null);
  if (spent !== null && spent !== key) setSpent(null);
  useEffect(() => {
    if (key === null) return;
    const timer = setTimeout(() => setSpent(key), ms);
    return () => clearTimeout(timer);
  }, [key, ms]);
  return key !== null && spent === key;
}

const ORGANIZATION: Record<ZeropsOrganizationStatus, RouteOrganization> = {
  selected: "chosen",
  "needs-selection": "not-chosen",
  idle: "choosing",
  loading: "choosing",
};

export interface RouteGateInputs {
  /** Null on a route that targets no environment (RG1). */
  readonly target: RouteTarget | null;
  /** The route's Zerops project, when a target names the environment. */
  readonly projectId: string | null;
  readonly mateName: string;
  readonly serviceId?: string | undefined;
}

const AUTHORIZED: ConversationAccess = { kind: "authorized" };

const tabNow = (): Instant => ({ wall: Date.now(), mono: performance.now() });

/**
 * `selectConversation` on the tab's clocks, judged again the moment its bound ends: a
 * conversation shown on a dropped link is hidden then, whatever else renders.
 */
export function useConversationView(
  access: ConversationAccess,
  machine: Pick<EnvironmentMachine, "link" | "linkLostAt"> | undefined,
): ConversationView {
  const [, judgeAgain] = useReducer((count: number) => count + 1, 0);
  const view = selectConversation({ access, machine, now: tabNow() });
  const until = view.kind === "shown" ? view.until : null;
  const untilWall = until?.wall ?? null;
  const untilMono = until?.mono ?? null;
  useEffect(() => {
    if (untilWall === null || untilMono === null) return;
    const now = tabNow();
    const timer = setTimeout(
      judgeAgain,
      Math.max(0, Math.min(untilWall - now.wall, untilMono - now.mono)),
    );
    return () => clearTimeout(timer);
  }, [untilWall, untilMono]);
  return view;
}

/**
 * What the route gate reads for the route's environment. The route is the account runtime's
 * demand from here: its target is exchanged first.
 */
export function useRouteGateInputs(environmentId: EnvironmentId | null): RouteGateInputs {
  const account = useAccountEnvironments();
  const machines = useEnvironmentMachines();
  const index = useDescriptorIndex();
  const mate = useZeropsMate(environmentId ?? EnvironmentId.make("route-gate:no-environment"));
  const inventory = useContext(InventoryContext);
  const { organizationStatus } = useZeropsSession();
  const content = useAtomValue(
    environmentId === null ? NO_SHELL : environmentShell.stateValueAtom(environmentId),
  ).status;
  const hqProject = useAtomValue(
    environmentId === null ? NO_PROJECT : hqProjectAtom(environmentId),
  );
  const hqNamed = hqNamedTarget(machines, hqProject);
  const orgId = useAccountOrgId();
  const listingAnswered = useProjection(rosterAnswered, orgId, ANSWERED);
  const row = useAtomValue(hqProject === null ? NO_ROW : listedProjectAtom(hqProject));
  const hqIndex = useProjection(hqIndexWord, orgId, HQ_DUE);
  const preview = useAtomValue(hqProject === null ? NO_PREVIEW : routePreviewAtom(hqProject));
  const routeKey = `${orgId ?? ""}/${environmentId ?? ""}`;
  // An absence said for another environment, or organization, says nothing of this one.
  const [absenceSaidFor, setAbsenceSaidFor] = useState<string | null>(null);
  if (absenceSaidFor !== null && absenceSaidFor !== routeKey) setAbsenceSaidFor(null);
  // Whether only HQ can still name the route's environment: then, and only then, the route reads
  // what the menu says of HQ. A conversation already open follows none of HQ's deltas or the clock.
  const onHq =
    environmentId !== null &&
    orgId !== null &&
    hqProject === null &&
    hqIndex !== "answered" &&
    absenceSaidFor !== routeKey &&
    hqNamed === undefined &&
    resolveEnvironment(machines, index, environmentId) === undefined;
  // What the menu says of HQ now, from the same reads and clock the menu's header says it from.
  const outage = useHqOutage(
    useAtomValue(onHq ? shownCanonicalHqListNavigationAtom : HQ_ANSWERING),
    useClientSettings((settings) => settings.timestampFormat),
    onHq,
  );
  const targetOf = (overdue: boolean) =>
    environmentId === null
      ? null
      : routeTarget({
          machines,
          index,
          environmentId,
          hqNamed,
          named: namedProject({
            hqProject,
            hqIndex,
            hqOutage: outage,
            overdue,
            absenceSaid: hqProject === null && absenceSaidFor === routeKey,
            orgId,
            listingAnswered,
            row,
            rows: preview?.rows ?? null,
          }),
          inventoryKnown: inventory !== null && !inventory.isLoading && inventory.error === null,
          organization: ORGANIZATION[organizationStatus],
          content,
        });
  // The route's one deadline, the listings' patience: it runs while, but for it, the route would
  // wait without end (`routeDeadlineRuns`) — on HQ to name its environment, on the environment to
  // be found, or on a Mate's quiet verdict over nothing to show. Past it HQ's waits say so and a
  // quiet wait ends, saying why (`routeTargetPastDeadline`). Resolving, a verdict with words,
  // saying the conversation is absent, or leaving the route ends the wait and clears its window.
  const waiting = targetOf(false);
  const overdue = usePatienceSpent(
    routeDeadlineRuns(waiting) ? routeKey : null,
    STILL_READING_PATIENCE_MS,
  );
  const pastDeadline = overdue ? targetOf(true) : null;
  const target = pastDeadline === null ? waiting : routeTargetPastDeadline(pastDeadline);
  // The absence the route says on HQ's answer, held while the route stays on this environment.
  if (
    hqProject === null &&
    target?.kind === "unresolved" &&
    target.discovery === "settled" &&
    absenceSaidFor !== routeKey
  )
    setAbsenceSaidFor(routeKey);
  useEffect(() => {
    if (account === null) return;
    account.setRoute(environmentId);
    return () => account.setRoute(null);
  }, [account, environmentId]);
  if (environmentId === null) return { target: null, projectId: null, mateName: "This Mate" };
  return {
    target,
    serviceId: (resolveEnvironment(machines, index, environmentId)?.key ?? hqNamed?.key)?.split(
      ":",
    )[1],
    projectId:
      (mate.kind === "mate" ? mate.mate.projectId : undefined) ??
      (resolveEnvironment(machines, index, environmentId)?.key ?? hqNamed?.key)?.split(":")[0] ??
      null,
    mateName: mate.kind === "mate" ? mate.mate.name : "This Mate",
  };
}

/**
 * Whether the route's conversation — a thread's, or a draft's — shows under its project's access
 * (DESIGN §9 C1b), for the environment it belongs to.
 */
export function useRouteConversation(environmentId: EnvironmentId | null): ConversationView {
  const machines = useEnvironmentMachines();
  const index = useDescriptorIndex();
  const inventory = useContext(InventoryContext);
  const found =
    environmentId === null ? undefined : resolveEnvironment(machines, index, environmentId);
  const projectId = found?.key.split(":")[0] ?? null;
  return useConversationView(
    inventory === null || projectId === null
      ? AUTHORIZED
      : conversationAccess(inventory, projectId),
    found?.machine,
  );
}

/** A Mate's row as a door names it: its key, and its project. */
export type MateRow = Pick<ZeropsCandidate, "key"> & {
  readonly project: Pick<ZeropsCandidate["project"], "id">;
};

export interface EnvironmentLinks {
  /** Whether a link into the environment is worth offering: everything but gone and replaced. */
  readonly linkable: (environmentId: EnvironmentId) => boolean;
  /** The registered environment a Mate's row opens in, when a link into it is worth offering. */
  readonly linkTarget: (row: MateRow) => EnvironmentId | undefined;
  /**
   * What a door and the Mate's own view read of it (`mateLink`): its target — found by its project
   * while its row stands for the project —, the environment its conversation opens in, and its
   * machine's verdict.
   */
  readonly mateLink: (row: MateRow) => MateLink;
}

/** The shared `environmentLinkable` rule for every producer of a link into an environment. */
export function useEnvironmentLinks(): EnvironmentLinks {
  const machines = useEnvironmentMachines();
  const index = useDescriptorIndex();
  const { environments } = useEnvironments();
  const linkable = useCallback(
    (environmentId: EnvironmentId) => {
      const found = resolveEnvironment(machines, index, environmentId);
      return found !== undefined && environmentLinkable(found.reachability);
    },
    [index, machines],
  );
  const registered = useMemo(
    () => new Set(environments.map((entry) => entry.environmentId)),
    [environments],
  );
  const linkOf = useCallback(
    (row: MateRow) =>
      mateLink({
        key: row.key,
        projectId: row.project.id,
        machines,
        index,
        registered,
      }),
    [index, machines, registered],
  );
  const linkTarget = useCallback((row: MateRow) => linkOf(row).environmentId, [linkOf]);
  return useMemo(
    () => ({ linkable, linkTarget, mateLink: linkOf }),
    [linkable, linkOf, linkTarget],
  );
}

/**
 * The link's verdict for an environment the route does not name — a draft's, whose route carries
 * only the draft — for the one voice over its conversation (`mateVoice`); null while no target
 * names it. It demands nothing: the draft's own view connects its environment.
 */
export function useEnvironmentReachability(
  environmentId: EnvironmentId | null,
): Reachability | null {
  const machines = useEnvironmentMachines();
  const index = useDescriptorIndex();
  if (environmentId === null) return null;
  return resolveEnvironment(machines, index, environmentId)?.reachability ?? null;
}
