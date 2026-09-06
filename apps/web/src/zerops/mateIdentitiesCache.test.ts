import { EnvironmentId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { removeLocalStorageItem, setLocalStorageItem } from "../hooks/useLocalStorage";
import {
  readCachedZeropsMates,
  writeCachedZeropsMates,
  ZEROPS_MATES_STORAGE_KEY,
} from "./mateIdentitiesCache";

const FEN = EnvironmentId.make("env-fen");
const NOVA = EnvironmentId.make("env-nova");

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
        [FEN, { name: "Fen", tint: "coral", project: "Acme Docs" }],
        [NOVA, { name: "Nova", tint: "rose", project: undefined }],
      ]),
    );
    const mates = readCachedZeropsMates();
    expect(mates?.get(FEN)).toEqual({ name: "Fen", tint: "coral", project: "Acme Docs" });
    expect(mates?.get(NOVA)).toEqual({ name: "Nova", tint: "rose", project: undefined });
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
    writeCachedZeropsMates(new Map([[FEN, { name: "Fen", tint: "coral", project: undefined }]]));
    writeCachedZeropsMates(new Map([[NOVA, { name: "Nova", tint: "rose", project: undefined }]]));
    expect(readCachedZeropsMates()?.has(FEN)).toBe(false);
  });
});
