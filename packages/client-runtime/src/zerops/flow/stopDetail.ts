/**
 * Every sentence a stop's page says (rule R5): its verdict, the line under its name, its service
 * rows and the quiet label over its older releases. The page draws; it never composes.
 *
 * The verdict reads the same `StopView` the menu and the projects page read, so a stop has one
 * word for its state wherever it is shown.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module flow/stopDetail
 */
import type { GroupEnvironmentTier } from "../groupEnvironments.ts";
import {
  deployedVersion,
  environmentRow,
  type EnvironmentServiceState,
  type GroupRowTone,
} from "../groupRows.ts";
import type { Shown } from "../knowledge/known.ts";
import type { ZeropsPublicRoute, ZeropsRouteOffer } from "../publicRoutes.ts";
import { releaseInFlightReason, RELEASE_NOTHING_NEW_ON_MAIN } from "../release.ts";
import {
  NOTHING_DEPLOYED,
  stopView,
  type Deployment,
  type StopService,
  type StopView,
} from "./deployment.ts";

export type StopVerdictTone = "off" | "busy" | "failed" | "ok";

/** The one sentence a stop's page opens with, its tone, and at most one verb. */
export interface StopVerdict {
  readonly tone: StopVerdictTone;
  readonly text: string;
  readonly detail: string | undefined;
  readonly verb:
    | { readonly kind: "release"; readonly tag: string }
    | { readonly kind: "run-again" }
    | null;
}

/** A deploy of the stop that failed: what it deployed, where, and what runs on instead. */
export interface StopFailure {
  readonly label: string;
  readonly service: string;
  /** What still runs on that service, when anything is known to. */
  readonly running: string | undefined;
  /** Whether the failed job is known, so it can be run again. */
  readonly jobKnown: boolean;
}

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

/** What a stop's page says first: the first state that holds, in the order a person needs them. */
export function stopVerdict(input: {
  readonly tier: GroupEnvironmentTier;
  readonly view: StopView;
  /** The tag in flight; production only. */
  readonly releasing: string | undefined;
  readonly failed: StopFailure | undefined;
  /** Changes merged to main that production does not run. */
  readonly waiting: number;
  readonly release: { readonly offered: boolean; readonly tag: string | undefined };
  /** How long ago production's release went out, already said (e.g. `2h ago`). */
  readonly releasedAge: string | undefined;
  /** Whether a stage runs main's head commit; stage only. */
  readonly atMainHead: boolean;
}): StopVerdict {
  const { tier, view } = input;
  const quiet = { detail: undefined, verb: null } as const;
  if (tier === "production" && input.releasing !== undefined)
    return { tone: "busy", text: releaseInFlightReason(input.releasing), ...quiet };
  if (view.tone === "pending") return { tone: "busy", text: view.word, ...quiet };
  if (input.failed !== undefined) {
    const { label, service, running, jobKnown } = input.failed;
    return {
      tone: "failed",
      text: `The deploy of ${label} failed on ${service}.`,
      detail: running === undefined ? undefined : `${running} still runs`,
      verb: jobKnown ? { kind: "run-again" } : null,
    };
  }
  if (view.version === undefined) {
    if (view.line !== NOTHING_DEPLOYED) return { tone: "off", text: view.line, ...quiet };
    return {
      tone: "off",
      text: `${NOTHING_DEPLOYED}.`,
      detail: tier === "stage" ? "The next merge to main deploys here." : undefined,
      verb: null,
    };
  }
  const label = view.version.label ?? view.line;
  if (tier === "stage")
    return {
      tone: "ok",
      text: input.atMainHead ? "Stage runs the head of main." : `Stage runs ${label}.`,
      ...quiet,
    };
  if (input.waiting > 0) {
    const { offered, tag } = input.release;
    return {
      tone: "busy",
      text: `${plural(input.waiting, "change", "changes")} not live.`,
      detail: `Production runs ${label}`,
      verb: offered && tag !== undefined ? { kind: "release", tag } : null,
    };
  }
  return {
    tone: "ok",
    text: RELEASE_NOTHING_NEW_ON_MAIN,
    detail: input.releasedAge === undefined ? label : `${label} · released ${input.releasedAge}`,
    verb: null,
  };
}

/**
 * The line under a stop's name: where its code comes from, and how many services run it.
 * `source` is the environment row's (`EnvironmentRow.source`): `release`, `a + b`, or `—` for none.
 */
export function stopMetaLine(input: {
  readonly tier: GroupEnvironmentTier;
  readonly source: string;
  readonly services: number;
}): string {
  const from =
    input.tier === "production"
      ? "Moves on release"
      : input.source === "" || input.source === "—"
        ? "Nothing yet"
        : `Follows ${input.source}`;
  return input.services > 0 ? `${from} · ${plural(input.services, "service", "services")}` : from;
}

/** The quiet label that shows a production's older releases. */
export function earlierReleasesLabel(count: number): string {
  return `Show ${plural(count, "earlier release", "earlier releases")}`;
}

/** One service of a stop, as its page draws it. */
export interface StopServiceRow {
  readonly hostname: string;
  /** Its repository in the group's org, from the Gitea side. */
  readonly repository: string | undefined;
  readonly sha: string | undefined;
  readonly commit: string | undefined;
  /** `deployed with <name>` when the app version names one. */
  readonly line: string | undefined;
  readonly tone: GroupRowTone;
  readonly word: string;
  /** The word, and how long it has run when the platform says. */
  readonly status: string;
  readonly routes: ReadonlyArray<ZeropsPublicRoute>;
  readonly offers: ReadonlyArray<ZeropsRouteOffer>;
}

const UNREAD: Shown<Deployment> = { state: "unread", waitingFor: null };

/**
 * The services the platform lists, and each one's deployment. A listing not read yet, failing or
 * withheld is each service's answer too: it says why the service's state is unknown, where an
 * empty listing would read as nothing running.
 */
function platformDeployments(platform: Shown<ReadonlyArray<StopService>>): {
  readonly hostnames: ReadonlyArray<string>;
  readonly of: (hostname: string) => Shown<Deployment>;
} {
  if (platform.state !== "known") return { hostnames: [], of: () => platform };
  const listed = new Map(platform.value.map((entry) => [entry.hostname, entry.deployment]));
  return { hostnames: [...listed.keys()], of: (hostname) => listed.get(hostname) ?? UNREAD };
}

/**
 * A stop's services, one row each: the union of what the group's Gitea and the platform know,
 * joined by hostname. The state is the menu's (`stopView` over that one service), so a service
 * reads the same word on the page as in the menu.
 */
export function serviceRows(input: {
  /** The environment's name in `environments.yaml`, which the statuses name. */
  readonly environment: string;
  readonly services: ReadonlyArray<EnvironmentServiceState>;
  readonly platform: Shown<ReadonlyArray<StopService>>;
  readonly routes: ReadonlyArray<ZeropsPublicRoute>;
  readonly offers: ReadonlyArray<ZeropsRouteOffer>;
  readonly nowMs: number;
  readonly age: (iso: string) => string;
}): ReadonlyArray<StopServiceRow> {
  const gitea = new Map(input.services.map((entry) => [entry.hostname, entry]));
  const platform = platformDeployments(input.platform);
  const hostnames = [...new Set([...gitea.keys(), ...platform.hostnames])].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
  return hostnames.map((hostname) => {
    const state = gitea.get(hostname);
    const deployment = platform.of(hostname);
    const version = deployedVersion(state?.appVersionName);
    // The service's own row: `stopView` reads only its version and tone, which the one service
    // and the environment's statuses decide; the row's name, tier and source go unread.
    const row =
      state === undefined
        ? undefined
        : environmentRow({
            projectId: "",
            name: input.environment,
            tier: "stage",
            sources: [],
            services: [state],
            environment: input.environment,
          });
    const { tone, word } = stopView({ deployment, row, nowMs: input.nowMs });
    const activatedAt =
      deployment.state === "known" && deployment.value.kind === "running"
        ? deployment.value.activatedAt
        : null;
    return {
      hostname,
      repository: state?.repository,
      sha: version.sha,
      commit: version.commit,
      line: version.name === undefined ? undefined : `deployed with ${version.name}`,
      tone,
      word,
      status: activatedAt === null ? word : `${word} · ${input.age(activatedAt)}`,
      routes: input.routes.filter((route) => route.service === hostname),
      offers: input.offers.filter((offer) => offer.service === hostname),
    };
  });
}

/** What a stage's deploy history says beside the commit that stage runs. */
export const RUNNING_HERE = "Running here";
