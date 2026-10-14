import type { AccountInput } from "../reducer.ts";
export const membershipInputs = (
  roleCode: string,
  canCreateProjects = false,
  generation = 1,
  orgId = "org",
): AccountInput[] => {
  const scope = `zerops:${orgId}:organization-user:${orgId}` as const;
  return [
    { kind: "stream", key: scope, now: generation, event: { kind: "demand", demanded: true } },
    { kind: "stream", key: scope, now: generation, event: { kind: "attempt" } },
    { kind: "stream", key: scope, now: generation, event: { kind: "handshake" } },
    { kind: "baseline-begin", scope, generation },
    {
      kind: "baseline-commit",
      scope,
      generation,
      via: "zerops-read",
      members: [orgId],
      rows: [
        {
          family: "organizationUser",
          id: orgId,
          revision: { kind: "zerops", version: null },
          value: {
            id: "user",
            email: "test@example.test",
            clientUserList: [
              { id: "member", clientId: orgId, status: "ACTIVE", roleCode, canCreateProjects },
            ],
          },
        },
      ],
    },
    { kind: "stream", key: scope, now: generation, event: { kind: "baseline-committed" } },
  ];
};
