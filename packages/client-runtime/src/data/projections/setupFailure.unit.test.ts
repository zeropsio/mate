import { expect, it } from "vite-plus/test";
import { processValue } from "../__fixtures__/account.ts";
import { failedSetupProcess } from "./setupFailure.ts";
const failed = processValue({
  id: "failed-setup",
  projectId: "p1",
  actionName: "stack.create",
  serviceStackIds: ["zcp"],
  status: "FAILED",
  created: "2026-10-07T10:00:00Z",
  started: "2026-10-07T10:00:02Z",
  finished: "2026-10-07T10:01:12Z",
  failReason: "CommandExec: init command failed",
});
// witness: packages/client-runtime/src/data/projections/setupFailure.ts | b.created.localeCompare(a.created) → a.created.localeCompare(b.created)
it("PJ63: A retried container setup never shows the replaced attempt's failure", () => {
  const retry = { ...failed, id: "retry", status: "RUNNING", created: "2026-10-07T10:02:00Z" };
  expect(failedSetupProcess([failed], "zcp")).toEqual(failed);
  expect(failedSetupProcess([failed], "other")).toBeUndefined();
  for (const processes of [
    [failed, retry],
    [retry, failed],
  ])
    expect(failedSetupProcess(processes, "zcp")).toBeUndefined();
  expect(failedSetupProcess([{ ...retry, status: "FINISHED" }, failed], "zcp")).toBeUndefined();
});
