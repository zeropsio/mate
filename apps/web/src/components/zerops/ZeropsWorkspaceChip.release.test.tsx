// @vitest-environment happy-dom
import { ZEROPS_RELEASE_QUESTION } from "@t3tools/client-runtime/zerops";
import type { Known } from "@t3tools/client-runtime/zerops/knowledge";
import {
  EnvironmentId,
  ThreadId,
  type ThreadLease,
  TurnId,
  type ZeropsLifecycle,
} from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ZeropsWorkspaceList } from "./ZeropsWorkspaceChip";

const NOW = Date.parse("2026-10-25T12:00:00Z");
const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

const ENVIRONMENT = EnvironmentId.make("environment-mate");
const THREAD = ThreadId.make("conversation-mate");
const LEASE = { alias: "webpool-3", pool: "webpool", branch: "feat-x" } as ThreadLease;

/** The conversation's lifecycle and shell, and every release request sent. */
const boundary = vi.hoisted(() => ({
  lifecycle: undefined as unknown,
  requestRelease: vi.fn<(input: Record<string, unknown>) => Promise<unknown>>(),
}));
vi.mock("../../zerops/useZeropsFeeds", () => ({
  useZeropsLifecycle: () => boundary.lifecycle,
}));
vi.mock("../../zerops/useNowMs", () => ({ useNowMs: () => NOW }));
vi.mock("../../zerops/useZeropsReleaseRequest", () => ({
  useZeropsReleaseRequest: () => boundary.requestRelease,
}));
vi.mock("../../state/entities", () => ({
  useThreadShell: () => ({
    id: "conversation-mate",
    modelSelection: { instanceId: "codex", model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    archivedAt: null,
  }),
}));
vi.mock("../../hooks/useThreadActions", () => ({
  useThreadActions: () => ({
    unarchiveThread: async () => ({ _tag: "Success", value: undefined }),
  }),
}));

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
const boundLease = {
  alias: "webpool-3",
  pool: "webpool",
  branch: "feat-x",
  state: "held",
  acquiredAt: hoursAgo(72),
  activity: {
    lastChangeAt: hoursAgo(3),
    previewOpenConns: 0,
    acquiredAt: hoursAgo(72),
    readAt: hoursAgo(1),
  },
  unsaved: { fileCount: 0, unpushedCommits: 0 },
};
const parkedLease = {
  alias: "webpool-5",
  pool: "webpool",
  branch: "b-red",
  state: "parked",
  acquiredAt: hoursAgo(80),
  activity: {
    lastChangeAt: hoursAgo(50),
    previewOpenConns: 0,
    acquiredAt: hoursAgo(80),
    readAt: hoursAgo(1),
  },
  unsaved: { fileCount: 0, unpushedCommits: 0 },
};

let host: HTMLDivElement;
let root: Root;
const onClose = vi.fn();

const press = async (button: Element | null | undefined) => {
  if (!(button instanceof HTMLElement)) throw new Error("no such button");
  await act(async () => {
    button.click();
  });
};
const releaseOf = (alias: string) =>
  host.querySelector(`[data-zerops-workspace="${alias}"] [data-zerops-workspace-release]`);
const questionButton = (words: string) =>
  [...host.querySelectorAll("[data-zerops-release-question] button")].find(
    (button) => button.textContent === words,
  );

describe("a workspace's Release in the Mate's list", () => {
  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    boundary.lifecycle = lifecycleReading([boundLease, parkedLease]);
    boundary.requestRelease.mockReset();
    boundary.requestRelease.mockResolvedValue({ _tag: "Success", value: undefined });
    onClose.mockReset();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root.render(
        <ZeropsWorkspaceList
          environmentId={ENVIRONMENT}
          latestTurn={{
            turnId: TurnId.make("turn-1"),
            state: "completed",
            requestedAt: hoursAgo(1),
            startedAt: hoursAgo(1),
            completedAt: hoursAgo(1),
            assistantMessageId: null,
          }}
          lease={LEASE}
          mateName="Kara"
          onClose={onClose}
          threadId={THREAD}
        />,
      );
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("asks first, then asks the Mate's conversation to release that workspace", async () => {
    await press(releaseOf("webpool-5"));
    const question = host.querySelector("[data-zerops-release-question]");
    expect(question?.textContent).toContain(ZEROPS_RELEASE_QUESTION("webpool-5"));
    expect(question?.textContent).toContain("idle · last active 2 d ago · all pushed");
    expect(boundary.requestRelease, "nothing is sent before the answer").not.toHaveBeenCalled();

    await press(questionButton("Release"));
    expect(boundary.requestRelease).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        alias: "webpool-5",
        threadRef: { environmentId: ENVIRONMENT, threadId: THREAD },
        archived: false,
      }),
    );
    expect(onClose, "the list closes once the request is on its way").toHaveBeenCalled();
  });

  it("goes back to the list on Not now, having sent nothing", async () => {
    await press(releaseOf("webpool-5"));
    await press(questionButton("Not now"));
    expect(host.querySelector("[data-zerops-release-question]")).toBeNull();
    expect(host.querySelector('[data-zerops-workspace="webpool-5"]')).not.toBeNull();
    expect(boundary.requestRelease).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("asks about the bound workspace with the conversation's own last turn, as the chip's Release does", async () => {
    await press(releaseOf("webpool-3"));
    const question = host.querySelector("[data-zerops-release-question]");
    expect(question?.textContent).toContain(ZEROPS_RELEASE_QUESTION("webpool-3"));
    expect(question?.textContent).toContain("last active 1 h ago · all pushed");
    await press(questionButton("Release"));
    expect(boundary.requestRelease).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ alias: "webpool-3" }),
    );
  });
});
