import * as CodexRpc from "effect-codex-app-server/rpc";
import { assert, describe, it } from "vite-plus/test";

import { routeCodexChildNotification } from "./CodexSessionRuntime.ts";

const notification = CodexRpc.SERVER_NOTIFICATION_METHODS;

describe("routeCodexChildNotification", () => {
  it("drops only enumerated child chatter", () => {
    for (const method of [
      notification["item/agentMessage/delta"],
      notification["item/reasoning/textDelta"],
      notification["item/commandExecution/outputDelta"],
      notification["turn/plan/updated"],
      notification["thread/name/updated"],
    ]) {
      assert.equal(routeCodexChildNotification(method), "drop", method);
    }
  });
});
