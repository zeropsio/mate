import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as CrewChecks from "./CrewChecks.ts";
import {
  crewShellLayer,
  makeServiceRepository,
  removeServiceRepository,
  serviceRepository,
  TEST_HOST,
  write,
} from "./testing/crewGitFixture.ts";

const LANE = { host: TEST_HOST, lane: "backend" } as const;

interface Row {
  readonly name: string;
  readonly command: string;
  readonly timeout?: Duration.Input;
  readonly lane?: string;
  readonly expected: CrewChecks.CheckOutcome["_tag"];
  readonly detail?: Partial<Record<"code" | "signal" | "tail", number | string>>;
}

const ROWS: ReadonlyArray<Row> = [
  {
    name: "passes in the lane with the crew port and the crewmate's env",
    command: 'test -f lane.txt && test "$CREW_PORT" = 3001 && test "$DATABASE_NAME" = "lane db"',
    expected: "passed",
  },
  {
    name: "fails with the command's exit code and the tail of its output",
    command: "echo boom; exit 3",
    expected: "failed",
    detail: { code: 3, tail: "boom\n" },
  },
  {
    name: "stops a command that outlives its timeout",
    command: "sleep 5",
    timeout: "1 second",
    expected: "timed-out",
  },
  {
    name: "tells a command killed by a signal from a failed one",
    command: "kill -KILL $$",
    expected: "killed",
    detail: { signal: 9 },
  },
  {
    name: "names a lane whose directory is missing",
    command: "true",
    lane: "frontend",
    expected: "lane-missing",
  },
];

describe("CrewChecks", () => {
  it.effect.each(Array.from(ROWS, (row) => ({ title: row.name, row })))("$title", ({ row }) =>
    Effect.gen(function* () {
      const root = makeServiceRepository();
      write(root, ".crew/backend/lane.txt", "lane\n");
      const outcome = yield* Effect.gen(function* () {
        const checks = yield* CrewChecks.CrewChecks;
        return yield* checks.run({
          ...LANE,
          lane: row.lane ?? LANE.lane,
          kind: "check",
          command: row.command,
          crewPort: 3001,
          env: { DATABASE_NAME: "lane db" },
          ...(row.timeout === undefined ? {} : { timeout: row.timeout }),
        });
      }).pipe(
        Effect.provide(
          CrewChecks.layer.pipe(Layer.provide(crewShellLayer([serviceRepository(root)]))),
        ),
        Effect.ensuring(Effect.sync(() => removeServiceRepository(root))),
      );
      assert.strictEqual(outcome._tag, row.expected);
      for (const [key, value] of Object.entries(row.detail ?? {})) {
        assert.strictEqual((outcome as unknown as Record<string, unknown>)[key], value, key);
      }
    }),
  );
});
