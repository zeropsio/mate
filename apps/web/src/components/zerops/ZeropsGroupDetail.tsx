import { HqEnvironmentId } from "@t3tools/contracts";
import {
  type CanonicalHqNavigationRead,
  type CanonicalAppEnvironmentsRead,
} from "@t3tools/client-runtime/data";
import { Atom } from "effect/reactivity";
import { useAccountDataOptional } from "~/zerops/accountData";
import { RuntimeStopPublicAccess } from "./StopPublicAccess";
/**
 * A project group's page, and one stop's, in place of the thread.
 *
 * The left menu draws a project as a timeline of where work *is*. These are
 * the same drawing with room: the group's over *time*, a stop's around the one
 * commit it happens to be running. They mount under the chat layout and stand
 * in the frame /zerops stands in, so the menu stays put and only the pane changes —
 * "I imagine the group and the prod/stage detail to be in place of the chat"
 * (the owner, 2026-09-19).
 *
 * The flow is the application's, read while the page is drawn (`projectFlows`),
 * and history summaries use recorded domain rows. Commit comparisons are requested only after
 * the person expands a release (`useReleaseComparisons`).
 *
 * Structural only — what a row says is `projectFlow.ts`'s and
 * `groupHistory.ts`'s (rule R5).
 */
import { StopReadAgain } from "./StopReadAgain";
import {
  buildZeropsGroupTree,
  heldGroupLabel,
  projectNameInApp,
  readZeropsMembership,
  type CanonicalEnvironmentRow as EnvironmentRow,
  type GroupRowTone,
  type ZeropsGroup,
  type ZeropsProject,
  firstDeployLine,
  firstDeployTone,
  stageFirstDeploy,
  type FirstDeploy,
} from "@t3tools/client-runtime/zerops";
import { stopView, type Deployment } from "@t3tools/client-runtime/zerops/flow";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import type { ServiceStatusToneId } from "@t3tools/shared/brand";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRightIcon } from "lucide-react";
import { useCallback, useContext, useId, useMemo } from "react";

import { useZeropsCandidates } from "~/zerops/useZeropsCandidates";
import {
  useAppsEnvironments,
  useProjectFlows,
  useStopDeploymentsShown,
  type ZeropsProjectFlow,
} from "~/zerops/projectFlows";
import { useHqAppFailure } from "~/zerops/useHqAppDetail";
import { ZeropsReadFailure } from "./ZeropsReadFailure";
import { ZeropsHostedFrame } from "./landing/ZeropsHostedFrame";
import { Crumbs, PageHeader, SectionLabel, usePageTrail, type Crumb } from "./system";
import { STATUS_BADGE_TONE, VerdictPanelWaiting } from "./primitives";
import { ZeropsChangeReview } from "./review/ZeropsChangeReview";
import { HeldInventoryContext, withheldProjectNotice } from "~/zerops/inventoryContext";
import { useZeropsInventory } from "~/zerops/ZeropsInventoryProvider";
import { unreadFlowWords } from "~/zerops/hqRead.logic";
import { Loading } from "../ui/loading";
import { Badge } from "~/components/ui/badge";
import { environmentTitle, stopRowSays } from "./place/place.logic";

/** A stop's tone as a dot's. Neutral wears none: nothing has been deployed. */
const STOP_DOT_TONE: Record<GroupRowTone, ServiceStatusToneId | undefined> = {
  good: "ok",
  pending: "busy",
  bad: "failed",
  neutral: undefined,
};

/**
 * The group behind a route parameter, from the same derivation the menu names
 * it by (`buildZeropsGroupTree`).
 *
 * A page titled by its route parameter shows a raw id; a page that wants to
 * *rename* the project needs the group itself, the HQ application its name is
 * kept on.
 */
function useGroup(groupId: string): ZeropsGroup | undefined {
  const { listing } = useZeropsCandidates();
  return useMemo(
    // Order is irrelevant here — a lookup by groupId, not a listing.
    () =>
      buildZeropsGroupTree(heldCandidates(listing).rows, { order: "name" }).groups.find(
        (entry) => entry.group.groupId === groupId,
      )?.group,
    [groupId, listing],
  );
}

/**
 * What a stop says in place of its content while the grant withholds its
 * project (DESIGN §3.4), and the stops whose content may be read — what the
 * attention panel is drawn from.
 */
export function useWithheldStops(environments: ReadonlyArray<EnvironmentRow> | undefined): {
  readonly withheldNotice: (projectId: string) => string | null;
  readonly shown: ReadonlyArray<EnvironmentRow>;
} {
  const inventory = useZeropsInventory();
  const withheldNotice = useCallback(
    // A row of the project's page: a removal is its own route's to say (a rename proves one).
    (projectId: string) =>
      withheldProjectNotice(inventory, projectId, undefined, { removal: false }),
    [inventory],
  );
  const shown = useMemo(
    () =>
      environments === undefined
        ? EMPTY_STOPS
        : environments.filter(
            (environment) =>
              environment.target.kind !== "zerops" ||
              withheldNotice(environment.target.projectId) === null,
          ),
    [environments, withheldNotice],
  );
  return { withheldNotice, shown };
}

/**
 * The project's name: the listing's, else — the listing failed, lapsed, or withholds every member —
 * the name HQ places its members under; undefined only while neither knows it.
 */
export function useGroupName(groupId: string): string | undefined {
  const held = useContext(HeldInventoryContext);
  const listed = useGroup(groupId)?.name;
  return listed ?? (held === null ? undefined : heldGroupLabel(held.projects, groupId));
}

/**
 * Where each declared stage of the group that runs nothing stands on its first deploy
 * (`stageFirstDeploy`), as its cell on the projects page and the menu say it: from what the
 * platform runs, HQ's jobs of its deploys, and whether HQ is still bringing it up.
 */
export function useStageFirstDeploys(
  flow: ZeropsProjectFlow | undefined,
): (projectId: string) => FirstDeploy | undefined {
  const { listing } = useZeropsCandidates();
  const deployments = useStopDeploymentsShown();
  return (projectId) => {
    const row = flow?.environments.find(
      (entry) =>
        entry.target.kind === "zerops" &&
        entry.target.projectId === projectId &&
        entry.tier === "stage",
    );
    const candidate = heldCandidates(listing).rows.find((entry) => entry.project.id === projectId);
    return stageFirstDeploy({
      birth: row?.birth,
      projectStatus: candidate?.project.status,
      services: candidate?.services === undefined ? undefined : candidate.services.statuses,
      deployment: deployments.get(projectId),
      deploys: row?.deploys,
      keyGap: row?.keyGap ?? false,
    });
  };
}

type RuntimeStopIdentity = {
  readonly projectId: string;
  readonly environmentId?: HqEnvironmentId;
  readonly name: string;
  readonly tier: "production" | "stage";
};
export function runtimeStopsOf(
  groupId: string,
  projects: ReadonlyArray<ZeropsProject>,
  declared:
    | ReadonlyArray<
        Pick<
          import("@t3tools/client-runtime/zerops/hq").CanonicalHqEnvironment,
          "id" | "target" | "name" | "tier"
        >
      >
    | undefined,
): ReadonlyArray<RuntimeStopIdentity> {
  const stops = new Map<string, RuntimeStopIdentity>();
  for (const project of projects) {
    const membership = readZeropsMembership(project);
    if (membership.groupId !== groupId) continue;
    if (membership.role !== "prod" && membership.role !== "stage" && membership.role !== "devstage")
      continue;
    stops.set(project.id, {
      projectId: project.id,
      name: projectNameInApp(project),
      tier: membership.role === "prod" ? "production" : "stage",
    });
  }
  if (declared !== undefined)
    for (const stop of declared) {
      if (stop.target.kind !== "zerops") continue;
      stops.set(stop.target.projectId, {
        projectId: stop.target.projectId,
        environmentId: stop.id,
        name: stop.name,
        tier: stop.tier,
      });
    }
  return [...stops.values()];
}

/**
 * The Mates of a group that are also its stage (`devstage`): HQ deploys nothing to them, their
 * agent does, and they stand for the stage in the *Environments* section.
 */
export function useRuntimeStops(groupId: string): ReadonlyArray<RuntimeStopIdentity> {
  const inventory = useZeropsInventory();
  const held = useContext(HeldInventoryContext);
  const declared = useAppsEnvironments(useMemo(() => [groupId], [groupId]))[groupId]?.environments;
  return runtimeStopsOf(groupId, held?.projects ?? inventory.projects, declared);
}

/** Runtime remains readable when HQ's changes/release detail has not answered. */
export function ZeropsRuntimeStops({
  stops,
  deployments,
  onOpen,
}: {
  readonly stops: ReadonlyArray<{
    readonly projectId: string;
    readonly environmentId?: HqEnvironmentId;
    readonly name: string;
    readonly tier: "production" | "stage";
  }>;
  readonly deployments: ReadonlyMap<string, Shown<Deployment>> | undefined;
  readonly onOpen?: (projectId: string) => void;
}) {
  if (stops.length === 0) return null;
  return (
    <Section title="Environments">
      <ul className="flex flex-col gap-3">
        {stops.map((stop) => {
          const view = stopView({
            deployment: deployments?.get(stop.projectId) ?? UNREAD_DEPLOYMENT,
            row: undefined,
            nowMs: 0,
          });
          const says = stopRowSays(stop.tier, view);
          const words = (
            <>
              <span className="text-sm font-medium">{environmentTitle(stop.tier, stop.name)}</span>
              {says.version === undefined ? null : (
                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                  {says.version}
                </span>
              )}
              <Badge
                dot
                tone={
                  STATUS_BADGE_TONE[
                    says.tone === undefined ? "off" : (STOP_DOT_TONE[says.tone] ?? "off")
                  ]
                }
              >
                {says.word}
              </Badge>
            </>
          );
          return (
            <li className="flex min-w-0 flex-col gap-2" key={stop.projectId}>
              <div className="flex min-w-0 items-center gap-3">
                {onOpen === undefined ? (
                  <span className="flex min-w-0 items-center gap-3">{words}</span>
                ) : (
                  <button
                    className="flex min-w-0 items-center gap-3 text-left"
                    type="button"
                    onClick={() => onOpen(stop.environmentId ?? stop.projectId)}
                  >
                    {words}
                  </button>
                )}
                <StopReadAgain projectId={stop.projectId} />
              </div>
              <RuntimeStopPublicAccess projectId={stop.projectId} />
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
export const NO_ROUTE_ENVIRONMENTS = Atom.make<CanonicalAppEnvironmentsRead>({
  environments: undefined,
  unread: [],
});
export const NO_ROUTE_NAVIGATION = Atom.make<CanonicalHqNavigationRead>({
  structure: null,
  organization: null,
  presses: {},
  people: {},
  read: "unread",
  refusal: null,
  capped: false,
  slow: false,
  updateRequired: false,
  coreBuild: undefined,
  link: { kind: "unreachable", since: null },
  retrying: false,
});

/**
 * A change's own page: its review, at its own address (pass 17).
 *
 * The page and the dialog that opens over the conversation are one surface in two frames — the
 * same sections, in the same words, in a column the conversation's width. The page is the review:
 * nothing opens over it, and its one button is pinned in view.
 *
 * `#4` used to be a link into Gitea, which was a sign-in page for everybody. Everything a change is
 * — its description, files, conversation and commits — is read here from HQ, as the person.
 */
export function ZeropsChangeDetailPage({
  groupId,
  repository,
  number,
}: {
  readonly groupId: string;
  readonly repository: string;
  readonly number: number;
}) {
  const groupName = useGroupName(groupId);
  const trail = usePageTrail({ project: { groupId, name: groupName }, here: `#${String(number)}` });
  const titleId = useId();
  return (
    <ZeropsHostedFrame breadcrumb={<Crumbs trail={trail} />} width="column">
      <ZeropsChangeReview
        frame="page"
        onClose={STAYS}
        target={{ kind: "change", groupId, repository, number }}
        titleId={titleId}
      />
    </ZeropsHostedFrame>
  );
}

/** The page has nothing to close: what would close a dialog leaves it where it is. */
const STAYS = () => {};

/** Nobody to name, before the flow is read. */
const EMPTY_STOPS: ReadonlyArray<EnvironmentRow> = [];

/** A stop whose project the flow has no listing for: not read, never "nothing". */
export const UNREAD_DEPLOYMENT: Shown<Deployment> = { state: "unread", waitingFor: null };

/** A section with nothing in it yet, and the way to put something there. */
/** A stop's version column shares its page's runtime answer, including a failure or wait. */
export function StopLine(props: {
  readonly environment: EnvironmentRow;
  readonly groupId: string;
  readonly notice: string | null;
  readonly firstDeploy?: FirstDeploy | undefined;
}) {
  if (props.environment.target.kind === "git")
    return <GitStopLine environment={props.environment} groupId={props.groupId} />;
  return <ZeropsStopLine {...props} />;
}
function GitStopLine({
  environment,
  groupId,
}: {
  readonly environment: EnvironmentRow;
  readonly groupId: string;
}) {
  const navigate = useNavigate();
  return (
    <button
      className="py-2 text-sm font-medium"
      data-zerops-environment-id={environment.id}
      type="button"
      onClick={() => {
        void navigate({
          to: "/group/$groupId/$projectId",
          params: { groupId, projectId: environment.id },
        });
      }}
    >
      {environmentTitle(environment.tier, environment.name)}
    </button>
  );
}
function ZeropsStopLine({
  environment,
  firstDeploy,
  groupId,
  notice,
}: {
  readonly environment: EnvironmentRow;
  readonly groupId: string;
  /**
   * Said in place of the stop while the grant withholds its project: its
   * tier stays, and its name, what it runs and its page do not (DESIGN §3.4).
   */
  readonly notice: string | null;
  /** A stage that runs nothing: where its first deploy stands, said as its cell says it. */
  readonly firstDeploy?: FirstDeploy | undefined;
}) {
  const navigate = useNavigate();
  const projectId = environment.target.kind === "zerops" ? environment.target.projectId : undefined;
  const deployments = useStopDeploymentsShown(
    useMemo(() => (projectId === undefined ? [] : [projectId]), [projectId]),
  );
  // The platform's answer, said in the words its card and Sites say a place in (`stopRowSays`).
  const deployment = projectId === undefined ? undefined : deployments.get(projectId);
  const says = stopRowSays(
    environment.tier,
    stopView({ deployment: deployment ?? UNREAD_DEPLOYMENT, row: environment, nowMs: 0 }),
  );
  // Nothing known to run and a first deploy asked for: the line its cell and its page say.
  const settled = says.tone === "good" || says.tone === "pending" || says.tone === "bad";
  const firstWord = settled ? undefined : firstDeployLine(firstDeploy);
  const word = firstWord ?? says.word;
  const dotTone =
    firstWord === undefined
      ? says.tone === undefined
        ? undefined
        : (STOP_DOT_TONE[says.tone] ?? "off")
      : firstDeployTone(firstDeploy);
  const title = environmentTitle(environment.tier, environment.name);
  const open = useCallback(() => {
    void navigate({
      to: "/group/$groupId/$projectId",
      params: { groupId, projectId: environment.id },
    });
  }, [environment.id, groupId, navigate]);
  if (notice !== null) {
    return (
      <li className="flex min-w-0 items-baseline gap-3 px-2 py-2">
        <span className="shrink-0 text-sm font-medium text-foreground">
          {environmentTitle(environment.tier, environment.tier)}
        </span>
        <span className="truncate text-xs text-muted-foreground">{notice}</span>
        {projectId === undefined ? null : <StopReadAgain projectId={projectId} />}
      </li>
    );
  }
  return (
    <li>
      <button
        // Fixed tracks, not a right-ragged flex: a version and a state that
        // start at a different x on every row cannot be read down the column.
        // The state's track holds its longest word whole: the run's column said "Nothing depl…".
        className="grid w-full min-w-0 cursor-pointer grid-cols-[minmax(0,1fr)_6rem_10.5rem_1rem] items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted"
        data-zerops-environment-id={environment.id}
        onClick={open}
        type="button"
      >
        <span className="min-w-0 truncate text-sm font-medium text-foreground">{title}</span>
        <span className="truncate text-end font-mono text-xs text-muted-foreground tabular-nums">
          {says.version}
        </span>
        {/* Never a wordless dot on its own: a colour that has to be learnt is
            a colour nobody reads, and a screen reader gets nothing from it. */}
        {/* The dot carries the state; the word supports it. Unsized, it
            inherited 16px and came out larger than the name it annotates. */}
        {dotTone === undefined ? (
          <span className="text-xs text-muted-foreground">{word}</span>
        ) : (
          <span className="shrink-0 text-xs text-muted-foreground">
            <Badge dot tone={STATUS_BADGE_TONE[dotTone]}>
              {word}
            </Badge>
          </span>
        )}
        <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground/60" />
      </button>
      {/* An application of several parts: how many, and each that differs from the version. */}
      {environment.parts === undefined ? null : (
        <span className="block truncate px-2 pb-2 text-xs text-muted-foreground">
          {environment.parts}
        </span>
      )}
      {projectId === undefined ? null : <StopReadAgain projectId={projectId} />}
    </li>
  );
}

/**
 * A detail page whose flow is not read yet: `standIn`, in the box of what the page opens with, while
 * the app reads it, and its own words where nothing will (`unreadFlowWords`) — HQ is unavailable,
 * a project not here any more or not the viewer's in Zerops, or reads that failed.
 */
export function UnreadDetail({
  groupId,
  standIn,
}: {
  readonly groupId: string;
  readonly standIn: React.ReactNode;
}) {
  const flows = useProjectFlows(useMemo(() => [groupId], [groupId]));
  const orgRole = useAccountDataOptional()?.viewer?.roleCode;
  const words = unreadFlowWords({
    failure: flows.readFailure,
    groupsRead: flows.groupsRead,
    groupKnown: flows.knownGroups.has(groupId),
    orgRole,
  });
  if (words !== null) return <Note>{words}</Note>;
  return standIn;
}

/** An environment's page opens with its verdict: its panel's box stands in while it is read. */
export function StopVerdictStandIn() {
  return (
    <Loading label="This environment">
      <VerdictPanelWaiting />
    </Loading>
  );
}

/**
 * A place's page: its header (`PageHeader`: the trail above, the title with its state line beside
 * it, the page's verbs at the line's end), then its sections. The trail sits in the page, above the
 * title, so the frame draws no bar of its own.
 */
export function DetailShell({
  trail,
  title,
  titleTag,
  summary,
  actions,
  children,
}: {
  /** Where this page sits, outermost first (`usePageTrail`). */
  readonly trail: ReadonlyArray<Crumb>;
  /** Undefined while the name is not read: its line is held, with no placeholder in it. */
  readonly title: string | undefined;
  /** What kind of thing the page is about, as a pill trailing its name. */
  readonly titleTag?: React.ReactNode;
  /** Beside the title: the place's state line. */
  readonly summary?: React.ReactNode;
  /** The verbs this page carries, at the title line's end. */
  readonly actions?: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  return (
    // The overview's and the project page's width: the trail and the title stay put going between them.
    <ZeropsHostedFrame bar={false} width="full">
      {/* The frame's page gap spaces the header and every block after it, as on /zerops. */}
      <PageHeader actions={actions} summary={summary} tag={titleTag} title={title} trail={trail} />
      {children}
    </ZeropsHostedFrame>
  );
}

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-1.5">
      <SectionLabel>{title}</SectionLabel>
      {children}
    </section>
  );
}

export function Note({ children }: { readonly children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

export function ProjectReadFailures({
  recipe,
  comparison,
}: {
  readonly recipe: ReturnType<typeof useHqAppFailure>;
  readonly comparison: ZeropsProjectFlow["release"]["comparisonFailure"];
}) {
  return (
    <>
      {recipe === undefined ? null : <ZeropsReadFailure action="Read setup again" {...recipe} />}
      {comparison === undefined ? null : (
        <ZeropsReadFailure action="Compare again" {...comparison} />
      )}
    </>
  );
}
