import { Cause } from "effect";
import { act } from "react";
import { create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const testState = vi.hoisted(() => ({
  result: { _tag: "Initial" } as unknown,
  refreshes: 0,
}));

vi.mock("@effect/atom-react", async () => {
  const { createContext } = await import("react");
  return {
    useAtomValue: () => testState.result,
    useAtomRefresh: () => () => {
      testState.refreshes += 1;
    },
    RegistryContext: createContext({
      refresh: () => {
        testState.refreshes += 1;
      },
    }),
  };
});
vi.mock("~/state/assets", () => ({
  assetEnvironment: { createUrl: () => ({}), createUrls: () => ({}) },
}));
vi.mock("~/state/session", () => ({
  usePreparedConnection: () => ({ _tag: "Some", value: { httpBaseUrl: "https://mate.test/" } }),
}));

import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import {
  assetUrlStateOf,
  SIGN_RETRY_DELAYS_MS,
  signingSaysNotThere,
  useAssetUrlState,
  useAssetUrlStates,
} from "./assetUrls";

const failure = (error: unknown) => ({ _tag: "Failure", cause: Cause.fail(error) });

describe("a picture's signed address", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    testState.refreshes = 0;
  });
  afterEach(() => vi.useRealTimers());

  const draw = (retry: boolean) => {
    const seen: Array<string> = [];
    function Probe() {
      seen.push(
        useAssetUrlState(
          EnvironmentId.make("env-1"),
          { _tag: "workspace-file", threadId: ThreadId.make("thread-1"), path: "shot.png" },
          { retry },
        )._tag,
      );
      return null;
    }
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(<Probe />);
    });
    return { seen, renderer };
  };

  it.each([
    ["the Mate did not answer", { _tag: "RpcClientError" }, false],
    ["the file is not there", { _tag: "AssetWorkspaceAssetNotFoundError" }, true],
    ["the workspace could not be resolved", { _tag: "AssetWorkspaceResolutionError" }, false],
    ["the conversation is gone", { _tag: "AssetWorkspaceContextNotFoundError" }, true],
    ["no attachment by that id", { _tag: "AssetAttachmentNotFoundError" }, true],
    ["the signing key did not load", { _tag: "AssetSigningKeyLoadError" }, false],
  ])("reads a failed signing where %s as not there: %s", (_case, error, notThere) => {
    expect(signingSaysNotThere(Cause.fail(error))).toBe(notThere);
  });

  // A Mate busy building or a socket that reconnects fails a signing for a
  // moment: it is tried again, still loading, before it fails for good.
  it("keeps loading while a failed signing is tried again, then fails", () => {
    testState.result = failure({ _tag: "RpcClientError" });
    const { seen, renderer } = draw(true);
    expect(seen.at(-1)).toBe("Loading");
    for (const wait of SIGN_RETRY_DELAYS_MS) {
      act(() => vi.advanceTimersByTime(wait));
    }
    expect(testState.refreshes).toBe(SIGN_RETRY_DELAYS_MS.length);
    expect(seen.at(-1)).toBe("Failure");
    act(() => renderer.unmount());
  });

  it.each([
    ["AssetWorkspaceAssetNotFoundError", "File no longer exists"],
    ["AssetWorkspaceContextNotFoundError", "Conversation workspace is unavailable"],
    ["AssetWorkspacePathValidationError", "File path is not allowed"],
    ["AssetPreviewTypeValidationError", "File type cannot be previewed"],
  ])("does not retry %s and retains its reason", (tag, reason) => {
    testState.result = failure({ _tag: tag });
    const { seen, renderer } = draw(true);
    expect(seen.at(-1)).toBe("Failure");
    expect(
      assetUrlStateOf(AsyncResult.failure(Cause.fail({ _tag: tag })), "https://mate.test/"),
    ).toEqual({ _tag: "Failure", reason });
    act(() => vi.advanceTimersByTime(60_000));
    expect(testState.refreshes).toBe(0);
    act(() => renderer.unmount());
  });

  it("fails at once where the file is not there, or nobody asked it to try again", () => {
    testState.result = failure({ _tag: "AssetWorkspaceAssetNotFoundError" });
    const missing = draw(true);
    expect(missing.seen.at(-1)).toBe("Failure");
    testState.result = failure({ _tag: "RpcClientError" });
    const once = draw(false);
    expect(once.seen.at(-1)).toBe("Failure");
    act(() => vi.advanceTimersByTime(60_000));
    expect(testState.refreshes).toBe(0);
    act(() => {
      missing.renderer.unmount();
      once.renderer.unmount();
    });
  });
});

// A result's pictures, read together: only a file the server says is not there is gone; one whose
// Mate is asleep, offline or reconnecting is still on its way (opening a sleeping Mate's cached
// conversation must not drop its pictures and bring them back with a jump).
describe("pictures' signed addresses, read together", () => {
  const BASE = "https://mate.test/";
  it.each([
    {
      case: "the file is not there",
      result: AsyncResult.failure(Cause.fail({ _tag: "AssetWorkspaceAssetNotFoundError" })),
      base: BASE,
      state: "Failure",
    },
    {
      case: "the Mate's link is not connected",
      result: AsyncResult.failure(Cause.fail({ _tag: "EnvironmentRpcUnavailableError" })),
      base: BASE,
      state: "Loading",
    },
    {
      case: "the Mate did not answer",
      result: AsyncResult.failure(Cause.fail({ _tag: "RpcClientError" })),
      base: BASE,
      state: "Loading",
    },
    { case: "not asked yet", result: AsyncResult.initial(), base: BASE, state: "Loading" },
    {
      case: "signed, its connection not prepared",
      result: AsyncResult.success({ relativeUrl: "/api/assets/a.png" }),
      base: null,
      state: "Loading",
    },
    {
      case: "signed",
      result: AsyncResult.success({ relativeUrl: "/api/assets/a.png" }),
      base: BASE,
      state: "Success",
    },
  ])("reads $case as $state", ({ result, base, state }) => {
    expect(assetUrlStateOf(result as never, base)._tag).toBe(state);
  });

  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    testState.refreshes = 0;
  });
  afterEach(() => vi.useRealTimers());

  it("tries a transient signing on the same schedule, then reports it unavailable", () => {
    testState.result = [
      AsyncResult.failure(Cause.fail({ _tag: "RpcClientError" })),
      AsyncResult.failure(Cause.fail({ _tag: "AssetWorkspaceAssetNotFoundError" })),
    ];
    const seen: Array<ReadonlyArray<string>> = [];
    function Probe() {
      seen.push(
        useAssetUrlStates(EnvironmentId.make("env-1"), [
          { _tag: "workspace-file", threadId: ThreadId.make("thread-1"), path: "a.png" },
          { _tag: "workspace-file", threadId: ThreadId.make("thread-1"), path: "b.png" },
        ]).map((state) => state._tag),
      );
      return null;
    }
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(<Probe />);
    });
    expect(seen.at(-1)).toEqual(["Loading", "Failure"]);
    for (const wait of SIGN_RETRY_DELAYS_MS) {
      act(() => vi.advanceTimersByTime(wait));
    }
    // Only the one that may come back is asked again, once per step of the schedule.
    expect(testState.refreshes).toBe(SIGN_RETRY_DELAYS_MS.length);
    expect(seen.at(-1)).toEqual(["Failure", "Failure"]);
    act(() => vi.advanceTimersByTime(60_000));
    expect(testState.refreshes).toBe(SIGN_RETRY_DELAYS_MS.length);
    act(() => renderer.unmount());
  });
});
