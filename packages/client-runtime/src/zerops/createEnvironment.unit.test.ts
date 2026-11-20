import { expect, it } from "vite-plus/test";

import { planEnvironmentCreation } from "./createEnvironment.ts";

// witness: packages/client-runtime/src/zerops/createEnvironment.ts | if (input.role === "prod") { → if (input.role === "prod" && input.withAgent !== true) {
it("ZV135: Creating a production reserves its project and access with no services and no agent container, even when an agent is asked for", () => {
  const grant = { clientUserId: "cu-1", roleCode: "ADMIN" };
  expect(
    planEnvironmentCreation({
      clientId: "c1",
      role: "prod",
      name: "Shop - production",
      withAgent: true,
      userRoles: [grant],
    }),
  ).toEqual({
    ok: true,
    steps: [
      {
        kind: "create-project",
        name: "Shop - production",
        tagList: [],
        location: undefined,
        userRoles: [grant],
      },
      { kind: "register" },
    ],
  });
});
