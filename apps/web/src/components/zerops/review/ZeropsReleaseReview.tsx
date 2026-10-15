import { GitDeliveryStatus, gitWhereLine } from "../GitDeliveryStatus";
/**
 * A release's review, and a roll back's (R5, R6).
 *
 * What goes out — one row per change, its Mate's face, and whether the stage that follows `main`
 * runs it — where it goes, and what to do if it goes wrong. The button names the version and the
 * foot says what the tag does. Pressed, it stays: it shows the release on its way, and ends with
 * "Released" or with the failure and the fix to hand to the person's own Mate (S6).
 *
 * Each change row opens that change's review in place (`ZeropsReleaseSteps`): the change, merged,
 * and "← Release" back to where the release was.
 *
 * A roll back is the same review, naming the version production goes back to and the new tag
 * that carries it: what leaves production and what comes back, each change by its title and its
 * Mate, as HQ compares them from what production runs (`rollbackReads`), each opening its review
 * in place with "← Roll back".
 *
 * The views take every read handed in, so the harness shows each state.
 */
import {
  cannotTellWhatRuns,
  deployedVersion,
  type GroupFlowAddress,
  servicesDeploying,
  changesCountWords,
  holdReleaseFacts,
  movedCommits,
  movedCount,
  releaseFacts,
  releaseFollows,
  releaseOutcomeOf,
  releaseReview,
  releaseStageMarks,
  releaseStep,
  releaseVersionField,
  releaseVersionSuggestions,
  reviewAge,
  rollbackReads,
  rollbackReview,
  rollbackServices,
  shortCommit,
  stageRead,
  stageStandings,
  type CompareRead,
  type ProductionRun,
  type ReleaseEntry,
  type ReleaseFacts,
  type ReleaseGate,
  type ReleaseOutcome,
  type ReleaseReplaces,
  type ReleaseVersionSuggestion,
  type ReviewPress,
} from "@t3tools/client-runtime/zerops";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import { Input } from "~/components/ui/input";

import { useAddressesSheet } from "~/zerops/addressesSheet";
import { useFixMates } from "~/zerops/fixMates";
import { useLacksOwnDomain } from "~/zerops/ownDomain";
import { useAccountOrgId } from "~/zerops/ZeropsAccountData";
import { useHqAppDetailHold } from "~/zerops/useHqAppDetail";
import { useGitTargetOperations } from "~/zerops/useGitTargetOperations";
import { useAskMateToFix, type FixProblem } from "~/zerops/fixRequest";
import { useFlowVerbs } from "~/zerops/flowVerbs";
import { useMateNames, useProjectFlows, type ZeropsProjectFlow } from "~/zerops/projectFlows";
import type { ReviewTarget } from "~/zerops/review";
import { useNowMs, useSecondsNowMs } from "~/zerops/useNowMs";
import { ZeropsReadFailure } from "../ZeropsReadFailure";
import { useReleaseComparisons, type ComparedCommits } from "~/zerops/useReleaseComparisons";
import { useZeropsReviewMates, type ZeropsReviewMate } from "~/zerops/useZeropsReviewMates";

import { ZeropsChangeReview } from "./ZeropsChangeReview";
import { useReleaseSteps, ZeropsReleaseSteps } from "./ZeropsReleaseSteps";
import { mainStageOf, useGroupName, useProductionAddresses } from "./reviewReads";
import {
  productionNow,
  releaseChangeRows,
  releaseFoot,
  releaseLine,
  reviewKindLine,
  rollbackListNote,
  sinceWords,
  whySaid,
  type ReleaseChangeRow,
  type ReleaseStageMark,
  type RollbackSide,
} from "./ZeropsReview.logic";
import {
  ReviewReleaseRows,
  ReviewSection,
  ReviewWhere,
  ZeropsReviewSurface,
  type ReviewReleaseRow,
} from "./ZeropsReviewSurface";
import { answeredDeploys } from "../ZeropsDeployAnswer";
import { jobInFlight } from "@t3tools/client-runtime/zerops/hq";
import { useDeployAnswerFollowing } from "~/zerops/activity/useDeployAnswerFollowing";

type ReleaseTarget = Extract<ReviewTarget, { readonly kind: "release" | "rollback" }>;

/** The review shows what a release would put live: it compares it while drawn. */
const COMPARED = { compare: true } as const;

export function ZeropsReleaseReview({
  target,
  titleId,
  onClose,
}: {
  readonly target: ReleaseTarget;
  readonly titleId: string;
  readonly onClose: () => void;
}) {
  // What a release lists and compares is its application's detail: held while it is drawn.
  useHqAppDetailHold([target.groupId]);
  // What production runs and what a release would put live, compared while the review is drawn.
  const { flows } = useProjectFlows(
    useMemo(() => [target.groupId], [target.groupId]),
    COMPARED,
  );
  const flow = flows.get(target.groupId);
  const name = useGroupName(target.groupId);
  const kind = target.kind === "release" ? "release" : "rollback";
  if (flow === undefined) {
    return (
      <ZeropsReviewSurface
        consequence="Nothing is tagged from here until the project is read."
        kind={kind}
        kindLabel={name ?? reviewKindLine(kind)}
        onClose={onClose}
        title={name ?? "Production"}
        titleId={titleId}
        verdict={{
          state: "releasing",
          tone: "busy",
          title: "Reading the project",
          why: "What production runs and what waits for it",
          fix: undefined,
        }}
      />
    );
  }
  return target.kind === "release" ? (
    <ChangeSteps
      back="Release"
      groupId={target.groupId}
      onClose={onClose}
      review={(onOpenChange, shownTitleId) => (
        <ReleaseData
          flow={flow}
          name={name}
          onClose={onClose}
          onOpenChange={onOpenChange}
          titleId={shownTitleId}
        />
      )}
      titleId={titleId}
    />
  ) : (
    <ChangeSteps
      back="Roll back"
      groupId={target.groupId}
      onClose={onClose}
      review={(onOpenChange, shownTitleId) => (
        <RollbackData
          flow={flow}
          name={name}
          onClose={onClose}
          onOpenChange={onOpenChange}
          tag={target.tag}
          titleId={shownTitleId}
        />
      )}
      titleId={titleId}
    />
  );
}

/**
 * A release or a roll back, and a change it lists read in place, "← {back}" its way back: the
 * title is the shown step's.
 */
function ChangeSteps({
  back,
  groupId,
  titleId,
  onClose,
  review,
}: {
  readonly back: string;
  readonly groupId: string;
  readonly titleId: string;
  readonly onClose: () => void;
  /** The release's or the roll back's review, its rows opening their change, titled while shown. */
  readonly review: (
    onOpenChange: (row: ReviewReleaseRow) => void,
    titleId: string | undefined,
  ) => ReactNode;
}) {
  const steps = useReleaseSteps();
  const onChange = steps.step.view === "change";
  return (
    <ZeropsReleaseSteps
      change={
        steps.shown === undefined ? null : (
          <ZeropsChangeReview
            back={{ label: back, onPress: steps.back }}
            onClose={onClose}
            target={{ kind: "change", groupId, ...steps.shown }}
            titleId={onChange ? titleId : undefined}
          />
        )
      }
      release={review(steps.open, onChange ? undefined : titleId)}
      steps={steps}
    />
  );
}

/** Each row with its Mate's face, and under its title whose Mate it is and when it merged. */
function reviewRowsOf(
  rows: ReadonlyArray<ReleaseChangeRow>,
  names: {
    readonly mates: ReadonlyMap<string, ZeropsReviewMate>;
    readonly mateNames: ReadonlyMap<string, string> | undefined;
    readonly now: number;
    /** A release names each change's Mate alone; a roll back says when it merged too. */
    readonly ages: boolean;
  },
): ReadonlyArray<ReviewReleaseRow> {
  return rows.map((row) => {
    const mate = row.mateProjectId === undefined ? undefined : names.mates.get(row.mateProjectId);
    const mateName =
      mate?.name ??
      (row.mateProjectId === undefined ? undefined : names.mateNames?.get(row.mateProjectId));
    const age =
      row.mergedAt === undefined || !names.ages
        ? undefined
        : reviewAge(row.mergedAt, names.now)?.toLowerCase();
    return {
      ...row,
      ...(mate === undefined ? {} : { face: { tint: mate.tint, shape: mate.shape } }),
      sub: [mateName, age === undefined ? undefined : `merged ${age}`]
        .filter((part) => part !== undefined)
        .join(" · "),
    };
  });
}

function ReleaseData({
  flow,
  name,
  titleId,
  onClose,
  onOpenChange,
}: {
  readonly flow: ZeropsProjectFlow;
  readonly name: string | undefined;
  readonly titleId: string | undefined;
  readonly onClose: () => void;
  readonly onOpenChange: (row: ReviewReleaseRow) => void;
}) {
  const verbs = useFlowVerbs();
  const mateNames = useMateNames();
  const mates = useZeropsReviewMates(flow.groupId);
  const askMateToFix = useAskMateToFix();
  const now = useNowMs();
  const [press, setPress] = useState<ReviewPress>({ kind: "idle" });
  // The version this review tags — the suggestion when it was pressed, or the one on its way.
  const [made, setMade] = useState<string | undefined>(undefined);
  // What the release is — its tag, what it replaces, what goes out and where — held from the
  // press, or from the first look at it on its way: once it lands, the reads are the state it made.
  const [held, setHeld] = useState<ReleaseFacts | undefined>(undefined);
  const [typedVersion, setTypedVersion] = useState<string | undefined>(undefined);
  const versionValue = typedVersion ?? flow.release.suggestion.slice(1);
  const versionTags = flow.releases.map((entry) => entry.tag);
  const chosen = releaseVersionField(versionValue, versionTags);
  const suggestions = releaseVersionSuggestions({
    repos: flow.repos ?? [],
    repositories: flow.release.repositories ?? new Map(),
    tags: versionTags,
  });
  const follows = releaseFollows({
    made,
    held,
    press,
    inFlight: flow.release.inFlight,
    stalled: flow.release.stalled,
    suggestion: chosen.tag ?? flow.release.suggestion,
    releases: flow.releases,
  });
  const clockMs = useSecondsNowMs(follows.ticking);

  const mainStage = mainStageOf(flow);
  const production = flow.environmentInputs.find((entry) => entry.tier === "production");
  // Production's Zerops project, where it is one: a Git destination has no addresses here.
  const productionProject =
    production?.target.kind === "zerops" ? production.target.projectId : undefined;
  const productionAddresses = useProductionAddresses(productionProject);
  // Its Where row follows HQ's deploys of it: released is said with them, never before.
  const followed = useDeployAnswerFollowing(answeredDeploys(press)).answer;
  const {
    outcome,
    held: keep,
    facts,
    productionMoved,
  } = releaseStep({
    follows,
    held,
    press,
    clockMs,
    deploying: followed?.jobs.some(jobInFlight) === true,
    read: (tag) =>
      releaseFacts({
        tag,
        live: flow.releases.find((entry) => entry.standing === "live")?.tag,
        releases: flow.releases,
        contents: flow.release.contents,
        comparison: flow.release.comparison,
        productionServices: production?.services.map((entry) => entry.hostname) ?? [],
      }),
  });
  if (keep !== held) setHeld(keep);
  // Once it is live, production on a domain of its own where it has none: read only from then.
  const orgId = useAccountOrgId();
  const offersDomain = useLacksOwnDomain(
    outcome.kind === "released" ? productionProject : undefined,
  );
  const onAddDomain =
    !offersDomain || orgId === null || productionProject === undefined
      ? undefined
      : () => {
          onClose();
          useAddressesSheet.getState().open({
            orgId,
            projectId: productionProject,
            groupId: flow.groupId,
            intent: "add-domain",
          });
        };
  // The changes are the release's; where each stands on the stage is read as it stands now, from
  // HQ's deploys, the same for everyone who sees the application.
  const stage = useMemo(
    () => (mainStage === undefined ? undefined : stageStandings(mainStage)),
    [mainStage],
  );
  // A stage on a repository's `main` head runs every change the release carries from it.
  const mainHeads = useMemo(
    () =>
      new Map(
        (flow.repos ?? []).flatMap(({ name: repository, mainHead }) =>
          mainHead === null ? [] : [[repository, mainHead] as const],
        ),
      ),
    [flow.repos],
  );
  const marks = useMemo(
    () => releaseStageMarks(facts, stage, mainHeads),
    [facts, mainHeads, stage],
  );
  const rows = reviewRowsOf(releaseChangeRows({ moved: facts.contents, marks }), {
    mates,
    mateNames,
    now,
    ages: false,
  });
  // A failed release is anybody's to fix: the person's own Mate in the project, the one they
  // used last (S6, `fixMates.ts`).
  const [fixer] = useFixMates(
    flow.release.git === undefined
      ? { projectId: production?.projectId ?? flow.groupId, groupId: flow.groupId }
      : undefined,
  );

  // A branch production releases only what HQ just found ready on its remote branch: the review
  // asks HQ to check it on opening and whenever what goes out changes, until it is pressed.
  const preflight = useGitTargetOperations(flow.groupId).actions?.preflight;
  const preflightRef = useRef(preflight);
  preflightRef.current = preflight;
  const [check, setCheck] = useState<{ readonly of: string; readonly why: string }>();
  const checked =
    flow.release.git === undefined
      ? undefined
      : flow.release.entries.map(({ service, commit }) => `${service}@${commit}`).join(" ");
  const checking = press.kind === "idle" ? checked : undefined;
  const canCheck = preflight !== undefined;
  useEffect(() => {
    if (checking === undefined || !canCheck) return;
    preflightRef.current?.().catch((error: unknown) => {
      setCheck({ of: checking, why: error instanceof Error ? error.message : String(error) });
    });
  }, [canCheck, checking]);

  const release = async () => {
    if (chosen.tag === undefined || chosen.error !== undefined) return;
    // Capture the offer in the press. HQ's stream may change it before React draws "running".
    setHeld({ ...facts, tag: chosen.tag });
    setMade(chosen.tag);
    setPress({ kind: "running" });
    const answer = await verbs.release(flow, chosen.tag);
    setPress(
      answer.ok
        ? { kind: "done", deploys: answer.deploys }
        : { kind: "refused", reason: answer.reason },
    );
    // The tag it made is the one the review follows from here.
    setMade(answer.ok ? (answer.tag ?? chosen.tag) : undefined);
  };

  return (
    <ReleaseReviewView
      git={
        flow.release.git === undefined
          ? undefined
          : {
              ...flow.release.git,
              check: check !== undefined && check.of === checked ? check.why : undefined,
            }
      }
      comparisonFailure={flow.release.comparisonFailure}
      fixer={fixer?.name}
      gate={flow.release.gate}
      production={{
        at: flow.releases.find((entry) => entry.standing === "live")?.taggedAt,
        addresses: productionAddresses,
        parts:
          production?.services.map((service) => ({
            hostname: service.hostname,
            version: deployedVersion(service.appVersionName).label,
          })) ?? [],
      }}
      stage={
        mainStage === undefined
          ? undefined
          : { name: mainStage.name, at: newestLive(mainStage.services) }
      }
      permission={flow.release.permission}
      // A stage HQ never put anything live on counts nothing: no "0 of N".
      hasStage={stage !== undefined && stageRead(stage)}
      name={name}
      now={now}
      onClose={onClose}
      onOpenChange={onOpenChange}
      onFix={(problem) => {
        if (fixer === undefined) return;
        askMateToFix(fixer.mateProjectId, problem);
        onClose();
      }}
      onAddDomain={onAddDomain}
      onRelease={() => {
        void release();
      }}
      outcome={outcome}
      press={press}
      productionMoved={productionMoved}
      replaces={facts.replaces}
      rows={rows}
      untold={flow.release.untold}
      services={facts.services}
      tag={facts.tag}
      version={{
        value: versionValue,
        onChange: setTypedVersion,
        tags: versionTags,
        suggestions,
        nextPatch: flow.release.suggestion,
      }}
      titleId={titleId}
      where={facts.where}
    />
  );
}

/** When the newest of these services' deploys went live: since when the stage runs what it runs. */
function newestLive(
  services: ReadonlyArray<{
    readonly deploy?:
      | { readonly live: { readonly at: string; readonly endedAt: string | null } | null }
      | undefined;
  }>,
): string | undefined {
  let newest: string | undefined;
  for (const service of services) {
    const live = service.deploy?.live;
    const at = live === null || live === undefined ? undefined : (live.endedAt ?? live.at);
    if (at !== undefined && (newest === undefined || Date.parse(at) > Date.parse(newest))) {
      newest = at;
    }
  }
  return newest;
}

export interface ReleaseReviewViewProps {
  readonly git?: ZeropsProjectFlow["release"]["git"];
  readonly onReplaceToken?: (() => void) | undefined;
  readonly comparisonFailure?:
    | { readonly reason: string; readonly again?: (() => void) | undefined }
    | undefined;
  /** The project's name: the title is it and the version. */
  readonly name: string | undefined;
  readonly tag: string;
  /** The person's editable name, shown only while this review offers a release. */
  readonly version?:
    | {
        readonly value: string;
        readonly onChange: (value: string) => void;
        readonly tags: ReadonlyArray<string>;
        readonly suggestions: ReadonlyArray<ReleaseVersionSuggestion>;
        readonly nextPatch: string;
      }
    | undefined;
  readonly gate: ReleaseGate;
  /** HQ's rule for this person, its refusal in words; `undefined` while it cannot be asked. */
  readonly permission: ReleaseGate | undefined;
  readonly rows: ReadonlyArray<ReviewReleaseRow>;
  /** Production's services whose commit cannot be told: what goes live on them is not said. */
  readonly untold: ReadonlyArray<string>;
  readonly where: ReadonlyArray<{ readonly service: string; readonly line: string }>;
  readonly hasStage: boolean;
  /** The stage that follows `main`: its name, and when what it runs went live. */
  readonly stage?: { readonly name: string; readonly at: string | undefined } | undefined;
  /** Production: when the release it runs was tagged, its parts, and the addresses it answers at. */
  readonly production?:
    | {
        readonly at: string | undefined;
        readonly addresses: ReadonlyArray<GroupFlowAddress>;
        readonly parts: ReadonlyArray<{
          readonly hostname: string;
          readonly version: string | undefined;
        }>;
      }
    | undefined;
  readonly services: ReadonlyArray<string>;
  /** What production ran as this one was offered. */
  readonly replaces: ReleaseReplaces;
  /** After a failure, whether production no longer runs what it replaced. */
  readonly productionMoved?: boolean | undefined;
  readonly outcome: ReleaseOutcome;
  readonly press: ReviewPress;
  /** The person's own Mate a failure is handed to, the one they used last. */
  readonly fixer: string | undefined;
  readonly now: number;
  readonly titleId?: string | undefined;
  readonly onRelease: () => void;
  /** Production on a domain of its own, offered once a release is live where it has none. */
  readonly onAddDomain?: (() => void) | undefined;
  readonly onFix: (problem: FixProblem) => void;
  /** A change row pressed: its review, in place. */
  readonly onOpenChange?: ((row: ReviewReleaseRow) => void) | undefined;
  readonly onClose: () => void;
}

export function ReleaseReviewView(props: ReleaseReviewViewProps) {
  const { rows, press, tag } = props;
  const versionId = useId();
  const version = props.outcome.kind === "offered" ? props.version : undefined;
  const checkedVersion =
    version === undefined ? undefined : releaseVersionField(version.value, version.tags);
  const model = releaseReview({
    tag,
    git: props.git,
    gate: props.gate,
    permission: props.permission,
    changes: rows.length,
    onStage: props.hasStage
      ? { total: rows.length, running: rows.filter((row) => row.stage === "on-stage").length }
      : undefined,
    services: props.services,
    replaces: props.replaces,
    outcome: props.outcome,
    productionMoved: props.productionMoved,
    now: props.now,
  });
  const answer = answeredDeploys(press);
  const answered = new Set(answer?.jobs.map(({ service }) => service));
  const fix = model.verdict.fix;
  const refused = press.kind === "refused" ? press.reason : undefined;
  // While it releases, a service it redeploys is deploying: its version names what is going, or
  // nothing yet, and is no fact to be unable to tell.
  const deploying =
    props.outcome.kind === "releasing"
      ? props.untold.filter((service) => props.services.includes(service))
      : [];
  const untold = props.untold.filter(
    (service) => !deploying.includes(service) && !answered.has(service),
  );
  const untoldDeploying = deploying.filter((service) => !answered.has(service));
  // What production runs as this one was offered: the version a roll back goes to.
  const live =
    props.replaces.kind === "release"
      ? props.replaces.tag
      : props.replaces.kind === "unnamed"
        ? "what production runs"
        : undefined;
  const ready = model.verdict.state === "release-ready";
  const now = productionNow({
    live,
    since: sinceWords(props.production?.at, props.now),
    parts: props.production?.parts ?? [],
    addresses: props.production?.addresses ?? [],
  });
  const line = releaseLine({
    changes: rows.length,
    stage: props.hasStage ? props.stage?.name : undefined,
    since: sinceWords(props.stage?.at, props.now),
    onStage: props.hasStage
      ? { total: rows.length, running: rows.filter((row) => row.stage === "on-stage").length }
      : undefined,
    live,
  });
  return (
    <ZeropsReviewSurface
      consequence={
        refused ??
        (props.git !== undefined
          ? model.consequence
          : releaseFoot({
              state: model.verdict.state,
              consequence: model.consequence,
              live: props.replaces.kind === "release" ? props.replaces.tag : undefined,
            }))
      }
      dismiss={
        props.git !== undefined ? "Cancel" : model.primary === undefined ? "Close" : "Cancel"
      }
      fix={
        fix === undefined || props.fixer === undefined
          ? undefined
          : {
              label: `Ask ${props.fixer} to ${fix.verb}`,
              onPress: () => {
                props.onFix(fix.problem);
              },
            }
      }
      kind="release"
      kindLabel={props.name ?? reviewKindLine("release")}
      // Ready, the line says all of it; else the verdict follows it.
      meta={
        props.git !== undefined ? undefined : <span>{ready ? line : line.replace(/\.$/u, "")}</span>
      }
      onClose={props.onClose}
      primary={
        model.primary === undefined ||
        (model.primary.label === "Replace token" && props.onReplaceToken === undefined)
          ? model.primary === undefined &&
            props.outcome.kind === "released" &&
            props.onAddDomain !== undefined
            ? {
                label: "Put it on your domain",
                enabled: true,
                safe: false,
                icon: "globe",
                onPress: props.onAddDomain,
              }
            : undefined
          : {
              ...model.primary,
              enabled: model.primary.enabled && checkedVersion?.error === undefined,
              busy: press.kind === "running",
              label: press.kind === "running" ? `Releasing ${tag}` : model.primary.label,
              text: `${model.primary.label} to production`,
              onPress:
                model.primary.label === "Replace token" ? props.onReplaceToken! : props.onRelease,
            }
      }
      title={`Release ${tag} to production`}
      titleId={props.titleId}
      verdict={model.verdict}
      verdictInLine={!ready}
      whySaid={whySaid(model.verdict, false)}
    >
      {props.git === undefined ? null : (
        <>
          <ReviewSection title="Where">
            {model.repositories?.map((repo) => (
              <div key={repo.repository}>
                <p className="rv-words">
                  {repo.repository} ·{" "}
                  {repo.included ? "Included" : `Left out: ${repo.reason ?? "Not ready"}`} ·{" "}
                  {repo.sha?.slice(0, 7) ?? "No commit on main"}
                </p>
                {repo.remote == null ? null : (
                  <p className="rv-note">
                    {gitWhereLine("production", props.git!.attachment.target, repo.remote.url)}
                    {repo.expiry === undefined ? null : <> · {repo.expiry}</>}
                  </p>
                )}
              </div>
            ))}
            {props.outcome.kind === "offered" ? null : (
              <GitDeliveryStatus
                environment={{ tier: "production", target: props.git.attachment.target }}
                delivery={props.git.delivery}
                showDestination={false}
              />
            )}
          </ReviewSection>
        </>
      )}
      {props.comparisonFailure === undefined ? null : (
        <ZeropsReadFailure action="Compare again" {...props.comparisonFailure} />
      )}
      {props.git !== undefined && rows.length === 0 ? null : rows.length === 0 &&
        untold.length === 0 &&
        untoldDeploying.length === 0 &&
        (answer !== undefined || props.where.length === 0) ? null : (
        <ReviewSection title="What goes out">
          {rows.length === 0 ? null : <ReviewReleaseRows onOpen={props.onOpenChange} rows={rows} />}
          {props.git !== undefined || untoldDeploying.length === 0 ? null : (
            <p className="rv-note">{servicesDeploying(untoldDeploying)}.</p>
          )}
          {props.git !== undefined || untold.length === 0 ? null : (
            <p className="rv-note">{cannotTellWhatRuns(untold)}.</p>
          )}
          {/* Which commit each service redeploys from, until HQ answers where it went. */}
          {props.git === undefined && answer === undefined
            ? props.where.map((entry) => (
                <p className="rv-note" key={entry.service}>
                  {entry.service} {entry.line}.
                </p>
              ))
            : null}
        </ReviewSection>
      )}
      {props.git !== undefined || props.replaces.kind === "first" ? null : (
        <ReviewSection title="Production now">
          <p className="rv-words">{now.line}</p>
          {now.rows.map((row) => (
            <p className="rv-note" data-zerops-production-part="" key={row}>
              {row}
            </p>
          ))}
        </ReviewSection>
      )}
      {props.git !== undefined || answer === undefined ? null : (
        <ReviewSection title="Where">
          <ReviewWhere answer={answer} rows={props.where} />
        </ReviewSection>
      )}
      {version === undefined ? null : (
        <ReviewSection title="Version">
          <div className="rv-version">
            <div className="w-44">
              <Input
                aria-label="Version"
                aria-describedby={`${versionId}-help`}
                aria-invalid={checkedVersion?.error !== undefined}
                autoComplete="off"
                disabled={press.kind === "running"}
                font="mono"
                id={versionId}
                nativeInput
                onChange={(event) => version.onChange(event.target.value)}
                spellCheck={false}
                value={version.value}
              />
            </div>
            <p className="rv-note" id={`${versionId}-help`}>
              {checkedVersion?.error ??
                `Must be newer than every release. Next patch is ${version.nextPatch}.`}
            </p>
            {version.suggestions.map((suggestion) => (
              <div className="rv-note rv-version-use" key={suggestion.source}>
                <button
                  className="rv-textbtn"
                  onClick={() => version.onChange(suggestion.tag.slice(1))}
                  type="button"
                >
                  Use {suggestion.tag}
                </button>
                <span>Declared on main in {suggestion.source}</span>
              </div>
            ))}
          </div>
        </ReviewSection>
      )}
    </ZeropsReviewSurface>
  );
}

/** A roll back's list as HQ compared it: its rows and how many move, or why that is not known. */
export type RollbackList =
  | {
      readonly state: "known";
      readonly rows: ReadonlyArray<ReviewReleaseRow>;
      readonly count: number;
      readonly atLeast: boolean;
    }
  | { readonly state: "reading" }
  | {
      readonly state: "failed";
      readonly reason: string;
      readonly again?: (() => void) | undefined;
    };

/** What a roll back takes off production and brings back, and the services nothing is told of. */
interface RollbackLists {
  readonly leaving: ComparedCommits;
  readonly comingBack: ComparedCommits;
  readonly untold: ReadonlyArray<string>;
}

const NO_ASKS: ReadonlyMap<string, ReadonlyArray<CompareRead>> = new Map();
/** What a roll back to a release not listed goes back to: nothing. */
const NO_ENTRIES: ReadonlyArray<ReleaseEntry> = [];
const COMPARING: ComparedCommits = { state: "reading" };
const LISTS_UNREAD: RollbackLists = { leaving: COMPARING, comingBack: COMPARING, untold: [] };
/** A roll back's rows are never marked by the stage: nothing it brings back is new to `main`. */
const NO_MARKS: ReadonlyMap<string, ReleaseStageMark> = new Map();

/**
 * What HQ compares a roll back to `entries` from: per service, the commits production runs that the
 * release does not, and the ones it lists that production does not run — asked once what
 * production runs and the repositories it builds from are known.
 */
function useRollbackLists(
  groupId: string,
  entries: ReadonlyArray<ReleaseEntry> | undefined,
  runs: ReadonlyMap<string, ProductionRun> | undefined,
  repositories: ReadonlyMap<string, string> | undefined,
): RollbackLists {
  const reads = useMemo(
    () =>
      entries === undefined || runs === undefined || repositories === undefined
        ? undefined
        : rollbackReads({ productionRepositories: repositories, entries, running: runs }),
    [entries, repositories, runs],
  );
  const asks = useMemo(
    () =>
      reads === undefined ? NO_ASKS : new Map([[groupId, [...reads.leaving, ...reads.comingBack]]]),
    [groupId, reads],
  );
  const compares = useReleaseComparisons(asks);
  return useMemo(() => {
    if (reads === undefined) return LISTS_UNREAD;
    const answered = compares.get(groupId);
    const listOf = (listReads: ReadonlyArray<CompareRead>): ComparedCommits =>
      answered === undefined
        ? COMPARING
        : {
            ...movedCommits({ reads: listReads, ...answered }),
            again: () => answered.again(listReads),
          };
    return {
      leaving: listOf(reads.leaving),
      comingBack: listOf(reads.comingBack),
      untold: reads.untold,
    };
  }, [compares, groupId, reads]);
}

function RollbackData({
  flow,
  name,
  tag,
  titleId,
  onClose,
  onOpenChange,
}: {
  readonly flow: ZeropsProjectFlow;
  readonly name: string | undefined;
  readonly tag: string;
  readonly titleId: string | undefined;
  readonly onClose: () => void;
  readonly onOpenChange: (row: ReviewReleaseRow) => void;
}) {
  const verbs = useFlowVerbs();
  const mateNames = useMateNames();
  const mates = useZeropsReviewMates(flow.groupId);
  const askMateToFix = useAskMateToFix();
  const now = useNowMs();
  const [press, setPress] = useState<ReviewPress>({ kind: "idle" });
  // The release the roll back made — HQ's answer, not the flow's guess — which the review follows
  // through HQ's record of it and production's deploy, as a release's.
  const [made, setMade] = useState<string | undefined>(undefined);
  // What the review offered when it was pressed: HQ's flow moves under the request (production's
  // baseline, the next version), and the review keeps saying what was approved.
  const [asked, setAsked] = useState<{ runs: typeof flow.release.runs; tag: string } | undefined>(
    undefined,
  );
  const suggestion = asked?.tag ?? flow.release.suggestion;
  const runs = asked === undefined ? flow.release.runs : asked.runs;
  const follows = releaseFollows({
    made,
    held: undefined,
    press,
    inFlight: undefined,
    stalled: flow.release.stalled,
    suggestion,
    releases: flow.releases,
  });
  const tagged = made === undefined ? undefined : follows.tagged;
  const done = press.kind === "done";
  const clockMs = useSecondsNowMs(done && follows.ticking);
  // Past the wait for it, or with a newer release above it, the roll back says how it ended.
  const outcome = releaseOutcomeOf({
    tagged,
    releasing: done,
    stalled: done && follows.stalled,
    superseded: done ? follows.superseded : undefined,
    pressing: false,
    tag: made ?? suggestion,
    clockMs,
  });
  // What production ran as it was offered, held from the press: once it lands, production runs
  // the roll back's own tag.
  const current = { tag, live: flow.releases.find((entry) => entry.standing === "live")?.tag };
  const [held, setHeld] = useState<typeof current | undefined>(undefined);
  const keep = holdReleaseFacts({ held, current, press, outcome });
  if (keep !== held) setHeld(keep);
  const earlier = flow.releases.find((entry) => entry.tag === tag);
  const { repositories } = flow.release;
  const lists = useRollbackLists(flow.groupId, earlier?.entries, runs, repositories);
  const listOf = (moved: ComparedCommits): RollbackList =>
    moved.state !== "known"
      ? moved
      : {
          state: "known",
          rows: reviewRowsOf(releaseChangeRows({ moved: moved.moved, marks: NO_MARKS }), {
            mates,
            mateNames,
            now,
            ages: true,
          }),
          ...movedCount(moved.moved),
        };
  // A roll back that hasn't landed is anybody's to look into, as a release's (S6, `fixMates.ts`).
  const production = flow.environmentInputs.find((entry) => entry.tier === "production");
  const [fixer] = useFixMates({
    projectId: production?.projectId ?? flow.groupId,
    groupId: flow.groupId,
  });
  const rollBack = async () => {
    setAsked({ runs: flow.release.runs, tag: flow.release.suggestion });
    setPress({ kind: "running" });
    const answer = await verbs.rollBack(flow, tag);
    setPress(
      answer.ok
        ? { kind: "done", deploys: answer.deploys }
        : { kind: "refused", reason: answer.reason },
    );
    if (answer.ok) setMade(answer.tag);
    else setAsked(undefined);
  };
  return (
    <RollbackReviewView
      comingBack={listOf(lists.comingBack)}
      fixer={fixer?.name}
      leaving={listOf(lists.leaving)}
      line={earlier?.line}
      live={(keep ?? current).live}
      // Rolling back is a release: HQ's rule for releasing decides, whatever else holds Release
      // back now.
      permission={flow.release.permission}
      name={name}
      nextTag={made ?? suggestion}
      now={now}
      onClose={onClose}
      onFix={(problem) => {
        if (fixer === undefined) return;
        askMateToFix(fixer.mateProjectId, problem);
        onClose();
      }}
      onOpenChange={onOpenChange}
      onRollBack={() => {
        void rollBack();
      }}
      outcome={outcome}
      press={press}
      services={rollbackServices({ entries: earlier?.entries ?? NO_ENTRIES, runs })}
      tag={tag}
      titleId={titleId}
      untold={lists.untold}
      where={(earlier?.entries ?? NO_ENTRIES).map((entry) => ({
        service: entry.service,
        line: `goes back to ${shortCommit(entry.commit)}`,
      }))}
    />
  );
}

export interface RollbackReviewViewProps {
  readonly name: string | undefined;
  /** The earlier release production goes back to. */
  readonly tag: string;
  /** The tag the roll back makes. */
  readonly nextTag: string;
  readonly live: string | undefined;
  /** What the earlier release lists, short: `app 3fa9c21 · api 3fa9c21`. */
  readonly line: string | undefined;
  readonly services: ReadonlyArray<string>;
  readonly where: ReadonlyArray<{ readonly service: string; readonly line: string }>;
  /** What production runs that the release does not: it leaves production. */
  readonly leaving: RollbackList;
  /** What the release lists that production does not run: it comes back. */
  readonly comingBack: RollbackList;
  /** Production's services whose commit cannot be told: what moves on them is not said. */
  readonly untold: ReadonlyArray<string>;
  /** A change row pressed: its review, in place. */
  readonly onOpenChange?: ((row: ReviewReleaseRow) => void) | undefined;
  /** HQ's rule for this person, its refusal in words; `undefined` while it cannot be asked. */
  readonly permission: ReleaseGate | undefined;
  readonly press: ReviewPress;
  /** The person's own Mate a roll back that hasn't landed is handed to, the one they used last. */
  readonly fixer?: string | undefined;
  readonly onFix?: ((problem: FixProblem) => void) | undefined;
  /** Where the tag it made stands, once it was made. */
  readonly outcome: ReleaseOutcome;
  readonly now: number;
  readonly titleId?: string | undefined;
  readonly onRollBack: () => void;
  readonly onClose: () => void;
}

/** One of a roll back's lists: its changes and how many, or what is said in their place. */
function RollbackListSection({
  title,
  side,
  list,
  onOpen,
  children,
}: {
  readonly title: string;
  readonly side: RollbackSide;
  readonly list: RollbackList;
  readonly onOpen: ((row: ReviewReleaseRow) => void) | undefined;
  readonly children?: ReactNode;
}) {
  const listed = list.state === "known" && list.rows.length > 0;
  return (
    <ReviewSection
      aside={listed ? changesCountWords(list.count, list.atLeast) : undefined}
      title={title}
    >
      {listed ? (
        <ReviewReleaseRows onOpen={onOpen} rows={list.rows} />
      ) : list.state === "failed" && list.again !== undefined ? (
        <ZeropsReadFailure
          action="Compare again"
          reason={rollbackListNote(side, list)}
          again={list.again}
        />
      ) : (
        <p className="rv-note">{rollbackListNote(side, list)}</p>
      )}
      {children}
    </ReviewSection>
  );
}

export function RollbackReviewView(props: RollbackReviewViewProps) {
  const { press, tag } = props;
  const model = rollbackReview({
    comparisons: { leaving: props.leaving.state, comingBack: props.comingBack.state },
    tag,
    nextTag: props.nextTag,
    live: props.live,
    services: props.services,
    permission: props.permission,
    press,
    outcome: props.outcome,
    now: props.now,
  });
  const fix = model.verdict.fix;
  const onFix = props.onFix;
  const answer = answeredDeploys(press);
  const answered = new Set(answer?.jobs.map(({ service }) => service));
  const untold = props.untold.filter((service) => !answered.has(service));
  return (
    <ZeropsReviewSurface
      consequence={model.consequence}
      dismiss={model.primary === undefined ? "Close" : "Cancel"}
      fix={
        fix === undefined || props.fixer === undefined || onFix === undefined
          ? undefined
          : {
              label: `Ask ${props.fixer} to ${fix.verb}`,
              onPress: () => {
                onFix(fix.problem);
              },
            }
      }
      kind="rollback"
      kindLabel={props.name ?? reviewKindLine("rollback")}
      meta={
        <>
          {model.meta === undefined ? null : <span>{model.meta}</span>}
          {props.line === undefined ? null : (
            <>
              {model.meta === undefined ? null : <span aria-hidden="true">·</span>}
              <span>{props.line}</span>
            </>
          )}
        </>
      }
      onClose={props.onClose}
      primary={
        model.primary === undefined
          ? undefined
          : {
              ...model.primary,
              icon: "rollback",
              busy: press.kind === "running",
              label: press.kind === "running" ? `Rolling back to ${tag}` : model.primary.label,
              onPress: props.onRollBack,
            }
      }
      title={`Roll back to ${tag}`}
      titleId={props.titleId}
      verdict={model.verdict}
    >
      <RollbackListSection
        list={props.leaving}
        onOpen={props.onOpenChange}
        side="leaving"
        title="Leaves production"
      >
        {untold.length === 0 ? null : <p className="rv-note">{cannotTellWhatRuns(untold)}.</p>}
      </RollbackListSection>
      <RollbackListSection
        list={props.comingBack}
        onOpen={props.onOpenChange}
        side="coming-back"
        title="Comes back"
      />
      {props.where.length === 0 && answer === undefined ? null : (
        <ReviewSection title="Where">
          <ReviewWhere answer={answer} rows={props.where} />
        </ReviewSection>
      )}
    </ZeropsReviewSurface>
  );
}
