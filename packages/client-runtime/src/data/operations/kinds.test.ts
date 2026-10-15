import { describe, expect, expectTypeOf, it } from "vite-plus/test";

import type { OperationIntents } from "../model.ts";
import { OPERATION_KINDS } from "./kinds.ts";

/** The kinds the account's registry names. */
type Registered = (typeof OPERATION_KINDS)[number]["kind"];
type Unregistered = Exclude<keyof OperationIntents & string, Registered>;

describe("the account's operation kinds", () => {
  // A screen sends any declared intent; the coordinator throws for one the registry lacks. The
  // typecheck names a missing kind: `true` is not assignable to it.
  it("Every operation a screen can send has a registered kind", () => {
    expectTypeOf<string extends Registered ? "names lost" : "named">().toEqualTypeOf<"named">();
    const everyKindRegistered: [Unregistered] extends [never] ? true : Unregistered = true;
    expect(everyKindRegistered).toBe(true);
  });
});
