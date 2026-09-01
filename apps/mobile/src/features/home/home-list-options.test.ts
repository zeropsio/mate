import { EnvironmentId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { withSelectedHomeEnvironment } from "./home-list-options";

it("stores a newly connected Zerops environment as the Home selection", () => {
  const selectedEnvironmentId = EnvironmentId.make("environment-2");

  expect(
    withSelectedHomeEnvironment(
      { selectedEnvironmentId: null, projectSortOrder: "updated_at" },
      selectedEnvironmentId,
    ),
  ).toEqual({ selectedEnvironmentId, projectSortOrder: "updated_at" });
});
