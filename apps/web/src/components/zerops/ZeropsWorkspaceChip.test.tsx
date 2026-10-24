import { ZEROPS_RELEASE_QUESTION } from "@t3tools/client-runtime/zerops";
import type { Known } from "@t3tools/client-runtime/zerops/knowledge";
import {
  EnvironmentId,
  type OrchestrationLatestTurn,
  ThreadId,
  type ThreadLease,
  TurnId,
  type ZeropsLifecycle,
} from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ZeropsReleaseQuestion, ZeropsWorkspaceChip } from "./ZeropsWorkspaceChip";

const NOW = Date.parse("2026-10-25T12:00:00Z");
const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

/** The conversation's lifecycle as the feed hands it over, and whose lifecycle the chip asked for. */
const feeds = vi.hoisted(() => ({
  lifecycle: undefined as unknown,
  asked: [] as Array<readonly [unknown, unknown]>,
}));
vi.mock("../../zerops/useZeropsFeeds", () => ({
  useZeropsLifecycle: (environmentId: unknown, threadId: unknown) => {
    feeds.asked.push([environmentId, threadId]);
    return feeds.lifecycle;
  },
}));
vi.mock("../../zerops/useNowMs", () => ({ useNowMs: () => NOW }));

const ENVIRONMENT = EnvironmentId.make("environment-mate");
const THREAD = ThreadId.make("conversation-mate");
const LEASE = { alias: "webpool-3", pool: "webpool", branch: "feat-x" } as ThreadLease;

/** The conversation's lifecycle, whose last envelope read `leases`. */
const lifecycleReading = (leases: ReadonlyArray<unknown>) =>
  ({
    state: "known",
    value: {
      threadId: THREAD,
      recentTools: [],
      envelope: {
        phase: "develop-active",
        environment: "container",
        project: { id: "proj-1", name: "weather" },
        services: [],
        leases,
        generated: hoursAgo(1),
      },
    },
  }) as unknown as Known<ZeropsLifecycle>;
const readLease = (lastChangeHours: number, unsaved: Record<string, unknown>) => ({
  alias: "webpool-3",
  pool: "webpool",
  branch: "feat-x",
  state: "held",
  acquiredAt: hoursAgo(72),
  activity: {
    lastChangeAt: hoursAgo(lastChangeHours),
    previewOpenConns: 0,
    acquiredAt: hoursAgo(72),
    readAt: hoursAgo(1),
  },
  unsaved,
});
const turnAt = (at: string): OrchestrationLatestTurn => ({
  turnId: TurnId.make("turn-1"),
  state: "completed",
  requestedAt: at,
  startedAt: at,
  completedAt: at,
  assistantMessageId: null,
});
const chip = (latestTurn: OrchestrationLatestTurn | null = null) =>
  renderToStaticMarkup(
    <ZeropsWorkspaceChip
      environmentId={ENVIRONMENT}
      latestTurn={latestTurn}
      lease={LEASE}
      threadId={THREAD}
    />,
  );

describe("the workspace chip of a conversation bound to a lease", () => {
  beforeEach(() => {
    feeds.lifecycle = undefined;
    feeds.asked = [];
  });

  it("A conversation bound to a lease shows when its workspace was last active and what a release would lose", () => {
    feeds.lifecycle = lifecycleReading([
      readLease(3, { files: [" M src/App.tsx", "?? notes.txt"], fileCount: 2, unpushedCommits: 2 }),
    ]);
    const html = chip(turnAt(hoursAgo(5)));
    expect(html).toContain("workspace · last active 3 h ago · 2 unpushed · 2 uncommitted");
    expect(html).toContain('data-tone="neutral"');
    expect(feeds.asked, "the conversation's own lifecycle").toContainEqual([ENVIRONMENT, THREAD]);
  });

  it("A workspace nothing happened in for 24 h is labelled idle", () => {
    feeds.lifecycle = lifecycleReading([readLease(26, { fileCount: 0, unpushedCommits: 0 })]);
    const html = chip(turnAt(hoursAgo(30)));
    expect(html).toContain("workspace · idle · last active 26 h ago · all pushed");
    expect(html).toContain('data-tone="warning"');
  });

  it("A conversation's last turn dates its workspace before zcp read it, and nothing shows with neither", () => {
    feeds.lifecycle = lifecycleReading([]);
    expect(chip(turnAt(new Date(NOW - 5 * 60_000).toISOString()))).toContain(
      "workspace · last active 5 min ago",
    );
    expect(chip(null)).toBe("");
  });
});

describe("the workspace chip's Release", () => {
  beforeEach(() => {
    feeds.lifecycle = undefined;
    feeds.asked = [];
  });

  it("The chip of a bound conversation offers Release, which asks before anything is sent", () => {
    feeds.lifecycle = lifecycleReading([readLease(3, { fileCount: 0, unpushedCommits: 0 })]);
    const html = chip(turnAt(hoursAgo(5)));
    expect(html).toContain("workspace · last active 3 h ago · all pushed");
    expect(html).toMatch(/<button[^>]*data-zerops-workspace-release[^>]*>Release<\/button>/u);
    expect(html, "the question opens only on a press").not.toContain(
      ZEROPS_RELEASE_QUESTION("webpool-3"),
    );
  });

  it("Release asks whether to release the workspace, with what is known of it, and offers Release or Not now", () => {
    feeds.lifecycle = lifecycleReading([
      readLease(3, { files: [" M src/App.tsx", "?? notes.txt"], fileCount: 2, unpushedCommits: 2 }),
    ]);
    const html = renderToStaticMarkup(
      <ZeropsReleaseQuestion
        environmentId={ENVIRONMENT}
        latestTurn={turnAt(hoursAgo(5))}
        lease={LEASE}
        onDismiss={() => {}}
        onRelease={() => {}}
        releasing={false}
        threadId={THREAD}
      />,
    );
    expect(html).toContain(ZEROPS_RELEASE_QUESTION("webpool-3"));
    expect(html).toContain("last active 3 h ago · 2 unpushed · 2 uncommitted");
    expect(html).toMatch(/>Release<\/button>/u);
    expect(html).toMatch(/>Not now<\/button>/u);
    expect(feeds.asked, "the conversation's own lifecycle").toContainEqual([ENVIRONMENT, THREAD]);
  });
});
