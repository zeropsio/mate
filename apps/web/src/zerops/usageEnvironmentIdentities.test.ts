import type { HqMateOwner } from "@t3tools/client-runtime/data";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { HqPlacement } from "@t3tools/client-runtime/zerops/hq";
import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  usageEnvironmentIdentities,
  usageBaselineStatus,
  usageOwnersStatus,
  type UsageEnvironmentIdentity,
} from "./usageEnvironmentIdentities";

const LENA = EnvironmentId.make("env-lena");
const OTTO = EnvironmentId.make("env-otto");
const FEN = EnvironmentId.make("env-fen");

/** Each Mate's owner as HQ names them, by project. */
const JAN: HqMateOwner = { userId: "user-jan", name: "Jan Novak", avatarUrl: null };
const EVA: HqMateOwner = { userId: "user-eva", name: "Eva Dvorak", avatarUrl: null };
const JAN_OWNER = { id: "user-jan", name: "Jan Novak", initials: "JN", avatarUrl: null };
const EVA_OWNER = { id: "user-eva", name: "Eva Dvorak", initials: "ED", avatarUrl: null };

/** A Mate HQ places in application `appId`, named `appName`. Its name is its project's (D3). */
function placedMate(appId: string, appName: string): HqPlacement {
  return { appId, appName, kind: "mate", mate: { face: "" } };
}

const titan = () => placedMate("titan", "Imperial Titan");
const docs = () => placedMate("docs", "Acme Docs");

function candidate(input: {
  readonly id: string;
  /** Its project's name in Zerops, the Mate's; its id where none is given. */
  readonly name?: string;
  readonly tags: ReadonlyArray<string>;
  readonly hq?: HqPlacement;
  readonly environmentId?: EnvironmentId;
}): ZeropsCandidate {
  return {
    key: `${input.id}:zcp`,
    project: {
      id: input.id,
      name: input.name ?? input.id,
      status: "ACTIVE",
      tagList: input.tags,
      ...(input.hq === undefined ? {} : { hq: input.hq }),
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
    readonly owners?: Readonly<Record<string, HqMateOwner | null>>;
    readonly viewerUserId?: string | null;
    readonly registeredOrigins?: ReadonlyMap<string, EnvironmentId>;
    readonly expected: ReadonlyArray<readonly [EnvironmentId, UsageEnvironmentIdentity]>;
  }> = [
    {
      name: "names a Mate by its name and its project by the group's header",
      candidates: [
        candidate({
          id: "titan-dev",
          tags: ["mate"],
          name: "Lena",
          hq: titan(),
          environmentId: LENA,
        }),
      ],
      expected: [
        [
          LENA,
          {
            mateName: "Lena",
            projectId: "titan",
            ownerState: "unknown",
            projectName: "Imperial Titan",
            owner: null,
          },
        ],
      ],
    },
    {
      name: "one project holding two Mates of two owners, the viewer's own flagged",
      candidates: [
        candidate({
          id: "titan-dev",
          tags: ["mate"],
          name: "Lena",
          hq: titan(),
          environmentId: LENA,
        }),
        candidate({
          id: "titan-otto",
          tags: ["mate"],
          name: "Otto",
          hq: titan(),
          environmentId: OTTO,
        }),
      ],
      owners: { "titan-dev": JAN, "titan-otto": EVA },
      viewerUserId: "user-eva",
      expected: [
        [
          LENA,
          {
            mateName: "Lena",
            projectId: "titan",
            ownerState: "known",
            projectName: "Imperial Titan",
            owner: { ...JAN_OWNER, isViewer: false },
          },
        ],
        [
          OTTO,
          {
            mateName: "Otto",
            projectId: "titan",
            ownerState: "known",
            projectName: "Imperial Titan",
            owner: { ...EVA_OWNER, isViewer: true },
          },
        ],
      ],
    },
    {
      name: "an owner wears HQ's picture of them, one without a picture their initials",
      candidates: [
        candidate({
          id: "titan-dev",
          tags: ["mate"],
          name: "Lena",
          hq: titan(),
          environmentId: LENA,
        }),
        candidate({
          id: "titan-otto",
          tags: ["mate"],
          name: "Otto",
          hq: titan(),
          environmentId: OTTO,
        }),
      ],
      owners: {
        "titan-dev": { ...JAN, avatarUrl: "https://img.example.test/jan.jpg" },
        "titan-otto": EVA,
      },
      viewerUserId: "user-eva",
      expected: [
        [
          LENA,
          {
            mateName: "Lena",
            projectId: "titan",
            ownerState: "known",
            projectName: "Imperial Titan",
            owner: { ...JAN_OWNER, avatarUrl: "https://img.example.test/jan.jpg", isViewer: false },
          },
        ],
        [
          OTTO,
          {
            mateName: "Otto",
            projectId: "titan",
            ownerState: "known",
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
          name: "Lena",
          tags: ["mate"],
          hq: placedMate("k2m9", ""),
          environmentId: LENA,
        }),
      ],
      expected: [
        [
          LENA,
          {
            mateName: "Lena",
            projectId: "k2m9",
            ownerState: "unknown",
            projectName: null,
            owner: null,
          },
        ],
      ],
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
          ...candidate({ id: "titan-dev", tags: ["mate"], name: "Lena", hq: titan() }),
          containerOrigin: "https://node-lena.runtime.zcp.zerops.app",
        },
      ],
      registeredOrigins: new Map([["https://node-lena.runtime.zcp.zerops.app", LENA]]),
      expected: [
        [
          LENA,
          {
            mateName: "Lena",
            projectId: "titan",
            ownerState: "unknown",
            projectName: "Imperial Titan",
            owner: null,
          },
        ],
      ],
    },
    {
      // In no project, so HQ records no name for it: it goes by its project's.
      name: "a Mate HQ names no owner of is nobody's",
      candidates: [
        candidate({
          id: "gone-dev",
          tags: ["mate"],
          environmentId: LENA,
        }),
      ],
      owners: { "gone-dev": null },
      viewerUserId: "user-jan",
      expected: [
        [
          LENA,
          {
            mateName: "gone-dev",
            projectId: null,
            ownerState: "unassigned",
            projectName: null,
            owner: null,
          },
        ],
      ],
    },
    {
      name: "two people's Mates across two projects",
      candidates: [
        candidate({
          id: "titan-dev",
          tags: ["mate"],
          name: "Lena",
          hq: titan(),
          environmentId: LENA,
        }),
        candidate({
          id: "docs-dev",
          tags: ["mate"],
          name: "Otto",
          hq: docs(),
          environmentId: OTTO,
        }),
        candidate({
          id: "docs-fen",
          tags: ["mate"],
          name: "Fen",
          hq: docs(),
          environmentId: FEN,
        }),
      ],
      owners: { "titan-dev": JAN, "docs-dev": JAN, "docs-fen": EVA },
      viewerUserId: "user-jan",
      expected: [
        [
          LENA,
          {
            mateName: "Lena",
            projectId: "titan",
            ownerState: "known",
            projectName: "Imperial Titan",
            owner: { ...JAN_OWNER, isViewer: true },
          },
        ],
        [
          OTTO,
          {
            mateName: "Otto",
            projectId: "docs",
            ownerState: "known",
            projectName: "Acme Docs",
            owner: { ...JAN_OWNER, isViewer: true },
          },
        ],
        [
          FEN,
          {
            mateName: "Fen",
            projectId: "docs",
            ownerState: "known",
            projectName: "Acme Docs",
            owner: { ...EVA_OWNER, isViewer: false },
          },
        ],
      ],
    },
  ];

  it.each(Array.from(cases, (entry) => ({ title: entry.name, entry })))("$title", ({ entry }) => {
    const identities = usageEnvironmentIdentities({
      candidates: entry.candidates,
      registeredOrigins: entry.registeredOrigins ?? NO_ORIGINS,
      owners: Object.fromEntries(
        Object.entries(entry.owners ?? {}).map(([id, owner]) => [
          id,
          { owner, owned: owner !== null },
        ]),
      ),
      viewerUserId: entry.viewerUserId ?? null,
    });
    expect([...identities]).toEqual(entry.expected);
  });
});

describe("usageOwnersStatus", () => {
  const signedIn = {
    session: "signed-in",
    organization: "selected",
    people: "ready",
    listing: "known",
  } as const;
  it.each([
    {
      name: "resolved once HQ's people and the listing are known",
      input: signedIn,
      expected: "resolved",
    },
    {
      name: "resolving while the session restores",
      input: { ...signedIn, session: "loading", people: "idle", listing: "unread" },
      expected: "resolving",
    },
    {
      name: "unavailable when signed out",
      input: { ...signedIn, session: "signed-out", people: "idle", listing: "unread" },
      expected: "unavailable",
    },
    {
      name: "resolving while the organization is being chosen",
      input: { ...signedIn, organization: "loading", people: "idle", listing: "unread" },
      expected: "resolving",
    },
    {
      name: "unavailable when no organization is selected",
      input: { ...signedIn, organization: "needs-selection", people: "idle", listing: "unread" },
      expected: "unavailable",
    },
    {
      name: "resolving while HQ's people are on their way",
      input: { ...signedIn, people: "loading" },
      expected: "resolving",
    },
    {
      name: "unavailable when HQ names nobody: one from before the overviews",
      input: { ...signedIn, people: "failed" },
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

it.each([
  ["new org ignores the old answer", "new", "old", true, false, "resolving"],
  ["cold placement", "org", "org", false, false, "resolving"],
  ["settled placement", "org", "org", true, false, "resolved"],
  ["warm HQ outage preserves the authorized baseline", "org", "org", true, true, "resolved"],
  ["cold HQ outage is unavailable", "org", "org", false, true, "unavailable"],
] as const)("%s", (_, orgId, navigationOrgId, complete, capped, expected) => {
  expect(
    usageBaselineStatus({
      orgId,
      navigationOrgId,
      placement: { complete },
      listing: "known",
      navigation: {
        read: complete ? "read" : "unread",
        refusal: null,
        capped,
        updateRequired: false,
      },
    }),
  ).toBe(expected);
});
