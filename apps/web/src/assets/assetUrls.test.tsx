import { Cause } from "effect";
import { act } from "react";
import { create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const testState = vi.hoisted(() => ({
  result: { _tag: "Initial" } as unknown,
  refreshes: 0,
}));

vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => testState.result,
  useAtomRefresh: () => () => {
    testState.refreshes += 1;
  },
}));
vi.mock("~/state/assets", () => ({
  assetEnvironment: { createUrl: () => ({}) },
}));
vi.mock("~/state/session", () => ({
  usePreparedConnection: () => ({ _tag: "Some", value: { httpBaseUrl: "https://mate.test/" } }),
}));

import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { SIGN_RETRY_DELAYS_MS, signingSaysNotThere, useAssetUrlState } from "./assetUrls";

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
    ["the file is not there", { _tag: "AssetWorkspaceResolutionError" }, true],
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

  it("fails at once where the file is not there, or nobody asked it to try again", () => {
    testState.result = failure({ _tag: "AssetWorkspaceResolutionError" });
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
