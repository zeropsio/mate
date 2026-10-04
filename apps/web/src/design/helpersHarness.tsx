/**
 * The helpers panel in the states its helpers reach: the map of the Mate's
 * helpers and theirs, and a helper's own card opened from its row — working
 * with its steps, done with its report, failed, and one from a driver that
 * forwards no steps.
 *
 * Served by the dev server at `/design-helpers.html` (`?theme=dark`,
 * `?open=<helper id>`, `?width=<panel px>`). The rows are invented, in the
 * shape the server sends them: task.* rows for each helper and its calls'
 * tool rows tagged with it (`agentId`).
 *
 * Fixtures only. Nothing here ships — no route imports this module.
 */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  classifyTaskAgentKind,
  EnvironmentId,
  ThreadId,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  deriveAgentPanelModel,
  foldSubagentActivities,
} from "@t3tools/client-runtime/state/subagentRuntime";

import { AgentsPanel } from "~/components/AgentsPanel";
import { showHelper } from "~/components/chat/helperFocus";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import "../index.css";

const NOW = Date.now();
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();
const ENVIRONMENT = EnvironmentId.make("environment-harness");
const THREAD = ThreadId.make("thread-harness");

let sequence = 0;
function row(
  kind: string,
  secondsAgo: number,
  payload: Record<string, unknown>,
): OrchestrationThreadActivity {
  sequence += 1;
  const stamped = kind.startsWith("task.")
    ? {
        ...payload,
        agentKind: classifyTaskAgentKind({
          taskType: payload.taskType as string | undefined,
          agentId: payload.agentId as string | undefined,
        }),
      }
    : payload;
  return {
    id: `harness-${sequence}`,
    kind,
    tone: kind.startsWith("tool.") ? "tool" : "info",
    summary: kind,
    payload: stamped,
    turnId: "turn-harness",
    sequence,
    createdAt: ago(secondsAgo),
  } as unknown as OrchestrationThreadActivity;
}

function helper(
  id: string,
  secondsAgo: number,
  title: string,
  prompt: string,
  extra: Record<string, unknown> = {},
) {
  return row("task.started", secondsAgo, {
    taskId: id,
    taskType: "local_agent",
    title,
    detail: title,
    prompt,
    role: "general-purpose",
    model: "claude-opus-5-5",
    effort: "max",
    toolUseId: `toolu-${id}`,
    ...extra,
  });
}

/** A call it made, as the server sends it: started, and returned unless `open`. */
function call(
  agentId: string,
  id: string,
  secondsAgo: number,
  took: number,
  tool: { name: string; itemType: string; input: Record<string, unknown>; output?: string },
  open = false,
): OrchestrationThreadActivity[] {
  const base = {
    itemType: tool.itemType,
    toolCallId: id,
    agentId,
    parentToolUseId: `toolu-${agentId}`,
    detail: `${tool.name}: ${String(tool.input.command ?? tool.input.file_path ?? tool.input.pattern ?? "")}`,
  };
  const data = {
    toolName: tool.name,
    ...(tool.input.command ? { command: tool.input.command } : {}),
    input: tool.input,
  };
  const started = row("tool.started", secondsAgo, { ...base, status: "inProgress", data });
  if (open) return [started];
  return [
    started,
    row("tool.completed", secondsAgo - took, {
      ...base,
      status: "completed",
      data: { ...data, ...(tool.output ? { rawOutput: { content: tool.output } } : {}) },
    }),
  ];
}

const bash = (command: string, description: string, output?: string) => ({
  name: "Bash",
  itemType: "command_execution",
  input: { command, description },
  ...(output ? { output } : {}),
});
const read = (file: string) => ({
  name: "Read",
  itemType: "file_change",
  input: { file_path: file },
});
const edit = (file: string) => ({
  name: "Edit",
  itemType: "file_change",
  input: { file_path: file, old_string: "a", new_string: "b" },
});

const usage = (id: string, secondsAgo: number, tokens: number, calls: number) =>
  row("task.progress", secondsAgo, {
    taskId: id,
    usageSnapshot: true,
    typedUsage: { totalTokens: tokens, toolUses: calls, durationMs: 0 },
  });

const REPORT = [
  "## Tags are in",
  "",
  "Books carry tags end to end, from the database to the list.",
  "",
  "- A `tags` column, set through `PUT /books/:id/tags`.",
  "- A `?tag=` filter on `GET /books`; 6 new tests, all 41 pass.",
  "- Chips on the list; pressing one filters by it.",
  "",
  "Dev is deployed. One thing left: tags are case-sensitive, so `Sci-fi` and `sci-fi` are two.",
].join("\n");

const ACTIVITIES: OrchestrationThreadActivity[] = [
  // A finished helper, earlier.
  helper(
    "h-tags",
    2900,
    "Add tags to books end to end",
    "Add tags to books: a tags column, the API to set and filter them, and chips on the page. Run the tests and deploy to dev.",
  ),
  ...call("h-tags", "t1", 2890, 2, read("/srv/app/src/db.ts")),
  ...call("h-tags", "t2", 2880, 4, edit("/srv/app/src/db.ts")),
  ...call("h-tags", "t3", 2870, 31, bash("npm test", "Run the test suite", "41 passing")),
  usage("h-tags", 2700, 41_200, 27),
  row("task.completed", 2700, {
    taskId: "h-tags",
    status: "completed",
    summary: "Tags are in end to end.",
    result: REPORT,
  }),
  // A working helper with a helper of its own.
  helper(
    "h-chart",
    2350,
    "Storyline narrative chart",
    "Build a storyline chart for the stats page: one band per book across the reading log's dates, labelled at the start of each band. Use plain SVG — no chart library. Add an API endpoint for a book's timeline, test it, and deploy to dev when it works. Report what you built and anything left undone.",
  ),
  ...call(
    "h-chart",
    "c1",
    2340,
    1,
    bash("ls src/components", "List the components", "BookList.tsx\nStats.tsx"),
  ),
  ...call("h-chart", "c2", 2330, 2, read("/srv/app/src/components/Stats.tsx")),
  ...call("h-chart", "c3", 2300, 3, edit("/srv/app/src/components/StorylineChart.tsx")),
  helper(
    "h-chart-data",
    2200,
    "Shape the timeline data",
    "Write the query that turns the reading log into per-book date ranges.",
    { agentId: "h-chart" },
  ),
  ...call("h-chart-data", "d1", 2190, 2, read("/srv/app/src/db.ts")),
  ...call(
    "h-chart-data",
    "d2",
    2150,
    12,
    bash("npm test -- timeline", "Run the timeline tests", "6 passing"),
  ),
  usage("h-chart-data", 2100, 18_400, 9),
  row("task.completed", 2100, {
    taskId: "h-chart-data",
    status: "completed",
    summary: "The timeline query returns one range per book.",
    result: "The timeline query returns one range per book, merged across gaps under 3 days.",
    agentId: "h-chart",
  }),
  ...call("h-chart", "c4", 2000, 64, bash("npm test", "Run the test suite", "41 passing")),
  ...call("h-chart", "c5", 1800, 5, edit("/srv/app/src/api/books.ts")),
  ...call(
    "h-chart",
    "c6",
    40,
    0,
    bash("npx zcli push --serviceId app", "Deploy to dev in the container"),
    true,
  ),
  usage("h-chart", 30, 339_000, 78),
  // A failed helper.
  helper("h-load", 600, "Write the API load-test script", "Write a load-test script for the API."),
  ...call("h-load", "l1", 590, 3, bash("node load-test.mjs", "Smoke-test the draft")),
  row("task.completed", 420, {
    taskId: "h-load",
    status: "failed",
    summary: "The dev server refused connections on port 3000.",
  }),
  // A helper from a driver that forwards no calls.
  row("task.started", 300, {
    taskId: "child-lint",
    title: "Tidy the lint warnings",
    role: "worker",
    model: "gpt-5.6",
    timelineBypass: true,
  }),
  row("task.progress", 20, {
    taskId: "child-lint",
    detail: "Running the linter on src/",
    summary: "Running the linter on src/",
    timelineBypass: true,
  }),
];

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
document.documentElement.classList.toggle("dark", appearance === "dark");
applyThemePalette(ZEROPS_THEME_ID, appearance);
const width = Number(params.get("width") ?? 520);
const open = params.get("open");

function Harness() {
  const model = deriveAgentPanelModel({ agents: foldSubagentActivities(ACTIVITIES) });
  useEffect(() => {
    if (open !== null)
      showHelper(scopedThreadKey({ environmentId: ENVIRONMENT, threadId: THREAD }), open);
  }, []);
  return (
    <div className="flex h-screen bg-background text-foreground">
      <div className="flex-1" />
      <aside className="h-full border-l border-border" style={{ width }}>
        <AgentsPanel
          activities={ACTIVITIES}
          environmentId={ENVIRONMENT}
          model={model}
          threadId={THREAD}
        />
      </aside>
    </div>
  );
}

const host = document.getElementById("design");
if (host) {
  createRoot(host).render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
}
