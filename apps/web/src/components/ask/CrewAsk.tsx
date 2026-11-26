/**
 * A Mate's crew ask (`crew-ask` fence) as its card, read as the setup it opens reads: the goal,
 * then who's on it, each crewmate with its part and, at the row's end, the agent's mark and the
 * model it runs on among this Mate's sign-ins. An agent the Mate isn't signed in to is a warning on
 * its row, a line saying what its crewmates start on instead and a press to sign in, after which
 * the rows follow. The main press opens the Crew tab's setup filled in with the crew, to change
 * and start there. Once the Mate's crew stands, it says so and opens the crew instead.
 */
import {
  CREW_SETUP_WORDS,
  crewJobLine,
  crewRoleTag,
} from "@t3tools/client-runtime/zerops/crew/phrases";
import type {
  CrewStatus,
  ProviderDriverKind,
  ScopedThreadRef,
  ServerProvider,
  ZeropsAgentId,
} from "@t3tools/contracts";
import type { MateTintId } from "@t3tools/shared/brand";
import { type CrewAskSeat, crewFromAsk } from "@t3tools/shared/crewTemplates";
import { createContext, type ReactNode, use, useMemo } from "react";

import { useServerConfigs } from "~/state/entities";
import { openCrewTab, openCrewView } from "~/zerops/crew/crewTab";
import { useCrew } from "~/zerops/crew/useCrew";
import { useZeropsMate } from "~/zerops/useZeropsMates";
import { PROVIDER_ICON_BY_PROVIDER } from "../chat/providerIconUtils";
import { Badge } from "../ui/badge";
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
  type CrewAskRunsOn,
  crewAskGoalLead,
  crewAskMissing,
  crewAskMissingWords,
  crewAskRunsOn,
  crewAskRunsOnWords,
  crewAskSeats,
  parseCrewAsk,
} from "./crewAsk.logic";

const NO_PROVIDERS: ReadonlyArray<ServerProvider> = [];

/** The conversation's sign-in dialog, opened on an agent; `null` where the conversation has none. */
export const CrewAskSignInContext = createContext<((agentId: ZeropsAgentId) => void) | null>(null);

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
  const signIn = use(CrewAskSignInContext);
  return (
    <CrewAskCardView
      ask={ask}
      mate={whoLivesHere.kind === "mate" ? whoLivesHere.mate : undefined}
      onOpenCrew={() => openCrewTab(threadRef, { setUp: false })}
      onSignIn={signIn}
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
  onSignIn,
}: {
  readonly ask: CrewAsk;
  readonly mate: { readonly name: string; readonly tint: MateTintId } | undefined;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly status: CrewStatus | null;
  /** Opens the setup filled in with the crew, each crewmate on what it runs on here. */
  readonly onSetUp: (seats: ReadonlyArray<CrewAskSeat>) => void;
  readonly onOpenCrew: () => void;
  /** Opens the sign-in to an agent; `null` where none can be opened here. */
  readonly onSignIn: ((agentId: ZeropsAgentId) => void) | null;
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

  const rows = useMemo(
    () => ask.crew.map((crewmate) => ({ crewmate, runsOn: crewAskRunsOn(crewmate, providers) })),
    [ask, providers],
  );
  const missing = crewAskMissing(rows);
  // One press per agent this viewer can sign this Mate in to here; the rows follow the sign-in.
  const signIns =
    onSignIn === null
      ? []
      : missing.flatMap(({ agent }) =>
          agent.agentId === undefined ? [] : [{ agentId: agent.agentId, name: agent.name }],
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
          also={
            signIns.length === 0
              ? undefined
              : signIns.map((agent) => (
                  <Button
                    key={agent.agentId}
                    onClick={() => onSignIn?.(agent.agentId)}
                    size="md"
                    variant="secondary"
                  >
                    {`Sign in to ${agent.name}…`}
                  </Button>
                ))
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
          note={
            live && signIns.length === 0 ? "You can change anyone before it starts." : undefined
          }
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
        // Two sections, as the setup's: the goal, then who's on it.
        <div className="mt-1 grid min-w-0 gap-4">
          <section className="grid min-w-0 gap-1">
            <Text render={<h3 />} variant="label">
              {CREW_SETUP_WORDS.goal}
            </Text>
            <p className="line-clamp-3 whitespace-pre-line text-body text-foreground">
              {crewAskGoalLead(ask.goal)}
            </p>
          </section>
          <section className="grid min-w-0 gap-1.5">
            <Text render={<h3 />} variant="label">
              {CREW_SETUP_WORDS.whosOnIt}
            </Text>
            <Card variant="inset">
              <List render={<ul />}>
                {rows.map(({ crewmate, runsOn }, index) => {
                  const sentence = crewJobLine(crewmate.part, crewmate.name);
                  const tag = crewRoleTag(crewmate.kind, crewmate.name, sentence);
                  return (
                    // A crew ask draws these inside an answer's words (`chat-markdown-island`), as
                    // a picture ask's steps (`AskSteps`).
                    <li data-crew-ask-crewmate={crewmate.kind} data-md-li="" key={index}>
                      <Row
                        lead={<MateFace size={24} state="idle" tint={tints[index] ?? "slate"} />}
                        line={sentence}
                        lineWraps
                        meta={<RunsOn runsOn={runsOn} />}
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
            {missing.map((agent) => (
              <Text data-crew-ask-missing="" key={agent.agent.driver} render={<p />} variant="note">
                {crewAskMissingWords(agent, name)}
              </Text>
            ))}
          </section>
        </div>
      ) : null}
    </AskCard>
  );
}

/**
 * What a crewmate runs on, at its row's end: the agent's mark and the model and effort it sets
 * there, or, for an agent this Mate isn't signed in to, that agent's mark in a warning.
 */
function RunsOn({ runsOn }: { readonly runsOn: CrewAskRunsOn }) {
  if (runsOn.missing !== null) {
    const Mark = PROVIDER_ICON_BY_PROVIDER[runsOn.missing.driver as ProviderDriverKind];
    return (
      <Badge tone="warning">
        {Mark === undefined ? null : <Mark />}
        {runsOn.missing.agentId === undefined ? "Not available" : "Not signed in"}
      </Badge>
    );
  }
  const words = crewAskRunsOnWords(runsOn);
  if (words === null) return null;
  const driver = runsOn.login?.driver;
  const Mark =
    driver === undefined ? undefined : PROVIDER_ICON_BY_PROVIDER[driver as ProviderDriverKind];
  return (
    <span className="flex items-center gap-1.5">
      {Mark === undefined ? null : <Mark aria-hidden="true" className="size-3.5" />}
      {words}
    </span>
  );
}
