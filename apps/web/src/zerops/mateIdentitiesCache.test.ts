import { EnvironmentId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { removeLocalStorageItem, setLocalStorageItem } from "../hooks/useLocalStorage";
import type { ZeropsMateIdentity } from "./mateIdentities";
import {
  readCachedZeropsMates,
  writeCachedZeropsMates,
  ZEROPS_MATES_STORAGE_KEY,
} from "./mateIdentitiesCache";

const FEN = EnvironmentId.make("env-fen");
const NOVA = EnvironmentId.make("env-nova");

/** A live identity, as `zeropsMateIdentities` builds it, for the writer to keep. */
function mate(identity: Omit<ZeropsMateIdentity, "projectUrl" | "connected">): ZeropsMateIdentity {
  return {
    ...identity,
    projectUrl: "https://app.zerops.io/project/acme-docs-dev",
    connected: true,
  };
}

describe("mateIdentitiesCache", () => {
  beforeEach(() => {
    removeLocalStorageItem(ZEROPS_MATES_STORAGE_KEY);
  });

  it("has nothing before the list has ever been read", () => {
    expect(readCachedZeropsMates()).toBeNull();
  });

  it("gives a reload back who lived where, project or none", () => {
    writeCachedZeropsMates(
      new Map([
        [FEN, mate({ name: "Fen", tint: "coral", project: "Acme Docs" })],
        [NOVA, mate({ name: "Nova", tint: "rose", project: undefined })],
      ]),
    );
    const mates = readCachedZeropsMates();
    // Remembered from another session: the name, the colour, the project and
    // the way into Zerops come back — connected does not, so a face drawn
    // from the cache sleeps until this session's socket registers.
    expect(mates?.get(FEN)).toEqual({
      name: "Fen",
      tint: "coral",
      project: "Acme Docs",
      projectUrl: "https://app.zerops.io/project/acme-docs-dev",
      connected: false,
    });
    expect(mates?.get(NOVA)).toEqual({
      name: "Nova",
      tint: "rose",
      project: undefined,
      projectUrl: "https://app.zerops.io/project/acme-docs-dev",
      connected: false,
    });
  });

  it("forgets a cache it cannot read rather than trusting it", () => {
    setLocalStorageItem(
      ZEROPS_MATES_STORAGE_KEY,
      { env: { name: "X", tint: "chartreuse" } },
      Schema.Unknown,
    );
    expect(readCachedZeropsMates()).toBeNull();
  });

  it("is overwritten whole by the next read, so a Mate that left is gone", () => {
    writeCachedZeropsMates(
      new Map([[FEN, mate({ name: "Fen", tint: "coral", project: undefined })]]),
    );
    writeCachedZeropsMates(
      new Map([[NOVA, mate({ name: "Nova", tint: "rose", project: undefined })]]),
    );
    expect(readCachedZeropsMates()?.has(FEN)).toBe(false);
  });
});
