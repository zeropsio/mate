import { EnvironmentId } from "@t3tools/contracts";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { describe, expect, it } from "vite-plus/test";

import { zeropsEnvironmentNames } from "./environmentNames";

const ENV_A = EnvironmentId.make("env-a");
const ENV_B = EnvironmentId.make("env-b");

function candidate(input: {
  readonly key: string;
  readonly name: string;
  readonly environmentId?: EnvironmentId;
}): ZeropsCandidate {
  return {
    key: input.key,
    group: "connected",
    project: {
      id: `p-${input.key}`,
      name: input.name,
      status: "ACTIVE",
    } as ZeropsCandidate["project"],
    ...(input.environmentId === undefined ? {} : { environmentId: input.environmentId }),
  };
}

describe("zeropsEnvironmentNames", () => {
  it.each([
    {
      name: "names every environment the candidates know",
      candidates: [
        candidate({ key: "1", name: "acme-docs-dev", environmentId: ENV_A }),
        candidate({ key: "2", name: "beviro-crm-dev", environmentId: ENV_B }),
      ],
      expected: [
        [ENV_A, "acme-docs-dev"],
        [ENV_B, "beviro-crm-dev"],
      ],
    },
    {
      name: "skips a project that is not an environment yet",
      candidates: [
        candidate({ key: "1", name: "no-container" }),
        candidate({ key: "2", name: "  ", environmentId: ENV_B }),
        candidate({ key: "3", name: "beviro-crm-dev", environmentId: ENV_A }),
      ],
      expected: [[ENV_A, "beviro-crm-dev"]],
    },
    {
      name: "keeps the first candidate's name for an environment listed twice",
      candidates: [
        candidate({ key: "1", name: "first", environmentId: ENV_A }),
        candidate({ key: "2", name: "second", environmentId: ENV_A }),
      ],
      expected: [[ENV_A, "first"]],
    },
  ])("$name", ({ candidates, expected }) => {
    expect([...zeropsEnvironmentNames(candidates)]).toEqual(expected);
  });
});
