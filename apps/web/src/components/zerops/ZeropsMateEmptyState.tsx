import { CircleAlertIcon, CircleHelpIcon } from "lucide-react";
/**
 * An empty conversation with a Mate, and the Mate's own view before the conversation exists
 * (`ZeropsMateComingPage`): the approved "Arrival" board's stage (`mateArrival.ts`). The Mate's
 * face a third of the way down — its shape in its colour, asleep until it answers — one headline
 * under it, one sentence under that, and one slot under the sentence. Every state from the press
 * to the first answer changes those words and that slot, never their places: the face and the
 * headline stand where "What should Fen do on Acme Docs?" will stand.
 *
 * - Coming up, the Mate's own steps in the slot, with their times.
 * - No agent signed in yet — the person who added it, a colleague, anyone — "Sign Fen in to
 *   start." over the sign-in itself (`ZeropsAgentSignIn`); only the sentence differs. Once its
 *   person signs in, the Mate's server stands development up itself (`mateStandUp.ts`); until
 *   the ask shows in the conversation the face works.
 * - Ready: the question the composer answers.
 *
 * A new state's words arrive where the last ones began and the slot hands over in place
 * (`ArrivalSwap`); the conversation the Mate's own view hands over to paints that same frame at
 * once. Who the Mate is comes from `useZeropsMate` (the caller resolves it, so a conversation
 * nobody lives in keeps upstream's empty line); whether a sign-in is required is
 * `zeropsAgentSignInRequired` over the environment's agent-auth feed once it is known — and its
 * provider instances, where an agent Mate signs nobody in to may already be ready — and until
 * then the slot says it is checking, or why it could not.
 */
import { signInReadSettled } from "@t3tools/client-runtime/zerops/conversationWriter";
import { useMateStandUp } from "../../zerops/useMateStandUp";
import { Button } from "../ui/button";
import { mateArriving, resolvePrimaryConversation } from "@t3tools/client-runtime/zerops";
import {
  birthRuntimesFacts,
  type BirthRuntimeFact,
} from "@t3tools/client-runtime/zerops/birthProgress";
import {
  zeropsAgentAuthView,
  zeropsAgentSignInRequired,
  zeropsOtherAgentReady,
} from "@t3tools/client-runtime/zerops/agentLogin";
import type { KnownMessage } from "@t3tools/client-runtime/zerops/knowledge";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";

import { MATE_SHAPE_OF_TINT, MATE_TINT_IDS, type MateMarkState } from "@t3tools/shared/brand";
import { cn } from "~/lib/utils";

import { useServerConfigs, useThreadShells } from "../../state/entities";
import {
  arrivalFace,
  arrivalHeadlineClauses,
  arrivalSentence,
  type ArrivalKind,
} from "../../zerops/mateArrival";
import type { MateViewKind } from "../../zerops/mateComing";
import type { ZeropsMateIdentity } from "../../zerops/mateIdentities";
import {
  mateStandUpPhase,
  mateStandUpSignedIn,
  type MateStandUpPhase,
} from "../../zerops/mateStandUp";
import { useZeropsEnvironmentProject } from "../../zerops/useZeropsEnvironmentProject";
import { useProjectServices } from "../../zerops/ZeropsAccountData";
import { useZeropsAgentAuth } from "../../zerops/useZeropsFeeds";
import { useNowMs } from "../../zerops/useNowMs";
import { useChangeCue } from "../../zerops/useMateMoments";
import { standUpDoneCue } from "../../zerops/mateMoments.logic";
import { useHqPersonNames } from "../../zerops/useZeropsMateOwners";
import { useZeropsSessionOptional } from "../../zerops/ZeropsSessionProvider";
import { restartLine } from "~/zerops/restartLine";

import { ArrivalSwap } from "./ArrivalSwap";
import { ArrivalRuntimesLine } from "./ZeropsArrivalSteps";
import { MateFace } from "./primitives";
import { ZeropsAgentSignIn } from "./ZeropsAgentSignIn";

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
    <MateEmptyStateView
      addedBy={state.addedBy}
      agentReady={state.agentReady}
      mate={mate}
      phase={state.phase}
      standUpFailure={state.standUpFailure}
      runtimes={state.runtimes}
      signIn={state.signIn}
      signInRequired={state.signInRequired}
      unknown={state.unknown}
    />
  );
}

/** What an empty conversation with a Mate says. */
export interface MateEmptyState {
  /** The stand-up's phase for this viewer, or `null` where it is not theirs. */
  readonly phase: MateStandUpPhase | null;
  readonly standUpFailure?: { readonly retrying: boolean; readonly retry: () => void } | undefined;
  /** The sign-in, once the agents' sign-in is known; null before. */
  readonly signIn: ReactNode | null;
  readonly signInRequired: boolean;
  /**
   * An agent Mate signs nobody in to (Cursor, OpenCode…) is ready, and no sign-in of the viewer's
   * is: what the stand-up waits on is not a sign-in.
   */
  readonly agentReady: boolean;
  readonly unknown: KnownMessage | null;
  /**
   * Whether the agents' sign-in read has ended — read, or failed (`signInReadSettled`): the
   * conversation's first paint says it whole.
   */
  readonly signInKnown: boolean;
  /**
   * A colleague's view of a Mate nobody has signed in: who added it, by name where it is known
   * (null where not); undefined for anybody else.
   */
  readonly addedBy: string | null | undefined;
  /** Its project's runtimes, as its project's read lists them; undefined while it is unread. */
  readonly runtimes: ReadonlyArray<BirthRuntimeFact> | undefined;
}

/**
 * The empty conversation's reading of its Mate: whose stand-up it is and where it stands, and the
 * agents' sign-in — for the conversation, and for the Mate's own view that hands over to it
 * (`ZeropsMateComingPage`), so the two say one thing. With no environment yet, nothing is read.
 */
export function useMateEmptyState({
  environmentId,
  mate,
  threadRef,
  projectId,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly mate: ZeropsMateIdentity;
  readonly threadRef: ScopedThreadRef | null;
  /** Its project, where the caller knows it before its environment's record says it. */
  readonly projectId?: string | undefined;
}): MateEmptyState {
  const agentAuthRead = useZeropsAgentAuth(environmentId);
  const { snapshot: agentAuth, unknown: agentAuthUnknown } = zeropsAgentAuthView(agentAuthRead);
  // Only a known snapshot can ask for a sign-in; one still being read says so. An agent outside
  // the sign-in (Cursor, OpenCode…) that is ready asks for none.
  const serverConfigs = useServerConfigs();
  const providers =
    environmentId === null ? undefined : serverConfigs.get(environmentId)?.providers;
  const signInRequired = agentAuth !== null && zeropsAgentSignInRequired(agentAuth, providers);
  const viewerSubject = useZeropsSessionOptional()?.user?.id;
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
  const viewerSignedIn =
    agentAuth !== null &&
    viewerSubject !== undefined &&
    mateStandUpSignedIn(agentAuth, viewerSubject);
  const agentReady = !viewerSignedIn && zeropsOtherAgentReady(providers);
  const standUp = useMateStandUp({ environmentId, threadRef, messageCount: 0 });
  const phase = mateStandUpPhase({
    marker: mate.standUp,
    viewer: viewerSubject,
    main,
    signIn:
      agentAuth === null
        ? "unknown"
        : signInRequired
          ? "required"
          : viewerSignedIn || agentReady
            ? "signed-in"
            : "someone-else",
  });
  // Somebody else added it and nobody has signed it in: the sentence names them — whichever flow
  // made it, as its row does (`mateOwnerView`).
  const adder = mate.madeBy ?? mate.standUp?.by;
  const colleague =
    phase === null && signInRequired && adder !== undefined && adder !== viewerSubject;
  const project = useZeropsEnvironmentProject(environmentId);
  // Its runtimes as its project's read lists them: the sign-in names the ones still coming up.
  const listed = useProjectServices(projectId ?? project?.projectId).services;
  const runtimes = useMemo(
    () =>
      listed === undefined ? undefined : (birthRuntimesFacts({ services: listed })?.runtimes ?? []),
    [listed],
  );
  const nameOf = useHqPersonNames(project?.orgId);

  return {
    phase,
    standUpFailure: standUp.sendFailed
      ? {
          retrying: standUp.retrying,
          retry: () => {
            void standUp.retry();
          },
        }
      : undefined,
    signIn:
      agentAuth === null ? null : (
        <ZeropsAgentSignIn
          environmentId={environmentId}
          mateName={mate.name}
          threadRef={threadRef}
        />
      ),
    signInRequired,
    agentReady,
    unknown: agentAuthUnknown,
    signInKnown: signInReadSettled(agentAuthRead),
    addedBy: colleague && adder !== undefined ? (nameOf(adder) ?? null) : undefined,
    runtimes,
  };
}

/**
 * Who the view is of: a Mate's identity, its project on Zerops or not — a New project's first
 * Mate is drawn before the platform has made it (`ZeropsNewProjectComingPage`).
 */
type DrawnMate = Omit<ZeropsMateIdentity, "projectUrl">;

/**
 * The places a Mate not yet named holds: a face's room, drawn unseen, and a
 * headline's line with no words — the named view's footprint, so nothing moves when it arrives.
 */
const UNNAMED: DrawnMate = {
  name: "\u00a0",
  tint: MATE_TINT_IDS[0],
  shape: MATE_SHAPE_OF_TINT[MATE_TINT_IDS[0]],
  project: undefined,
  connected: false,
};

/**
 * A Mate still coming up, one that never came, or one on its way to its conversation, as its own
 * view draws it (`ZeropsMateComingPage`): the kind of headline, the sentence under it where the
 * view has its own, and what stands in the slot — how far it has got, what it waits for, or what
 * can be done about it.
 */
export interface MateEmptyComing {
  readonly face?: MateMarkState | undefined;
  readonly severity?: "info" | "attention" | "danger" | undefined;
  /** A source-backed link state speaks as the Mate in the headline. */
  readonly headline?: string | undefined;
  /** Its container is restarting: its face plays the restart while it lasts. */
  readonly restarting?: boolean | undefined;
  readonly kind: MateViewKind;
  readonly below: ReactNode;
  /** The sentence under the headline: how long is left, or why it stopped. */
  readonly sentence?: string | undefined;
  /** It is up: the state it moves into is read, and its words hand over to it. */
  readonly over?: boolean;
  /**
   * Made by a press this tab ran: its sentence turns from keeping the tab open to a stop, and back
   * on *Try again*. On a narrow screen one wraps and the other does not, so the sentence holds two
   * lines' room from the press, and none of it moves the rows under it.
   */
  readonly pressed?: boolean;
}

/**
 * The opening's headline and its face's size, which a crewmate's empty
 * conversation shares (`CrewmateEmptyState`), so a switch between the two
 * keeps the face where it stood.
 */
export const MATE_EMPTY_HEADLINE_CLASS =
  "text-center text-2xl font-normal tracking-tight text-foreground sm:text-3xl";
export const MATE_EMPTY_FACE_CLASS = "size-16 sm:size-18";

/** What the stage says, from where the Mate is and whose stand-up it is. */
export function mateArrivalKind(input: {
  readonly coming: MateEmptyComing | null;
  readonly phase: MateStandUpPhase | null;
  readonly signInRequired: boolean;
  readonly addedBy: string | null | undefined;
}): ArrivalKind {
  const { coming, phase } = input;
  if (coming !== null && coming.over !== true) {
    return coming.kind === "failed" ? "coming-failed" : coming.kind;
  }
  if (phase === "sign-in") return "sign-in";
  if (phase === "standing-up") return "standing-up";
  if (!input.signInRequired) return "question";
  return input.addedBy === undefined ? "sign-in-plain" : "sign-in-colleague";
}

const SIGN_IN_KINDS: ReadonlySet<ArrivalKind> = new Set([
  "sign-in",
  "sign-in-plain",
  "sign-in-colleague",
]);

/**
 * The stage as it is drawn, from what it says: its Mate, the stand-up's phase (null where it is
 * not this viewer's), the sign-in once the agents' sign-in is known and whether one is required,
 * and — while it is not known — what the slot says instead. Before the conversation exists, the
 * same stage is the Mate's own view while it comes up (`coming`), its steps in the slot.
 */
export function MateEmptyStateView({
  mate: named,
  phase,
  standUpFailure,
  signIn,
  signInRequired,
  unknown,
  coming = null,
  addedBy,
  agentReady = false,
  runtimes,
  focusOnArrival = false,
}: {
  /** Null while the directory has not named the Mate: its places held, empty. */
  readonly mate: DrawnMate | null;
  readonly phase: MateStandUpPhase | null;
  readonly standUpFailure?: { readonly retrying: boolean; readonly retry: () => void } | undefined;
  /** The sign-in, once the agents' sign-in is known; null before. */
  readonly signIn: ReactNode | null;
  /** No agent is signed in: nothing typed here could be acted on. */
  readonly signInRequired: boolean;
  readonly unknown: KnownMessage | null;
  /** Still coming up (or never came, or on its way to its conversation). */
  readonly coming?: MateEmptyComing | null;
  /** A colleague's view of a Mate nobody has signed in (`MateEmptyState.addedBy`). */
  readonly addedBy?: string | null | undefined;
  /** Its agent needs no sign-in, and none of the viewer's made it ready (`MateEmptyState`). */
  readonly agentReady?: boolean | undefined;
  /** Its project's runtimes: under the sign-in, the ones still coming up; undefined while unread. */
  readonly runtimes?: ReadonlyArray<BirthRuntimeFact> | undefined;
  /**
   * Landed on from a press, the dialog gone: the headline takes the focus where nothing else holds
   * it, and reads with the sentence under it.
   */
  readonly focusOnArrival?: boolean;
}) {
  const mate = named ?? UNNAMED;
  const headline = useRef<HTMLHeadingElement>(null);
  const arrived = useRef(false);
  useEffect(() => {
    if (!focusOnArrival || arrived.current) return;
    arrived.current = true;
    const holder = document.activeElement;
    if (holder !== null && holder !== document.body) return;
    headline.current?.focus({ preventScroll: true });
  }, [focusOnArrival]);
  const kind = mateArrivalKind({
    coming,
    phase: standUpFailure === undefined ? phase : null,
    signInRequired,
    addedBy,
  });
  // The minute clock its pose reads: it wakes only while it arrives (`mateArriving`).
  const nowMs = useNowMs();
  // On its way to its conversation, a Mate whose link has no words of its own says it opens it.
  const opening =
    coming !== null &&
    coming.over !== true &&
    (coming.kind === "reaching" || coming.kind === "unreachable");
  const clauses =
    coming?.headline !== undefined
      ? [coming.headline]
      : opening
        ? [`${named?.name || "The Mate"} is opening the conversation.`]
        : arrivalHeadlineClauses(mate, kind);
  const sentence =
    coming !== null && coming.over !== true && coming.sentence !== undefined
      ? coming.sentence
      : opening
        ? "Picking up where you left off."
        : arrivalSentence(mate, kind, { addedBy: addedBy ?? undefined, agentReady });
  const slot =
    standUpFailure === undefined
      ? arrivalSlot({ kind, coming, signIn, unknown, runtimes })
      : {
          id: "stand-up-failed",
          node: (
            <div className="flex flex-col items-center gap-3" role="status">
              <p>The message to {mate.name} didn't go through.</p>
              <Button
                variant="outline"
                size="sm"
                disabled={standUpFailure.retrying}
                onClick={standUpFailure.retry}
              >
                {standUpFailure.retrying ? "Trying again…" : "Try again"}
              </Button>
            </div>
          ),
        };

  // A press's words change while its steps run, stop and go again: on a narrow screen each holds
  // two lines' room, so none of it moves the rows under them.
  const pressed = coming?.pressed === true && coming.over !== true ? "" : undefined;
  return (
    <ArrivalComposition
      clauses={clauses}
      headline={headline}
      kind={kind}
      mate={named}
      pressed={pressed}
      restarting={coming?.restarting === true}
      sentence={sentence}
      severity={coming?.severity}
      slot={slot}
      state={
        coming?.face ?? arrivalFace(kind, mate.connected, mateArriving(mate.arrivingUntil, nowMs))
      }
      status={opening}
    />
  );
}

/**
 * Every opening state's one composition: the face centred on top, the headline, the line under it
 * and the slot under that, each place handing over in place (`ArrivalSwap`) — so a state changing
 * keeps the face where it stands, its words cross-fade, and nothing is drawn anew.
 */
function ArrivalComposition({
  kind,
  mate,
  state,
  restarting,
  severity,
  clauses,
  sentence,
  slot,
  pressed,
  status,
  headline,
}: {
  readonly kind: ArrivalKind;
  /** Null while the directory has not named the Mate: its face's place held, empty. */
  readonly mate: DrawnMate | null;
  readonly state: MateMarkState;
  readonly restarting: boolean;
  readonly severity: MateEmptyComing["severity"];
  readonly clauses: ReadonlyArray<string>;
  readonly sentence: string;
  readonly slot: { readonly id: string; readonly node: ReactNode };
  readonly pressed: "" | undefined;
  /** It speaks a wait or a refusal: the composition is the page's status. */
  readonly status: boolean;
  readonly headline?: RefObject<HTMLHeadingElement | null>;
}) {
  const sentenceId = useId();
  // Standing up, it paces the headline's width; done, it gives a satisfied little dance.
  const pacing = kind === "standing-up" && slot.id !== "stand-up-failed";
  const [headlineWords, setHeadlineWords] = useState<HTMLSpanElement | null>(null);
  const [faceElement, setFaceElement] = useState<HTMLDivElement | null>(null);
  const pace = useHeadlineReach(headlineWords, faceElement, pacing);
  const [restart, setRestart] = useState({ active: restarting, cycle: 0 });
  if (restart.active !== restarting) setRestart({ active: restarting, cycle: 0 });
  const spokenSentence = restarting
    ? restartLine(mate?.name ?? "The Mate", restart.cycle)
    : sentence;
  const stoodUp = useChangeCue<string>(kind, () => undefined, standUpDoneCue);
  return (
    <div
      className="flex h-full flex-col items-center px-5 sm:px-6"
      data-arrival={kind}
      data-zerops-surface="mate-empty-state"
    >
      {/* The face's place, a third of the way down whatever is said under it:
          every Mate's opening, in every state, puts its face where the last did. */}
      <div aria-hidden="true" className="shrink-0 basis-1/3" />
      <div
        className="flex w-full flex-col items-center"
        data-mate-empty-lead
        role={status ? "status" : undefined}
      >
        {/* Until the directory names the Mate, its face's place is held, empty: no guessed face. */}
        {mate === null ? (
          <div aria-hidden="true" className={MATE_EMPTY_FACE_CLASS} data-mate-face-reserved="" />
        ) : (
          <div ref={setFaceElement}>
            <MateFace
              className={MATE_EMPTY_FACE_CLASS}
              greets="detail"
              onRestartCycle={() =>
                setRestart((current) => ({ ...current, cycle: current.cycle + 1 }))
              }
              cues={stoodUp === undefined ? undefined : [stoodUp]}
              paces={pacing}
              restarting={restarting}
              shape={mate.shape}
              size="lg"
              state={state}
              style={{ "--mate-face-pace": `${pace}px` } as CSSProperties}
              tint={mate.tint}
              tracks
            />
          </div>
        )}
        <ArrivalSwap
          className="mt-6 w-full max-w-2xl"
          data-arrival-headline=""
          id={clauses.join(" ")}
          kind="words"
        >
          <h1
            aria-describedby={spokenSentence.length === 0 ? undefined : sentenceId}
            aria-live="polite"
            className={cn(MATE_EMPTY_HEADLINE_CLASS, "arrival-headline text-balance outline-none")}
            data-pressed={pressed}
            ref={headline}
            tabIndex={-1}
          >
            {/* One run of words, set on the room's last lines where it holds more than it says. */}
            <span ref={setHeadlineWords}>
              <SeverityMark severity={severity} />
              {clauses.map((clause, at) => (
                <Fragment key={clause}>
                  {at === 0 ? null : " "}
                  <span className="inline-block">{clause}</span>
                </Fragment>
              ))}
            </span>
          </h1>
        </ArrivalSwap>
        {spokenSentence.length === 0 ? null : (
          <ArrivalSwap
            className="mt-2 w-full max-w-2xl"
            data-arrival-sentence=""
            domId={sentenceId}
            id={spokenSentence}
            kind="words"
            live="polite"
          >
            <p className="arrival-sentence" data-pressed={pressed}>
              {spokenSentence}
            </p>
          </ArrivalSwap>
        )}
        <ArrivalSwap
          className="mt-7 w-full max-w-126"
          data-arrival-slot={slot.id}
          id={slot.id}
          kind="slot"
        >
          {slot.node}
        </ArrivalSwap>
      </div>
    </div>
  );
}

/**
 * How far either way of centre the face may pace under a headline: half its words' width, less
 * half the face. Measured when the headline's layout changes, never per frame.
 */
function useHeadlineReach(
  words: HTMLElement | null,
  face: HTMLElement | null,
  measuring: boolean,
): number {
  const [reach, setReach] = useState(0);
  useLayoutEffect(() => {
    if (!measuring || words === null || face === null) return;
    const measure = () =>
      setReach(
        Math.max(0, (words.getBoundingClientRect().width - face.getBoundingClientRect().width) / 2),
      );
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(words.parentElement ?? words);
    observer.observe(face);
    return () => observer.disconnect();
  }, [words, face, measuring]);
  return reach;
}

/** What stands in the slot under the sentence, and the name its hand-overs go by. */
function arrivalSlot(input: {
  readonly kind: ArrivalKind;
  readonly coming: MateEmptyComing | null;
  readonly signIn: ReactNode | null;
  readonly unknown: KnownMessage | null;
  readonly runtimes: ReadonlyArray<BirthRuntimeFact> | undefined;
}): { readonly id: string; readonly node: ReactNode } {
  const { kind, coming, signIn, unknown } = input;
  switch (kind) {
    case "coming":
    case "coming-failed":
    case "reaching":
    case "unreachable":
      return { id: kind, node: coming?.below ?? null };
    case "standing-up":
      return { id: "none", node: null };
    default:
      if (SIGN_IN_KINDS.has(kind) && signIn !== null) {
        return {
          id: "sign-in",
          node: (
            <section aria-label="Sign in" data-zerops-surface="mate-sign-in">
              {signIn}
              {/* The runtimes still coming up: the stand-up's run card carries them from there. */}
              <ArrivalRuntimesLine runtimes={input.runtimes} />
            </section>
          ),
        };
      }
      if (signIn === null && unknown !== null) {
        return { id: "checking", node: <AgentAuthUnknown unknown={unknown} /> };
      }
      return { id: "none", node: null };
  }
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

/**
 * A source-backed wait or refusal over a conversation that cannot show yet: the same composition
 * as every opening state — the face centred on top, the headline, the line under it, its actions
 * — so a state changing in place keeps the face where it stands and only its words cross-fade.
 */
export function MateConnectionState({
  mate,
  face,
  headline,
  secondary,
  actions,
  severity = "info",
}: {
  readonly severity?: "info" | "attention" | "danger" | undefined;
  readonly mate: DrawnMate | null;
  readonly face: MateMarkState;
  readonly headline: string;
  readonly secondary: string;
  readonly actions: ReactNode;
}) {
  return (
    <ArrivalComposition
      clauses={[headline]}
      kind="reaching"
      mate={mate}
      pressed={undefined}
      restarting={false}
      sentence={secondary}
      severity={severity}
      slot={{ id: "reaching", node: actions }}
      state={face}
      status
    />
  );
}

/** What a wait that needs the person, or a refusal, wears before its headline. */
function SeverityMark({ severity }: { readonly severity: MateEmptyComing["severity"] }) {
  if (severity === undefined || severity === "info") return null;
  return severity === "danger" ? (
    <CircleAlertIcon aria-hidden="true" className="me-2 inline size-5 align-[-0.15em] text-error" />
  ) : (
    <CircleHelpIcon
      aria-hidden="true"
      className="me-2 inline size-5 align-[-0.15em] text-status-attention"
    />
  );
}
