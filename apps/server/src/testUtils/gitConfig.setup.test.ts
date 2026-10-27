import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { ServerConfig } from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";

const TestLayer = GitVcsDriver.layer.pipe(
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-git-config-test-" })),
  Layer.provideMerge(NodeServices.layer),
);

const decodeTrace = Schema.decodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      event: Schema.String,
      argv: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
);

it.effect("suite Git commits cannot leave maintenance writers racing scoped cleanup", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const git = yield* GitVcsDriver.GitVcsDriver;
      const trace = yield* fs.makeTempFileScoped({ prefix: "t3-git-maintenance-trace-" });
      const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-git-maintenance-" });
      const run = (args: ReadonlyArray<string>, env?: NodeJS.ProcessEnv) =>
        git.execute({
          operation: "test.fixtureMaintenance",
          cwd,
          args,
          ...(env === undefined ? {} : { env }),
        });

      yield* run(["init", "--initial-branch=main", "--object-format=sha1"]);
      yield* run(["config", "user.email", "test@example.com"]);
      yield* run(["config", "user.name", "Test User"]);
      yield* fs.makeDirectory(path.join(cwd, "docs"));
      yield* fs.writeFileString(
        path.join(cwd, "docs", "PULL_REQUEST_TEMPLATE.md"),
        "template from docs/PULL_REQUEST_TEMPLATE.md",
      );
      yield* run(["add", "-A"]);
      yield* run(["commit", "-m", "Add pull request templates"], {
        // This fixture's tree and commit both land in Git's sampled 17 object shard.
        // Git 2.54+ estimates 512 loose objects, exceeding its default repack threshold.
        GIT_AUTHOR_DATE: "1700000158 +0000",
        GIT_COMMITTER_DATE: "1700000158 +0000",
        GIT_TRACE2_EVENT: trace,
      });
      assert.strictEqual(
        (yield* run(["rev-parse", "HEAD"])).stdout.trim(),
        "174145852ef6e7f58a0c54976599a02dc4a59eed",
      );
      const maintenance = (yield* fs.readFileString(trace))
        .trim()
        .split("\n")
        .map((line) => decodeTrace(line))
        .filter((event) => event.event === "child_start" && event.argv?.[1] === "maintenance")
        .map((event) => event.argv);
      assert.deepStrictEqual(
        maintenance,
        [],
        "fixture commits must not launch automatic maintenance",
      );
    }),
  ).pipe(Effect.provide(TestLayer)),
);
