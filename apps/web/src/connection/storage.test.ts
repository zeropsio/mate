import {
  BearerConnectionCredential,
  BearerConnectionProfile,
  ConnectionTransientError,
} from "@t3tools/client-runtime/connection";
import { ConnectionCatalogDocument } from "@t3tools/client-runtime/platform";
import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { afterEach, vi } from "vite-plus/test";

import { accountCloseLogouts, makeCatalogBackend, makeCatalogStore } from "./storage";

const emptyCatalog = {
  schemaVersion: 1,
  targets: [],
  profiles: [],
  credentials: [],
  remoteDpopTokens: [],
} as const;
const decodeCatalog = Schema.decodeUnknownSync(Schema.fromJsonString(ConnectionCatalogDocument));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("makeCatalogStore", () => {
  it.effect("quarantines malformed catalogs and starts from an empty document", () =>
    Effect.gen(function* () {
      const writes: string[] = [];
      const quarantined: string[] = [];
      const store = yield* makeCatalogStore({
        read: Effect.succeed("{not-json"),
        write: (raw) => Effect.sync(() => writes.push(raw)),
        quarantine: (raw) => Effect.sync(() => quarantined.push(raw)),
      });

      expect(yield* store.read).toEqual(emptyCatalog);
      expect(quarantined).toEqual(["{not-json"]);
      expect(writes).toHaveLength(1);
      expect(decodeCatalog(writes[0]!)).toEqual(emptyCatalog);
    }),
  );

  it.effect("does not hide catalog read failures", () =>
    Effect.gen(function* () {
      const failure = new ConnectionTransientError({
        reason: "remote-unavailable",
        detail: "permission denied",
      });
      const store = yield* makeCatalogStore({
        read: Effect.fail(failure),
        write: () => Effect.void,
      });

      expect(yield* Effect.flip(store.read)).toBe(failure);
    }),
  );
});

describe("makeCatalogBackend", () => {
  it.effect("AL-01 never reads the historical desktop catalog and isolates each login", () =>
    Effect.gen(function* () {
      const getConnectionCatalog = vi.fn();
      vi.stubGlobal("window", { desktopBridge: { getConnectionCatalog } });
      const first = makeCatalogBackend();
      yield* first.write("private-session");
      const next = makeCatalogBackend();
      expect(yield* next.read).toBeNull();
      expect(yield* first.read).toBe("private-session");
      expect(getConnectionCatalog).not.toHaveBeenCalled();
    }),
  );
});

describe("accountCloseLogouts", () => {
  const NOW = 1_000_000_000;
  const DAY_MS = 86_400_000;
  const mate = (name: string) =>
    new BearerConnectionProfile({
      connectionId: `bearer:${name}`,
      environmentId: EnvironmentId.make(name),
      label: name,
      httpBaseUrl: `https://${name}.example.test/mate/`,
      wsBaseUrl: `wss://${name}.example.test/mate/`,
    });
  const stored = (
    name: string,
    lifetime: { issuedAtEpochMs?: number; expiresAtEpochMs?: number },
  ) => ({
    connectionId: `bearer:${name}`,
    credential: new BearerConnectionCredential({ token: `token-of-${name}`, ...lifetime }),
  });

  // Signing out ends every session this tab still holds; one already past its day has ended on
  // its Mate, and sending it would only earn a refusal in that Mate's log.
  it("logs out every live session and never presents one past its deadline", () => {
    const document = {
      ...emptyCatalog,
      profiles: [mate("live"), mate("ended"), mate("undated"), mate("uncredentialed")],
      credentials: [
        stored("live", { issuedAtEpochMs: NOW - 60_000, expiresAtEpochMs: NOW + DAY_MS }),
        stored("ended", { issuedAtEpochMs: NOW - 2 * DAY_MS, expiresAtEpochMs: NOW - DAY_MS }),
        stored("undated", {}),
      ],
    };

    expect(accountCloseLogouts(document, NOW)).toEqual([
      { url: "https://live.example.test/mate/api/auth/logout", token: "token-of-live" },
      { url: "https://undated.example.test/mate/api/auth/logout", token: "token-of-undated" },
    ]);
  });
});
