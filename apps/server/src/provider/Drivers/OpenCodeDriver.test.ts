import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { OpenCodeSettings } from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { checkOpenCodeProviderStatus } from "../Layers/OpenCodeProvider.ts";
import { OpenCodeRuntimeError, OpenCodeRuntimeLive } from "../opencodeRuntime.ts";
import * as OpenCodeServerOwner from "../OpenCodeServerOwner.ts";
import { withOpenCodeInstallerPath } from "./OpenCodeDriver.ts";

const testLayer = OpenCodeRuntimeLive.pipe(Layer.provideMerge(NodeServices.layer));

// The probe reads the version; the inventory needs a running server, which a
// stub binary does not give, so the owner refuses at once.
const noServer = OpenCodeServerOwner.OpenCodeServerOwner.of({
  withServer: () =>
    Effect.fail(
      new OpenCodeRuntimeError({ operation: "startOpenCodeServerProcess", detail: "no server" }),
    ),
});

// The `#!/bin/sh` stubs below cannot be resolved as executables on Windows.
const windowsHost = HostProcessPlatform.defaultValue() === "win32";

const writeOpenCode = Effect.fn("writeOpenCode")(function* (file: string, version: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(path.dirname(file), { recursive: true });
  yield* fs.writeFileString(file, `#!/bin/sh\necho ${version}\n`);
  yield* fs.chmod(file, 0o755);
});

const enabledOpenCode = Schema.decodeSync(OpenCodeSettings)({ enabled: true });

const statusWith = (environment: NodeJS.ProcessEnv) =>
  checkOpenCodeProviderStatus(enabledOpenCode, process.cwd(), environment).pipe(
    Effect.provideService(OpenCodeServerOwner.OpenCodeServerOwner, noServer),
  );

it.layer(testLayer)("OpenCodeDriver", (it) => {
  it.effect.skipIf(windowsHost)(
    "OpenCode installed at the official installer's home location reads as installed with its version when it is not on PATH",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const home = yield* fs.makeTempDirectoryScoped({ prefix: "t3-opencode-home-" });
        const emptyPath = yield* fs.makeTempDirectoryScoped({ prefix: "t3-opencode-path-" });
        // A Mate container's OpenCode: the official installer's location, which
        // only a login shell's rc adds to PATH.
        yield* writeOpenCode(path.join(home, ".opencode", "bin", "opencode"), "1.18.34");

        const before = yield* statusWith({ PATH: emptyPath });
        expect(before.installed).toBe(false);

        const after = yield* statusWith(
          withOpenCodeInstallerPath({ PATH: emptyPath }, home, "linux", path),
        );
        expect(after.installed).toBe(true);
        expect(after.version).toBe("1.18.34");
      }).pipe(Effect.scoped),
  );

  it.effect.skipIf(windowsHost)("an OpenCode on PATH wins over the installer's location", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "t3-opencode-home-" });
      const onPath = yield* fs.makeTempDirectoryScoped({ prefix: "t3-opencode-path-" });
      yield* writeOpenCode(path.join(home, ".opencode", "bin", "opencode"), "1.18.34");
      yield* writeOpenCode(path.join(onPath, "opencode"), "1.19.3");

      const status = yield* statusWith(
        withOpenCodeInstallerPath({ PATH: onPath }, home, "linux", path),
      );
      expect(status.version).toBe("1.19.3");
    }).pipe(Effect.scoped),
  );
});
