/**
 * Intake row 6b's looks, each on the surface the conversation draws it on: an answer with a
 * Mermaid diagram (settled, and still streaming), and a run whose commands show their code —
 * a one-liner, a `bash -lc` wrapper and a Python heredoc.
 *
 * Served by the dev server at `/design-looks.html` (`?theme=dark`, `?unit=mermaid|shell`). Open
 * it at 1786 × 1000; the column is the conversation's (max-w-3xl) beside the owner's 435 px menu.
 *
 * Fixtures only. Nothing here ships — `design-looks.html` is not `index.html`, and no route
 * imports this module.
 */
import { Component, StrictMode, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { EnvironmentId } from "@t3tools/contracts";
import type { AccountScope } from "@t3tools/client-runtime/zerops/data";
import { emptyAgentPanelModel } from "@t3tools/client-runtime/state/subagentRuntime";

import ChatMarkdown from "~/components/ChatMarkdown";
import {
  TimelineRowActivityCtx,
  TimelineRowCtx,
  type TimelineRowSharedState,
} from "~/components/chat/timelineContext";
import { InventoryContext } from "~/zerops/inventoryContext";
import { ZeropsDataContext } from "~/zerops/zeropsDataContext";
import type { MessagesTimelineRow, RecordItem } from "~/components/chat/MessagesTimeline.logic";
import { RunChat } from "~/components/chat/RunChat";
import { setRunFold } from "~/components/chat/runCard.logic";
import { stepOf } from "~/components/chat/workSteps.logic";
import type { WorkLogEntry } from "~/session-logic";
import { writeThemePreference } from "~/hooks/useTheme";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const unit = params.get("unit") ?? "mermaid";
// The answer's code and diagrams follow the app's theme setting, not the root class.
writeThemePreference(appearance);

const NOW = Date.now();
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

const DIAGRAM = [
  "```mermaid",
  "flowchart TD",
  "  A[Cart] --> B{Items in cart?}",
  "  B -- no --> C[Show empty cart error]",
  "  B -- yes --> D[Add shipping]",
  "  D --> E[Charge payment]",
  "  E --> F{Paid?}",
  "  F -- yes --> G[Order confirmed]",
  "  F -- no --> H[Ask for another card]",
  "```",
].join("\n");

const ANSWER = [
  "The checkout now validates the cart before it charges. Here is the flow:",
  "",
  DIAGRAM,
  "",
  "Tests pass, and `src/payment.ts` is new.",
].join("\n");

const BROKEN = ["```mermaid", "flowchart TD", "  A[Cart] --> --> B{", "```"].join("\n");

/** The answer as it streams: the fence arrives a line at a time, then settles. */
function StreamingAnswer() {
  const lines = ANSWER.split("\n");
  const [count, setCount] = useState(1);
  useEffect(() => {
    if (count >= lines.length) return;
    const timer = setTimeout(() => setCount((value) => value + 1), 350);
    return () => clearTimeout(timer);
  }, [count, lines.length]);
  return (
    <ChatMarkdown
      variant="answer"
      text={lines.slice(0, count).join("\n")}
      cwd={undefined}
      isStreaming={count < lines.length}
    />
  );
}

function call(partial: Partial<WorkLogEntry> & { readonly id: string }): WorkLogEntry {
  return {
    createdAt: ago(100),
    label: "Tool call",
    tone: "tool",
    sourceActivityKind: "tool.completed",
    toolLifecycleStatus: "completed",
    ...partial,
  };
}

function command(id: string, text: string, description: string | null, at: number): RecordItem {
  const entry = call({
    id,
    label: "Command run",
    itemType: "command_execution",
    command: text,
    ...(description === null ? {} : { callInput: { description } }),
    startedAt: ago(at + 4),
    createdAt: ago(at + 4),
    updatedAt: ago(at),
  });
  return { kind: "step", key: `step:${id}`, at: ago(at), step: stepOf(entry, undefined, false) };
}

const HEREDOC = [
  "python3 - <<'PY'",
  "import json, pathlib",
  'data = json.loads(pathlib.Path("package.json").read_text())',
  'print(data["scripts"].get("test", "none"))',
  'for name in sorted(data.get("dependencies", {})):',
  '    print(f"dep {name}")',
  'print("done")',
  "PY",
].join("\n");

const COMMANDS: ReadonlyArray<RecordItem> = [
  command("c1", "ls -la src && git log --oneline -5", null, 40),
  command(
    "c2",
    `bash -lc "cd /var/www/app && pnpm install --frozen-lockfile && pnpm vitest run src/checkout.test.ts --reporter=dot"`,
    "Run the checkout tests",
    30,
  ),
  command("c3", HEREDOC, "List the app's dependencies", 20),
  command(
    "c4",
    `curl -fsS -H "Authorization: Bearer $ZEROPS_TOKEN" "https://api.app-prg1.zerops.io/api/rest/public/project/$PROJECT_ID" | jq '.services[] | {name, status}'`,
    null,
    10,
  ),
];

type RecordRow = Extract<MessagesTimelineRow, { kind: "record" }>;

const RUN: RecordRow = {
  kind: "record",
  id: "record:looks",
  createdAt: ago(60),
  turnKey: "looks",
  live: false,
  items: COMMANDS,
  now: null,
  answering: false,
  status: {
    live: false,
    face: "idle",
    startedAt: ago(60),
    endedAt: ago(5),
    waitedMs: 0,
    waitingSince: null,
    worked: true,
  },
  outcome: null,
};

const SHARED: TimelineRowSharedState = {
  timestampFormat: "24-hour",
  routeThreadKey: "harness",
  threadRef: null,
  markdownCwd: undefined,
  resolvedTheme: appearance,
  workspaceRoot: undefined,
  skills: [],
  activeThreadEnvironmentId: EnvironmentId.make("environment-local"),
  onRevertToTurnCount: () => undefined,
  onRunShellCommand: undefined,
  onImageExpand: () => undefined,
  onOpenTurnDiff: () => undefined,
  speaker: { name: "Nova", tint: "sky" },
  standUpAsk: null,
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

/** The contexts a conversation row reads, with nothing behind them. */
function Standins({ children }: { readonly children: ReactNode }) {
  const notHere = () => {
    throw new Error("not in the harness");
  };
  return (
    <ZeropsDataContext
      value={{
        scope: {} as AccountScope,
        signals: { hidden: () => false, online: () => true, listen: () => () => undefined },
        organizationRef: notHere,
        projectRef: notHere,
      }}
    >
      <InventoryContext
        value={{
          projects: [],
          isLoading: false,
          error: null,
          projectRefs: new Map(),
          authority: new Map(),
          lost: new Set(),
        }}
      >
        <TimelineRowCtx value={SHARED}>
          <TimelineRowActivityCtx
            value={{
              isWorking: false,
              isCompacting: false,
              isRevertingCheckpoint: false,
              latestTurnId: null,
              workingStepLabel: null,
              stoppingBackgroundWork: false,
            }}
          >
            {children}
          </TimelineRowActivityCtx>
        </TimelineRowCtx>
      </InventoryContext>
    </ZeropsDataContext>
  );
}

// The run is opened, as when the person asked for its work.
setRunFold("harness", "looks", "shown");

function Harness() {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <div className="w-[435px] shrink-0 border-e border-border bg-sidebar" />
      <div className="min-w-0 flex-1 px-8 py-10">
        <div className="mx-auto grid w-full max-w-3xl gap-10" data-looks-harness={unit}>
          {unit === "mermaid-stream" ? (
            <StreamingAnswer />
          ) : unit === "mermaid" ? (
            <>
              <ChatMarkdown variant="answer" text={ANSWER} cwd={undefined} />
              <ChatMarkdown variant="answer" text={BROKEN} cwd={undefined} />
            </>
          ) : (
            <div data-card-slice="top" data-card-whole="">
              <div className="run-tray run-tray-top">
                <RunChat row={RUN} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

class Shows extends Component<{ readonly children: ReactNode }, { readonly error: string | null }> {
  override state = { error: null as string | null };
  static getDerivedStateFromError(error: unknown) {
    return {
      error: error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error),
    };
  }
  override render() {
    return this.state.error === null ? (
      this.props.children
    ) : (
      <pre data-harness-error>{this.state.error}</pre>
    );
  }
}

document.documentElement.classList.toggle("dark", appearance === "dark");
applyThemePalette(ZEROPS_THEME_ID, appearance);
createRoot(document.getElementById("design")!).render(
  <StrictMode>
    <Shows>
      <Standins>
        <Harness />
      </Standins>
    </Shows>
  </StrictMode>,
);
