import type { AccountInput } from "../reducer.ts";
const scope = "zerops:org:organization-user:org" as const;
export const membershipInputs = (
  roleCode: string,
  canCreateProjects = false,
  generation = 1,
): AccountInput[] => [
  { kind: "stream", key: scope, now: generation, event: { kind: "demand", demanded: true } },
  { kind: "stream", key: scope, now: generation, event: { kind: "attempt" } },
  { kind: "stream", key: scope, now: generation, event: { kind: "handshake" } },
  { kind: "baseline-begin", scope, generation },
  {
    kind: "baseline-commit",
    scope,
    generation,
    via: "zerops-read",
    members: ["org"],
    rows: [
      {
        family: "organizationUser",
        id: "org",
        revision: { kind: "zerops", version: null },
        value: {
          id: "user",
          email: "test@example.test",
          clientUserList: [
            { id: "member", clientId: "org", status: "ACTIVE", roleCode, canCreateProjects },
          ],
        },
      },
    ],
  },
  { kind: "stream", key: scope, now: generation, event: { kind: "baseline-committed" } },
];
