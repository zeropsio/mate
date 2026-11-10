/**
 * What a release's sheet says beside its title: the line under it, the steps HQ runs in
 * production, in its order, and the foot's note. The same steps are the plan before the press and
 * the progress after it: a creation follows HQ's creation of it (or the person's own, run early
 * from its step), a deploy follows its service's job, and the last turns when production runs the
 * release.
 *
 * Pure: no DOM, no clock.
 */
import {
  formatRunClock,
  RELEASE_ESTIMATE_MS,
  type ReleaseCreation,
  type ReleaseOutcome,
  type ReleaseReplaces,
  type ReviewVerdict,
} from "@t3tools/client-runtime/zerops";
import {
  deployKeyTrouble,
  type DeployKeyTrouble,
  type HqJob,
} from "@t3tools/client-runtime/zerops/hq";
import type { ReleaseServicePlan } from "@t3tools/shared/hqRelease";

import { namesWords } from "../../ask/ask.logic";
import { plannedServiceWords, type ServiceCreateRun } from "../proposal/productionAsk.logic";
import { sinceWords } from "./ZeropsReview.logic";

/** Words with the names in them — a service, a version — set apart as code. */
export type Words = ReadonlyArray<string | { readonly code: string }>;

const code = (text: string) => ({ code: text });

export function wordsText(words: Words): string {
  return words.map((word) => (typeof word === "string" ? word : word.code)).join("");
}

const VERSION = /(v\d+\.\d+\.\d+[\w.+-]*)/u;

/** A sentence with the versions in it set apart: "Release v0.1.6" → "Release ", `v0.1.6`. */
export function wordsNaming(sentence: string): Words {
  return sentence
    .split(VERSION)
    .filter((part) => part !== "")
    .map((part) => (VERSION.test(part) ? code(part.replace(/\.$/u, "")) : part));
}

/** A service HQ's plan creates: its settings, and HQ's words for its cost. */
export type ReleaseCreateOperation = Extract<
  ReleaseServicePlan["operations"][number],
  { kind: "create" }
>;
type CreateOperation = ReleaseCreateOperation;

/** The services a plan creates, in HQ's order. */
export function planCreations(
  plan: ReleaseServicePlan | undefined,
): ReadonlyArray<CreateOperation> {
  return plan === undefined
    ? []
    : plan.operations.flatMap((operation) => (operation.kind === "create" ? [operation] : []));
}

/** The services a plan deploys to, in HQ's order. */
function planDeploys(plan: ReleaseServicePlan | undefined): ReadonlyArray<string> {
  return plan === undefined
    ? []
    : plan.operations.flatMap((operation) =>
        operation.kind === "deploy" ? [operation.service] : [],
      );
}

/**
 * The one press: "Release v0.1.6", and where the plan creates services, that too — HQ creates
 * them itself when the release is approved, so one press does both.
 */
export function releasePressLabel(tag: string, creates: ReadonlyArray<string>): string {
  if (creates.length === 0) return `Release ${tag}`;
  const what = creates.length === 1 ? creates[0]! : `${String(creates.length)} services`;
  return `Create ${what} and release ${tag.replace(/^Release /u, "")}`;
}

/** What a service the plan creates is, without its category: "PostgreSQL 18, highly available". */
function createdWords(settings: Readonly<Record<string, unknown>>): string | undefined {
  const words = plannedServiceWords(settings);
  if (words === null) return undefined;
  const at = words.indexOf(" · ");
  return at === -1 ? words : words.slice(at + 3);
}

/** One production service's deploy of the release, as HQ's job of it stands. */
export interface ReleaseDeployProgress {
  readonly service: string;
  readonly state: HqJob["state"];
  /** HQ's words for how it ended: the platform's message, or HQ's refusal. */
  readonly reason: string | undefined;
  /** When HQ began it; `undefined` for one only the press's answer has said so far. */
  readonly at: string | undefined;
  readonly endedAt: string | null;
}

/** What HQ does in production for the release, as its jobs there stand. */
export interface ReleaseProgress {
  readonly creation: ReleaseCreation | undefined;
  readonly deploys: ReadonlyArray<ReleaseDeployProgress>;
}

export type ReleaseStepMark = "pending" | "busy" | "done" | "failed" | "attention";

export interface ReleaseSheetStep {
  readonly key: string;
  readonly kind: "create" | "deploy" | "live";
  readonly service: string | undefined;
  readonly mark: ReleaseStepMark;
  readonly title: Words;
  readonly line: Words;
  readonly tone: "quiet" | "busy" | "failed" | "attention";
  /** At the right: how long a running step has run, how long a finished one took. */
  readonly aside: string | undefined;
  /** A creation's import, to show on request: what HQ's plan settles, and HQ's words for its cost. */
  readonly creates: CreateOperation | undefined;
  /**
   * The step's own press: a creation's early path, its retry after Zerops failed it, or the
   * renewal of production's deploy key where that is what stopped it.
   */
  readonly action: "create-now" | "create-again" | "renew-key" | undefined;
  /** What stopped it is production's deploy key, which HQ will not use (`deployKeyTrouble`). */
  readonly deployKey?: DeployKeyTrouble | undefined;
}

/** The renewal of production's deploy key this sheet runs, as its operation says it stands. */
export type KeyRenewal =
  | { readonly kind: "none" | "working" | "renewed" }
  | { readonly kind: "failed"; readonly words: string };

export interface ReleaseSheetStepsInput {
  readonly tag: string;
  readonly outcome: ReleaseOutcome;
  /** Pressed, HQ not answered yet. */
  readonly pressing: boolean;
  /** HQ's plan: reviewed, or held from the press. */
  readonly plan: ReleaseServicePlan | undefined;
  /** What the early path created here before the plan was read again without it. */
  readonly created: ReadonlyArray<CreateOperation>;
  /** The early path's run, as its operation says it stands. */
  readonly early: ServiceCreateRun;
  /** Whether the early path may be pressed: the person may release, and production is known. */
  readonly canCreate: boolean;
  /** The services that redeploy, where no plan lists them. */
  readonly services: ReadonlyArray<string>;
  /** Production's services the release does not deploy to. */
  readonly untouched: ReadonlyArray<string>;
  /** What each production service runs now, as a person names it. */
  readonly versions: ReadonlyMap<string, string>;
  readonly replaces: ReleaseReplaces;
  /** Where production answers, without its scheme. */
  readonly host: string | undefined;
  readonly progress: ReleaseProgress | undefined;
  /** The stalled or superseded release's own words (`releaseReview`), on the step it stopped at. */
  readonly stopped: string | undefined;
  /** Production as HQ names it: its sentences lead with the name, and the sheet says Production. */
  readonly environmentName?: string | undefined;
  /** The key's renewal run from the sheet; none where it runs none. */
  readonly renewal?: KeyRenewal | undefined;
  /** False where the viewer has no admin access to production's project: the key is not theirs to renew. */
  readonly mayRenew?: boolean | undefined;
  readonly nowMs: number;
}

/**
 * HQ's words for the production under review, saying Production where HQ leads a sentence with its
 * own name for the environment ("acme-production's deploy token…"): the person knows it as
 * Production. Told by the environment's own name, at a sentence's start, never by its shape.
 */
export function inProductionWords(words: string, environmentName: string | undefined): string {
  if (environmentName === undefined || environmentName === "") return words;
  let said = "";
  let from = 0;
  for (;;) {
    const at = words.indexOf(environmentName, from);
    if (at === -1) return said + words.slice(from);
    const after = words.slice(at + environmentName.length);
    const leads =
      at === 0 || words.slice(0, at).endsWith(": ") || words.slice(0, at).endsWith("; ");
    const named = leads && (after.startsWith("'s ") || after.startsWith(" "));
    said += words.slice(from, at) + (named ? "Production" : environmentName);
    from = at + environmentName.length;
  }
}

/** HQ's words for what stopped the release in production, as its jobs say them; none where none. */
export function releaseStopReason(progress: ReleaseProgress | undefined): string | undefined {
  if (progress === undefined) return undefined;
  if (progress.creation?.state === "failed") return progress.creation.reason;
  return progress.deploys.find((job) => job.state === "failed" || job.state === "refused")?.reason;
}

/**
 * HQ's note on what it asked for at the press, as the sheet says it: where it repeats the reason
 * already standing on the step that stopped ("HQ could not stop mail: <the same sentence>"), the
 * sentence is said once, there, and the note says "for the same reason".
 */
export function releaseNoteSaid(input: {
  readonly note: string | undefined;
  /** HQ's reason on the step that stopped (`releaseStopReason`). */
  readonly stopped: string | undefined;
  readonly environmentName: string | undefined;
}): string | undefined {
  if (input.note === undefined) return undefined;
  const same = input.stopped?.replace(/\.$/u, "").trim();
  const once =
    same === undefined || same === ""
      ? input.note
      : input.note.split(`: ${same}`).join(" for the same reason");
  const left = once === same || once === `${same ?? ""}.` ? "" : once;
  return left.trim() === "" ? undefined : inProductionWords(left, input.environmentName);
}

/** Why HQ will not use production's deploy key, in the person's words. */
const KEY_WORDS: Record<DeployKeyTrouble, string> = {
  missing: "It has none yet.",
  dead: "It no longer answers.",
  widened: "It reaches more than this project, so HQ won't use it.",
};

const elapsed = (from: string | undefined, to: number): string | undefined => {
  const since = from === undefined ? Number.NaN : Date.parse(from);
  return Number.isNaN(since) ? undefined : formatRunClock(to - since);
};

const took = (job: { readonly at: string | undefined; readonly endedAt: string | null }) =>
  job.endedAt === null ? undefined : elapsed(job.at, Date.parse(job.endedAt));

const NOT_STARTED: Words = ["Not started"];

/**
 * The steps, in HQ's order: a creation per service production lacks, a deploy per service the
 * release puts something on, and production answering with it.
 */
export function releaseSheetSteps(input: ReleaseSheetStepsInput): ReadonlyArray<ReleaseSheetStep> {
  const { tag, outcome, progress } = input;
  const offered = outcome.kind === "offered";
  const released = outcome.kind === "released";
  const running = outcome.kind === "releasing";
  const planned = planCreations(input.plan);
  // HQ's creation names its services where no plan is held: a sheet opened on a release on its way.
  const creations: ReadonlyArray<{ readonly service: string; readonly op?: CreateOperation }> = [
    ...input.created.map((op) => ({ service: op.service, op })),
    ...(planned.length > 0
      ? planned
          .filter((op) => !input.created.some((made) => made.service === op.service))
          .map((op) => ({ service: op.service, op }))
      : offered || progress?.creation?.services === undefined
        ? []
        : progress.creation.services.map((service) => ({ service }))),
  ];
  const plannedDeploys = planDeploys(input.plan);
  const deploys = plannedDeploys.length > 0 ? plannedDeploys : input.services;
  // HQ deploys only once what the release creates stands, so a deploy it runs proves the creation
  // where no row of it has come yet. One queued, refused or left because the service already runs
  // the commit (live, with HQ's remark) proves nothing: the creation is still under way.
  const proved =
    progress !== undefined &&
    progress.deploys.some(
      (job) =>
        job.state === "submitting" ||
        job.state === "building" ||
        (job.state === "live" && job.reason === undefined),
    );
  const said = (words: string) =>
    inProductionWords(words, input.environmentName).replace(/\.$/u, "");
  const renewal = input.renewal ?? NOT_RENEWING;
  // Stopped on production's deploy key: Zerops was never asked, and asking again changes nothing.
  const keyStep = (
    base: Pick<ReleaseSheetStep, "key" | "kind" | "service">,
    trouble: DeployKeyTrouble,
  ): ReleaseSheetStep => ({
    ...base,
    mark: "failed",
    title: ["HQ can't use production's deploy key"],
    line: [
      renewal.kind === "failed"
        ? said(renewal.words)
        : `${KEY_WORDS[trouble]} ${
            input.mayRenew === false
              ? "Someone with admin access to production's project in Zerops renews it."
              : "Renewing makes a new one for this project only."
          }`,
    ],
    tone: renewal.kind === "failed" ? "failed" : "quiet",
    aside: undefined,
    creates: undefined,
    action: input.mayRenew === false ? undefined : "renew-key",
    deployKey: trouble,
  });
  const late =
    running && outcome.clock?.endsWith("taking longer than usual") === true
      ? " · taking longer than usual"
      : "";

  const steps: Array<ReleaseSheetStep> = [];
  for (const { service, op } of creations) {
    const what = op === undefined ? undefined : createdWords(op.settings);
    const base = { key: `create ${service}`, kind: "create" as const, service, creates: op };
    const done = (aside?: string): ReleaseSheetStep => ({
      ...base,
      mark: "done",
      title: ["Created ", code(service)],
      line: [what === undefined ? "Running" : `${what} · running`],
      tone: "quiet",
      aside,
      creates: undefined,
      action: undefined,
    });
    const failed = (words: string | undefined, after: string | undefined): ReleaseSheetStep => ({
      ...base,
      mark: "failed",
      title: ["Zerops could not create ", code(service)],
      line: [
        [
          words === undefined ? "Zerops gave no reason" : said(words),
          ...(after === undefined ? [] : [`after ${after}`]),
        ].join(" · "),
      ],
      tone: "failed",
      aside: undefined,
      action: op !== undefined && input.canCreate ? "create-again" : undefined,
    });
    const creating = (aside: string | undefined): ReleaseSheetStep => ({
      ...base,
      mark: "busy",
      title: ["Creating ", code(service), "…"],
      line: [what ?? "A new service"],
      tone: "quiet",
      aside,
      creates: undefined,
      action: undefined,
    });
    if (input.created.some((made) => made.service === service) || released) {
      steps.push(done(progress?.creation === undefined ? undefined : took(progress.creation)));
      continue;
    }
    // The person's own create, run from the step: before the press, or again after HQ's failed.
    if (input.early.kind === "working") {
      steps.push(
        creating(
          input.early.sinceMs === undefined
            ? undefined
            : formatRunClock(input.nowMs - input.early.sinceMs),
        ),
      );
      continue;
    }
    if (input.early.kind === "failed") {
      steps.push(failed(earlyFailureWords(input.early.words, service), undefined));
      continue;
    }
    if (offered) {
      steps.push({
        ...base,
        mark: "pending",
        title: ["Create ", code(service)],
        line: [[what ?? "A new service", "billed by Zerops"].join(" · ")],
        tone: "quiet",
        aside: undefined,
        action: input.canCreate ? "create-now" : undefined,
      });
      continue;
    }
    const creation = progress?.creation;
    const trouble = creation?.state === "failed" ? deployKeyTrouble(creation.reason) : undefined;
    if (trouble !== undefined) {
      steps.push(keyStep(base, trouble));
    } else if (creation?.state === "failed") {
      steps.push(failed(creation.reason, took(creation)));
    } else if (creation?.state === "created" || (creation === undefined && proved)) {
      steps.push(done(creation === undefined ? undefined : took(creation)));
    } else {
      steps.push(creating(creation === undefined ? undefined : elapsed(creation.at, input.nowMs)));
    }
  }

  // While what the release creates does not stand, no deploy of it has started: a job HQ ended
  // for that alone ("the creation did not resolve") is the creation's failure, said once, there.
  const uncreated = !offered && steps.some((step) => step.mark !== "done");
  const untouched =
    input.untouched.length === 0
      ? ""
      : ` · ${namesWords(input.untouched)} ${input.untouched.length === 1 ? "is" : "are"} not touched`;
  deploys.forEach((service, index) => {
    const before = input.versions.get(service);
    const goes: Words =
      before === undefined || before === tag
        ? ["Gets ", code(tag)]
        : [code(before), " → ", code(tag)];
    const moves: Words =
      index === deploys.length - 1 && untouched !== "" ? [...goes, untouched] : goes;
    const base = {
      key: `deploy ${service}`,
      kind: "deploy" as const,
      service,
      creates: undefined,
      action: undefined,
    };
    const job = uncreated
      ? undefined
      : progress?.deploys.find((entry) => entry.service === service);
    const trouble =
      job !== undefined && (job.state === "failed" || job.state === "refused")
        ? deployKeyTrouble(job.reason)
        : undefined;
    if (trouble !== undefined) {
      steps.push(keyStep(base, trouble));
      return;
    }
    if (released || job?.state === "live") {
      steps.push({
        ...base,
        mark: "done",
        title: ["Deployed ", code(service)],
        line: goes,
        tone: "quiet",
        aside: job === undefined ? undefined : took(job),
      });
      return;
    }
    if (offered || job === undefined || job.state === "queued") {
      steps.push({
        ...base,
        mark: "pending",
        title: ["Deploy ", code(service)],
        line: job?.state === "queued" ? ["Queued"] : moves,
        tone: "quiet",
        aside: undefined,
      });
      return;
    }
    switch (job.state) {
      case "submitting":
      case "building":
        steps.push({
          ...base,
          mark: "busy",
          title: ["Deploying ", code(service)],
          line: [`${job.state === "building" ? "Building…" : "Starting the build…"}${late}`],
          tone: "busy",
          aside: elapsed(job.at, input.nowMs),
        });
        return;
      case "failed":
      case "refused":
        steps.push({
          ...base,
          mark: "failed",
          title:
            job.state === "failed"
              ? ["The deploy of ", code(service), " failed"]
              : ["HQ refused the deploy of ", code(service)],
          line: [
            [
              job.reason === undefined ? "The platform gave no reason" : said(job.reason),
              ...(took(job) === undefined ? [] : [`after ${took(job)!}`]),
            ].join(" · "),
          ],
          tone: "failed",
          aside: undefined,
        });
        return;
      default:
        // Skipped, replaced, or one HQ could not follow to its end: HQ's words where it has some.
        steps.push({
          ...base,
          mark: job.state === "unresolved" ? "attention" : "pending",
          title: ["Deploy ", code(service)],
          line: [
            job.reason === undefined
              ? job.state === "unresolved"
                ? "HQ couldn't confirm how the deploy ended"
                : "Not started"
              : said(job.reason),
          ],
          tone: job.state === "unresolved" ? "attention" : "quiet",
          aside: undefined,
        });
    }
  });

  const back: Words =
    input.replaces.kind === "release"
      ? ["You can roll back to ", code(input.replaces.tag), " from production's page"]
      : input.replaces.kind === "first"
        ? ["The first release"]
        : ["You can roll back from production's page"];
  steps.push({
    key: "live",
    kind: "live",
    service: undefined,
    mark: released ? "done" : "pending",
    title: [input.host === undefined ? "Live in production" : `Live at ${input.host}`],
    // Live, the title says it runs: the step keeps the way back.
    line:
      released || offered
        ? back
        : input.replaces.kind === "release"
          ? [code(input.replaces.tag), " serves until the new one answers"]
          : ["Waiting for production to answer"],
    tone: "quiet",
    aside: undefined,
    creates: undefined,
    action: undefined,
  });
  if (offered || released) return steps;
  return settle(steps, input);
}

/** Zerops' words for a create that failed, without the sentence the step's title already says. */
function earlyFailureWords(words: string, service: string): string {
  const said = `Zerops could not create ${service}`;
  const rest = words.startsWith(said) ? words.slice(said.length).replace(/^[:\s]+/u, "") : words;
  const trimmed = rest.replace(/\.$/u, "").trim();
  return trimmed === "" ? "Zerops gave no reason" : trimmed;
}

/**
 * Once pressed: the first step not done is the one under way, or the one it stopped at, and
 * nothing after a stopped step has started.
 */
function settle(
  steps: ReadonlyArray<ReleaseSheetStep>,
  input: ReleaseSheetStepsInput,
): ReadonlyArray<ReleaseSheetStep> {
  const { outcome } = input;
  const failedAt = steps.findIndex((step) => step.mark === "failed");
  const openAt = steps.findIndex((step) => step.mark !== "done");
  // A deploy after the stop that failed on its own keeps its own words: it did start.
  const after = (step: ReleaseSheetStep) =>
    step.mark === "done" || (step.kind === "deploy" && step.mark === "failed") ? step : idle(step);
  if (outcome.kind === "releasing") {
    if (failedAt !== -1) return steps.map((step, index) => (index > failedAt ? after(step) : step));
    return steps.map((step, index) =>
      index === openAt && step.mark === "pending" ? underWay(step) : step,
    );
  }
  // Ended without going live. A failure no job says stands on the service HQ names, else on the
  // step it stopped at; a stalled or superseded release says its own words there.
  const named =
    outcome.kind === "failed"
      ? steps.findIndex(
          (step) =>
            step.kind === "deploy" &&
            step.mark !== "done" &&
            outcome.services?.includes(step.service ?? "") === true,
        )
      : -1;
  const at = failedAt !== -1 ? failedAt : named !== -1 ? named : openAt;
  return steps.map((step, index) => {
    if (index < at || at === -1) return step;
    if (index > at) return after(step);
    if (failedAt !== -1) return step;
    if (outcome.kind === "failed") {
      // The deploy HQ names failed in the platform's words; anything else stopped in HQ's own.
      const deploy = index === named && step.service !== undefined;
      return {
        ...step,
        mark: "failed" as const,
        tone: "failed" as const,
        aside: undefined,
        title: deploy ? ["The deploy of ", code(step.service), " failed"] : step.title,
        line: [
          inProductionWords(
            outcome.error ?? (deploy ? undefined : outcome.detail) ?? "HQ recorded no reason",
            input.environmentName,
          ).replace(/\.$/u, ""),
        ],
      };
    }
    return {
      ...step,
      mark: outcome.kind === "stalled" ? ("attention" as const) : ("pending" as const),
      tone: outcome.kind === "stalled" ? ("attention" as const) : ("quiet" as const),
      aside: undefined,
      line:
        input.stopped === undefined
          ? step.line
          : wordsNaming(
              inProductionWords(input.stopped, input.environmentName).replace(/\.$/u, ""),
            ),
    };
  });
}

/** A step the release never reached: its plain title, and that it did not start. */
const idle = (step: ReleaseSheetStep): ReleaseSheetStep => ({
  ...step,
  mark: "pending",
  title:
    step.service === undefined
      ? step.title
      : [step.kind === "create" ? "Create " : "Deploy ", code(step.service)],
  tone: "quiet",
  aside: undefined,
  line: NOT_STARTED,
  action: undefined,
  deployKey: undefined,
});

const NOT_RENEWING: KeyRenewal = { kind: "none" };

/**
 * The steps once production's key is renewed from the sheet: the step it stopped at says so. The
 * release itself stays stopped — HQ runs none of it again — and a new one uses the new key.
 */
export function keyRenewedSteps(
  steps: ReadonlyArray<ReleaseSheetStep>,
): ReadonlyArray<ReleaseSheetStep> {
  return steps.map((step) =>
    step.deployKey === undefined
      ? step
      : {
          ...step,
          mark: "done" as const,
          title: ["Key renewed"],
          line: ["HQ has a new one for this project only. A new release uses it."],
          tone: "quiet" as const,
          action: undefined,
        },
  );
}

/** The step under way that no job of its own says yet: its mark turns, its words wait. */
const underWay = (step: ReleaseSheetStep): ReleaseSheetStep => ({
  ...step,
  mark: "busy",
  title:
    step.kind === "deploy" && step.service !== undefined
      ? ["Deploying ", code(step.service)]
      : step.title,
});

/** The line under the title: what is known of the release as it stands. */
export function releaseSubtitle(input: {
  readonly state: ReviewVerdict["state"];
  /** The release's own words where it stalled or a newer one followed it (`releaseReview`). */
  readonly said: string;
  /** How many changes go out; `undefined` while HQ has not said. */
  readonly changes: number | undefined;
  /** Whose Mates' changes they are, each once. */
  readonly mates: ReadonlyArray<string>;
  readonly replaces: ReleaseReplaces;
  /** When HQ made it, and who asked: "you", a person's name, or nobody known. */
  readonly startedAt: string | undefined;
  readonly startedBy: string | undefined;
  /** When production took it. */
  readonly liveAt: string | undefined;
  /** Whether any of it was deployed before it stopped. */
  readonly deployed: boolean;
  readonly nowMs: number;
}): Words {
  const ran = input.replaces.kind === "release" ? input.replaces.tag : undefined;
  switch (input.state) {
    case "releasing": {
      const ago = input.startedAt === undefined ? undefined : elapsed(input.startedAt, input.nowMs);
      const by = input.startedBy === undefined ? "" : ` by ${input.startedBy}`;
      return [
        `Started${by}${ago === undefined ? "" : ` ${ago} ago`} · you can close this, it carries on`,
      ];
    }
    case "released": {
      const since = sinceWords(input.liveAt, input.nowMs);
      const lasted =
        input.liveAt === undefined || input.startedAt === undefined
          ? undefined
          : elapsed(input.startedAt, Date.parse(input.liveAt));
      const parts = [
        ...(since === undefined ? [] : [`Since ${since}`]),
        ...(lasted === undefined ? [] : [`took ${lasted}`]),
      ];
      return parts.length === 0 ? ["Production runs it"] : [parts.join(" · ")];
    }
    case "release-failed":
      return input.deployed
        ? ["Part of it was deployed"]
        : ran === undefined
          ? ["Nothing was deployed"]
          : ["Nothing was deployed · production still runs ", code(ran)];
    case "release-stalled":
    case "release-superseded":
      return wordsNaming(input.said.replace(/\.$/u, ""));
  }
  // None is no count to lead with: what production runs says it.
  const count =
    input.changes === undefined || input.changes === 0
      ? undefined
      : `${String(input.changes)} ${input.changes === 1 ? "change" : "changes"}`;
  const from =
    count === undefined || input.mates.length === 0
      ? ""
      : input.mates.length <= 2
        ? ` from ${namesWords(input.mates)}`
        : ` from ${String(input.mates.length)} Mates`;
  const runs: Words =
    ran !== undefined
      ? ["production runs ", code(ran)]
      : input.replaces.kind === "first"
        ? ["the first release"]
        : [];
  if (count === undefined) return capital(runs);
  return runs.length === 0 ? [`${count}${from}`] : [`${count}${from} · `, ...runs];
}

function capital(words: Words): Words {
  const [first, ...rest] = words;
  return typeof first !== "string" || first === ""
    ? words
    : [`${first.charAt(0).toUpperCase()}${first.slice(1)}`, ...rest];
}

/** Where a pressed release stands, for its foot: "Step 2 of 3 · 2m 58s", "Stopped at step 1". */
export function releaseStepWords(input: {
  readonly steps: ReadonlyArray<ReleaseSheetStep>;
  readonly outcome: ReleaseOutcome;
  readonly startedAt: string | undefined;
  readonly nowMs: number;
}): { readonly note: string; readonly tone: "quiet" | "failed" | "attention" } {
  const { steps, outcome } = input;
  const open = steps.findIndex((step) => step.mark !== "done");
  const at = String(open === -1 ? steps.length : open + 1);
  switch (outcome.kind) {
    case "releasing": {
      const clock =
        input.startedAt === undefined ? undefined : elapsed(input.startedAt, input.nowMs);
      const late =
        input.startedAt !== undefined &&
        input.nowMs - Date.parse(input.startedAt) >= RELEASE_ESTIMATE_MS &&
        !steps.some((step) => step.mark === "busy" && step.tone === "busy")
          ? " · taking longer than usual"
          : "";
      return {
        note: `Step ${at} of ${String(steps.length)}${clock === undefined ? "" : ` · ${clock}`}${late}`,
        tone: "quiet",
      };
    }
    case "failed":
      return { note: `Stopped at step ${at}`, tone: "failed" };
    case "stalled":
      return { note: `Stopped at step ${at}`, tone: "attention" };
    default:
      return { note: "", tone: "quiet" };
  }
}
