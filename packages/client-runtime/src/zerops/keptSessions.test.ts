import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  BearerConnectionCredential,
  BearerConnectionProfile,
  BearerConnectionRegistration,
} from "../connection/catalog.ts";
import { BearerConnectionTarget } from "../connection/model.ts";
import {
  KEPT_SESSION_LEAD_MS,
  KEPT_SESSIONS_KEY,
  makeKeptSessions,
  type KeptSessionStorage,
} from "./keptSessions.ts";

const NOW = 1_800_000_000_000;
const DAY_MS = 86_400_000;

/** A Mate's session as the door's token exchange answers it, for the Mate `name`. */
function session(
  name: string,
  lifetime: { readonly expiresAtEpochMs?: number } = { expiresAtEpochMs: NOW + DAY_MS },
): BearerConnectionRegistration {
  const environmentId = EnvironmentId.make(`env-${name}`);
  const connectionId = `bearer:env-${name}`;
  return new BearerConnectionRegistration({
    target: new BearerConnectionTarget({ environmentId, label: name, connectionId }),
    profile: new BearerConnectionProfile({
      connectionId,
      environmentId,
      label: name,
      httpBaseUrl: `https://${name}.example.test/mate`,
      wsBaseUrl: `wss://${name}.example.test/mate`,
    }),
    credential: new BearerConnectionCredential({
      token: ["session", name].join("-"),
      issuedAtEpochMs: NOW - 60_000,
      ...lifetime,
      origin: "zerops-identity",
    }),
  });
}

function memoryStorage(): KeptSessionStorage & { readonly items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
    removeItem: (key) => {
      items.delete(key);
    },
  };
}

const kept = (storage: KeptSessionStorage = memoryStorage()) =>
  makeKeptSessions(storage, () => NOW);

describe("kept sessions", () => {
  it("answers a session for the target it was kept for, and for no other", () => {
    const sessions = kept();
    sessions.keep("p1:zcp", session("shop"));

    expect(sessions.read("p1:zcp")).toEqual(session("shop"));
    expect(sessions.read("p2:zcp")).toBeNull();
  });

  it("survives the load that kept it: another load over the same storage reads it", () => {
    const storage = memoryStorage();
    kept(storage).keep("p1:zcp", session("shop"));

    expect(kept(storage).read("p1:zcp")).toEqual(session("shop"));
  });

  describe("a session that would end within the load is not presented again", () => {
    const rows = [
      { name: "past its deadline", expiresAtEpochMs: NOW - 1, presented: false },
      {
        name: "within the lead of its deadline",
        expiresAtEpochMs: NOW + KEPT_SESSION_LEAD_MS - 1,
        presented: false,
      },
      { name: "past the lead", expiresAtEpochMs: NOW + KEPT_SESSION_LEAD_MS + 1, presented: true },
      // A session with no deadline has only its Mate to judge it.
      { name: "undated", expiresAtEpochMs: undefined, presented: true },
    ] as const;
    it.each(rows.map((row) => [row.name, row] as const))("%s", (_name, row) => {
      const sessions = kept();
      sessions.keep(
        "p1:zcp",
        session(
          "shop",
          row.expiresAtEpochMs === undefined ? {} : { expiresAtEpochMs: row.expiresAtEpochMs },
        ),
      );

      expect(sessions.read("p1:zcp") !== null).toBe(row.presented);
    });
  });

  it("forgets a session only while it is still the one refused", () => {
    const sessions = kept();
    sessions.keep("p1:zcp", session("shop"));

    // Another tab kept a newer session for the same Mate: this tab's refusal is not about it.
    sessions.forget("p1:zcp", "an-older-session");
    expect(sessions.read("p1:zcp")).toEqual(session("shop"));

    sessions.forget("p1:zcp", session("shop").credential.token);
    expect(sessions.read("p1:zcp")).toBeNull();
  });

  it("drains every session still live, for the account's close to end, and keeps none", () => {
    const storage = memoryStorage();
    const sessions = kept(storage);
    sessions.keep("p1:zcp", session("shop"));
    sessions.keep("p2:zcp", session("ended", { expiresAtEpochMs: NOW - DAY_MS }));
    sessions.keep("p3:zcp", session("blog"));

    expect(sessions.drain()).toEqual([session("shop"), session("blog")]);
    expect(storage.items.has(KEPT_SESSIONS_KEY)).toBe(false);
    expect(sessions.read("p1:zcp")).toBeNull();
    expect(sessions.drain()).toEqual([]);
  });

  it("drops a session past its deadline the next time it writes", () => {
    const storage = memoryStorage();
    const sessions = kept(storage);
    sessions.keep("p2:zcp", session("ended", { expiresAtEpochMs: NOW - DAY_MS }));
    sessions.keep("p1:zcp", session("shop"));

    expect(Object.keys(JSON.parse(storage.items.get(KEPT_SESSIONS_KEY)!))).toEqual(["p1:zcp"]);
  });

  it("reads past what it cannot decode, and writes over it", () => {
    const storage = memoryStorage();
    storage.setItem(KEPT_SESSIONS_KEY, "{not-json");
    expect(kept(storage).read("p1:zcp")).toBeNull();

    storage.setItem(KEPT_SESSIONS_KEY, JSON.stringify({ "p9:zcp": { token: "no-shape" } }));
    const sessions = kept(storage);
    expect(sessions.read("p9:zcp")).toBeNull();
    sessions.keep("p1:zcp", session("shop"));
    expect(sessions.read("p1:zcp")).toEqual(session("shop"));
  });

  it("keeps nothing and throws nothing when the storage refuses", () => {
    const refusing: KeptSessionStorage = {
      getItem: () => {
        throw new Error("storage blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("storage blocked");
      },
    };
    const sessions = kept(refusing);

    expect(() => sessions.keep("p1:zcp", session("shop"))).not.toThrow();
    expect(sessions.read("p1:zcp")).toBeNull();
    expect(() => sessions.forget("p1:zcp", "x")).not.toThrow();
    expect(sessions.drain()).toEqual([]);
  });
});
