import { expect, it } from "vite-plus/test";

import { deployTokenMint } from "./deployToken.ts";

// witness: packages/client-runtime/src/zerops/deployToken.ts | roleCode: "BASIC_USER" }], → roleCode: "ADMIN" }],
it("ZV112: A deploy token asks for no organization role and for Basic user on the environment's project alone", () => {
  const mint = deployTokenMint({ projectId: "p-stage", environmentName: "stage" });

  expect(mint.roleCode).toBe("NO_ACCESS");
  expect(mint.projects).toEqual([{ projectId: "p-stage", roleCode: "BASIC_USER" }]);
});
