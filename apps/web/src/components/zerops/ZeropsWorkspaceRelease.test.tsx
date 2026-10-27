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

import { ZeropsReleaseQuestion } from "./ZeropsWorkspaceRelease";

const NOW = Date.parse("2026-10-25T12:00:00Z");
const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

/** The conversation's lifecycle as the feed hands it over, and whose lifecycle the question asked for. */
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
describe("a workspace's release question", () => {
  beforeEach(() => {
    feeds.lifecycle = undefined;
    feeds.asked = [];
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
