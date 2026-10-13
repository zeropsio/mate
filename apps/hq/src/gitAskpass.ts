/** Scoped Git token handoff. Only askpass reads plaintext; Git receives no secret in argv or env. */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";

export interface GitCredentialProcess {
  readonly args: ReadonlyArray<string>;
  readonly env: { readonly GIT_ASKPASS: string; readonly GIT_TERMINAL_PROMPT: string };
}
const ASKPASS = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const prompt = process.argv[2] || '';
if (/^Username for /i.test(prompt)) process.stdout.write('x-access-token\\n');
else if (/^Password for /i.test(prompt)) process.stdout.write(fs.readFileSync(path.join(__dirname, 'credential'), 'utf8') + '\\n');
else process.exitCode = 1;
`;

export const withGitCredential = <A, E, R>(
  token: Redacted.Redacted,
  use: (process: GitCredentialProcess) => Effect.Effect<A, E, R>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "mate-git-" });
      yield* fs.chmod(directory, 0o700);
      const askpass = path.join(directory, "askpass.cjs");
      yield* fs.writeFileString(path.join(directory, "credential"), Redacted.value(token), {
        mode: 0o600,
        flag: "wx",
      });
      yield* fs.writeFileString(askpass, ASKPASS, { mode: 0o700, flag: "wx" });
      return yield* use({
        args: [
          "-c",
          "credential.helper=",
          "-c",
          `core.askPass=${askpass}`,
          "-c",
          "credential.useHttpPath=true",
          "-c",
          "http.followRedirects=false",
        ],
        env: { GIT_ASKPASS: askpass, GIT_TERMINAL_PROMPT: "0" },
      });
    }),
  );
