import { describe, expect, it } from "vite-plus/test";
import type { HqProblem } from "@t3tools/shared/hqProblems";
import { problemPresentation } from "./problems.ts";

describe("HQ problem presentation", () => {
  it("The client renders HQ's finding; it never reclassifies HQ's prose or keeps its own copy of which fields Zerops accepts.", () => {
    const problem: HqProblem = {
      code: "arbitrary-code",
      what: "HQ's exact finding, including an unfamiliar field",
      where: {
        appId: "app",
        service: "api",
        tier: "production",
        file: "production.yaml",
        head: "head",
      },
      rule: {
        source: "zerops-schema",
        code: "additionalProperties",
        schemaPath: "/services/additionalProperties",
        instancePath: "/services/0/futureField",
        schemaUrl: "https://schema.example/import.json",
        schemaDigest: "digest",
      },
      next: {
        actor: "mate",
        action: "Keep the unfamiliar field and correct the named value.",
        target: "group",
      },
      evidence: { processId: "original-operation", logUrl: "https://logs.example/original" },
    };
    expect(problemPresentation(problem)).toEqual({
      what: "HQ's exact finding, including an unfamiliar field",
      where: "appId: app · service: api · tier: production · file: production.yaml · head: head",
      rule: "zerops-schema · additionalProperties · /services/additionalProperties · /services/0/futureField · https://schema.example/import.json · digest",
      next: "mate: Keep the unfamiliar field and correct the named value. (group)",
      evidence: "processId: original-operation · logUrl: https://logs.example/original",
    });
  });
});
