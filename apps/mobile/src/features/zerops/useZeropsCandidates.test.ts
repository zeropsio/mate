import { expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";

import { connectedZeropsOrigins } from "./candidate-origins";

it("indexes only connected Zerops origins", () => {
  const connected = EnvironmentId.make("connected");
  const origins = connectedZeropsOrigins([
    {
      environmentId: connected,
      displayUrl: "https://ZCP-DEMO-8080.PRG1.ZEROPS.APP/z3/",
      connection: { phase: "connected" },
    },
    {
      environmentId: EnvironmentId.make("offline"),
      displayUrl: "https://offline.example.test/z3",
      connection: { phase: "offline" },
    },
  ]);

  expect(origins).toEqual(new Map([["https://zcp-demo-8080.prg1.zerops.app", connected]]));
});
