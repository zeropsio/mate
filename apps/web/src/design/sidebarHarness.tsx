/**
 * The sidebar, in every state it has, at the width it really gets — the thing
 * a string assertion cannot show you.
 *
 * Served by the dev server at `/design.html`. It renders the real components
 * with made-up data and no session, so there is no door to get through and
 * nothing live to disturb; both themes stand side by side because a sidebar
 * that reads well in one and badly in the other is a sidebar nobody checked.
 *
 * Fixtures only. Nothing here ships in the app bundle — `design.html` is not
 * `index.html`, and no route imports this module.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { EnvironmentRow, FlowPullRequest } from "@t3tools/client-runtime/zerops";
import { ThreadId } from "@t3tools/contracts";

import { SidebarZeropsTree, type SidebarProjectFlow } from "~/components/zerops/SidebarZeropsTree";
import type { ZeropsAgentActivity } from "~/zerops/agentActivity";

import "../index.css";

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

function candidate(
  id: string,
  name: string,
  tags: ReadonlyArray<string>,
  options: {
    readonly connected?: boolean;
    readonly container?: boolean;
    readonly routes?: ReadonlyArray<{ host: string; url: string }>;
  } = {},
): ZeropsCandidate {
  const { connected = true, container = true, routes } = options;
  const base = {
    key: `${id}:zcp`,
    project: { id, name, status: "ACTIVE", tagList: tags },
    group: connected ? ("connected" as const) : ("ready" as const),
  };
  const withRoutes = routes === undefined ? base : { ...base, routes };
  return container
    ? { ...withRoutes, service: { id: "zcp", name: "zcp", status: "ACTIVE" } }
    : {
        ...withRoutes,
        group: "unavailable",
        reason: "no Zerops Mate container in this project",
        missingContainer: true,
      };
}

function activity(input: {
  readonly subject?: string;
  readonly snippet?: string;
  readonly hours: number;
  readonly face: ZeropsAgentActivity["face"];
}): ZeropsAgentActivity {
  return {
    threadId: ThreadId.make("thread"),
    kind: "idle",
    status: null,
    face: input.face,
    subject: input.subject,
    snippet: input.snippet,
    at: hoursAgo(input.hours),
  };
}

const LINKS = ["mate:g:links", "mate:name:Links"];
const NOTES = ["mate:g:notes", "mate:name:Notes"];
const TODO = ["mate:g:todo", "mate:name:Todo"];

const CANDIDATES: ReadonlyArray<ZeropsCandidate> = [
  candidate("links-enzo", "Links - enzo", ["mate", ...LINKS, "mate:role:dev", "mate:bot:Enzo"]),
  candidate("links-theo", "Links - theo", ["mate", ...LINKS, "mate:role:dev", "mate:bot:Theo"]),
  candidate("links-wren", "Links - wren", ["mate", ...LINKS, "mate:role:dev", "mate:bot:Wren"]),
  candidate("links-stage", "Links - stage", [...LINKS, "mate:role:stage"], {
    container: false,
    routes: [{ host: "links-stage.zerops.app", url: "https://links-stage.zerops.app" }],
  }),
  candidate("links-prod", "Links - production", [...LINKS, "mate:role:prod"], {
    container: false,
    routes: [{ host: "links.example.com", url: "https://links.example.com" }],
  }),

  candidate("notes-iris", "Notes - iris", ["mate", ...NOTES, "mate:role:dev", "mate:bot:Iris"]),
  candidate("notes-prod", "Notes - production", [...NOTES, "mate:role:prod"], {
    container: false,
    routes: [
      { host: "notes.example.com", url: "https://notes.example.com" },
      { host: "www.notes.example.com", url: "https://www.notes.example.com" },
    ],
  }),

  candidate("todo-vera", "Todo - vera", ["mate", ...TODO, "mate:role:dev", "mate:bot:Vera"]),
  candidate("todo-fen", "Todo - fen", ["mate", ...TODO, "mate:role:dev", "mate:bot:Fen"]),
  candidate("todo-stage", "Todo - stage", [...TODO, "mate:role:stage"], {
    container: false,
    routes: [{ host: "todo-stage.zerops.app", url: "https://todo-stage.zerops.app" }],
  }),
  candidate("todo-prod", "Todo - production", [...TODO, "mate:role:prod"], { container: false }),
];

const ACTIVITY = new Map<string, ZeropsAgentActivity>([
  [
    "links-enzo",
    activity({
      subject: "Add a search box above the list that filters the saved links",
      snippet: "Done. The search box is live on both services. What changes…",
      hours: 11,
      face: "working",
    }),
  ],
  ["links-theo", activity({ subject: "/compact", hours: 9, face: "idle" })],
  [
    "notes-iris",
    activity({
      subject: "Show a live character count under the body field of the note form",
      snippet: 'Healthy, and the rendered body confirms "0 characters"…',
      hours: 20,
      face: "idle",
    }),
  ],
  [
    "todo-vera",
    activity({ subject: "Reply with just: done", snippet: "done", hours: 14, face: "idle" }),
  ],
  [
    "todo-fen",
    activity({
      subject: "Rename the app in the page title and the main heading",
      snippet: "Done. Both the browser tab title and the <h1> now read…",
      hours: 20,
      face: "idle",
    }),
  ],
]);

function pull(input: Partial<FlowPullRequest> & { number: number }): FlowPullRequest {
  return {
    repository: "appdev",
    title: "Change",
    kind: "code",
    mateProjectId: undefined,
    author: undefined,
    url: "https://gitea.example/links/appdev/pulls/1",
    checks: "passing",
    checkWord: "Passing",
    mergeable: true,
    headSha: "3f9c1b2",
    baseBranch: "main",
    line: `appdev #${input.number}`,
    updatedAt: hoursAgo(2),
    ...input,
  };
}

function environment(input: Partial<EnvironmentRow> & { projectId: string }): EnvironmentRow {
  return {
    kind: "environment",
    name: "stage",
    tier: "stage",
    source: "main",
    commit: "3f9c1b2",
    line: "main · 3f9c1b2",
    tone: "good",
    ...input,
  };
}

const FLOWS = new Map<string, SidebarProjectFlow>([
  [
    "links",
    {
      pullRequests: [
        pull({
          number: 4,
          title: "Add a search box above the list",
          mateProjectId: "links-enzo",
          checks: "pending",
          checkWord: "Checking",
          mergeable: false,
        }),
        pull({
          number: 5,
          title: "Cache the link previews",
          mateProjectId: "links-theo",
          checks: "failing",
          checkWord: "Failing",
          mergeable: false,
        }),
        pull({ number: 6, title: "Bump the linter", author: "ada", mateProjectId: undefined }),
      ],
      environments: new Map([
        ["links-stage", environment({ projectId: "links-stage" })],
        [
          "links-prod",
          environment({
            projectId: "links-prod",
            name: "production",
            tier: "production",
            source: "release",
            commit: "77ab0e1",
            line: "release · 77ab0e1",
            tone: "neutral",
          }),
        ],
      ]),
      releaseOffered: true,
      releaseContents: [
        {
          commits: [
            { sha: "a1", subject: "Add a search box above the list" },
            { sha: "b2", subject: "Rename the app in the page title" },
            { sha: "c3", subject: "Cache the link previews" },
          ],
        },
      ],
      merging: () => false,
      releasing: false,
      onMerge: () => {},
      onRelease: () => {},
    },
  ],
  [
    "notes",
    {
      pullRequests: [],
      environments: new Map([
        [
          "notes-prod",
          environment({
            projectId: "notes-prod",
            name: "production",
            tier: "production",
            source: "release",
            commit: "5d1e8a0",
            line: "release · 5d1e8a0",
            tone: "good",
          }),
        ],
      ]),
      releaseOffered: false,
      missing: [
        { kind: "missing-environment", tier: "stage", name: "Stage", line: "not set up yet" },
      ],
      merging: () => false,
      releasing: false,
      onMerge: () => {},
      onRelease: () => {},
    },
  ],
  [
    "todo",
    {
      pullRequests: [
        pull({ number: 9, title: "Rename the app in the page title", mateProjectId: "todo-fen" }),
      ],
      environments: new Map([
        ["todo-stage", environment({ projectId: "todo-stage", tone: "pending" })],
        [
          "todo-prod",
          environment({
            projectId: "todo-prod",
            name: "production",
            tier: "production",
            source: "release",
            commit: undefined,
            line: "release",
            tone: "bad",
          }),
        ],
      ]),
      releaseOffered: false,
      merging: () => false,
      releasing: false,
      onMerge: () => {},
      onRelease: () => {},
    },
  ],
]);

/**
 * One sidebar at one width. The panel is resizable (`SIDEBAR_WIDTH` is the
 * 256px default, and the owner runs it near 368), so every width in that range
 * is a width this has to read at — the narrow one is where truncation bites.
 */
function Panel({ label, width }: { readonly label: string; readonly width: number }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="px-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <div
        className="h-[900px] overflow-y-auto border border-border bg-sidebar py-2"
        style={{ width }}
      >
        <SidebarZeropsTree
          candidates={CANDIDATES}
          className="px-1"
          getActivity={(item) => ACTIVITY.get(item.project.id)}
          getFlow={(groupId) => FLOWS.get(groupId)}
          onBrowseProjects={() => {}}
          onSelect={() => {}}
          activeProjectId="links-enzo"
        />
      </div>
    </div>
  );
}

function Harness() {
  return (
    <div className="flex min-h-screen items-start gap-8 bg-background p-6">
      {[256, 320, 368].map((width) => (
        <Panel key={width} label={`${width}px`} width={width} />
      ))}
    </div>
  );
}

// The app sets the theme on the document element (`themePalette.ts`), so the
// harness does the same rather than nesting a `.dark` wrapper the tokens never
// reach — which is exactly how the first pass produced two identical panels.
document.documentElement.classList.toggle(
  "dark",
  new URLSearchParams(location.search).get("theme") === "dark",
);

const host = document.getElementById("design");
if (host) {
  createRoot(host).render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
}
