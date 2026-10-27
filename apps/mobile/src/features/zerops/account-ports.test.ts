import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";

import { hqAbsent, memoryIntents } from "./account-ports";

describe("memoryIntents", () => {
  it("holds the container intents until they are forgotten", () => {
    const intents = memoryIntents();
    expect(intents.read()).toBeNull();

    intents.write('[{"target":"p:s"}]');
    expect(intents.read()).toBe('[{"target":"p:s"}]');

    intents.write(null);
    expect(intents.read()).toBeNull();
  });
});

describe("hqAbsent", () => {
  // The device runs no HQ flow: HQ will not answer here, and its silence is never passed off as
  // a word from HQ.
  it("names no environment's project and says nothing of a close-off", () => {
    const hq = hqAbsent();
    expect(hq.hqIndex.projectOf(EnvironmentId.make("env-a"))).toBeNull();
    expect(hq.closeOff.read()).toBeNull();
  });
});
