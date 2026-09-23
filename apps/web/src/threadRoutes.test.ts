import { describe, expect, it } from "vite-plus/test";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ThreadId } from "@t3tools/contracts";
import { DraftId } from "./composerDraftStore";

import {
  buildDraftThreadRouteParams,
  buildThreadRouteParams,
  resolveActiveThreadRouteRef,
  resolveThreadRouteRenderState,
  resolveThreadRouteRef,
  resolveThreadRouteTarget,
} from "./threadRoutes";

describe("threadRoutes", () => {
  it("builds canonical thread route params from a scoped ref", () => {
    const ref = scopeThreadRef("env-1" as never, ThreadId.make("thread-1"));

    expect(buildThreadRouteParams(ref)).toEqual({
      environmentId: "env-1",
      threadId: "thread-1",
    });
  });

  it("resolves a scoped ref only when both params are present", () => {
    expect(
      resolveThreadRouteRef({
        environmentId: "env-1",
        threadId: "thread-1",
      }),
    ).toEqual({
      environmentId: "env-1",
      threadId: "thread-1",
    });

    expect(resolveThreadRouteRef({ environmentId: "env-1" })).toBeNull();
    expect(resolveThreadRouteRef({ threadId: "thread-1" })).toBeNull();
  });

  it("builds canonical draft route params from a draft id", () => {
    expect(buildDraftThreadRouteParams(DraftId.make("draft-1"))).toEqual({
      draftId: "draft-1",
    });
  });

  it("resolves draft and server route targets", () => {
    expect(
      resolveThreadRouteTarget({
        environmentId: "env-1",
        threadId: "thread-1",
      }),
    ).toEqual({
      kind: "server",
      threadRef: {
        environmentId: "env-1",
        threadId: "thread-1",
      },
    });

    expect(
      resolveThreadRouteTarget({
        draftId: "draft-1",
      }),
    ).toEqual({
      kind: "draft",
      draftId: "draft-1",
    });
  });

  it("resolves the backing thread while a draft route is being promoted", () => {
    const target = resolveThreadRouteTarget({ draftId: "draft-1" });

    expect(
      resolveActiveThreadRouteRef(target, {
        environmentId: "env-1" as never,
        threadId: ThreadId.make("draft-thread"),
        promotedTo: scopeThreadRef("env-2" as never, ThreadId.make("server-thread")),
      }),
    ).toEqual({
      environmentId: "env-2",
      threadId: "server-thread",
    });
  });

  it("does not treat a draft's reserved thread ref as an active sidebar thread", () => {
    const target = resolveThreadRouteTarget({ draftId: "draft-1" });

    expect(
      resolveActiveThreadRouteRef(target, {
        environmentId: "env-1" as never,
        threadId: ThreadId.make("draft-thread"),
        promotedTo: null,
      }),
    ).toBeNull();
  });

  // The thread gate (DESIGN §4.8): "no longer available" only from a live shell that lacks the
  // thread, or a detail the server deleted; anything else waits on the environment's reachability.
  it.each([
    ["an empty shell waits", "empty", {}, "loading"],
    ["a cached shell without the thread waits", "cached", {}, "loading"],
    ["a synchronizing shell without the thread waits", "synchronizing", {}, "loading"],
    ["a live shell without the thread: no longer available", "live", {}, "missing"],
    [
      "a live shell with only the thread's shell waits for its detail",
      "live",
      { shell: true },
      "loading",
    ],
    [
      "a cached shell with the thread's detail shows it",
      "cached",
      { shell: true, detail: true },
      "ready",
    ],
    [
      "a synchronizing shell with a local draft shows it",
      "synchronizing",
      { draft: true },
      "ready",
    ],
    [
      "a detail the server deleted: no longer available",
      "cached",
      { shell: true, deleted: true },
      "missing",
    ],
  ] as const)("%s", (_case, shell, thread, expected) => {
    const has = thread as {
      readonly shell?: boolean;
      readonly detail?: boolean;
      readonly deleted?: boolean;
      readonly draft?: boolean;
    };
    expect(
      resolveThreadRouteRenderState({
        shell,
        serverThreadShellExists: has.shell === true,
        serverThreadDetailExists: has.detail === true,
        serverThreadDetailDeleted: has.deleted === true,
        draftThreadExists: has.draft === true,
      }),
    ).toBe(expected);
  });
});
