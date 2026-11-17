/**
 * Naming another of the person's Mates with `@` in a Mate's conversation: the composer's open `@`
 * menu, the person's other Mates first by face, name and project, then a file; and the person's
 * message as sent, each Mate it names drawn in that Mate's hue. Under the bubble, the context the
 * Mate hears with it, which the person never sees.
 *
 * Served by the dev server at `/design-mentions.html` (`?theme=dark` for the dark theme).
 * Fixtures only: nothing here ships, and no route imports this module.
 */
import { emptyAgentPanelModel } from "@t3tools/client-runtime/state/subagentRuntime";
import { EnvironmentId, MessageId } from "@t3tools/contracts";
import { StrictMode, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import {
  ComposerPromptEditor,
  type ComposerPromptEditorHandle,
} from "~/components/ComposerPromptEditor";
import {
  ComposerCommandMenu,
  type ComposerCommandItem,
} from "~/components/chat/ComposerCommandMenu";
import { UserTimelineRow } from "~/components/chat/MessagesTimeline";
import { TimelineRowCtx, type TimelineRowSharedState } from "~/components/chat/timelineContext";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import {
  mateMentionMatcher,
  mateMentionNotes,
  mateMentionText,
  mateMenuMatches,
  type MentionableMate,
} from "~/zerops/mateMentions";
import "../index.css";

const MATES: ReadonlyArray<MentionableMate> = [
  { projectId: "p-fia-7Kq2", name: "Fia", project: "Mate Web", tint: "violet", shape: "gem" },
  { projectId: "p-juno-3Rm8", name: "Juno", project: "Shop", tint: "olive", shape: "clover" },
  {
    projectId: "p-otto-9Ln4",
    name: "Otto",
    project: "Billing API",
    tint: "amber",
    shape: "hexagon",
  },
];

const appearance = new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light";

const SHARED: TimelineRowSharedState = {
  timestampFormat: "24-hour",
  routeThreadKey: "harness",
  threadRef: null,
  markdownCwd: undefined,
  resolvedTheme: appearance,
  workspaceRoot: undefined,
  skills: [],
  mateMentions: mateMentionMatcher(MATES),
  activeThreadEnvironmentId: EnvironmentId.make("environment-local"),
  onRunShellCommand: undefined,
  onImageExpand: () => undefined,
  speaker: { name: "Nova", tint: "sky" },
  standUpAsk: null,
  livePauseId: null,
  usagePause: null,
  agentPanelModel: emptyAgentPanelModel(),
  onOpenAgents: () => undefined,
  onSteerQueuedMessage: () => undefined,
  steerQueuedMessageShortcutLabel: "⌘↑",
  onRemoveQueuedMessage: () => undefined,
  arrivedAfter: null,
  syncing: false,
  onHoldReading: () => undefined,
};

const TYPED = "Ask @Fia whether the checkout copy landed, then @";

function menuItems(query: string): ComposerCommandItem[] {
  return [
    ...mateMenuMatches(MATES, query).map((mate): ComposerCommandItem => ({
      id: `mate:${mate.projectId}`,
      type: "mate",
      projectId: mate.projectId,
      name: mate.name,
      tint: mate.tint,
      shape: mate.shape,
      label: mate.name,
      description: mate.project ?? "",
    })),
    {
      id: "path:file:src/checkout/Copy.tsx",
      type: "path",
      path: "src/checkout/Copy.tsx",
      pathKind: "file",
      searchTarget: { environmentId: EnvironmentId.make("environment-local"), cwd: "/app", query },
      label: "Copy.tsx",
      description: "src/checkout",
    },
  ];
}

function Composer() {
  const editorRef = useRef<ComposerPromptEditorHandle>(null);
  const [value, setValue] = useState(TYPED);
  const [cursor, setCursor] = useState(TYPED.length);
  const query = /@(\S*)$/u.exec(value.slice(0, cursor))?.[1] ?? null;
  const items = query === null ? [] : menuItems(query);
  const [active, setActive] = useState<string | null>(items[0]?.id ?? null);
  const chips = MATES.map((mate) => ({
    handle: mate.name,
    tint: mate.tint,
    shape: mate.shape,
    mate: true as const,
  }));
  return (
    <div className="flex flex-col" data-harness-state="menu">
      {items.length > 0 ? (
        <ComposerCommandMenu
          listId="harness-mentions"
          items={items}
          resolvedTheme={appearance}
          isLoading={false}
          triggerKind="path"
          activeItemId={active ?? items[0]?.id ?? null}
          onHighlightedItemChange={setActive}
          onSelect={(item) => {
            if (item.type !== "mate") return;
            const start = value.slice(0, cursor).lastIndexOf("@");
            const next = `${value.slice(0, start)}${mateMentionText(item.name)} ${value.slice(cursor)}`;
            setValue(next);
            setCursor(start + mateMentionText(item.name).length + 1);
          }}
        />
      ) : null}
      <div className="rounded-3xl border border-border bg-card px-4 pt-4 pb-3 shadow-lg/5">
        <ComposerPromptEditor
          editorRef={editorRef}
          value={value}
          cursor={cursor}
          terminalContexts={[]}
          skills={[]}
          crewmates={chips}
          disabled={false}
          placeholder="Ask Nova…"
          onRemoveTerminalContext={() => undefined}
          onChange={(next, nextCursor) => {
            setValue(next);
            setCursor(nextCursor);
          }}
          onPaste={() => undefined}
        />
      </div>
    </div>
  );
}

const SENT = "Ask @Fia whether the checkout copy landed, then tell @otto to rerun the invoices.";

function Sent() {
  return (
    <div className="flex flex-col gap-4" data-harness-state="sent">
      <UserTimelineRow
        row={{
          kind: "message",
          id: "message:sent",
          createdAt: "2026-11-17T09:00:00.000Z",
          message: {
            id: MessageId.make("sent"),
            role: "user",
            text: SENT,
            turnId: null,
            createdAt: "2026-11-17T09:00:00.000Z",
            updatedAt: "2026-11-17T09:00:00.000Z",
            streaming: false,
          },
          receipt: "seen",
          aside: false,
          imageOnly: false,
          showAssistantMeta: false,
        }}
      />
      <pre
        className="whitespace-pre-wrap font-mono text-muted-foreground text-xs"
        data-agent-context
      >
        {mateMentionNotes(SENT, MATES).join("\n")}
      </pre>
    </div>
  );
}

function Harness() {
  return (
    <TimelineRowCtx value={SHARED}>
      <main className="mx-auto grid max-w-[1400px] grid-cols-2 gap-x-16 p-10 pt-64">
        <Composer />
        <Sent />
      </main>
    </TimelineRowCtx>
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
