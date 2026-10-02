import type { ZeropsOrganizationMember } from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { HqPlacement } from "@t3tools/client-runtime/zerops/hq";
import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  usageEnvironmentIdentities,
  usageOwnersStatus,
  type UsageEnvironmentIdentity,
} from "./usageEnvironmentIdentities";

const LENA = EnvironmentId.make("env-lena");
const OTTO = EnvironmentId.make("env-otto");
const FEN = EnvironmentId.make("env-fen");

const JAN: ZeropsOrganizationMember = {
  id: "member-jan",
  user: {
    id: "user-jan",
    fullName: "Jan Novak",
    avatar: { smallAvatarUrl: "https://avatars.example/jan.png" },
  },
};
const EVA: ZeropsOrganizationMember = {
  id: "member-eva",
  user: { id: "user-eva", firstName: "Eva", lastName: "Dvorak" },
};
const JAN_OWNER = {
  id: "user-jan",
  name: "Jan Novak",
  initials: "JN",
  avatarUrl: "https://avatars.example/jan.png",
};
const EVA_OWNER = { id: "user-eva", name: "Eva Dvorak", initials: "ED", avatarUrl: null };

/**
 * A Mate HQ places in application `appId`, named `appName`, as `name`; its summary names who
 * signed Claude in where `signer` is given.
 */
function placedMate(appId: string, appName: string, name: string, signer?: string): HqPlacement {
  const live =
    signer === undefined
      ? {}
      : {
          live: {
            online: true,
            at: "2026-10-02T10:00:00.000Z",
            summary: { main: null, running: 0, waiting: 0, signers: { "claude-code": signer } },
          },
        };
  return { appId, appName, kind: "mate", mate: { name, face: "", ...live } };
}

const titan = (name: string) => placedMate("titan", "Imperial Titan", name);
const docs = (name: string, signer?: string) => placedMate("docs", "Acme Docs", name, signer);

function candidate(input: {
  readonly id: string;
  readonly tags: ReadonlyArray<string>;
  readonly hq?: HqPlacement;
  readonly environmentId?: EnvironmentId;
  readonly ownerMemberId?: string;
}): ZeropsCandidate {
  return {
    key: `${input.id}:zcp`,
    project: {
      id: input.id,
      name: input.id,
      status: "ACTIVE",
      tagList: input.tags,
      ...(input.hq === undefined ? {} : { hq: input.hq }),
      ...(input.ownerMemberId === undefined
        ? {}
        : { userRoles: [{ clientUserId: input.ownerMemberId, roleCode: "OWNER" }] }),
    },
    group: input.environmentId === undefined ? "ready" : "connected",
    service: { id: "zcp", name: "zcp", status: "ACTIVE" },
    ...(input.environmentId === undefined ? {} : { environmentId: input.environmentId }),
  };
}

const NO_ORIGINS: ReadonlyMap<string, EnvironmentId> = new Map();

describe("usageEnvironmentIdentities", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly candidates: ReadonlyArray<ZeropsCandidate>;
    readonly members?: ReadonlyArray<ZeropsOrganizationMember>;
    readonly viewerUserId?: string | null;
    readonly registeredOrigins?: ReadonlyMap<string, EnvironmentId>;
    readonly expected: ReadonlyArray<readonly [EnvironmentId, UsageEnvironmentIdentity]>;
  }> = [
    {
      name: "names a Mate by its name and its project by the group's header",
      candidates: [
        candidate({ id: "titan-dev", tags: ["mate"], hq: titan("Lena"), environmentId: LENA }),
      ],
      expected: [[LENA, { mateName: "Lena", projectName: "Imperial Titan", owner: null }]],
    },
    {
      name: "one project holding two Mates of two owners, the viewer's own flagged",
      candidates: [
        candidate({
          id: "titan-dev",
          tags: ["mate"],
          hq: titan("Lena"),
          environmentId: LENA,
          ownerMemberId: "member-jan",
        }),
        candidate({
          id: "titan-otto",
          tags: ["mate"],
          hq: titan("Otto"),
          environmentId: OTTO,
          ownerMemberId: "member-eva",
        }),
      ],
      members: [JAN, EVA],
      viewerUserId: "user-eva",
      expected: [
        [
          LENA,
          {
            mateName: "Lena",
            projectName: "Imperial Titan",
            owner: { ...JAN_OWNER, isViewer: false },
          },
        ],
        [
          OTTO,
          {
            mateName: "Otto",
            projectName: "Imperial Titan",
            owner: { ...EVA_OWNER, isViewer: true },
          },
        ],
      ],
    },
    {
      name: "a group with no real name reads as no project",
      candidates: [
        candidate({
          id: "loose-dev",
          tags: ["mate"],
          hq: placedMate("k2m9", "", "Lena"),
          environmentId: LENA,
        }),
      ],
      expected: [[LENA, { mateName: "Lena", projectName: null, owner: null }]],
    },
    {
      name: "leaves out a Mate no environment reaches, and an environment nobody lives in",
      candidates: [
        candidate({ id: "unreached-dev", tags: ["mate"] }),
        candidate({
          id: "titan-stage",
          tags: [],
          hq: { appId: "titan", appName: "Imperial Titan", kind: "stage", mate: null },
          environmentId: OTTO,
        }),
      ],
      expected: [],
    },
    {
      name: "knows a Mate by its container's origin before its socket is up",
      candidates: [
        {
          ...candidate({ id: "titan-dev", tags: ["mate"], hq: titan("Lena") }),
          containerOrigin: "https://node-lena.runtime.zcp.zerops.app",
        },
      ],
      registeredOrigins: new Map([["https://node-lena.runtime.zcp.zerops.app", LENA]]),
      expected: [[LENA, { mateName: "Lena", projectName: "Imperial Titan", owner: null }]],
    },
    {
      // In no project, so HQ records no name for either: each goes by its project's.
      name: "an owner the member list does not have, or who names no person, is nobody",
      candidates: [
        candidate({
          id: "gone-dev",
          tags: ["mate"],
          environmentId: LENA,
          ownerMemberId: "member-left",
        }),
        candidate({
          id: "faceless-dev",
          tags: ["mate"],
          environmentId: OTTO,
          ownerMemberId: "member-faceless",
        }),
      ],
      members: [JAN, { id: "member-faceless" }],
      viewerUserId: "user-jan",
      expected: [
        [LENA, { mateName: "gone-dev", projectName: null, owner: null }],
        [OTTO, { mateName: "faceless-dev", projectName: null, owner: null }],
      ],
    },
    {
      name: "a member whose user carries no id is keyed by the member id",
      candidates: [
        candidate({
          id: "titan-dev",
          tags: ["mate"],
          environmentId: LENA,
          ownerMemberId: "member-anon",
        }),
      ],
      members: [{ id: "member-anon", user: { email: "anon@example.com" } }],
      viewerUserId: "user-jan",
      expected: [
        [
          LENA,
          {
            mateName: "titan-dev",
            projectName: null,
            owner: {
              id: "member-anon",
              name: "anon@example.com",
              initials: "A",
              avatarUrl: null,
              isViewer: false,
            },
          },
        ],
      ],
    },
    {
      name: "two people's Mates across two projects, an owner named by the agent's signer",
      candidates: [
        candidate({
          id: "titan-dev",
          tags: ["mate"],
          hq: titan("Lena"),
          environmentId: LENA,
          ownerMemberId: "member-jan",
        }),
        candidate({
          id: "docs-dev",
          tags: ["mate"],
          hq: docs("Otto"),
          environmentId: OTTO,
          ownerMemberId: "member-jan",
        }),
        candidate({
          id: "docs-fen",
          tags: ["mate"],
          hq: docs("Fen", "user-eva"),
          environmentId: FEN,
        }),
      ],
      members: [JAN, EVA],
      viewerUserId: "user-jan",
      expected: [
        [
          LENA,
          {
            mateName: "Lena",
            projectName: "Imperial Titan",
            owner: { ...JAN_OWNER, isViewer: true },
          },
        ],
        [
          OTTO,
          { mateName: "Otto", projectName: "Acme Docs", owner: { ...JAN_OWNER, isViewer: true } },
        ],
        [
          FEN,
          { mateName: "Fen", projectName: "Acme Docs", owner: { ...EVA_OWNER, isViewer: false } },
        ],
      ],
    },
  ];

  for (const entry of cases) {
    it(entry.name, () => {
      const identities = usageEnvironmentIdentities({
        candidates: entry.candidates,
        registeredOrigins: entry.registeredOrigins ?? NO_ORIGINS,
        members: entry.members ?? [],
        viewerUserId: entry.viewerUserId ?? null,
      });
      expect([...identities]).toEqual(entry.expected);
    });
  }
});

describe("usageOwnersStatus", () => {
  const signedIn = {
    session: "signed-in",
    organization: "selected",
    members: "ready",
    listing: "known",
  } as const;
  it.each([
    {
      name: "resolved once members and the listing are known",
      input: signedIn,
      expected: "resolved",
    },
    {
      name: "resolving while the session restores",
      input: { ...signedIn, session: "loading", members: "idle", listing: "unread" },
      expected: "resolving",
    },
    {
      name: "unavailable when signed out",
      input: { ...signedIn, session: "signed-out", members: "idle", listing: "unread" },
      expected: "unavailable",
    },
    {
      name: "resolving while the organization is being chosen",
      input: { ...signedIn, organization: "loading", members: "idle", listing: "unread" },
      expected: "resolving",
    },
    {
      name: "unavailable when no organization is selected",
      input: { ...signedIn, organization: "needs-selection", members: "idle", listing: "unread" },
      expected: "unavailable",
    },
    {
      name: "resolving while members are read",
      input: { ...signedIn, members: "loading" },
      expected: "resolving",
    },
    {
      name: "unavailable when the member read failed",
      input: { ...signedIn, members: "failed" },
      expected: "unavailable",
    },
    {
      name: "resolving while the listing is read",
      input: { ...signedIn, listing: "reading" },
      expected: "resolving",
    },
    {
      name: "resolving while the listing is unread",
      input: { ...signedIn, listing: "unread" },
      expected: "resolving",
    },
    {
      name: "unavailable when the listing failed",
      input: { ...signedIn, listing: "failed" },
      expected: "unavailable",
    },
    {
      name: "unavailable when the listing is withheld",
      input: { ...signedIn, listing: "withheld" },
      expected: "unavailable",
    },
  ] as const)("$name", ({ input, expected }) => {
    expect(usageOwnersStatus(input)).toBe(expected);
  });
});
