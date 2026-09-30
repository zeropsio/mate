/**
 * A new Mate's empty conversation, in every state its stand-up has, at the
 * owner's size (1786 × 1000, the menu at 435): the question a colleague sees
 * (and the person who added the Mate saw before the stand-up), the stand-up
 * before the sign-in, while the sign-in is read, on its way, and not through.
 *
 * Before it: the Mate's own view while it comes up (`ZeropsMateComingPage`) —
 * where Add lands — with the projects page's progress under its headline, a
 * step past its cap, a creation the platform refused; and `handing`, the frame
 * its view hands over to the conversation with (`coming → handing` is the
 * hand-over the view plays in place). Then the same view for any other Mate a
 * door opens while its conversation cannot be: its name, and under it what its
 * link waits for, or why it cannot be opened (`MateOpeningLine`).
 *
 * The pane is the real `MateEmptyStateView` over the real sign-in rows
 * (`ZeropsAgentAuthRows`, a fixture snapshot); the header and the composer
 * around it are stand-ins at their real heights, as in `design-switch.html`.
 *
 * Served by the dev server at `/design-standup.html` (`?theme=dark`,
 * `?state=<id>` for the state it opens on). `window.__standUpHarness.go(id)`
 * moves to a state from a script, so a per-frame sampler can watch a change of
 * phase it started itself. Fixtures only: nothing here ships, and no route
 * imports this module.
 */
import type { ZeropsAgentAuthSnapshot } from "@t3tools/contracts";
import { deriveBirthProgress, type BirthFacts } from "@t3tools/client-runtime/zerops/birthProgress";
import type { KnownMessage } from "@t3tools/client-runtime/zerops/knowledge";
import { MATE_SHAPE_OF_TINT } from "@t3tools/shared/brand";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { Button } from "~/components/ui/button";
import { ZeropsBirthLine } from "~/components/zerops/ZeropsBirthProgress";
import { MateOpeningLine } from "~/components/zerops/ZeropsMateComingPage";
import {
  MateEmptyStateView,
  StandUpAuthorize,
  type MateEmptyComing,
} from "~/components/zerops/ZeropsMateEmptyState";
import { ZeropsAgentAuthRows } from "~/components/zerops/ZeropsAgentAuthCard";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import { mateOpeningPhrase, type MateComingPage } from "~/zerops/mateComing";
import type { ZeropsMateIdentity } from "~/zerops/mateIdentities";
import type { MateStandUpPhase } from "~/zerops/mateStandUp";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";

const FEN: ZeropsMateIdentity = {
  name: "Fen",
  tint: "olive",
  shape: MATE_SHAPE_OF_TINT.olive,
  project: "Acme Docs",
  projectUrl: "https://app.zerops.io/project/harness",
  connected: true,
  standUp: { by: "u-ada" },
};

const NOT_SIGNED_IN: ZeropsAgentAuthSnapshot = {
  available: true,
  agents: (["claude-code", "codex"] as const).map((agentId) => ({
    agentId,
    credPresent: false,
    flagOAuth: false,
    flagToken: false,
    providerAuth: "unknown" as const,
    state: "not-authorized" as const,
  })),
};

/** Claude Code signed in by the person looking; Codex not. */
const SIGNED_IN: ZeropsAgentAuthSnapshot = {
  available: true,
  agents: NOT_SIGNED_IN.agents.map((agent) =>
    agent.agentId === "claude-code"
      ? {
          ...agent,
          credPresent: true,
          flagOAuth: true,
          providerAuth: "authenticated" as const,
          state: "authorized" as const,
          authorizedBy: { subject: "u-ada" },
        }
      : agent,
  ),
};

const CHECKING: KnownMessage = {
  text: "Checking which coding agents are signed in…",
  afterMs: 0,
} as KnownMessage;

interface HarnessState {
  readonly id: string;
  readonly label: string;
  readonly mate: ZeropsMateIdentity;
  readonly phase: MateStandUpPhase | null;
  readonly rows: boolean;
  readonly checking: boolean;
  /** The Mate's own view while it comes up, or the frame it hands over with. */
  readonly coming?: "coming" | "almost" | "slow" | "not-created" | "handing";
  /** The same view for a Mate on its way to its conversation, or not to be opened. */
  readonly opening?: Extract<MateComingPage, { readonly kind: "reaching" | "unreachable" }>;
}

const AGO = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();

/** A birth 72 s in: the project made, the container being created. */
const CREATING: BirthFacts = {
  project: { status: "ACTIVE", createdAt: AGO(72) },
  container: { serviceId: "zcp", status: "CREATING", hasOrigin: false },
  processes: [
    {
      actionName: "project.create",
      status: "FINISHED",
      createdAt: AGO(72),
      startedAt: AGO(72),
      finishedAt: AGO(47),
      serviceIds: [],
    },
    {
      actionName: "stack.create",
      status: "RUNNING",
      createdAt: AGO(44),
      startedAt: AGO(44),
      finishedAt: null,
      serviceIds: ["zcp"],
    },
  ],
  health: undefined,
  provisioningPhase: "awaiting-settled",
  connection: "none",
};

/** Three minutes in: everything up but Mate itself, which is waited on. */
const ANSWERING: BirthFacts = {
  ...CREATING,
  project: { status: "ACTIVE", createdAt: AGO(188) },
  container: { serviceId: "zcp", status: "ACTIVE", hasOrigin: true },
  processes: CREATING.processes.map((process) =>
    process.status === "RUNNING"
      ? { ...process, status: "FINISHED", finishedAt: AGO(90) }
      : process,
  ),
  provisioningPhase: "awaiting-health",
};

const QUINN: ZeropsMateIdentity = {
  name: "Quinn",
  tint: "coral",
  shape: "gem",
  project: "Acme Docs",
  projectUrl: "https://app.zerops.io/project/harness",
  connected: false,
  standUp: { by: "u-ada" },
};

const STATES: ReadonlyArray<HarnessState> = [
  {
    id: "coming",
    label: "Coming up · where Add lands",
    mate: QUINN,
    phase: "sign-in",
    rows: false,
    checking: false,
    coming: "coming",
  },
  {
    id: "almost",
    label: "Coming up · Mate being waited on",
    mate: QUINN,
    phase: "sign-in",
    rows: false,
    checking: false,
    coming: "almost",
  },
  {
    id: "slow",
    label: "Coming up · a step past its cap",
    mate: QUINN,
    phase: "sign-in",
    rows: false,
    checking: false,
    coming: "slow",
  },
  {
    id: "not-created",
    label: "Coming up · the platform refused it",
    mate: QUINN,
    phase: "sign-in",
    rows: false,
    checking: false,
    coming: "not-created",
  },
  {
    id: "handing",
    label: "Up · handed over in place",
    mate: { ...QUINN, connected: true },
    phase: "sign-in",
    rows: true,
    checking: false,
    coming: "handing",
  },
  {
    id: "reconnecting",
    label: "Opening · its link made again",
    mate: { ...QUINN, standUp: undefined },
    phase: null,
    rows: false,
    checking: false,
    opening: { kind: "reaching", reachability: { kind: "reconnecting" } },
  },
  {
    id: "retrying",
    label: "Opening · not answering",
    mate: { ...QUINN, standUp: undefined },
    phase: null,
    rows: false,
    checking: false,
    opening: {
      kind: "reaching",
      reachability: {
        kind: "retrying",
        retryAtMs: Date.now() + 8_000,
        last: { kind: "network" },
        restart: false,
      },
    },
  },
  {
    id: "stopped",
    label: "Opening · stopped",
    mate: { ...QUINN, standUp: undefined },
    phase: null,
    rows: false,
    checking: false,
    opening: {
      kind: "reaching",
      reachability: { kind: "container", container: { level: "inactive", status: "STOPPED" } },
    },
  },
  {
    id: "gone",
    label: "Not to be opened · gone",
    mate: { ...QUINN, standUp: undefined },
    phase: null,
    rows: false,
    checking: false,
    opening: {
      kind: "unreachable",
      reachability: { kind: "gone", because: "complete-scope-omits-verified" },
    },
  },
  {
    id: "question",
    label: "Question · a colleague (before: everyone)",
    mate: FEN,
    phase: null,
    rows: true,
    checking: false,
  },
  {
    id: "sign-in",
    label: "Stand-up · before the sign-in",
    mate: FEN,
    phase: "sign-in",
    rows: true,
    checking: false,
  },
  {
    id: "checking",
    label: "Stand-up · the sign-in being read",
    mate: FEN,
    phase: "sign-in",
    rows: false,
    checking: true,
  },
  {
    id: "standing-up",
    label: "Stand-up · on its way",
    mate: FEN,
    phase: "standing-up",
    rows: false,
    checking: false,
  },
  {
    id: "failed",
    label: "Stand-up · not through",
    mate: FEN,
    phase: "failed",
    rows: false,
    checking: false,
  },
  {
    id: "no-project",
    label: "Stand-up · a Mate in no project",
    mate: { ...FEN, project: undefined },
    phase: "sign-in",
    rows: true,
    checking: false,
  },
];

const COMPOSER_HEIGHT = 132;

/** What hangs under a coming headline: the projects page's own birth line, or its verb. */
function ComingBelowFixture({ coming }: { readonly coming: NonNullable<HarnessState["coming"]> }) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (coming === "slow" || coming === "not-created") {
    const failed = coming === "not-created";
    return (
      <div className="flex w-full max-w-sm flex-col items-center gap-3">
        <p
          className={
            failed
              ? "text-center text-sm text-status-failed-text"
              : "text-center text-sm text-muted-foreground"
          }
        >
          {failed ? "Could not be created." : "Taking longer than usual."}
        </p>
        <Button size="compact" variant="pill">
          {failed ? "Remove" : "Keep waiting"}
        </Button>
      </div>
    );
  }
  const facts = coming === "coming" ? CREATING : ANSWERING;
  return (
    <div className="flex w-full max-w-xs">
      <ZeropsBirthLine nowMs={nowMs} progress={deriveBirthProgress(facts, nowMs)} />
    </div>
  );
}

function comingOf(state: HarnessState): MateEmptyComing | null {
  if (state.opening !== undefined) {
    return {
      kind: state.opening.kind,
      below: (
        <MateOpeningLine
          onTryNow={() => undefined}
          phrase={mateOpeningPhrase(state.opening, {
            nowMs: Date.now(),
            mateName: state.mate.name,
          })}
          projectUrl={state.mate.projectUrl}
          projects={<a href="#projects" />}
        />
      ),
    };
  }
  if (state.coming === undefined) return null;
  return {
    kind: state.coming === "not-created" ? "failed" : "coming",
    over: state.coming === "handing",
    below: <ComingBelowFixture coming={state.coming === "handing" ? "almost" : state.coming} />,
  };
}

function Pane({ state, onRetry }: { readonly state: HarnessState; readonly onRetry: () => void }) {
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="relative flex min-h-0 flex-1 flex-col" data-harness-pane>
        <MateEmptyStateView
          coming={comingOf(state)}
          mate={state.mate}
          phase={state.phase}
          signIn={
            state.checking ? null : state.phase === "sign-in" && state.rows ? (
              // The stand-up's own two buttons, as the conversation draws them.
              <StandUpAuthorize onAuthorize={() => undefined} snapshot={NOT_SIGNED_IN} />
            ) : (
              <ZeropsAgentAuthRows
                onCancel={() => undefined}
                onSignIn={() => undefined}
                snapshot={state.rows ? NOT_SIGNED_IN : SIGNED_IN}
                viewerSubject="u-ada"
              />
            )
          }
          signInRequired={state.rows}
          unknown={state.checking ? CHECKING : null}
          onRetry={onRetry}
        />
      </div>
      {/* The Mate's own view has no composer; the conversation it hands over to holds its own
          back while the stand-up waits on its person. */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-5 pt-2"
        hidden={state.coming !== undefined || state.opening !== undefined}
        style={{ height: COMPOSER_HEIGHT }}
      >
        <div
          className="mx-auto flex max-w-3xl items-start rounded-3xl border border-border bg-card px-5 py-4 text-muted-foreground text-sm shadow-sm"
          style={{ height: COMPOSER_HEIGHT - 20 }}
        >
          Sign in a coding agent to start
        </div>
      </div>
    </div>
  );
}

function Harness() {
  const [current, setCurrent] = useState(
    () => STATES.find((state) => state.id === params.get("state"))?.id ?? "sign-in",
  );
  useEffect(() => {
    (window as unknown as { __standUpHarness: unknown }).__standUpHarness = {
      go: (id: string) => setCurrent(id),
      states: STATES.map((state) => state.id),
    };
  }, []);
  const state =
    STATES.find((candidate) => candidate.id === current) ??
    STATES.find((candidate) => candidate.id === "sign-in")!;
  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <aside
        className="flex shrink-0 flex-col gap-1 border-border border-r p-4"
        style={{ width: 435 }}
      >
        <p className="pb-2 text-muted-foreground text-xs">A new Mate's stand-up</p>
        {STATES.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            data-harness-state={candidate.id}
            aria-current={candidate.id === current ? "true" : undefined}
            className="rounded-lg px-3 py-2 text-left text-sm aria-[current=true]:bg-accent"
            onClick={() => setCurrent(candidate.id)}
          >
            {candidate.label}
          </button>
        ))}
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <header
          className="flex shrink-0 items-center border-border border-b px-5 font-medium text-sm"
          style={{ height: 52 }}
        >
          {state.mate.name}
        </header>
        <Pane state={state} onRetry={() => setCurrent("standing-up")} />
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
