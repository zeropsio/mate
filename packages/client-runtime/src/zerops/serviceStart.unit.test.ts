import { expect, it } from "vite-plus/test";

import type { ZeropsDoor } from "./api.ts";
import { startService } from "./api/service.ts";

// witness: packages/client-runtime/src/zerops/api/service.ts | `/service-stack/${serviceId}/start`, → `/project/${serviceId}/start`,
it("ZV172: A stopped Mate's Start is one PUT that starts its own container's service, answered by the platform's process; breaks: Start asks the platform to start the project instead of the Mate's container", async () => {
  const sent: string[] = [];
  const door: ZeropsDoor = async (path, init) => {
    sent.push(`${init?.method ?? "GET"} ${path}`);
    return { id: "process-1" } as never;
  };
  expect(await startService(door, "s1")).toEqual({ processId: "process-1" });
  expect(sent).toEqual(["PUT /service-stack/s1/start"]);
});
