import { setupFailureReason } from "@t3tools/client-runtime/data";
/**
 * A Mate's arrival, in every state, at the owner's size (1786 × 1000, the menu at 435): the
 * approved "Arrival" board's Direction A and its sign-in S1, drawn by the real stage
 * (`MateEmptyStateView`), the real steps (`ComingBelow`, `arrivalSteps`), the real sign-in
 * (`AgentSignInView`) and the real quiet line (`StandUpAskLine`), over fixtures.
 *
 * The sign-in answers as a Mate would: choosing a card starts its login, whose page is ready
 * 0.7 s later; a pasted code is checked for 1.2 s and signs in, and the stage moves on to the
 * stand-up and the conversation. Moving between states keeps the stage mounted, so every change
 * of state plays the hand-over it would play live.
 *
 * Served by the dev server at `/design-arrival.html` — `?state=<id>` for the state it opens on
 * (coming, coming-new, signin, signin-claude, signin-codex, checking-code, signin-failed,
 * terminal, standing-up, conversation, not-created, colleague, crew, dialog), `?theme=dark`.
 * `window.__arrivalHarness.go(id)` moves to a state from a script. Fixtures only: nothing here
 * ships, and no route imports this module.
 */
import {
  deriveBirthProgress,
  type BirthCopyService,
  type BirthFacts,
  type BirthRuntimeFact,
} from "@t3tools/client-runtime/zerops/birthProgress";
import type { KnownMessage } from "@t3tools/client-runtime/zerops/knowledge";
import { emptyAgentPanelModel } from "@t3tools/client-runtime/state/subagentRuntime";
import { EnvironmentId, type ZeropsAgentId, type ZeropsAgentLoginState } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { StandUpAskLine } from "~/components/chat/ConversationRows";
import { RunLine } from "~/components/chat/RunChat";
import {
  TimelineRowActivityCtx,
  TimelineRowCtx,
  type TimelineRowActivityState,
  type TimelineRowSharedState,
} from "~/components/chat/timelineContext";
import { Button } from "~/components/ui/button";
import { Dialog } from "~/components/ui/dialog";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import { MateFace } from "~/components/zerops/primitives";
import {
  AgentSignInView,
  ZeropsAgentSignInDialogPopup,
  type SignInAgent,
} from "~/components/zerops/ZeropsAgentSignIn";
import {
  ComingBelow,
  comingSentenceOf,
  type ArrivalProgress,
} from "~/components/zerops/ZeropsMateComingPage";
import { MateLinkLineView, MateLinkProcessesView } from "~/components/zerops/MateLinkLine";
import { MateEmptyStateView, type MateEmptyComing } from "~/components/zerops/ZeropsMateEmptyState";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import {
  arrivalHeaderFace,
  type ArrivalService,
  type ArrivalStepInput,
} from "~/zerops/mateArrival";
import { askAgainLabel, type MateVoice } from "@t3tools/client-runtime/zerops/environments";
import type { MateComing } from "~/zerops/mateComing";
import type { ZeropsMateIdentity } from "~/zerops/mateIdentities";
import { mateStandUpAskLine, type MateStandUpPhase } from "~/zerops/mateStandUp";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";

const ADA = "u-ada";
const WREN: ZeropsMateIdentity = {
  name: "Wren",
  tint: "slate",
  shape: "squircle",
  project: "Acme Docs",
  projectUrl: "https://app.zerops.io/project/harness",
  connected: true,
  standUp: { by: ADA },
};
const VERA: ZeropsMateIdentity = {
  ...WREN,
  name: "Vera",
  tint: "rose",
  shape: "flower",
  project: "Acme Shop",
  connected: false,
};
const YOU = { initials: "AR", avatarUrl: null };

const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();

/** 44 s into its workspace: its copy of the project made in 25 s, the container being created. */
function creatingFacts(): BirthFacts {
  return {
    project: { status: "ACTIVE", createdAt: ago(69) },
    container: { serviceId: "zcp", status: "CREATING", hasOrigin: false },
    processes: [
      {
        actionName: "project.create",
        status: "FINISHED",
        createdAt: ago(69),
        startedAt: ago(69),
        finishedAt: ago(44),
        serviceIds: [],
      },
      {
        actionName: "stack.create",
        status: "RUNNING",
        createdAt: ago(40),
        startedAt: ago(40),
        finishedAt: null,
        serviceIds: ["zcp"],
      },
    ],
    health: undefined,
    connection: "none",
  };
}

/**
 * The copy's managed services, what its first step waits on — shaped like a live add (2026-09-30:
 * the project made at +40 s, its data services up by +87 s).
 */
const MANAGED: ReadonlyArray<BirthCopyService> = [
  { hostname: "db", state: "done" },
  { hostname: "cache", state: "done" },
  { hostname: "storage", state: "done" },
  { hostname: "search", state: "active" },
];

/**
 * The runtimes its workspace imports once the project is closed off, in the recipe's order: the
 * utility's build and the dev halves under way, the stage halves waiting for a first deploy.
 */
const RUNTIMES = {
  runtimes: [
    { hostname: "mailpit", role: "utility", state: "active" },
    { hostname: "appdev", role: "dev", state: "active" },
    { hostname: "webdev", role: "dev", state: "waiting" },
    { hostname: "appstage", role: "stage", state: "waiting" },
    { hostname: "webstage", role: "stage", state: "waiting" },
  ],
} as const;

function comingProgress(
  kind: "coming" | "coming-new" | "not-created",
  nowMs: number,
): ArrivalProgress {
  const mate = deriveBirthProgress(creatingFacts(), nowMs);
  if (kind === "coming-new") {
    const steps: ReadonlyArray<ArrivalStepInput> = [
      { id: "hq", label: "HQ", state: "done" },
      { id: "registry", label: "Acme Shop", state: "done" },
      ...mate.steps,
    ];
    return { ...mate, steps, startedAt: ago(96) };
  }
  if (kind === "not-created") {
    const steps = mate.steps.map((step): ArrivalStepInput =>
      step.id === "container"
        ? { ...step, state: "failed", detail: "It could not be created." }
        : step.state === "active"
          ? { ...step, state: "waiting" }
          : step,
    );
    return { ...mate, steps, managed: MANAGED.map((service) => ({ ...service, state: "done" })) };
  }
  return { ...mate, managed: MANAGED, runtimes: { ...RUNTIMES, state: "active", up: 0, total: 5 } };
}

const CLAUDE_URL = "https://claude.example/oauth/authorize?code=true";
const OPENAI_URL = "https://openai.example/codex/device";
const DEVICE_CODE = "K7QF-2M9D";

type Logins = Partial<Record<ZeropsAgentId, ZeropsAgentLoginState>>;

const login = (
  agentId: ZeropsAgentId,
  phase: ZeropsAgentLoginState["phase"],
  extra: Partial<ZeropsAgentLoginState> = {},
): ZeropsAgentLoginState => ({
  phase,
  terminalId: `agent-login-${agentId}`,
  startedAt: DateTime.makeUnsafe(Date.now() - 20_000),
  ...(phase === "starting" || phase === "menu"
    ? {}
    : agentId === "codex"
      ? { url: OPENAI_URL, code: DEVICE_CODE }
      : { url: CLAUDE_URL }),
  ...extra,
});

interface HarnessState {
  readonly id: string;
  readonly label: string;
  readonly mate: ZeropsMateIdentity;
  readonly phase: MateStandUpPhase | null;
  readonly coming?: "coming" | "coming-new" | "not-created" | "reaching";
  /** A Mate that is up, as its link's one voice says it (`mateVoice`). */
  readonly voice?: MateVoice;
  readonly logins?: Logins;
  readonly addedBy?: string | null;
  readonly unknown?: KnownMessage;
  readonly conversation?: boolean;
  readonly dialog?: ZeropsAgentId;
  /** The dialog's agent holds a colleague's sign-in: their name. */
  readonly heldBy?: string;
  readonly crew?: boolean;
  readonly watching?: boolean;
}

const STATES: ReadonlyArray<HarnessState> = [
  {
    id: "coming",
    label: "1 Coming up · 1:09 after Add",
    mate: { ...WREN, connected: false },
    phase: "sign-in",
    coming: "coming",
  },
  {
    id: "coming-new",
    label: "1 Coming up · a New project's first Mate",
    mate: VERA,
    phase: "sign-in",
    coming: "coming-new",
  },
  {
    id: "connecting",
    label: "0 Opening · the first 1.5 s: the face and the name, nothing said",
    mate: { ...WREN, connected: false },
    phase: null,
    coming: "reaching",
    voice: { surface: "stage", text: null, actions: [], processes: false },
  },
  {
    id: "opening",
    label: "0 Opening · past 1.5 s: its line and the platform's processes",
    mate: { ...WREN, connected: false },
    phase: null,
    coming: "reaching",
    voice: { surface: "stage", text: "Opening Wren…", actions: [], processes: true },
  },
  {
    id: "restarting",
    label: "0 Restarting · a reload while Zerops restarts it",
    mate: { ...WREN, connected: false },
    phase: null,
    coming: "reaching",
    voice: { surface: "stage", text: "Wren is restarting.", actions: [], processes: false },
  },
  {
    id: "reconnecting",
    label: "0 Reconnecting · its link lost past 1.5 s, no conversation shown",
    mate: { ...WREN, connected: false },
    phase: null,
    coming: "reaching",
    voice: {
      surface: "stage",
      text: "Reconnecting to Wren…",
      actions: ["try-now"],
      processes: false,
    },
  },
  { id: "signin", label: "2 Sign-in · the choice", mate: WREN, phase: "sign-in", logins: {} },
  {
    id: "signin-claude",
    label: "2 Sign-in · Claude, its page ready",
    mate: WREN,
    phase: "sign-in",
    logins: { "claude-code": login("claude-code", "awaiting-browser") },
  },
  {
    id: "signin-codex",
    label: "2 Sign-in · Codex, its code to type",
    mate: WREN,
    phase: "sign-in",
    logins: { codex: login("codex", "awaiting-browser") },
  },
  {
    id: "checking-code",
    label: "2 Sign-in · Claude's code being checked",
    mate: WREN,
    phase: "sign-in",
    logins: { "claude-code": login("claude-code", "verifying-code") },
  },
  {
    id: "signin-failed",
    label: "2 Sign-in · it didn't finish",
    mate: WREN,
    phase: "sign-in",
    logins: { codex: login("codex", "awaiting-browser") },
  },
  {
    id: "terminal",
    label: "2 Sign-in · what's happening",
    mate: WREN,
    phase: "sign-in",
    logins: { "claude-code": login("claude-code", "awaiting-browser") },
    watching: true,
  },
  {
    id: "standing-up",
    label: "3 Signed in · the ask on its way",
    mate: WREN,
    phase: "standing-up",
  },
  {
    id: "conversation",
    label: "3 The conversation · the ask, quietly",
    mate: WREN,
    phase: null,
    conversation: true,
  },
  {
    id: "not-created",
    label: "4 Stopped · it could not be added",
    mate: { ...WREN, connected: false },
    phase: "sign-in",
    coming: "not-created",
  },
  {
    id: "colleague",
    label: "5 A colleague · nobody signed it in",
    mate: WREN,
    phase: null,
    addedBy: "Mira",
    logins: {},
  },
  {
    id: "crew",
    label: "5 The Crew tab · no agent yet",
    mate: WREN,
    phase: null,
    addedBy: null,
    logins: {},
    crew: true,
  },
  {
    id: "dialog",
    label: "6 The sign-in in a dialog (picker, band)",
    mate: WREN,
    phase: null,
    conversation: true,
    dialog: "claude-code",
  },
  {
    id: "dialog-held",
    label: "6 The sign-in in a dialog, over a colleague's sign-in",
    mate: WREN,
    phase: null,
    conversation: true,
    dialog: "codex",
    heldBy: "Ann",
  },
];

const SHARED: TimelineRowSharedState = {
  timestampFormat: "24-hour",
  routeThreadKey: "harness",
  threadRef: null,
  markdownCwd: undefined,
  resolvedTheme: appearance,
  workspaceRoot: undefined,
  skills: [],
  activeThreadEnvironmentId: EnvironmentId.make("environment-harness"),
  onRevertToTurnCount: () => undefined,
  onRunShellCommand: undefined,
  onImageExpand: () => undefined,
  onOpenTurnDiff: () => undefined,
  speaker: { name: WREN.name, tint: WREN.tint, shape: WREN.shape },
  standUpAsk: mateStandUpAskLine(WREN, "you"),
  livePauseId: null,
  usagePause: null,
  onUsageAutoResumeChange: null,
  agentPanelModel: emptyAgentPanelModel(),
  onOpenAgents: () => undefined,
  onStopBackgroundWork: () => undefined,
  onSteerQueuedMessage: () => undefined,
  steerQueuedMessageShortcutLabel: null,
  onRemoveQueuedMessage: () => undefined,
  arrivedAfter: null,
  syncing: false,
  onHoldReading: () => undefined,
};

/** The model's first run, under way. */
const WORKING: TimelineRowActivityState = {
  isWorking: true,
  isCompacting: false,
  isRevertingCheckpoint: false,
  latestTurnId: null,
  workingStepLabel: null,
  stoppingBackgroundWork: false,
};

const TERMINAL: Record<ZeropsAgentId, string> = {
  "claude-code": `$ claude /login\nBrowser didn't open? Use the url below to sign in\n${CLAUDE_URL}&state=…\nPaste code here if prompted >`,
  codex: `$ codex login --device-auth\nOpen this link in your browser and sign in to your account\n${OPENAI_URL}\nThen enter this one-time code: ${DEVICE_CODE}\nWaiting for you to finish…`,
};

/** An attempt's own start, carried to its next phase. */
const startedOf = (attempt: ZeropsAgentLoginState | undefined) =>
  attempt === undefined ? {} : { startedAt: attempt.startedAt };

/** The sign-in as a Mate answers it: a login's page ready in 0.7 s, a pasted code in 1.2 s. */
function useFixtureSignIn(initial: Logins, onSignedIn: () => void, fail: boolean) {
  const [logins, setLogins] = useState<Logins>(initial);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), []);
  const later = (ms: number, run: () => void) => {
    timers.current.push(window.setTimeout(run, ms));
  };
  const onStart = useCallback(
    (agentId: ZeropsAgentId) => {
      const startedAt = DateTime.makeUnsafe(Date.now());
      setLogins((current) => ({
        ...current,
        [agentId]: login(agentId, "starting", { startedAt }),
      }));
      later(700, () =>
        setLogins((current) => ({
          ...current,
          [agentId]: login(agentId, "awaiting-browser", { startedAt }),
        })),
      );
      if (agentId === "codex") {
        later(fail ? 2600 : 6000, () =>
          setLogins((current) => ({
            ...current,
            codex: fail
              ? login("codex", "failed", { startedAt, message: "the one-time code expired" })
              : login("codex", "succeeded", { startedAt }),
          })),
        );
        if (!fail) later(6600, onSignedIn);
      }
    },
    [fail, onSignedIn],
  );
  const onSubmitCode = useCallback(
    async (agentId: ZeropsAgentId) => {
      setLogins((current) => ({
        ...current,
        [agentId]: login(agentId, "verifying-code", startedOf(current[agentId])),
      }));
      later(1200, () => {
        setLogins((current) => ({
          ...current,
          [agentId]: login(agentId, "succeeded", startedOf(current[agentId])),
        }));
        later(500, onSignedIn);
      });
      return true;
    },
    [onSignedIn],
  );
  const onCancel = useCallback((agentId: ZeropsAgentId) => {
    setLogins((current) => ({ ...current, [agentId]: undefined }));
  }, []);
  return { logins, onStart, onSubmitCode, onCancel };
}

/** The colleague whose sign-in a dialog's agent holds. */
const HOLDER = "u-holder";

function FixtureSignIn({
  state,
  onSignedIn,
  fixed = null,
}: {
  readonly state: HarnessState;
  readonly onSignedIn: () => void;
  readonly fixed?: ZeropsAgentId | null;
}) {
  const { logins, onStart, onSubmitCode, onCancel } = useFixtureSignIn(
    state.logins ?? {},
    onSignedIn,
    state.id === "signin-failed",
  );
  // The failure plays out from the Codex card: its code expires.
  useEffect(() => {
    if (state.id === "signin-failed") onStart("codex");
  }, [onStart, state.id]);
  const agents: ReadonlyArray<SignInAgent> = (["claude-code", "codex"] as const)
    .filter((agentId) => fixed === null || agentId === fixed)
    .map((agentId) => ({
      agentId,
      login: logins[agentId],
      ...(state.heldBy === undefined || agentId !== fixed
        ? {}
        : { credPresent: true, authorizedBy: { subject: HOLDER } }),
    }));
  return (
    <AgentSignInView
      agents={agents}
      codeField
      fixed={fixed !== null}
      mateName={state.mate.name}
      nameOf={(subject) => (subject === HOLDER ? state.heldBy : undefined)}
      onCancel={onCancel}
      onStart={onStart}
      onSubmitCode={onSubmitCode}
      terminal={(agentId) => (
        <pre className="h-full overflow-auto whitespace-pre-wrap break-all p-3 font-mono text-xs leading-4">
          {TERMINAL[agentId]}
        </pre>
      )}
      usual={state.id === "colleague" ? null : "claude-code"}
      viewerSubject="u-harness"
      watching={state.watching === true}
    />
  );
}

const SILENT = { surface: "stage", text: null, actions: [], processes: false } as const;

/** Beviro as a slow first connect finds it: the Mate's container restarting, a stage waiting. */
const PROCESSES: ReadonlyArray<ArrivalService> = [
  { name: "zcp", state: "busy" },
  { name: "appdev", state: "ok" },
  { name: "appstage", state: "waiting" },
  { name: "db", state: "ok" },
];

function comingOf(state: HarnessState, nowMs: number): MateEmptyComing | null {
  if (state.coming === undefined) return null;
  if (state.coming === "reaching") {
    const voice = state.voice?.surface === "stage" ? state.voice : SILENT;
    return {
      kind: "reaching",
      below: (
        <MateLinkLineView
          onTryNow={askAgainLabel(voice.actions) === null ? undefined : () => undefined}
          processes={voice.processes ? <MateLinkProcessesView services={PROCESSES} /> : null}
          projects={<a href="#projects" />}
          projectUrl={undefined}
          voice={voice}
        />
      ),
    };
  }
  const failure = setupFailureReason(state.mate.name, "CommandExec: init command failed", [
    "curl: (6) Could not resolve host: zerops.io",
    "zcp init: command not found (exit 127)",
  ]);
  const coming: MateComing =
    state.coming === "not-created"
      ? {
          kind: "failed",
          line: failure.text,
          verb: "try-again",
        }
      : { kind: "coming", line: "Coming up. A few minutes." };
  const progress =
    state.coming === "not-created"
      ? deriveBirthProgress(
          {
            project: { status: "ACTIVE" },
            container: { serviceId: "zcp", status: "ACTION_FAILED", hasOrigin: false },
            processes: [
              {
                actionName: "project.create",
                status: "FINISHED",
                serviceIds: [],
                createdAt: "2026-10-07T10:00:00Z",
                startedAt: "2026-10-07T10:00:00Z",
                finishedAt: "2026-10-07T10:00:44Z",
              },
              {
                actionName: "stack.create",
                status: "FAILED",
                serviceIds: ["zcp"],
                createdAt: "2026-10-07T10:00:44Z",
                startedAt: "2026-10-07T10:00:44Z",
                finishedAt: "2026-10-07T10:01:54Z",
                failReason: "CommandExec: init command failed",
              },
            ],
            health: undefined,
            connection: "none",
          },
          nowMs,
        )
      : comingProgress(state.coming, nowMs);
  return {
    kind: coming.kind,
    sentence: comingSentenceOf({ coming, progress, nowMs }),
    below: (
      <ComingBelow
        coming={coming}
        mate={state.mate}
        nowMs={nowMs}
        onRemove={() => undefined}
        {...(state.coming === "not-created"
          ? {
              onTryAgain: () => undefined,
              setupFailureDetails: {
                details: failure.details,
                status: "ended",
                retrying: false,
                projectUrl: "https://app.zerops.io/project/fixture",
                process: {
                  id: "fixture-dns",
                  projectId: "fixture",
                  status: "FAILED",
                  actionName: "stack.create",
                  serviceStackIds: ["zcp"],
                  created: "2026-10-07T10:00:44Z",
                },
              },
            }
          : {})}
        progress={progress}
        you={YOU}
      />
    ),
  };
}

function Conversation() {
  const startedAt = useMemo(() => ago(8), []);
  return (
    <TimelineRowCtx value={SHARED}>
      <TimelineRowActivityCtx value={WORKING}>
        <div
          className="mx-auto flex w-full max-w-3xl animate-rise-in flex-col gap-5 px-5 pt-10"
          data-harness-conversation
        >
          <StandUpAskLine at={ago(9)} timestampFormat="24-hour" words={SHARED.standUpAsk ?? ""} />
          <div>
            <div className="run-tray run-tray-top">
              <RunLine
                status={{
                  live: true,
                  face: "working",
                  startedAt,
                  endedAt: null,
                  waitedMs: 0,
                  waitingSince: null,
                  worked: true,
                }}
              />
            </div>
            <div className="run-tray run-tray-bottom" />
          </div>
        </div>
      </TimelineRowActivityCtx>
    </TimelineRowCtx>
  );
}

/**
 * The runtimes under the sign-in, as its project's read lists them: the stage halves up, the dev
 * halves and the utility still coming — appdev up 6 s after the pane opens, the rest by 12 s, so
 * the line's words fade in its place.
 */
function signInRuntimes(sinceMs: number): ReadonlyArray<BirthRuntimeFact> {
  const upAfter: ReadonlyArray<readonly [string, BirthRuntimeFact["role"], number]> = [
    ["appdev", "dev", 6_000],
    ["appstage", "stage", 0],
    ["mailpit", "utility", 12_000],
    ["webdev", "dev", 12_000],
    ["webstage", "stage", 0],
  ];
  return upAfter.map(([hostname, role, after]) => ({
    hostname,
    role,
    service: {
      id: `svc-${hostname}`,
      status: role === "stage" ? "READY_TO_DEPLOY" : sinceMs >= after ? "ACTIVE" : "CREATING",
    },
  }));
}

function Pane({ state, go }: { readonly state: HarnessState; readonly go: (id: string) => void }) {
  const [openedAt] = useState(() => Date.now());
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const onSignedIn = useCallback(() => {
    go("standing-up");
    window.setTimeout(() => go("conversation"), 1400);
  }, [go]);
  const signingIn = state.logins !== undefined;
  const stage = (
    <MateEmptyStateView
      addedBy={state.addedBy}
      coming={comingOf(state, nowMs)}
      // Waiting for its first sign-in, it is still arriving (`mateArrivingUntil`).
      mate={
        state.logins === undefined
          ? state.mate
          : { ...state.mate, arrivingUntil: nowMs + 30 * 60_000 }
      }
      phase={state.phase}
      runtimes={signInRuntimes(nowMs - openedAt)}
      signIn={
        signingIn ? (
          // A state that opens on a login shows it from its first frame.
          <FixtureSignIn key={state.id} onSignedIn={onSignedIn} state={state} />
        ) : null
      }
      signInRequired={signingIn}
      unknown={state.unknown ?? null}
    />
  );
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col" data-harness-pane>
      {state.conversation === true ? <Conversation /> : stage}
      {state.dialog === undefined ? null : (
        <Dialog open>
          <ZeropsAgentSignInDialogPopup mateName={state.mate.name}>
            <FixtureSignIn
              fixed={state.dialog}
              onSignedIn={() => go("conversation")}
              state={state}
            />
          </ZeropsAgentSignInDialogPopup>
        </Dialog>
      )}
    </div>
  );
}

function Header({ state }: { readonly state: HarnessState }) {
  return (
    <WorkspacePageHeader className="relative bg-background">
      <span className="flex items-center gap-2.5">
        <MateFace
          className="size-6"
          shape={state.mate.shape}
          size="sm"
          state={
            state.conversation === true
              ? state.mate.connected
                ? "idle"
                : "sleep"
              : arrivalHeaderFace({
                  kind:
                    state.coming === "not-created"
                      ? "failed"
                      : state.coming === "reaching"
                        ? "reaching"
                        : "coming",
                  over: state.coming === undefined,
                  arriving: state.logins !== undefined,
                  connected: state.mate.connected,
                })
          }
          tint={state.mate.tint}
        />
        <span className="font-semibold text-base">{state.mate.name}</span>
      </span>
      {state.crew === true ? (
        <span className="ms-6 flex items-center gap-4 text-muted-foreground text-sm">
          <span>Conversation</span>
          <span className="font-medium text-foreground">Crew</span>
        </span>
      ) : null}
    </WorkspacePageHeader>
  );
}

function Harness() {
  const [current, setCurrent] = useState(
    () => STATES.find((state) => state.id === params.get("state"))?.id ?? "coming",
  );
  useEffect(() => {
    (window as unknown as { __arrivalHarness: unknown }).__arrivalHarness = {
      go: (id: string) => setCurrent(id),
      states: STATES.map((state) => state.id),
    };
  }, []);
  const state = STATES.find((candidate) => candidate.id === current) ?? STATES[0]!;
  const play = () => {
    setCurrent("coming");
    window.setTimeout(() => setCurrent("signin"), 2300);
  };
  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <aside
        className="flex shrink-0 flex-col gap-1 border-border border-r p-4"
        style={{ width: 435 }}
      >
        <p className="pb-1 text-muted-foreground text-xs">
          A Mate's arrival — Direction A, sign-in S1
        </p>
        <div className="pb-2">
          <Button onClick={play} size="sm" variant="outline">
            Play the arrival
          </Button>
        </div>
        {STATES.map((candidate) => (
          <button
            aria-current={candidate.id === current ? "true" : undefined}
            className="rounded-lg px-3 py-1.5 text-left text-sm aria-[current=true]:bg-accent"
            data-harness-state={candidate.id}
            key={candidate.id}
            onClick={() => setCurrent(candidate.id)}
            type="button"
          >
            {candidate.label}
          </button>
        ))}
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <Header state={state} />
        <Pane go={setCurrent} state={state} />
      </main>
    </div>
  );
}

document.documentElement.classList.toggle("dark", appearance === "dark");
applyThemePalette(ZEROPS_THEME_ID, appearance);

const host = document.getElementById("design");
if (host) {
  createRoot(host).render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
}
