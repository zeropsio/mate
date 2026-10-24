import { describe, expect, it } from "@effect/vitest";

import { signInStartingOrganisation, type OrgStartPorts } from "./orgKeyMint.logic.ts";

type Answer = { readonly session: string; readonly orgKeyKept?: boolean };

class NotStarted extends Error {
  readonly code = "org_not_started";
}
class KeyRejected extends Error {
  readonly code = "org_key_rejected";
}

/** Locks as `navigator.locks` grants them: one holder per name, in the order asked. */
function fakeLocks() {
  const tails = new Map<string, Promise<unknown>>();
  return <T>(name: string, run: () => Promise<T>): Promise<T> => {
    const result = (tails.get(name) ?? Promise.resolve()).then(run, run);
    tails.set(
      name,
      result.catch(() => undefined),
    );
    return result;
  };
}

/** HQ as the sign-in sees it: the first valid organisation key starts the organisation. */
function fakeHq(options: { readonly rejectKeys?: boolean } = {}) {
  let started = false;
  const log = { signIns: 0, minted: [] as string[], deleted: [] as string[] };
  const ports = (withLock: OrgStartPorts<Answer>["withLock"]): OrgStartPorts<Answer> => ({
    orgId: "org-1",
    withLock,
    mayStart: async () => true,
    signIn: async (orgKey) => {
      log.signIns += 1;
      await Promise.resolve();
      if (orgKey === undefined) {
        if (started) return { session: "s" };
        throw new NotStarted();
      }
      if (options.rejectKeys) throw new KeyRejected();
      if (started) return { session: "s", orgKeyKept: false };
      started = true;
      return { session: "s", orgKeyKept: true };
    },
    isNotStarted: (cause) => cause instanceof NotStarted,
    mintKey: async () => {
      const id = `key-${log.minted.length + 1}`;
      log.minted.push(id);
      return { id, token: `token-${id}` };
    },
    deleteKey: async (id) => {
      log.deleted.push(id);
    },
  });
  return { log, ports };
}

describe("an Owner or Admin signing in to an organisation HQ has not started", () => {
  it("Two tabs of an Owner signing in to an unstarted organisation mint one key", async () => {
    const hq = fakeHq();
    const locks = fakeLocks();
    const [one, two] = await Promise.all([
      signInStartingOrganisation(hq.ports(locks)),
      signInStartingOrganisation(hq.ports(locks)),
    ]);
    expect([one.session, two.session]).toEqual(["s", "s"]);
    expect(hq.log.minted).toEqual(["key-1"]);
    expect(hq.log.deleted).toEqual([]);
  });

  it("an answer saying the key was not kept deletes the token the client minted", async () => {
    const hq = fakeHq();
    const base = hq.ports(fakeLocks());
    // Another caller started the organisation between the lock's re-ask and the key's use.
    let asked = 0;
    const ports: OrgStartPorts<Answer> = {
      ...base,
      signIn: async (orgKey) => {
        asked += 1;
        if (orgKey === undefined) throw new NotStarted();
        return { session: "s", orgKeyKept: false };
      },
    };
    await signInStartingOrganisation(ports);
    expect(asked).toBe(3);
    expect(hq.log.minted).toEqual(["key-1"]);
    expect(hq.log.deleted).toEqual(["key-1"]);
  });

  it("a key HQ rejects is deleted, and the rejection stands", async () => {
    const hq = fakeHq({ rejectKeys: true });
    await expect(signInStartingOrganisation(hq.ports(fakeLocks()))).rejects.toBeInstanceOf(
      KeyRejected,
    );
    expect(hq.log.deleted).toEqual(["key-1"]);
  });

  it("a person who may not start the organisation mints nothing", async () => {
    const hq = fakeHq();
    const ports = { ...hq.ports(fakeLocks()), mayStart: async () => false };
    await expect(signInStartingOrganisation(ports)).rejects.toBeInstanceOf(NotStarted);
    expect(hq.log.minted).toEqual([]);
  });
});
