/**
 * A Mate's crew ask (`crew-ask` fence) as its card: the goal it set up and who is on the crew, each
 * crewmate on what it runs on among this Mate's sign-ins, and one press that opens the Crew tab's
 * setup filled in with it, to change and start there. Once the Mate's crew stands, it says so and
 * opens the crew instead.
 */
import { crewJobLine, crewRoleTag } from "@t3tools/client-runtime/zerops/crew/phrases";
import type { CrewStatus, ScopedThreadRef, ServerProvider } from "@t3tools/contracts";
import type { MateTintId } from "@t3tools/shared/brand";
import { type CrewAskSeat, crewFromAsk } from "@t3tools/shared/crewTemplates";
import { type ReactNode, useMemo } from "react";

import { useServerConfigs } from "~/state/entities";
import { openCrewTab, openCrewView } from "~/zerops/crew/crewTab";
import { useCrew } from "~/zerops/crew/useCrew";
import { useZeropsMate } from "~/zerops/useZeropsMates";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { List } from "../ui/list";
import { Row } from "../ui/row";
import { Text } from "../ui/text";
import { MateFace } from "../zerops/primitives";
import { AskCard, AskFooter } from "./AskCard";
import type { AskState } from "./ask.logic";
import {
  type CrewAsk,
  crewAskRunsOn,
  crewAskRunsOnWords,
  crewAskGoalLead,
  crewAskSeats,
  parseCrewAsk,
} from "./crewAsk.logic";

const NO_PROVIDERS: ReadonlyArray<ServerProvider> = [];

/** A fence's card once its words are whole; words that set up no crew stay the code they are. */
export function CrewAskFence({
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
  const ask = useMemo(() => (isStreaming ? null : parseCrewAsk(code)), [code, isStreaming]);
  // Half-written JSON is nothing to read: the card appears once the Mate finished it.
  if (isStreaming) return null;
  if (ask === null || threadRef === undefined) return children;
  return (
    // The card sits in an answer's words; it keeps its own rhythm, not the answer's paragraphs.
    <div className="chat-markdown-island my-4 max-w-[34rem]">
      <CrewAskCard ask={ask} threadRef={threadRef} />
    </div>
  );
}

function CrewAskCard({
  ask,
  threadRef,
}: {
  readonly ask: CrewAsk;
  readonly threadRef: ScopedThreadRef;
}) {
  const { environmentId } = threadRef;
  const whoLivesHere = useZeropsMate(environmentId);
  const providers = useServerConfigs().get(environmentId)?.providers ?? NO_PROVIDERS;
  const status = useCrew(environmentId).status;
  return (
    <CrewAskCardView
      ask={ask}
      mate={whoLivesHere.kind === "mate" ? whoLivesHere.mate : undefined}
      onOpenCrew={() => openCrewTab(threadRef, { setUp: false })}
      onSetUp={(seats) =>
        openCrewView(threadRef, {
          kind: "setup",
          proposed: { key: ask.key, goal: ask.goal, seats },
        })
      }
      providers={providers}
      status={status}
    />
  );
}

/**
 * The card as it reads the Mate, its sign-ins and its crew's status (`null` while unread): the
 * crew to set up while none stands, else that one does.
 */
export function CrewAskCardView({
  ask,
  mate,
  providers,
  status,
  onSetUp,
  onOpenCrew,
}: {
  readonly ask: CrewAsk;
  readonly mate: { readonly name: string; readonly tint: MateTintId } | undefined;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly status: CrewStatus | null;
  /** Opens the setup filled in with the crew, each crewmate on what it runs on here. */
  readonly onSetUp: (seats: ReadonlyArray<CrewAskSeat>) => void;
  readonly onOpenCrew: () => void;
}) {
  const name = mate?.name ?? "this Mate";
  // The crew as the setup would draw it: each crewmate's tint, stepping past the Mate's own.
  const tints = useMemo(
    () =>
      crewFromAsk({
        seats: ask.crew,
        crew: "crew",
        devHosts: [],
        ...(mate === undefined ? {} : { mateTint: mate.tint }),
      }).members.map((member) => member.tint),
    [ask, mate],
  );

  const state: AskState =
    status === "applied"
      ? { kind: "done", words: `${mate?.name ?? "This Mate"}'s crew is set up`, told: null }
      : status === "off"
        ? { kind: "failed", words: `Crews are turned off for ${name}.` }
        : { kind: "waiting" };
  const live = state.kind === "waiting";

  return (
    <AskCard
      askId={`crew:${ask.key}`}
      density="full"
      footer={
        <AskFooter
          action={
            status === "applied" ? (
              <Button onClick={onOpenCrew} size="md" variant="secondary">
                Open crew
              </Button>
            ) : undefined
          }
          density="full"
          main={
            live
              ? {
                  label: "Set up crew…",
                  disabled: status === null,
                  onPress: () => onSetUp(crewAskSeats(ask, providers)),
                }
              : null
          }
          note={live ? "You can change anyone before it starts." : undefined}
          state={state}
        />
      }
      kind="crew"
      state={state.kind}
      title={ask.title}
      where={null}
      why={live && ask.why !== undefined ? { who: name, words: ask.why } : null}
    >
      {live ? (
        <>
          <figure className="grid min-w-0 gap-1">
            <Text render={<figcaption />} variant="note">
              Goal
            </Text>
            <div className="line-clamp-3 whitespace-pre-line border-foreground/15 border-s-2 ps-3 text-body text-foreground">
              {crewAskGoalLead(ask.goal)}
            </div>
          </figure>
          <Card variant="inset">
            <List render={<ul />}>
              {ask.crew.map((crewmate, index) => {
                const runsOn = crewAskRunsOn(crewmate, providers);
                const runsOnWords = crewAskRunsOnWords(runsOn);
                const sentence = crewJobLine(crewmate.part, crewmate.name);
                const tag = crewRoleTag(crewmate.kind, crewmate.name, sentence);
                return (
                  // A crew ask draws these inside an answer's words (`chat-markdown-island`), as a
                  // picture ask's steps (`AskSteps`).
                  <li data-crew-ask-crewmate={crewmate.kind} data-md-li="" key={index}>
                    <Row
                      lead={<MateFace size={24} state="idle" tint={tints[index] ?? "slate"} />}
                      line={
                        <>
                          <span className="block">{sentence}</span>
                          {runsOnWords === null ? null : (
                            <Text className="block" variant="note">
                              {runsOn.missing === null
                                ? `On ${runsOnWords}`
                                : `On ${runsOnWords}: ${name} isn't signed in to ${runsOn.missing}`}
                            </Text>
                          )}
                        </>
                      }
                      lineWraps
                      title={
                        <>
                          {crewmate.name}
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
        </>
      ) : null}
    </AskCard>
  );
}
