import { describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import type { PersonOptions } from "../../fakes/zeropsWorld.ts";
import { menuScenario } from "./dsl.ts";

const cases: ReadonlyArray<{
  name: string;
  person: PersonOptions;
  actions: ReadonlyArray<string>;
}> = [
  {
    name: "org OWNER",
    person: { role: "OWNER" },
    actions: ["rename", "face", "assign", "move", "delete"],
  },
  {
    name: "org ADMIN",
    person: { role: "ADMIN" },
    actions: ["rename", "face", "assign", "move", "delete"],
  },
  {
    name: "Developer with their Mate OWNER grant",
    person: { role: "Developer", grants: { Ada: "OWNER" } },
    actions: ["rename", "face", "move", "delete"],
  },
  {
    name: "Developer with a BASIC_USER grant",
    person: { role: "Developer", grants: { Ada: "BASIC_USER" } },
    actions: [],
  },
  ...(["OWNER", "ADMIN"] as const).map((grant) => ({
    name: `NO_ACCESS with a ${grant} grant`,
    person: { role: "NO_ACCESS" as const, grants: { Ada: grant } },
    actions: ["rename", "face", "move", "delete"],
  })),
  {
    name: "NO_ACCESS with a BASIC_USER grant",
    person: { role: "NO_ACCESS", grants: { Ada: "BASIC_USER" } },
    actions: [],
  },
  { name: "org READ_ONLY", person: { role: "READ_ONLY" }, actions: [] },
  {
    name: "NO_ACCESS with a READ_ONLY grant",
    person: { role: "NO_ACCESS", grants: { Ada: "READ_ONLY" } },
    actions: [],
  },
];

describe("B: Mate menu access", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    for (const row of cases) {
      it.effect(`${row.name} sees only their permitted Mate management actions`, () =>
        Effect.gen(function* () {
          const s = yield* menuScenario();
          s.given.person("viewer", row.person);
          yield* s.given.project("Ada", { mate: true, app: "Shop" });
          s.given.asPerson("viewer");
          yield* s.given.signedIn;
          yield* s.menu.grouped("Ada", "Shop");
          yield* s.menu.actions("Ada", row.actions);
          yield* s.then.noExternalNetwork;
        }),
      );
    }
  });
});
