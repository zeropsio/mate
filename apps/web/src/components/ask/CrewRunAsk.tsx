/**
 * A Mate's crew run ask (`crew-run` fence) as its card: the goal it gives the crew this Mate has,
 * then who's on it, as the crew stands. Its press opens the run's limits right here, in the
 * conversation (`CrewRunDialog`); Start saves the goal as the crew's brief, starts the crew from
 * this conversation, which the run reports to when it ends, and tells its lead to plan the goal
 * (`crewRunTell`). The run names this card, so the card follows it
 * (`crewRunAskState`). A viewer who may not run the crew (D6) reads the card with the reason in
 * place of the press.
 */
import {
  CREW_SETUP_WORDS,
  crewJobLine,
  crewLockWords,
  crewRoleTag,
} from "@t3tools/client-runtime/zerops/crew/phrases";
import type { Crewmate, ScopedThreadRef } from "@t3tools/contracts";
import {
  CREW_BRIEF_FILE,
  CREW_HOME_FILE,
  parseCrewHome,
  renderCrewHome,
} from "@t3tools/shared/crewHome";
import { type ReactNode, useMemo, useState } from "react";

import { openCrewTab } from "~/zerops/crew/crewTab";
import { withBrief } from "~/zerops/crew/crewHome";
import { useCrew } from "~/zerops/crew/useCrew";
import { useCrewAccess } from "~/zerops/crew/useCrewAccess";
import { type UseCrewCommand, useCrewCommand } from "~/zerops/crew/useCrewCommand";
import { useZeropsMate } from "~/zerops/useZeropsMates";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { List } from "../ui/list";
import { Row } from "../ui/row";
import { Text } from "../ui/text";
import { MateFace } from "../zerops/primitives";
import { CrewRunDialog, type CrewRunDialogAsk } from "../zerops/crew/CrewRunDialog";
import { AskCard, AskFooter } from "./AskCard";
import { crewAskGoalLead } from "./crewAsk.logic";
import {
  type CrewRunAsk,
  crewRunAskState,
  crewRunBrief,
  crewRunTell,
  parseCrewRunAsk,
} from "./crewRunAsk.logic";

/** A fence's card once its words are whole; words that give the crew no work stay the code they are. */
export function CrewRunAskFence({
  code,
  isStreaming,
  threadRef,
  children,
}: {
  readonly code: string;
  readonly isStreaming: boolean;
  readonly threadRef: ScopedThreadRef | undefined;
  readonly children: ReactNode;
}) {
  const ask = useMemo(() => (isStreaming ? null : parseCrewRunAsk(code)), [code, isStreaming]);
  // Half-written JSON is nothing to read: the card appears once the Mate finished it.
  if (isStreaming) return null;
  if (ask === null || threadRef === undefined) return children;
  return (
    // The card sits in an answer's words; it keeps its own rhythm, not the answer's paragraphs.
    <div className="chat-markdown-island my-4 max-w-[34rem]">
      <CrewRunAskCard ask={ask} threadRef={threadRef} />
    </div>
  );
}

/** Start's first step: the goal saved as the crew's brief, which each crewmate reads next. */
const saveGoal =
  (ask: CrewRunAsk) =>
  async (commands: UseCrewCommand): Promise<boolean> => {
    const files = await commands.readFiles();
    if (files === null) return false;
    const definition = parseCrewHome("crew", files.files).definition;
    if (definition === undefined) return false;
    const brief = crewRunBrief(ask);
    const written = renderCrewHome(withBrief(definition, brief.title, brief.text)).filter(
      (file) => file.path === CREW_HOME_FILE || file.path === CREW_BRIEF_FILE,
    );
    if (!(await commands.writeFiles({ files: written }))) return false;
    return (await commands.send({ _tag: "briefSave", apply: "nextTurn" })) !== null;
  };

function CrewRunAskCard({
  ask,
  threadRef,
}: {
  readonly ask: CrewRunAsk;
  readonly threadRef: ScopedThreadRef;
}) {
  const { environmentId } = threadRef;
  const whoLivesHere = useZeropsMate(environmentId);
  const mate = whoLivesHere.kind === "mate" ? whoLivesHere.mate : undefined;
  const { status, snapshot, view, current } = useCrew(environmentId);
  const access = useCrewAccess(environmentId, snapshot);
  const commands = useCrewCommand(environmentId);
  const [dialog, setDialog] = useState<CrewRunDialogAsk | null>(null);
  const lock = access.reach({ kind: "crew" });
  // `null` while the crew is unread: who is on it is not known yet, never no one.
  const crewmates = useMemo(
    () => (view === null ? null : view.crewmates.map((row) => row.crewmate)),
    [view],
  );
  return (
    <>
      <CrewRunAskCardView
        ask={ask}
        crewmates={crewmates}
        lock={access.reading ? null : (lock?.ownership ?? null)}
        mate={mate}
        onOpenCrew={() => openCrewTab(threadRef, { setUp: false })}
        onStart={
          !current || access.reading || lock !== null
            ? null
            : () =>
                setDialog({
                  mode: "start",
                  after: crewRunTell(ask),
                  // A client's thread is its engine conversation, which the run reports to.
                  card: {
                    key: ask.key,
                    from: { conversationId: threadRef.threadId },
                    before: saveGoal(ask),
                  },
                })
        }
        run={snapshot?.run ?? null}
        status={status}
      />
      <CrewRunDialog
        ask={dialog}
        current={current}
        environmentId={environmentId}
        hasLead={view?.lead != null}
        mateName={mate?.name ?? "the Mate"}
        onClose={() => setDialog(null)}
        onDone={(after) => {
          if (after !== null) void commands.send(after);
        }}
        snapshot={snapshot}
      />
    </>
  );
}

/** The card as it reads the Mate's crew: the goal and who's on it while nothing it started runs. */
export function CrewRunAskCardView({
  ask,
  mate,
  status,
  run,
  crewmates,
  lock,
  onStart,
  onOpenCrew,
}: {
  readonly ask: CrewRunAsk;
  readonly mate: { readonly name: string } | undefined;
  readonly status: Parameters<typeof crewRunAskState>[0]["status"];
  readonly run: Parameters<typeof crewRunAskState>[0]["run"];
  /** `null` while the crew is unread. */
  readonly crewmates: ReadonlyArray<
    Pick<Crewmate, "handle" | "displayName" | "tint" | "kind" | "jobFirstLine">
  > | null;
  /** Why this viewer may not run the crew; `null` where they may, or while that is read. */
  readonly lock: Parameters<typeof crewLockWords>[0] | null;
  /** Opens the run's limits; `null` while the crew is not current here or not this viewer's to run. */
  readonly onStart: (() => void) | null;
  readonly onOpenCrew: () => void;
}) {
  const hasLead =
    crewmates === null ? null : crewmates.some((crewmate) => crewmate.kind === "lead");
  const state = crewRunAskState({ status, run, hasLead }, ask.key, mate?.name);
  const live = state.kind === "waiting";
  return (
    <AskCard
      askId={`crew-run:${ask.key}`}
      density="full"
      footer={
        <AskFooter
          action={
            !live && status === "applied" ? (
              <Button onClick={onOpenCrew} size="md" variant="secondary">
                Open crew
              </Button>
            ) : undefined
          }
          density="full"
          main={
            live && lock === null
              ? { label: "Start the crew…", disabled: onStart === null, onPress: () => onStart?.() }
              : null
          }
          note={live && lock !== null ? crewLockWords(lock) : undefined}
          state={state}
        />
      }
      kind="crew"
      state={state.kind}
      title={ask.title}
      where={null}
      why={
        live && ask.why !== undefined ? { who: mate?.name ?? "this Mate", words: ask.why } : null
      }
    >
      {live ? (
        // Two sections, as the crew card's: the goal, then who's on it.
        <div className="mt-1 grid min-w-0 gap-4">
          <section className="grid min-w-0 gap-1">
            <Text render={<h3 />} variant="label">
              {CREW_SETUP_WORDS.goal}
            </Text>
            <p className="line-clamp-3 whitespace-pre-line text-body text-foreground">
              {crewAskGoalLead(ask.goal)}
            </p>
          </section>
          {crewmates === null || crewmates.length === 0 ? null : (
            <section className="grid min-w-0 gap-1.5">
              <Text render={<h3 />} variant="label">
                {CREW_SETUP_WORDS.whosOnIt}
              </Text>
              <Card variant="inset">
                <List render={<ul />}>
                  {crewmates.map((crewmate) => {
                    const sentence = crewJobLine(crewmate.jobFirstLine, crewmate.displayName);
                    const tag = crewRoleTag(crewmate.kind, crewmate.displayName, sentence);
                    return (
                      // Inside an answer's words (`chat-markdown-island`), as a crew card's rows.
                      <li data-md-li="" key={crewmate.handle}>
                        <Row
                          lead={<MateFace size={24} state="idle" tint={crewmate.tint} />}
                          line={sentence}
                          lineWraps
                          title={
                            <>
                              {crewmate.displayName}
                              {tag === null ? null : (
                                <span className="font-normal text-muted-foreground">{` · ${tag}`}</span>
                              )}
                            </>
                          }
                        />
                      </li>
                    );
                  })}
                </List>
              </Card>
            </section>
          )}
        </div>
      ) : null}
    </AskCard>
  );
}
