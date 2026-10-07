import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import type { HqLifecycleRecord } from "@t3tools/shared/hqLifecycle";
import { ZeropsDeletionRecovery } from "./ZeropsDeletionRecovery";
import { Button } from "../ui/button";

const held = vi.hoisted(() => ({
  records: [] as HqLifecycleRecord[],
  current: true,
  run: vi.fn(),
}));
vi.mock("~/zerops/useLifecycleRemainders", () => ({
  useLifecycleRemainders: () => ({ deletions: held.records }),
}));
vi.mock("~/zerops/accountOperations", () => ({ useAccountOperations: () => ({ run: held.run }) }));
vi.mock("~/zerops/accountLifetime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/zerops/accountLifetime")>()),
  captureAccountLifetime: () => () => held.current,
}));
let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  held.current = true;
  held.run.mockReset().mockResolvedValue(undefined);
  held.records = [
    {
      requestId: "original",
      projectName: "Ada",
      intent: { kind: "prepare-mate-deletion", orgId: "org", hqProjectId: "hq", projectId: "p" },
      result: { keyTokenId: "exact-key", completion: "seal" },
    },
  ];
  act(() => {
    tree = create(<ZeropsDeletionRecovery />);
  });
});
afterEach(() => {
  act(() => tree?.unmount());
});
const finish = () =>
  act(async () => {
    tree?.root.findByType(Button).props.onClick();
  });

it("a reopened deletion never deletes the project again and retains its exact cleanup request ids", async () => {
  held.run.mockRejectedValueOnce(new Error("HQ isn't answering."));
  await finish();
  expect(tree?.root.findByProps({ role: "alert" }).children.join("")).toContain(
    "HQ isn't answering.",
  );
  await finish();
  expect(held.run.mock.calls.map(([intent]) => intent.kind)).toEqual([
    "complete-mate-deletion",
    "complete-mate-deletion",
    "retire-mate-key",
    "complete-key-retirement",
  ]);
  expect(held.run.mock.calls.map(([, options]) => options.requestId)).toEqual([
    "original:complete",
    "original:complete",
    "original:retire",
    "original:retired",
  ]);
  expect(held.run.mock.calls[2]?.[0]).toMatchObject({
    tokenId: "exact-key",
    preparedRequestId: "original",
    completionRequestId: "original:complete",
  });
  held.records = [];
  act(() => tree?.update(<ZeropsDeletionRecovery />));
  expect(tree?.toJSON()).toBe(null);
});

it("account closure between completion and retirement ends the cleanup without another write", async () => {
  held.run.mockImplementationOnce(async () => {
    held.current = false;
  });
  await finish();
  expect(held.run).toHaveBeenCalledTimes(1);
});
