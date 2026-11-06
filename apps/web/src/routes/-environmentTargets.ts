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
  routePreviewAtom,
  selectConversation,
  type ConversationAccess,
  type ConversationView,
  selectReachability,
  type DescriptorIndex,
  type EnvironmentMachine,
  type MateLink,
  type Reachability,
  type RouteContent,
  type RoutePreview,
  type RouteTarget,
  type TargetKey,
} from "@t3tools/client-runtime/zerops/environments";
import {
  hqIndexWord,
  listedProjectAtom,
  rosterAnswered,
  STREAM_POLICY,
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
import { useZeropsMate } from "../zerops/useZeropsMates";
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
const HQ_SILENT = Atom.make<HqIndexWord>("silent").pipe(Atom.withLabel("route-gate:no-hq"));
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
  /** Only HQ can name it, and HQ's answer is due past the first answer's patience. */
  | "hq-slow"
  /** Only HQ can name it, and HQ is refused or failing past its grace. */
  | "hq-unreachable";

/**
 * `NamedProject` from the reads: the project HQ names, whether the Zerops listing's latest read
 * answered (`rosterAnswered`) and lists it, and its rows as read (`routePreviewAtom`). Absence is
 * claimed only on that evidence: a listing that answered with the project but not yet its
 * services says nothing of its Mate. An environment nothing remembers is named by HQ alone — the
 * Zerops listing never carries environments — so it is absent only once HQ named every Mate it
 * places with its environment (`hqIndexWord`) and none with this one; until then it waits, says
 * HQ is slow past the first answer's patience, and says HQ is unavailable where it is refused or
 * failing, never that the conversation is gone.
 */
export function namedProject(input: {
  readonly hqProject: string | null;
  /** Where HQ's index of the reader's Mates stands for the organization (`hqIndexWord`). */
  readonly hqIndex: HqIndexWord;
  /** HQ's answer has been due for less than the first answer's patience. */
  readonly patient: boolean;
  /** The organization the account shows: a project another one owns is not listed here. */
  readonly orgId: string | null;
  readonly listingAnswered: boolean;
  /** The project's own row as the account holds it, from the listing or a read ahead of it. */
  readonly row: Pick<ProjectValue, "clientId"> | null;
  readonly rows: ReadonlyArray<Pick<ZeropsCandidate, "service">> | null;
}): NamedProject {
  if (input.hqProject === null) {
    // No organization shown: no HQ answers for one, and the organization's choice speaks.
    if (input.orgId === null) return "none";
    switch (input.hqIndex) {
      case "answered":
        return "none";
      case "due":
        return input.patient ? "reading" : "hq-slow";
      case "silent":
        return "hq-unreachable";
    }
  }
  if (input.rows !== null)
    return input.rows.some((row) => row.service !== undefined) ? "with-mate" : "without-mate";
  const listed = input.row !== null && input.row.clientId === input.orgId;
  // HQ naming a project the listing lacks has it read again (`zerops/account/hqView.ts`): until
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
  // whose machine has not taken it in yet is on its way, not missing.
  const discovering =
    input.organization === "choosing" ||
    !input.inventoryKnown ||
    input.named === "reading" ||
    input.named === "with-mate";
  if (discovering) return { kind: "unresolved", discovery: "pending" };
  if (input.named === "hq-slow" || input.named === "hq-unreachable")
    return { kind: "unresolved", discovery: input.named };
  return {
    kind: "unresolved",
    discovery: input.organization === "not-chosen" ? "no-organization" : "settled",
  };
}

/** Whether `ms` has passed since `key` began to be waited on; a new key (or none) starts over. */
function usePatienceSpent(key: string | null, ms: number): boolean {
  const [spent, setSpent] = useState<string | null>(null);
  useEffect(() => {
    if (key === null) return;
    const timer = window.setTimeout(() => setSpent(key), ms);
    return () => window.clearTimeout(timer);
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
  const hqIndex = useProjection(hqIndexWord, orgId, HQ_SILENT);
  // HQ's first answer gets the menu's patience before the wait for it says HQ is slow.
  const patient = !usePatienceSpent(
    environmentId !== null && hqProject === null && hqIndex === "due"
      ? `${orgId ?? ""}/${environmentId}`
      : null,
    // The menu's patience with its sources' first answers (`MENU_SOURCES_PATIENCE_MS`).
    STREAM_POLICY.reconnectGraceMs,
  );
  const preview = useAtomValue(hqProject === null ? NO_PREVIEW : routePreviewAtom(hqProject));
  const target =
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
            patient,
            orgId,
            listingAnswered,
            row,
            rows: preview?.rows ?? null,
          }),
          inventoryKnown: inventory !== null && !inventory.isLoading && inventory.error === null,
          organization: ORGANIZATION[organizationStatus],
          content,
        });
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
