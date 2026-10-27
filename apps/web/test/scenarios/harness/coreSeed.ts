import { assert } from "@effect/vitest";
import * as Effect from "effect/Effect";

import type { FakeWorld, ZeropsMember, ZeropsOwnToken } from "./fakeWorld.ts";
import { emptyWorld } from "./fakeWorld.ts";
import type { Call } from "./httpCall.ts";

const HQ = "HQ1";
const ADDRESS = "https://hqzone.prg1-zerops.zone";

const person = (userId: string, roleCode: string): ZeropsMember => ({
  name: userId,
  kind: "person",
  roleCode,
  status: "ACTIVE",
  userId,
  clientUserId: `C-${userId}`,
  canCreateProjects: false,
  email: `${userId}@tea.test`,
});

const tokenRecord = (patch: Partial<ZeropsOwnToken>): Omit<ZeropsOwnToken, "readAtMs"> => ({
  id: "T",
  name: "",
  orgId: "ORG",
  roleCode: "NO_ACCESS",
  canCreateProjects: false,
  canViewFinances: false,
  canEditFinances: false,
  projects: [],
  createdMs: 0,
  createdByUser: null,
  ...patch,
});

/** The rig in miniature: HQ's token and anchor, an owner, a Developer, the HQ project and a Mate's. */
export const seedCoreWorld = (now: number, anchored: boolean, orgId: string): FakeWorld => {
  const fake = emptyWorld();
  fake.tokens.set(
    "hq",
    tokenRecord({ id: "T-hq", orgId, name: `mate-hq-org:${HQ}`, roleCode: "READ_ONLY" }),
  );
  const door = (value: string, createdByUser: string, patch: Partial<ZeropsOwnToken> = {}) =>
    fake.tokens.set(
      value,
      tokenRecord({
        id: value,
        orgId,
        name: `mate-door:${HQ}:n0nce`,
        createdMs: now,
        createdByUser,
        ...patch,
      }),
    );
  door("door-owner", "owner");
  door("door-owner-2", "owner");
  door("door-dev", "dev");
  door("door-flagged", "owner", { canCreateProjects: true });
  door("door-reader", "reader");
  door("door-other-org", "owner", { orgId: "ORG2" });
  door("door-wrong-name", "owner", { name: "mate-door:ELSEWHERE:n0nce" });
  door("door-invited", "invitee");
  door("door-stale", "owner", { createdMs: now - 10 * 60_000 });
  fake.members.set(orgId, [
    person("owner", "OWNER"),
    person("dev", "NO_ACCESS"),
    person("reader", "READ_ONLY"),
    { ...person("invitee", "ADMIN"), status: "INVITED" },
    { ...person("T-hq", "READ_ONLY"), name: `mate-hq-org:${HQ}`, kind: "token" },
    ...(anchored
      ? [
          {
            ...person("T-anchor", "ADMIN"),
            name: `mate-hq:${HQ}:${ADDRESS}`,
            kind: "token" as const,
          },
        ]
      : []),
  ]);
  for (const id of [HQ, "P_MATE"]) {
    fake.projects.push({
      id,
      orgId,
      name: id,
      status: "ACTIVE",
      tags: [],
      userRoles: [],
      publicZone: id === HQ ? "hqzone.prg1-zerops.zone" : `${id}.prg1-zerops.zone`,
    });
  }
  return fake;
};

/** A one-use ticket for `session`'s socket. */
export const ticketFor = (call: Call, session: string) =>
  Effect.map(
    call("POST", "/api/stream-ticket", { session }),
    (response) => (response.body as { readonly ticket: string }).ticket,
  );

/** What zcp does: the challenge, written into the project's env, presented back; the credential. */
export const enrollMate = (call: Call, fake: FakeWorld, projectId: string) =>
  Effect.gen(function* () {
    const { nonce } = (yield* call("POST", "/api/mate/challenge", { body: { projectId } }))
      .body as { readonly nonce: string };
    fake.env.set(projectId, [{ key: "MATE_HQ_CHALLENGE", value: nonce, sensitive: false }]);
    const issued = yield* call("POST", "/api/mate/credential", { body: { projectId, nonce } });
    assert.strictEqual(issued.status, 200);
    return (issued.body as { readonly credential: string }).credential;
  });
