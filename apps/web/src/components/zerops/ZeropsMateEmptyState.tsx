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

  return (
    <>
      <MateEmptyStateView
        mate={mate}
        phase={phase}
        signIn={
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
          )
        }
        signInRequired={signInRequired}
        unknown={agentAuthUnknown}
        onRetry={() => retryMateStandUp(environmentId)}
      />
      {authorizationDialog}
    </>
  );
}

/**
 * The stand-up's two buttons (the owner: "it should say … and the two buttons"): one per agent the
 * Mate offers, each opening that agent's authorization. The headline above already says what a
 * sign-in is for, so no row repeats it with a status.
 */
function StandUpAuthorize({
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
 * The empty conversation as it is drawn, from what it says: its Mate, the stand-up's phase (null
 * for the question), the agents' sign-in rows once their sign-in is known and whether one must be
 * signed in, and — while it is not known — what the agents' region says instead.
 */
export function MateEmptyStateView({
  mate,
  phase,
  signIn,
  signInRequired,
  unknown,
  onRetry,
}: {
  readonly mate: ZeropsMateIdentity;
  readonly phase: MateStandUpPhase | null;
  /** The agents' sign-in rows, once their sign-in is known; null before. */
  readonly signIn: ReactNode | null;
  /** No agent is signed in: nothing typed here could be acted on. */
  readonly signInRequired: boolean;
  readonly unknown: KnownMessage | null;
  readonly onRetry: () => void;
}) {
  const shownPhase = STAND_UP_PHASES.indexOf(phase ?? "sign-in");
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
          className="size-16 sm:size-18"
          size="lg"
          shape={mate.shape}
          state={mateFaceFor(mate.connected, undefined)}
          tint={mate.tint}
        />
        {phase === null ? (
          <h1 className="text-center text-2xl font-normal tracking-tight text-foreground sm:text-3xl">
            {mateQuestion(mate)}
          </h1>
        ) : (
          // Every phase in one box, the tallest's: a new one fades its words in
          // where the last ones began, and nothing around them moves. The
          // phase in view is the heading; a failure carries its own Try again.
          <div
            aria-live="polite"
            className="w-full max-w-2xl"
            data-mate-standup={phase}
            data-standup-headline
          >
            {STAND_UP_PHASES.map((each, index) => {
              const Words = each === phase ? "h1" : "p";
              return (
                <div
                  aria-hidden={each === phase ? undefined : true}
                  className="flex flex-col items-center gap-3"
                  data-standup-phrase={
                    index === shownPhase ? "shown" : index < shownPhase ? "past" : "next"
                  }
                  inert={each !== phase}
                  key={each}
                >
                  <Words className="text-balance text-center text-2xl font-normal tracking-tight text-foreground sm:text-3xl">
                    {mateStandUpHeadlineClauses(mate, each).map((clause, at) => (
                      <Fragment key={clause}>
                        {at === 0 ? null : " "}
                        <span className="inline-block">{clause}</span>
                      </Fragment>
                    ))}
                  </Words>
                  {each === "failed" ? (
                    <Button data-mate-standup-retry onClick={onRetry} size="compact" variant="pill">
                      {MATE_STAND_UP_RETRY_LABEL}
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
        {/* What hangs below the headline, never moving it. */}
        <div className="absolute inset-x-0 top-full flex justify-center pt-6">
          {phase === null ? (
            <QuestionSignIn
              mate={mate}
              signIn={signInRequired ? signIn : null}
              unknown={signIn === null ? unknown : null}
            />
          ) : (
            <StandUpSlot phase={phase} signIn={signIn} unknown={unknown} />
          )}
        </div>
      </div>
    </div>
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
 * Below the stand-up's headline, each in a layer of its own: the sign-in rows (the headline
 * already says why) — held once the sign-in is known, so a sign-in landing fades them where they
 * stand — and the sign-in still being read.
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
            <FlatCard className="overflow-hidden">{signIn}</FlatCard>
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
