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
  crewJobSentence,
  crewLockWords,
  crewNoDevHostWord,
  crewPortsOfferWords,
  crewProposingWord,
  crewSetUpFooter,
  crewSetUpTitle,
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
import { ChevronRightIcon, PlusIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { withBrief } from "../../../zerops/crew/crewHome";
import { useCrewSetupDraft } from "../../../zerops/crew/crewSetupDraft";
import type { UseCrewCommand } from "../../../zerops/crew/useCrewCommand";
import { useCrewHome } from "../../../zerops/crew/useCrewHome";
import { useCrewProposal } from "../../../zerops/crew/useCrewProposal";
import { MateFace } from "../primitives";
import { crewGoalFields, crewGoalMarkdown, crewGoalTitleOf } from "./CrewGoal.logic";
import { CrewPress, CrewTextButton } from "./CrewParts";
import {
  crewProposalFailure,
  crewStartState,
  crewSuggestState,
  type CrewProposeWith,
} from "./CrewSetup.logic";
import { CrewIssues, CrewTextArea, CrewView, CrewViewFoot } from "./CrewView";

export interface CrewSetupProps {
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
  const hostsOf = { devHosts, databaseHosts };

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
   * added by hand, or whose service was read since), then applies.
   */
  const start = async () => {
    if (definition === null) return;
    const declared = withSharedDatabase(definition, databaseHosts);
    const next = draft.goal === null ? declared : withGoal(declared);
    if (next !== definition && !(await home.save(next, [CREW_HOME_FILE, CREW_BRIEF_FILE]))) return;
    if ((await commands.send({ _tag: "apply" })) !== null) draft.clear();
  };

  /** Drops the draft: the goal kept here, and whoever was picked. */
  const drop = async () => {
    proposal.cancel();
    setAsked(false);
    draft.clear();
    // The crew home holds the picks and the goal as last saved: it goes back to nobody, no goal.
    if (definition !== null) {
      await saveAll(crewFromTemplate({ template: "empty", crew: "crew", ...hostsOf, ...mateTint }));
    }
  };

  const startLock = members === null ? null : (props.startLock?.(members) ?? null);
  const writers = members === null ? [] : members.filter((member) => member.kind === "writer");
  const noDevHost = writers.length > 0 && props.devHosts.length === 0;
  const writerHosts = (shared: boolean) => [
    ...new Set(
      writers.flatMap((member) =>
        member.host === undefined ||
        (shared && (member.database !== "shared" || !databaseHosts.includes(member.host)))
          ? []
          : [member.host],
      ),
    ),
  ];
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
        <h2 className="font-semibold text-base leading-6">{crewSetUpTitle(mate.name)}</h2>
        <span className="grow" />
        <button
          aria-label={CREW_SETUP_WORDS.close}
          className="crew-menu-btn -me-1.5"
          onClick={props.onClose}
          type="button"
        >
          <XIcon aria-hidden="true" className="size-4" />
        </button>
      </div>
      <p className="mt-0.5 text-line leading-4.5 text-muted-foreground">{CREW_SETUP_WORDS.line}</p>

      <span className="mt-6 font-medium text-sm leading-5">{CREW_SETUP_WORDS.goal}</span>
      {drafted ? null : (
        <span className="mt-0.5 text-line leading-4.5 text-muted-foreground">
          {CREW_SETUP_WORDS.goalLine}
        </span>
      )}
      <div className="mt-2">
        <CrewTextArea
          aria-label={CREW_SETUP_WORDS.goal}
          disabled={props.applied}
          {...(drafted ? {} : { lines: 4 as const })}
          onBlur={() => void saveGoal()}
          onChange={(event) => draft.setGoal(event.target.value)}
          placeholder={CREW_SETUP_WORDS.goalPlaceholder}
          value={goal}
        />
      </div>

      <span className="mt-7 font-medium text-sm leading-5">{CREW_SETUP_WORDS.whosOnIt}</span>
      {members === null ? null : members.length === 0 ? (
        <div className="mt-2 flex flex-col gap-2" data-crew-setup-start>
          {proposal.state.kind === "proposing" ? (
            <div className="crew-option" data-crew-proposing data-live="" role="status">
              <MateFace shape={mate.shape} size={24} state="working" tint={mate.tint ?? "amber"} />
              <span className="font-medium text-sm leading-5">{crewProposingWord(mate.name)}</span>
              <CrewTextButton label={CREW_SETUP_WORDS.stopProposing} onPress={proposal.cancel} />
            </div>
          ) : proposal.state.kind === "failed" ? (
            <div className="crew-option" data-crew-proposal-failed data-live="" role="alert">
              <MateFace shape={mate.shape} size={24} state="idle" tint={mate.tint ?? "amber"} />
              <span className="text-line leading-4.5 text-status-failed-text">
                {crewProposalFailure(proposal.state.cause, mate.name)}
              </span>
              {suggestPress.disabled ? (
                <span />
              ) : (
                <CrewTextButton
                  label={CREW_SETUP_WORDS.proposeAgain}
                  onPress={() => void suggest()}
                />
              )}
            </div>
          ) : (
            <button
              className="crew-option"
              data-crew-suggest
              disabled={suggestPress.disabled}
              onClick={() => void suggest()}
              type="button"
            >
              <MateFace shape={mate.shape} size={24} state="idle" tint={mate.tint ?? "amber"} />
              <span className="flex min-w-0 flex-col">
                <span className="font-medium text-sm leading-5">{crewSuggestWord(mate.name)}</span>
                <span className="text-line leading-4.5 text-muted-foreground">
                  {suggestPress.reason ?? crewSuggestLine(mate.name)}
                </span>
              </span>
              <ChevronRightIcon aria-hidden="true" className="size-4 text-muted-foreground" />
            </button>
          )}
          <button
            className="crew-option"
            disabled={busy}
            onClick={() => void startFrom("lead-and-builders")}
            type="button"
          >
            <TrioFaces mateTint={mate.tint} />
            <span className="flex min-w-0 flex-col">
              <span className="font-medium text-sm leading-5">{CREW_SETUP_WORDS.leadAndTwo}</span>
              <span className="text-line leading-4.5 text-muted-foreground">
                {CREW_SETUP_WORDS.leadAndTwoLine}
              </span>
            </span>
            <ChevronRightIcon aria-hidden="true" className="size-4 text-muted-foreground" />
          </button>
          <button
            className="flex h-9 cursor-pointer items-center gap-3 rounded-lg ps-2.5 pe-3 font-medium text-line leading-4.5 text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent"
            disabled={busy}
            onClick={() => void startFrom("empty", () => props.onEditCrewmate(null))}
            type="button"
          >
            <span className="flex w-7 justify-center">
              <PlusIcon aria-hidden="true" className="size-4" />
            </span>
            {CREW_SETUP_WORDS.addYourself}
          </button>
        </div>
      ) : (
        <>
          <span className="mt-0.5 text-line leading-4.5 text-muted-foreground">
            {crewSuggestedLine(mate.name, asked)}
          </span>
          <div className="-mx-4 mt-2 flex flex-col gap-0.5" data-crew-setup-rows>
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
              <button
                className="mx-2 grid h-9 cursor-pointer grid-cols-[28px_minmax(0,1fr)] items-center gap-x-3 rounded-lg px-2 text-start font-medium text-line leading-4.5 text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  void saveGoal().then(() => props.onEditCrewmate(null));
                }}
                type="button"
              >
                <span className="flex justify-center">
                  <PlusIcon aria-hidden="true" className="size-4" />
                </span>
                {CREW_MENU.addCrewmate}
              </button>
            )}
          </div>
        </>
      )}
      {noDevHost ? (
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
        {commands.error === null ? null : (
          <p className="text-line leading-4.5 text-status-failed-text" role="alert">
            {commands.error}
          </p>
        )}
        {drafted ? (
          <span className="text-line leading-4.5 text-muted-foreground">
            {crewSetUpFooter(mate.name, writerHosts(false), writerHosts(true))}
          </span>
        ) : null}
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
  return (
    <button
      className="crew-row text-start"
      data-crew-setup-row={member.handle}
      disabled={applied}
      onClick={onOpen}
      type="button"
    >
      <MateFace size={24} state={readying ? "working" : "idle"} tint={member.tint ?? "slate"} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium text-sm leading-5">{member.displayName}</span>
        <span className="mt-0.5 text-line leading-4.5 text-muted-foreground">
          {crewJobSentence(member.job.split("\n")[0] ?? "", member.displayName)}
        </span>
        {readying ? (
          <span className="text-line leading-4.5 text-muted-foreground">{CREW_COPY_READYING}</span>
        ) : null}
        {broken === null ? null : (
          <span className="text-line leading-4.5 text-status-failed-text">{broken}</span>
        )}
      </span>
    </button>
  );
}
