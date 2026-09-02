import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  HostProcessArguments,
  HostProcessExecutablePath,
  HostProcessPlatform,
  HostProcessUserId,
} from "@t3tools/shared/hostProcess";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import * as ProcessRunner from "../processRunner.ts";
import * as BootService from "./bootService.ts";

const linuxPlan = {
  nodePath: "/usr/bin/node",
  entryPath: "/srv/mate/node_modules/zerops-mate/dist/bin.mjs",
  baseDir: "/home/theo/.t3",
  logPath: "/home/theo/.t3/userdata/logs/boot-service.log",
  unitPath: "/home/theo/.config/systemd/user/t3code.service",
};

it("runs the already-installed release entrypoint under systemd", () => {
  const unit = BootService.renderBootServiceUnit(linuxPlan);

  expect(unit).toContain(
    "ExecStart=/usr/bin/node /srv/mate/node_modules/zerops-mate/dist/bin.mjs serve",
  );
  expect(unit).toContain("KillMode=mixed");
  expect(unit).toContain("OOMPolicy=continue");
  expect(unit).not.toContain("npm");
  expect(unit).not.toContain("runtime/versions");
});

const macPlan = {
  ...linuxPlan,
  nodePath: "/opt/homebrew/bin/node",
  entryPath: "/Users/theo/mate/node_modules/zerops-mate/dist/bin.mjs",
  baseDir: "/Users/theo/.t3",
  logPath: "/Users/theo/.t3/userdata/logs/boot-service.log",
  unitPath: "/Users/theo/Library/LaunchAgents/com.t3tools.t3code.service.plist",
};
const macInstallerPath = "/opt/homebrew/bin:/Users/theo/.local/bin:/usr/bin:/bin";

it("runs the already-installed release entrypoint under launchd", () => {
  const plist = BootService.renderBootServicePlist(macPlan, {
    homeDir: "/Users/theo",
    environmentPath: macInstallerPath,
  });

  expect(plist).toContain("<string>/opt/homebrew/bin/node</string>");
  expect(plist).toContain(
    "<string>/Users/theo/mate/node_modules/zerops-mate/dist/bin.mjs</string>",
  );
  expect(plist).toContain("<string>serve</string>");
  expect(plist).toContain(`    <key>PATH</key>\n    <string>${macInstallerPath}</string>`);
  expect(plist).toContain("<key>KeepAlive</key>\n  <true/>");
  expect(plist).not.toContain("runtime/versions");
});

it("escapes service-manager values", () => {
  expect(BootService.quoteSystemdValue("/srv/100% ready/mate")).toBe('"/srv/100%% ready/mate"');
  expect(BootService.escapeXmlText("/Users/T3 & <Co>")).toBe("/Users/T3 &amp; &lt;Co&gt;");
});

const makeHarness = Effect.fn("test.make_boot_service_harness")(function* (
  platform: NodeJS.Platform = "linux",
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* fs.makeTempDirectoryScoped({ prefix: "mate-boot-service-test-" });
  const entryPath = path.join(home, "node_modules", "zerops-mate", "dist", "bin.mjs");
  yield* fs.makeDirectory(path.dirname(entryPath), { recursive: true });
  yield* fs.writeFileString(entryPath, "export {};\n");

  const commands: string[] = [];
  const control = { reportedVersion: "1.2.3" };
  const runner = ProcessRunner.ProcessRunner.of({
    run: (input) =>
      Effect.sync(() => {
        commands.push(`${input.command} ${input.args.join(" ")}`);
        return {
          stdout: input.args[1] === "--version" ? `mate v${control.reportedVersion}\n` : "",
          stderr: "",
          code: ChildProcessSpawner.ExitCode(0),
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
          stdoutInvalidUtf8: false,
          stderrInvalidUtf8: false,
        };
      }),
  });
  const service = yield* BootService.make({
    baseDir: path.join(home, ".t3"),
    logsDir: path.join(home, ".t3", "userdata", "logs"),
    cliVersion: "1.2.3",
    host: { execPath: "/usr/bin/node", entryPath },
  }).pipe(
    Effect.provideService(ProcessRunner.ProcessRunner, runner),
    Effect.provide(
      Layer.mergeAll(
        Layer.succeed(HostProcessPlatform, platform),
        Layer.succeed(HostProcessUserId, 501),
        Layer.succeed(HostProcessExecutablePath, "/usr/bin/node"),
        Layer.succeed(HostProcessArguments, ["/usr/bin/node", entryPath]),
        ConfigProvider.layer(
          ConfigProvider.fromEnv({ env: { HOME: home, PATH: macInstallerPath } }),
        ),
      ),
    ),
  );
  return { service, commands, control, entryPath };
});

it.layer(NodeServices.layer)("boot service lifecycle", (it) => {
  it.effect("installs, reports current state, and uninstalls without a registry command", () =>
    Effect.gen(function* () {
      const { service, commands, entryPath } = yield* makeHarness();

      expect((yield* service.status).installed).toBe(false);
      const plan = yield* service.install;
      expect(plan.entryPath).toBe(entryPath);
      expect(yield* service.status).toMatchObject({ installed: true, current: true });
      expect(commands.some((command) => /\bnpm\b/.test(command))).toBe(false);
      expect(commands).toContain(`/usr/bin/node ${entryPath} --version`);
      expect(yield* service.uninstall).toBe(true);
      expect((yield* service.status).installed).toBe(false);
    }),
  );

  it.effect("rejects an entrypoint that reports a different release", () =>
    Effect.gen(function* () {
      const { service, control } = yield* makeHarness();
      control.reportedVersion = "9.9.9";

      const error = yield* service.install.pipe(Effect.flip);
      expect(error._tag).toBe("BootServiceCommandError");
      expect(error.message).toContain("verifying this mate release");
    }),
  );
});
