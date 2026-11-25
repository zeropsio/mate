/**
 * *Set up a crew*, as a view of the Crew tab (PRD §4.7, §5.1), read top to
 * bottom: the goal, who's on it, *Start the crew*. Who's on it starts from
 * *Let Fen suggest a crew* — a proposal from the goal, made in place by the
 * Mate's own agent outside its conversation (`useCrewProposal`): the option
 * becomes a row of the Mate proposing, with Cancel, and the crew it proposes
 * fills the rows to edit — or from *Start with a lead and two builders*, or
 * *Add someone yourself*. Once drafted, a row per crewmate exactly like the
 * tab's, each opening its job. *Start the crew* makes each builder its own
 * copy of the Mate's code, and each row says how that goes, until the crew
 * stands and the view becomes the tab.
 *
 * The draft is kept until the crew starts or the person drops it: the goal
 * for this account (`useCrewSetupDraft`), the picks in the Mate's crew home
 * as each is made. Both presses wait for the goal and say so.
 *
 * The account samples the crew home while an editor demands it. A crew on a
 * login the viewer may not run does not start (D6): *Start the crew* waits,
 * saying why.
 */
import type { CrewLock } from "@t3tools/client-runtime/zerops/crew/crewAccess";
import {
  CREW_COPY_READYING,
  CREW_MENU,
  CREW_SETUP_WORDS,
  crewAskMateWord,
  crewBrokenCopyWord,
  crewJobLine,
  crewLockWords,
  crewNamingTheMate,
  crewNoDevHostWord,
  crewPortsOfferWords,
  crewProposingWord,
  crewRoleTag,
  crewSetUpFooter,
  crewSetUpTitle,
  crewStartFailedWords,
  crewSuggestLine,
  crewSuggestWord,
  crewSuggestedLine,
} from "@t3tools/client-runtime/zerops/crew/phrases";
import type { CrewDevHost, CrewHost, Crewmate, EnvironmentId } from "@t3tools/contracts";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";
import {
  CREW_BRIEF_FILE,
  CREW_HOME_FILE,
  renderCrewHome,
  withSharedDatabase,
  type CrewDefinition,
  type CrewMemberSpec,
} from "@t3tools/shared/crewHome";
import {
  crewFromProposal,
  crewFromTemplate,
  type CrewTemplateId,
} from "@t3tools/shared/crewTemplates";
import { PlusIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { withBrief } from "../../../zerops/crew/crewHome";
import { useCrewSetupDraft } from "../../../zerops/crew/crewSetupDraft";
import type { CrewFailureCause, UseCrewCommand } from "../../../zerops/crew/useCrewCommand";
import { useCrewHome } from "../../../zerops/crew/useCrewHome";
import { useCrewProposal } from "../../../zerops/crew/useCrewProposal";
import { Button } from "../../ui/button";
import { Failure, FailureDetails } from "../../ui/failure";
import { Row } from "../../ui/row";
import { MateFace } from "../primitives";
import { crewGoalFields, crewGoalMarkdown, crewGoalTitleOf } from "./CrewGoal.logic";
import { CrewChoice, CrewPress, CrewTextButton } from "./CrewParts";
import {
  crewProposalFailure,
  crewStartState,
  crewSuggestState,
  type CrewProposeWith,
} from "./CrewSetup.logic";
import { CrewIssues, CrewTextArea, CrewView, CrewViewFoot } from "./CrewView";

interface CrewSetupProps {
  readonly environmentId: EnvironmentId;
  readonly commands: UseCrewCommand;
  /** The crew stands: Start was pressed, and each row says how its copy goes. */
  readonly applied: boolean;
  /** The standing crew's crewmates, for their copies' progress. */
  readonly crewmates: ReadonlyArray<Crewmate>;
  /** The standing crew's dev services, for the offer of an address per builder. */
  readonly hosts: ReadonlyArray<CrewHost>;
  /** Where a builder's copy can live, and whether each reaches a database (a builder there shares it). */
  readonly devHosts: ReadonlyArray<CrewDevHost>;
  readonly pools: ReadonlyArray<string> | undefined;
  readonly mate: {
    readonly name: string;
    readonly tint: MateTintId | undefined;
    readonly shape?: MateShapeId | undefined;
  };
  /** Where *Let Fen suggest a crew* runs, or why it can't for this viewer. */
  readonly proposeWith: CrewProposeWith;
  readonly onClose: () => void;
  /** Opens a crewmate's job; `null` adds one. */
  readonly onEditCrewmate: (handle: string | null) => void;
  /** Reserves an address for each builder on `host`, and asks the Mate to open them. */
  readonly onAskPorts: (host: string, count: number) => void;
  /** What *Start the crew* meets for this viewer, by the crew it would start (D6). */
  readonly startLock?: (members: ReadonlyArray<CrewMemberSpec>) => CrewLock | null;
}

export function CrewSetup(props: CrewSetupProps) {
  const { commands, mate } = props;
  const home = useCrewHome(commands);
  const definition = home.definition;
  const draft = useCrewSetupDraft(props.environmentId);
  const proposal = useCrewProposal(props.environmentId);
  // The Mate proposed the rows, and nobody drafted others here since.
  const [asked, setAsked] = useState(false);
  // Why the last *Start the crew* was refused: kept until it is pressed again, the goal is
  // edited, or the draft is dropped — never on a timer.
  const [startFailure, setStartFailure] = useState<CrewFailureCause | null>(null);
  const devHosts = props.devHosts.map((host) => host.host);
  const databaseHosts = props.devHosts.flatMap((host) =>
    host.database === true ? [host.host] : [],
  );
  const goal = draft.goal ?? (definition === null ? "" : crewGoalFields(definition.brief).body);
  /**
   * Who is on the crew, as its home reads: nobody while there is no crew home
   * yet; `null` while it is read, or while it doesn't read — its issues, in
   * the footer, say why.
   */
  const members: ReadonlyArray<CrewMemberSpec> | null =
    definition !== null
      ? definition.members
      : home.issues.length > 0 && home.issues.every((issue) => issue.code === "file-missing")
        ? []
        : null;
  const drafted = members !== null && members.length > 0;
  const proposing = proposal.state.kind === "proposing";
  const busy = commands.isPending("filesPut") || commands.isPending("apply") || proposing;

  // Every copy made, the crew stands: the view becomes the tab.
  const ready =
    props.applied &&
    props.crewmates.length > 0 &&
    props.crewmates.every((row) => row.lane === null || row.lane.state === "ready");
  const { onClose } = props;
  useEffect(() => {
    if (ready) onClose();
  }, [onClose, ready]);

  /** The definition with the goal as written, titled from its first sentence while it has no title. */
  const withGoal = (base: CrewDefinition): CrewDefinition => {
    if (goal.trim() === "") return base;
    const fields = crewGoalFields(base.brief);
    const markdown = crewGoalMarkdown({
      ...fields,
      body: goal,
      title: fields.title === "" ? crewGoalTitleOf(goal) : fields.title,
    });
    return withBrief(base, markdown.title, markdown.text);
  };

  const saveAll = (next: CrewDefinition) =>
    home.save(
      next,
      renderCrewHome(next).map((file) => file.path),
    );

  const mateTint = mate.tint === undefined ? {} : { mateTint: mate.tint };
  const hostsOf = { devHosts, databaseHosts, pools: props.pools ?? [] };

  const startFrom = async (template: CrewTemplateId, then?: () => void) => {
    setAsked(false);
    const next = withGoal(crewFromTemplate({ template, crew: "crew", ...hostsOf, ...mateTint }));
    if (await saveAll(next)) then?.();
  };

  const suggest = async () => {
    if (props.proposeWith.kind !== "ready") return;
    const proposed = await proposal.propose({
      goal: goal.trim(),
      modelSelection: props.proposeWith.modelSelection,
    });
    if (proposed === null) return;
    const next = withGoal(
      crewFromProposal({ proposal: proposed, crew: "crew", ...hostsOf, ...mateTint }),
    );
    if (await saveAll(next)) setAsked(true);
  };

  const saveGoal = async () => {
    if (definition === null || draft.goal === null) return;
    await home.save(withGoal(definition), [CREW_HOME_FILE, CREW_BRIEF_FILE]);
  };

  /**
   * Saves the goal as written and each builder on a service with a database sharing it (one
   * added by hand, or whose service was read since), then applies. A refusal stays beside the
   * press until it is pressed again.
   */
  const start = async () => {
    if (definition === null) return;
    setStartFailure(null);
    const declared = withSharedDatabase(definition, databaseHosts);
    const next = draft.goal === null ? declared : withGoal(declared);
    const started =
      (next === definition || (await home.save(next, [CREW_HOME_FILE, CREW_BRIEF_FILE]))) &&
      (await commands.send({ _tag: "apply" })) !== null;
    if (started) draft.clear();
    else setStartFailure(commands.lastFailure() ?? { reason: null, detail: null });
  };

  /** Drops the draft: the goal kept here, and whoever was picked. */
  const drop = async () => {
    proposal.cancel();
    setAsked(false);
    setStartFailure(null);
    draft.clear();
    // The crew home holds the picks and the goal as last saved: it goes back to nobody, no goal.
    if (definition !== null) {
      await saveAll(crewFromTemplate({ template: "empty", crew: "crew", ...hostsOf, ...mateTint }));
    }
  };

  const startLock = members === null ? null : (props.startLock?.(members) ?? null);
  const writers = members === null ? [] : members.filter((member) => member.kind === "writer");
  const noDevHost =
    props.devHosts.length === 0 &&
    !props.pools?.length &&
    writers.some((member) => member.pool === undefined);
  // The services whose database its builders share: the footer says how many, never their names.
  const sharedDatabases = new Set(
    writers.flatMap((member) =>
      member.host === undefined ||
      member.database !== "shared" ||
      !databaseHosts.includes(member.host)
        ? []
        : [member.host],
    ),
  ).size;
  const portless = props.applied
    ? props.hosts.filter(
        (host) =>
          host.crewPorts.length === 0 &&
          props.crewmates.some((row) => row.host === host.host && row.kind === "writer"),
      )
    : [];
  const suggestPress = crewSuggestState({
    goal,
    busy: busy || props.proposeWith.kind === "reading",
    unavailable: props.proposeWith.kind === "unavailable" ? props.proposeWith.words : null,
  });
  const startPress = crewStartState({
    goal,
    drafted,
    blocked:
      busy ||
      props.applied ||
      noDevHost ||
      home.issues.some((issue) => issue.code !== "file-missing"),
    lock: startLock === null ? null : crewLockWords(startLock.ownership),
  });
  const droppable = !props.applied && (drafted || goal.trim() !== "");

  return (
    <CrewView onBack={null}>
      <div className="mt-1 flex h-7 items-center gap-2" data-crew-setup>
        <h2 className="font-semibold text-emphasis">{crewSetUpTitle(mate.name)}</h2>
        <span className="grow" />
        <Button
          aria-label={CREW_SETUP_WORDS.close}
          className="-me-1.5"
          onClick={props.onClose}
          size="icon-sm"
          variant="ghost-muted"
        >
          <XIcon aria-hidden="true" />
        </Button>
      </div>
      <p className="mt-0.5 text-line leading-4.5 text-muted-foreground">{CREW_SETUP_WORDS.line}</p>

      {/* The goal reads the same before and after a roster lands: data arriving never moves what
          the person just wrote (the onboarding run, 2026-10-16). */}
      <span className="mt-6 font-medium text-body leading-5">{CREW_SETUP_WORDS.goal}</span>
      <span className="mt-0.5 text-line leading-4.5 text-muted-foreground">
        {CREW_SETUP_WORDS.goalLine}
      </span>
      <div className="mt-2">
        <CrewTextArea
          aria-label={CREW_SETUP_WORDS.goal}
          disabled={props.applied}
          lines={4}
          onBlur={() => void saveGoal()}
          onChange={(event) => {
            // An edit answers a refused start: its words go until Start is pressed again.
            setStartFailure(null);
            draft.setGoal(event.target.value);
          }}
          placeholder={CREW_SETUP_WORDS.goalPlaceholder}
          value={goal}
        />
      </div>

      <span className="mt-7 font-medium text-body leading-5">{CREW_SETUP_WORDS.whosOnIt}</span>
      {members === null ? null : members.length === 0 ? (
        <div className="mt-2 flex flex-col gap-2" data-crew-setup-start>
          {proposal.state.kind === "proposing" ? (
            <div data-crew-proposing role="status">
              <CrewChoice
                end={
                  <CrewTextButton
                    label={CREW_SETUP_WORDS.stopProposing}
                    onPress={proposal.cancel}
                  />
                }
                lead={
                  <MateFace
                    shape={mate.shape}
                    size={24}
                    state="working"
                    tint={mate.tint ?? "amber"}
                  />
                }
                title={crewProposingWord(mate.name)}
              />
            </div>
          ) : proposal.state.kind === "failed" ? (
            <Failure
              action={
                suggestPress.disabled ? undefined : (
                  <CrewTextButton
                    label={CREW_SETUP_WORDS.proposeAgain}
                    onPress={() => void suggest()}
                  />
                )
              }
              cause={crewProposalFailure(proposal.state.cause, mate.name)}
              data-crew-proposal-failed=""
            />
          ) : (
            <CrewChoice
              disabled={suggestPress.disabled}
              lead={
                <MateFace shape={mate.shape} size={24} state="idle" tint={mate.tint ?? "amber"} />
              }
              line={suggestPress.reason ?? crewSuggestLine(mate.name)}
              render={
                <button
                  data-crew-suggest=""
                  disabled={suggestPress.disabled}
                  onClick={() => void suggest()}
                  type="button"
                />
              }
              title={crewSuggestWord(mate.name)}
            />
          )}
          <CrewChoice
            disabled={busy}
            lead={<TrioFaces mateTint={mate.tint} />}
            line={CREW_SETUP_WORDS.leadAndTwoLine}
            render={
              <button
                disabled={busy}
                onClick={() => void startFrom("lead-and-builders")}
                type="button"
              />
            }
            title={CREW_SETUP_WORDS.leadAndTwo}
          />
          <Row
            aria-disabled={busy || undefined}
            lead={<PlusIcon aria-hidden="true" />}
            pressable
            render={
              <button
                disabled={busy}
                onClick={() => void startFrom("empty", () => props.onEditCrewmate(null))}
                type="button"
              />
            }
            title={CREW_SETUP_WORDS.addYourself}
          />
        </div>
      ) : (
        <>
          <span className="mt-0.5 text-line leading-4.5 text-muted-foreground">
            {crewSuggestedLine(mate.name, asked)}
          </span>
          <div className="-mx-2 mt-2 flex flex-col gap-0.5" data-crew-setup-rows>
            {members.map((member) => (
              <SetupRow
                applied={props.applied}
                crewmate={props.crewmates.find((row) => row.handle === member.handle)}
                key={member.handle}
                mateName={mate.name}
                member={member}
                onOpen={() => {
                  void saveGoal().then(() => props.onEditCrewmate(member.handle));
                }}
              />
            ))}
            {props.applied ? null : (
              <Row
                lead={<PlusIcon aria-hidden="true" />}
                pressable
                render={
                  <button
                    onClick={() => {
                      void saveGoal().then(() => props.onEditCrewmate(null));
                    }}
                    type="button"
                  />
                }
                title={CREW_MENU.addCrewmate}
              />
            )}
          </div>
        </>
      )}
      {noDevHost && props.pools !== undefined ? (
        <p className="mt-3 text-line leading-4.5 text-muted-foreground">
          {crewNoDevHostWord(mate.name)}
        </p>
      ) : null}
      {portless.map((host) => (
        <p className="mt-3 text-line leading-4.5 text-muted-foreground" key={host.host}>
          {crewPortsOfferWords(mate.name)}
          {" — "}
          <CrewTextButton
            label={crewAskMateWord(mate.name)}
            onPress={() =>
              props.onAskPorts(
                host.host,
                props.crewmates.filter((row) => row.host === host.host && row.kind === "writer")
                  .length,
              )
            }
          />
        </p>
      ))}

      <CrewViewFoot>
        <CrewIssues issues={home.issues.filter((issue) => issue.code !== "file-missing")} />
        {startFailure !== null || commands.error === null ? null : (
          <Failure cause={commands.error} role="alert" size="line" />
        )}
        {/* Said from the start, under a Start still waiting too: a roster landing fills who's
            on it and adds no note above Start. */}
        <span className="text-line leading-4.5 text-muted-foreground">
          {crewSetUpFooter(mate.name, sharedDatabases)}
        </span>
        {startFailure === null ? null : (
          <div className="flex flex-col gap-1" data-crew-start-failure>
            <Failure
              cause={crewNamingTheMate(crewStartFailedWords(startFailure.reason), mate.name)}
              role="alert"
              size="line"
            />
            {startFailure.detail === null || startFailure.detail.trim() === "" ? null : (
              <FailureDetails>{startFailure.detail}</FailureDetails>
            )}
          </div>
        )}
        <span className="flex items-center gap-1.5">
          <CrewPress
            disabled={startPress.disabled}
            label={CREW_SETUP_WORDS.start}
            onPress={() => void start()}
            size="md"
          />
          {startPress.reason === null ? null : (
            <span
              className="ms-1.5 text-line leading-4.5 text-muted-foreground"
              data-crew-start-reason
            >
              {startPress.reason}
            </span>
          )}
          <span className="grow" />
          {droppable ? (
            <CrewPress
              disabled={commands.isPending("filesPut") || commands.isPending("apply")}
              label={CREW_SETUP_WORDS.drop}
              onPress={() => void drop()}
              size="md"
              variant="ghost"
            />
          ) : null}
        </span>
      </CrewViewFoot>
    </CrewView>
  );
}

/** A lead and two builders, as three small faces in one 28 px mark. */
function TrioFaces({ mateTint }: { readonly mateTint: MateTintId | undefined }) {
  const tints = crewFromTemplate({
    template: "lead-and-builders",
    crew: "crew",
    devHosts: [],
    ...(mateTint === undefined ? {} : { mateTint }),
  }).members.map((member) => member.tint ?? "slate");
  return (
    <span className="relative block size-7" aria-hidden="true">
      <span className="absolute top-0 left-1.75">
        <MateFace size={16} state="idle" tint={tints[0] ?? "violet"} />
      </span>
      <span className="absolute top-3.25 left-0">
        <MateFace size={16} state="idle" tint={tints[1] ?? "sky"} />
      </span>
      <span className="absolute top-3.25 left-3.5">
        <MateFace size={16} state="idle" tint={tints[2] ?? "coral"} />
      </span>
    </span>
  );
}

/** A crewmate being set up: the tab's row — its name, the first line of its job — and its copy's progress once it starts. */
function SetupRow({
  member,
  crewmate,
  applied,
  mateName,
  onOpen,
}: {
  readonly member: CrewMemberSpec;
  readonly crewmate: Crewmate | undefined;
  readonly applied: boolean;
  readonly mateName: string;
  readonly onOpen: () => void;
}) {
  const lane = applied ? (crewmate?.lane ?? null) : null;
  const readying = lane?.state === "creating" || lane?.state === "setting-up";
  const broken = lane === null ? null : crewBrokenCopyWord(lane, mateName);
  // The job as its editor's *Its job* holds it, every sentence: one text in both (run 2).
  const sentence = crewJobLine(member.job.split("\n")[0] ?? "", member.displayName);
  const tag = crewRoleTag(member.kind, member.displayName, sentence);
  return (
    <Row
      aria-disabled={applied || undefined}
      data-crew-setup-row={member.handle}
      lead={
        <MateFace size={24} state={readying ? "working" : "idle"} tint={member.tint ?? "slate"} />
      }
      line={
        <>
          <span className="block">{sentence}</span>
          {readying ? <span className="block">{CREW_COPY_READYING}</span> : null}
          {broken === null ? null : <span className="block text-status-failed-text">{broken}</span>}
        </>
      }
      lineWraps
      pressable
      render={<button disabled={applied} onClick={onOpen} type="button" />}
      title={
        <>
          {member.displayName}
          {tag === null ? null : (
            <span className="font-normal text-muted-foreground">{` · ${tag}`}</span>
          )}
        </>
      }
    />
  );
}
