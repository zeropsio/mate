/**
 * An empty conversation with a Mate: the Mate's own face — its shape in its
 * colour, awake or asleep as its container is — the question — "What should
 * Fen do on Acme Docs?" — and, when no coding agent is signed in so nothing
 * typed here could be acted on, the sign-in itself,
 * right where the first message would go. Asking there is the empty state
 * doing its one job; a line above the timeline asking the same was a second
 * voice.
 *
 * A Mate just added to a project says instead what it is about to do, to the
 * person who added it (`mateStandUp.ts`): "Fen will stand up development on
 * Acme Docs after you authorize your agent." over its two buttons, the composer
 * held back (`mateStandUpHoldsComposer`); once they have signed in, "Fen is
 * standing up development on Acme Docs…" while their
 * message is on its way, until it appears and the conversation takes over;
 * and if it did not go through, that, with a Try again. The sentences share
 * one box and cross-fade in place. A colleague sees the question: the stand-up
 * is its person's, sent from their own sign-in.
 *
 * The face stands a third of the way down the pane and the headline under it,
 * whatever hangs below them — the rows, the line saying the sign-in is being
 * checked — so a sign-in arriving, or going, never moves them.
 *
 * Who the Mate is comes from `useZeropsMate` (the caller resolves it, so a
 * conversation nobody lives in keeps upstream's empty line); whether a
 * sign-in is required is `zeropsAgentSignInRequired` over the environment's
 * agent-auth feed once it is known, and until then the place says it is
 * checking, or why it could not; the sign-in itself is
 * `useZeropsAgentSignInDialog`, the one dialog every sign-in surface shares.
 */
import { resolvePrimaryConversation } from "@t3tools/client-runtime/zerops";
import {
  agentAuthAction,
  zeropsAgentAuthView,
  zeropsAgentSignInRequired,
} from "@t3tools/client-runtime/zerops/agentLogin";
import type { KnownMessage } from "@t3tools/client-runtime/zerops/knowledge";
import type {
  EnvironmentId,
  ScopedThreadRef,
  ZeropsAgentAuthSnapshot,
  ZeropsAgentId,
} from "@t3tools/contracts";
import { Fragment, useMemo, type ReactNode } from "react";

import { cn } from "~/lib/utils";

import { useThreadShells } from "../../state/entities";
import { mateFaceFor } from "../../zerops/agentActivity";
import { mateComingHeadlineClauses, type MateViewKind } from "../../zerops/mateComing";
import { mateHandedOver } from "../../zerops/mateHandOver";
import { mateQuestion, type ZeropsMateIdentity } from "../../zerops/mateIdentities";
import {
  MATE_STAND_UP_RETRY_LABEL,
  mateStandUpHeadlineClauses,
  mateStandUpPhase,
  mateStandUpSignedIn,
  type MateStandUpPhase,
} from "../../zerops/mateStandUp";
import { useAgentLoginCancel } from "../../zerops/useAgentLoginCancel";
import { retryMateStandUp, useMateStandUpAttempt } from "../../zerops/useMateStandUp";
import { useLocalAgentSigners } from "../../zerops/useZeropsAgentSigner";
import { useZeropsAgentAuth } from "../../zerops/useZeropsFeeds";
import { useZeropsAgentSignInDialog } from "../../zerops/useZeropsAgentSignInDialog";
import { useZeropsSessionOptional } from "../../zerops/ZeropsSessionProvider";
import { Button } from "../ui/button";
import { FlatCard, MateFace } from "./primitives";
import { ZeropsAgentAuthRows } from "./ZeropsAgentAuthCard";
import { ZEROPS_AGENT_NAMES } from "./ZeropsAgentAuthorizationDialog.logic";

export function ZeropsMateEmptyState({
  environmentId,
  mate,
  threadRef,
}: {
  readonly environmentId: EnvironmentId;
  readonly mate: ZeropsMateIdentity;
  readonly threadRef: ScopedThreadRef | null;
}) {
  const state = useMateEmptyState({ environmentId, mate, threadRef });
  return (
    <>
      <MateEmptyStateView
        // Handed over from its own view a moment ago: that view's last frame, its coming words'
        // room kept in the box, so the conversation arriving moves nothing.
        coming={mateHandedOver(environmentId) ? "past" : null}
        mate={mate}
        onRetry={state.onRetry}
        phase={state.phase}
        signIn={state.signIn}
        signInRequired={state.signInRequired}
        unknown={state.unknown}
      />
      {state.dialog}
    </>
  );
}

/** What an empty conversation with a Mate says, and the sign-in dialog it opens. */
export interface MateEmptyState {
  /** The stand-up's phase for this viewer, or `null` for the question. */
  readonly phase: MateStandUpPhase | null;
  /** The agents' sign-in, once it is known; null before. */
  readonly signIn: ReactNode | null;
  readonly signInRequired: boolean;
  readonly unknown: KnownMessage | null;
  /** Whether the agents' sign-in is read: the conversation's first paint says it whole. */
  readonly signInKnown: boolean;
  readonly onRetry: () => void;
  readonly dialog: ReactNode;
}

/**
 * The empty conversation's reading of its Mate: whose stand-up it is and where it stands, the
 * agents' sign-in and the dialog that does it — for the conversation, and for the Mate's own view
 * that hands over to it (`ZeropsMateComingPage`), so the two say one thing. With no environment
 * yet, nothing is read.
 */
export function useMateEmptyState({
  environmentId,
  mate,
  threadRef,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly mate: ZeropsMateIdentity;
  readonly threadRef: ScopedThreadRef | null;
}): MateEmptyState {
  const { snapshot: agentAuth, unknown: agentAuthUnknown } = zeropsAgentAuthView(
    useZeropsAgentAuth(environmentId),
  );
  // Only a known snapshot can ask for a sign-in; one still being read says so.
  const signInRequired = agentAuth !== null && zeropsAgentSignInRequired(agentAuth);
  const viewerSubject = useZeropsSessionOptional()?.user?.id;
  const localSigners = useLocalAgentSigners();
  const attempt = useMateStandUpAttempt(environmentId);
  // The stand-up goes into the Mate's main conversation, the one opening it lands on.
  const threads = useThreadShells();
  const main = useMemo(
    () =>
      threadRef !== null &&
      resolvePrimaryConversation(
        threads.filter((thread) => thread.environmentId === threadRef.environmentId),
      ).primary?.id === threadRef.threadId,
    [threadRef, threads],
  );
  // D6: the conversation view (`ChatView`) is the one place that records the
  // signer of a successful sign-in, whichever door it went through; this
  // hook only reads how that went and owns the dialog itself.
  const {
    openFor: openAuthorizationDialog,
    dialog: authorizationDialog,
    recordFailed,
    retryRecord,
  } = useZeropsAgentSignInDialog(environmentId, threadRef, { projectName: mate.project ?? null });
  const cancelAgentLogin = useAgentLoginCancel(threadRef);
  const phase = mateStandUpPhase({
    marker: mate.standUp,
    viewer: viewerSubject,
    main,
    signIn:
      agentAuth === null
        ? "unknown"
        : signInRequired
          ? "required"
          : viewerSubject !== undefined &&
              mateStandUpSignedIn(agentAuth, viewerSubject, localSigners)
            ? "signed-in"
            : "someone-else",
    attempt,
  });

  return {
    phase,
    signIn:
      agentAuth === null ? null : phase === "sign-in" ? (
        <StandUpAuthorize onAuthorize={openAuthorizationDialog} snapshot={agentAuth} />
      ) : (
        <ZeropsAgentAuthRows
          onCancel={cancelAgentLogin}
          onRetryRecord={retryRecord}
          onSignIn={openAuthorizationDialog}
          recordFailed={recordFailed}
          snapshot={agentAuth}
          viewerSubject={viewerSubject}
        />
      ),
    signInRequired,
    unknown: agentAuthUnknown,
    signInKnown: agentAuth !== null,
    onRetry: () => {
      if (environmentId !== null) retryMateStandUp(environmentId);
    },
    dialog: authorizationDialog,
  };
}

/**
 * The stand-up's two buttons (the owner: "it should say … and the two buttons"): one per agent the
 * Mate offers, each opening that agent's authorization. The headline above already says what a
 * sign-in is for, so no row repeats it with a status.
 */
export function StandUpAuthorize({
  snapshot,
  onAuthorize,
}: {
  readonly snapshot: ZeropsAgentAuthSnapshot;
  readonly onAuthorize: (agentId: ZeropsAgentId) => void;
}) {
  const agents = snapshot.agents.filter((agent) => agentAuthAction(agent) === "sign-in");
  return (
    <div
      className="flex flex-wrap items-center justify-center gap-3"
      data-zerops-surface="mate-standup-authorize"
    >
      {agents.map((agent) => (
        <Button
          data-agent-id={agent.agentId}
          key={agent.agentId}
          onClick={() => {
            onAuthorize(agent.agentId);
          }}
          size="compact"
          variant="pill"
        >
          Authorize {ZEROPS_AGENT_NAMES[agent.agentId]}
        </Button>
      ))}
    </div>
  );
}

/** The stand-up's sentences, in the order a stand-up moves through them. */
const STAND_UP_PHASES: ReadonlyArray<MateStandUpPhase> = ["sign-in", "standing-up", "failed"];

/**
 * A Mate still coming up, one that never came, or one on its way to its conversation, as its own
 * view draws it (`ZeropsMateComingPage`): the kind of headline, and what stands under its words —
 * how far it has got, what it waits for, or what can be done about it.
 */
export interface MateEmptyComing {
  readonly kind: MateViewKind;
  readonly below: ReactNode;
  /** It is up: the phase it moves into is read, and its words leave with what stood under them. */
  readonly over?: boolean;
}

/** One sentence of the headline's box: the words, in the clauses it breaks between. */
interface HeadlinePhrase {
  readonly id: "coming" | "question" | MateStandUpPhase;
  readonly clauses: ReadonlyArray<string>;
}

/**
 * The opening's headline and its face's size, which a crewmate's empty
 * conversation shares (`CrewmateEmptyState`), so a switch between the two
 * keeps the face where it stood.
 */
export const MATE_EMPTY_HEADLINE_CLASS =
  "text-center text-2xl font-normal tracking-tight text-foreground sm:text-3xl";
export const MATE_EMPTY_FACE_CLASS = "size-16 sm:size-18";

/**
 * The empty conversation as it is drawn, from what it says: its Mate, the stand-up's phase (null
 * for the question), the agents' sign-in rows once their sign-in is known and whether one must be
 * signed in, and — while it is not known — what the agents' region says instead.
 *
 * Before the conversation exists, the same view is the Mate's own while it comes up (`coming`):
 * its headline says so, first in the box every phase shares, the phase it will move into waiting
 * after it, and its progress hangs where the sign-in will. When it is up the words hand over in
 * place — its coming words leave upward, the phase arrives from below, 180 ms — and the
 * conversation it hands over to paints that last frame (`"past"`), its coming words' room kept.
 */
export function MateEmptyStateView({
  mate,
  phase,
  signIn,
  signInRequired,
  unknown,
  onRetry,
  coming = null,
}: {
  readonly mate: ZeropsMateIdentity;
  readonly phase: MateStandUpPhase | null;
  /** The agents' sign-in rows, once their sign-in is known; null before. */
  readonly signIn: ReactNode | null;
  /** No agent is signed in: nothing typed here could be acted on. */
  readonly signInRequired: boolean;
  readonly unknown: KnownMessage | null;
  readonly onRetry: () => void;
  /** Still coming up (or never came), or — `"past"` — handed over from that a moment ago. */
  readonly coming?: MateEmptyComing | "past" | null;
}) {
  const comingNow = coming !== null && coming !== "past" && coming.over !== true ? coming : null;
  const comingKind = coming !== null && coming !== "past" ? coming.kind : "coming";
  const phrases: ReadonlyArray<HeadlinePhrase> = [
    ...(coming === null
      ? []
      : [{ id: "coming" as const, clauses: mateComingHeadlineClauses(mate, comingKind) }]),
    ...(phase === null
      ? [{ id: "question" as const, clauses: [mateQuestion(mate)] }]
      : STAND_UP_PHASES.map((each) => ({
          id: each,
          clauses: mateStandUpHeadlineClauses(mate, each),
        }))),
  ];
  const shownId = comingNow !== null ? "coming" : (phase ?? "question");
  const shownAt = phrases.findIndex((each) => each.id === shownId);
  return (
    <div
      className="flex h-full flex-col items-center px-5 sm:px-6"
      data-zerops-surface="mate-empty-state"
    >
      {/* The face's place, a third of the way down whatever is said under it:
          every Mate's opening, in every state, puts its face where the last did. */}
      <div aria-hidden="true" className="shrink-0 basis-1/3" />
      <div className="relative flex w-full flex-col items-center gap-6" data-mate-empty-lead>
        {/* The brand mark's box: a draft's hero shows the mark until it is
            known who lives here, and the face takes its place without a jump. */}
        <MateFace
          className={MATE_EMPTY_FACE_CLASS}
          size="lg"
          shape={mate.shape}
          state={mateFaceFor(mate.connected, undefined)}
          tint={mate.tint}
        />
        {coming === null && phase === null ? (
          <h1 className={MATE_EMPTY_HEADLINE_CLASS}>{mateQuestion(mate)}</h1>
        ) : (
          // Every phase in one box, the tallest's: a new one fades its words in
          // where the last ones began, and nothing around them moves. The
          // phase in view is the heading; a failure carries its own Try again.
          <div
            aria-live="polite"
            className="w-full max-w-2xl"
            data-mate-standup={phase ?? undefined}
            data-standup-headline
          >
            {phrases.map((each, index) => {
              const Words = each.id === shownId ? "h1" : "p";
              return (
                <div
                  aria-hidden={each.id === shownId ? undefined : true}
                  className="flex flex-col items-center gap-3"
                  data-standup-phrase={
                    index === shownAt ? "shown" : index < shownAt ? "past" : "next"
                  }
                  inert={each.id !== shownId}
                  key={each.id}
                >
                  <Words
                    className={cn(
                      MATE_EMPTY_HEADLINE_CLASS,
                      each.id !== "question" && "text-balance",
                    )}
                  >
                    {each.clauses.map((clause, at) => (
                      <Fragment key={clause}>
                        {at === 0 ? null : " "}
                        <span className="inline-block">{clause}</span>
                      </Fragment>
                    ))}
                  </Words>
                  {each.id === "failed" ? (
                    <Button data-mate-standup-retry onClick={onRetry} size="compact" variant="pill">
                      {MATE_STAND_UP_RETRY_LABEL}
                    </Button>
                  ) : null}
                  {/* Under its words, 12 px down as a failure's Try again: how far it has got —
                      the room of the progress line whatever it holds, so the box is as tall in
                      the conversation it hands over to as it was here. */}
                  {each.id === "coming" ? (
                    <div className="flex min-h-6 w-full justify-center" data-mate-coming-below>
                      {coming !== null && coming !== "past" ? coming.below : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
        {/* What hangs below the headline, never moving it; while the Mate comes up, nothing —
            the sign-in fades in once it is up. */}
        <div className="absolute inset-x-0 top-full flex justify-center pt-6">
          {coming === null || coming === "past" ? (
            <SignInBelow
              mate={mate}
              phase={phase}
              signIn={signIn}
              signInRequired={signInRequired}
              unknown={unknown}
            />
          ) : (
            <div className="grid w-full justify-items-center" data-mate-empty-below>
              <StandUpLayer shown={comingNow === null}>
                <SignInBelow
                  mate={mate}
                  phase={phase}
                  signIn={signIn}
                  signInRequired={signInRequired}
                  unknown={unknown}
                />
              </StandUpLayer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Below the headline: the question's sign-in, or the stand-up's. */
function SignInBelow({
  mate,
  phase,
  signIn,
  signInRequired,
  unknown,
}: {
  readonly mate: ZeropsMateIdentity;
  readonly phase: MateStandUpPhase | null;
  readonly signIn: ReactNode | null;
  readonly signInRequired: boolean;
  readonly unknown: KnownMessage | null;
}) {
  return phase === null ? (
    <QuestionSignIn
      mate={mate}
      signIn={signInRequired ? signIn : null}
      unknown={signIn === null ? unknown : null}
    />
  ) : (
    <StandUpSlot phase={phase} signIn={signIn} unknown={unknown} />
  );
}

/** Today's region below the question: the sign-in, or why it cannot be read yet. */
function QuestionSignIn({
  mate,
  signIn,
  unknown,
}: {
  readonly mate: ZeropsMateIdentity;
  readonly signIn: ReactNode | null;
  readonly unknown: KnownMessage | null;
}) {
  if (signIn !== null) {
    return (
      <section className="flex w-full max-w-md flex-col gap-3" data-zerops-surface="mate-sign-in">
        <p className="text-center text-sm text-muted-foreground">
          {mate.name} works through a coding agent. Sign one in to start.
        </p>
        <FlatCard className="overflow-hidden">{signIn}</FlatCard>
      </section>
    );
  }
  return unknown === null ? null : <AgentAuthUnknown unknown={unknown} />;
}

/**
 * Below the stand-up's headline, each in a layer of its own: its Authorize buttons (the headline
 * already says why), bare — the sign-in rows' card drew a white bar behind them — held once the
 * sign-in is known, so a sign-in landing fades them where they stand; and the sign-in still being
 * read.
 */
function StandUpSlot({
  phase,
  signIn,
  unknown,
}: {
  readonly phase: MateStandUpPhase;
  readonly signIn: ReactNode | null;
  readonly unknown: KnownMessage | null;
}) {
  const rows = phase === "sign-in" && signIn !== null;
  const checking = phase === "sign-in" && signIn === null;
  return (
    <div className="grid w-full max-w-md justify-items-center" data-standup-slot>
      {signIn === null ? null : (
        <StandUpLayer shown={rows}>
          <section className="w-full" data-zerops-surface="mate-sign-in">
            {signIn}
          </section>
        </StandUpLayer>
      )}
      {unknown === null ? null : (
        <StandUpLayer shown={checking}>
          <AgentAuthUnknown unknown={unknown} />
        </StandUpLayer>
      )}
    </div>
  );
}

function StandUpLayer({
  shown,
  children,
}: {
  readonly shown: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div
      aria-hidden={shown ? undefined : true}
      className="flex w-full justify-center"
      data-standup-layer={shown ? "shown" : "hidden"}
      inert={!shown}
    >
      {children}
    </div>
  );
}

function AgentAuthUnknown({ unknown }: { readonly unknown: KnownMessage }) {
  return (
    <p
      className={cn(
        "text-center text-sm text-muted-foreground",
        // A placeholder waits a beat before it says anything, so a quick
        // answer never flickers "Checking…".
        unknown.afterMs > 0 && "animate-zerops-appear",
      )}
      data-zerops-surface="mate-agent-auth-unknown"
      style={unknown.afterMs > 0 ? { animationDelay: `${unknown.afterMs}ms` } : undefined}
    >
      {unknown.text}
    </p>
  );
}
