import { expect, it, vi } from "vite-plus/test";

import { HqError } from "../../../zerops/hq/client.ts";
import { acquireHqPressLease } from "./hqPressLease.ts";

const refusal = (reason = "not_mate_operator") =>
  new HqError({
    kind: "refused",
    code: "forbidden",
    reason,
    status: 403,
    message: "HQ refused the press write",
  });

it("a refused receipt write never reports a recovered import as recorded", async () => {
  const holdPress = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(refusal());
  const hold = acquireHqPressLease(
    { holdPress, endPress: async () => {} },
    null,
    { kind: "mate", appId: "app-1" },
    "owner-1",
  );

  expect(await hold.take("project-1")).toBe("held");
  expect(await hold.imported("service-1")).toBe("refused");
  expect(holdPress).toHaveBeenLastCalledWith(
    "project-1",
    expect.objectContaining({ importProcessId: "service-1" }),
  );
  await hold.end(false);
});

it("a skipped receipt write never reports a recovered import as recorded", async () => {
  const holdPress = vi.fn().mockRejectedValue(refusal());
  const refusedHold = acquireHqPressLease(
    { holdPress, endPress: async () => {} },
    null,
    { kind: "mate", appId: "app-1" },
    "owner-1",
  );
  expect(await refusedHold.take("project-1")).toBe("held");
  const afterRefusal = await refusedHold.imported("service-1");

  const missingHq = acquireHqPressLease(null, null, { kind: "mate" }, "owner-1");
  await missingHq.take("project-1");
  const withoutHq = await missingHq.imported("service-1");

  let active = true;
  let releaseFirst: () => void = () => {};
  let firstDispatched: () => void = () => {};
  const dispatched = new Promise<void>((resolve) => {
    firstDispatched = resolve;
  });
  const firstAnswer = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const queuedWrite = vi.fn(async () => {
    firstDispatched();
    await firstAnswer;
  });
  const queuedHold = acquireHqPressLease(
    { holdPress: queuedWrite, endPress: async () => {} },
    null,
    { kind: "mate", active: () => active },
    "owner-1",
  );
  const taking = queuedHold.take("project-1");
  await dispatched;
  const importing = queuedHold.imported("service-1");
  active = false;
  releaseFirst();
  await taking;
  const skippedInQueue = await importing;
  expect([afterRefusal, withoutHq, skippedInQueue]).toEqual(["unsent", "unsent", "unsent"]);
  expect(holdPress).toHaveBeenCalledTimes(1);
  expect(queuedWrite).toHaveBeenCalledTimes(1);
});

it("a competing press refuses the receipt and lapses the hold", async () => {
  const holdPress = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(refusal("press_held"));
  const hold = acquireHqPressLease(
    { holdPress, endPress: async () => {} },
    null,
    { kind: "mate" },
    "owner-1",
  );
  await hold.take("project-1");
  expect(await hold.imported("service-1")).toBe("refused");
  expect(hold.lapsed()).toBe(true);
});

it("reports a receipt as recorded only when HQ answers its write", async () => {
  const hold = acquireHqPressLease(
    { holdPress: async () => {}, endPress: async () => {} },
    null,
    { kind: "mate" },
    "owner-1",
  );
  await hold.take("project-1");
  expect(await hold.imported("process-1")).toBe("recorded");
  await hold.end(false);
});

it("preserves uncertainty when HQ does not answer a receipt write", async () => {
  const uncertain = new Error("HQ did not answer");
  const holdPress = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(uncertain);
  const hold = acquireHqPressLease(
    { holdPress, endPress: async () => {} },
    null,
    { kind: "mate" },
    "owner-1",
  );
  await hold.take("project-1");
  await expect(hold.imported("process-1")).rejects.toBe(uncertain);
  await hold.end(false);
});
