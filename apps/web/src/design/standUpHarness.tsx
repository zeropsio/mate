/**
 * A new Mate's empty conversation, in every state its stand-up has, at the
 * owner's size (1786 × 1000, the menu at 435): the question a colleague sees
 * (and the person who added the Mate saw before the stand-up), the stand-up
 * before the sign-in, while the sign-in is read, on its way, and not through.
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
import type { KnownMessage } from "@t3tools/client-runtime/zerops/knowledge";
import { MATE_SHAPE_OF_TINT } from "@t3tools/shared/brand";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { MateEmptyStateView } from "~/components/zerops/ZeropsMateEmptyState";
import { ZeropsAgentAuthRows } from "~/components/zerops/ZeropsAgentAuthCard";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
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
}

const STATES: ReadonlyArray<HarnessState> = [
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

function Pane({ state, onRetry }: { readonly state: HarnessState; readonly onRetry: () => void }) {
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="relative flex min-h-0 flex-1 flex-col" data-harness-pane>
        <MateEmptyStateView
          mate={state.mate}
          phase={state.phase}
          signIn={
            state.checking ? null : (
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
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-5 pt-2"
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
    () => STATES.find((state) => state.id === params.get("state"))?.id ?? STATES[1]!.id,
  );
  useEffect(() => {
    (window as unknown as { __standUpHarness: unknown }).__standUpHarness = {
      go: (id: string) => setCurrent(id),
      states: STATES.map((state) => state.id),
    };
  }, []);
  const state = STATES.find((candidate) => candidate.id === current) ?? STATES[1]!;
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
