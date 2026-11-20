import { expect, it } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ConfigProvider from "effect/ConfigProvider";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { ChildProcessSpawner } from "effect/process";

import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import type * as VcsDriver from "../vcs/VcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as AzureDevOpsCli from "./AzureDevOpsCli.ts";
import * as BitbucketApi from "./BitbucketApi.ts";
import * as ForgejoCli from "./ForgejoCli.ts";
import * as GitHubCli from "./GitHubCli.ts";
import * as GitLabCli from "./GitLabCli.ts";
import { detectPrTemplate } from "./PrTemplateDetection.ts";
import type * as SourceControlProvider from "./SourceControlProvider.ts";
import { transportSafeSourceControlErrorValue } from "./SourceControlProvider.ts";
import * as SourceControlProviderRegistry from "./SourceControlProviderRegistry.ts";
import * as SourceControlRepositoryService from "./SourceControlRepositoryService.ts";

const TEST_EPOCH = DateTime.makeUnsafe("1970-01-01T00:00:00.000Z");

const processOutput = (stdout: string): VcsProcess.VcsProcessOutput => ({
  exitCode: ChildProcessSpawner.ExitCode(0),
  stdout,
  stderr: "",
  stdoutTruncated: false,
  stderrTruncated: false,
});

const gitRepository = (driver: Partial<VcsDriver.VcsDriver["Service"]>) => ({
  kind: "git" as const,
  repository: {
    kind: "git" as const,
    rootPath: "/repo",
    metadataPath: null,
    freshness: {
      source: "live-local" as const,
      observedAt: TEST_EPOCH,
      expiresAt: Option.none(),
    },
  },
  driver: driver as unknown as VcsDriver.VcsDriver["Service"],
});

// witness: apps/server/src/sourceControl/BitbucketApi.ts | return origin !== null && origin === apiOrigin ? value : null; → return origin !== null ? value : null;
it.effect(
  "SC1: A Bitbucket request answered with a redirect to another host fails as untrusted and is not followed, so the account's token never reaches that host",
  () => {
    const requests: Array<HttpClientRequest.HttpClientRequest> = [];
    return Effect.gen(function* () {
      const bitbucket = yield* BitbucketApi.BitbucketApi;

      const error = yield* Effect.flip(
        bitbucket.request({ method: "GET", url: "/repositories/acme/web/pullrequests/1/diff" }),
      );

      expect(error._tag).toBe("BitbucketUntrustedUrlError");
      expect(requests).toHaveLength(1);
    }).pipe(
      Effect.provide(
        BitbucketApi.layer.pipe(
          Layer.provide(
            Layer.succeed(
              HttpClient.HttpClient,
              HttpClient.make((request) =>
                Effect.sync(() => {
                  requests.push(request);
                  return HttpClientResponse.fromWeb(
                    request,
                    new Response(null, {
                      status: 302,
                      headers: { location: "https://attacker.example/stolen" },
                    }),
                  );
                }),
              ),
            ),
          ),
          Layer.provide(
            Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
              resolve: () => Effect.succeed(gitRepository({})),
            }),
          ),
          Layer.provide(Layer.mock(GitVcsDriver.GitVcsDriver)({})),
          Layer.provide(
            ConfigProvider.layer(
              ConfigProvider.fromEnv({
                env: {
                  T3CODE_BITBUCKET_API_BASE_URL: "https://api.test.local/2.0",
                  T3CODE_BITBUCKET_EMAIL: "user@example.com",
                  T3CODE_BITBUCKET_API_TOKEN: "token",
                },
              }),
            ),
          ),
          Layer.provide(NodeServices.layer),
        ),
      ),
    );
  },
);

// witness: apps/server/src/sourceControl/GitLabCli.ts | `description=@${input.bodyFile}`, → `description=${input.bodyFile}`,
it.effect(
  "SC2: A GitLab merge request is created through `glab api` with its description read from the body file, so the body never stands in the process arguments",
  () => {
    const runs: Array<VcsProcess.VcsProcessInput> = [];
    return Effect.gen(function* () {
      const glab = yield* GitLabCli.GitLabCli;
      yield* glab.createMergeRequest({
        cwd: "/repo",
        baseBranch: "main",
        headSelector: "owner:feature/provider",
        title: "Provider MR",
        bodyFile: "/tmp/t3-mr-body.md",
      });

      expect(runs.map(({ command, cwd, args }) => ({ command, cwd, args }))).toEqual([
        {
          command: "glab",
          cwd: "/repo",
          args: [
            "api",
            "--method",
            "POST",
            "projects/:fullpath/merge_requests",
            "--raw-field",
            "source_branch=feature/provider",
            "--raw-field",
            "target_branch=main",
            "--raw-field",
            "title=Provider MR",
            "--field",
            "description=@/tmp/t3-mr-body.md",
          ],
        },
      ]);
    }).pipe(
      Effect.provide(
        GitLabCli.layer.pipe(
          Layer.provide(
            Layer.mock(VcsProcess.VcsProcess)({
              run: (input) =>
                Effect.sync(() => {
                  runs.push(input);
                  return processOutput("{}");
                }),
            }),
          ),
        ),
      ),
    );
  },
);

const SYMLINK_BLOB = "3b18e512dba79e4c8300dd08aeb37f8e728b8dad";
const REGULAR_BLOB = "8c7dd922ad47494fc02c388e12c00eac278d5f1c";

// witness: apps/server/src/sourceControl/PrTemplateDetection.ts | (mode !== "100644" && mode !== "100755") || → (mode !== "100644" && mode !== "100755" && mode !== "120000") ||
it.effect(
  "SC3: A pull-request template committed as a symlink is never read; the committed regular template is used instead",
  () =>
    Effect.gen(function* () {
      const blobs: Record<string, string> = {
        [SYMLINK_BLOB]: "LOCAL_SECRET_SENTINEL",
        [REGULAR_BLOB]: "safe template",
      };
      const template = yield* detectPrTemplate("/repo", "HEAD", (input) =>
        Effect.succeed(
          processOutput(
            input.args[0] === "ls-tree"
              ? [
                  `120000 blob ${SYMLINK_BLOB}\t.github/pull_request_template.md`,
                  `100644 blob ${REGULAR_BLOB}\tpull_request_template.md`,
                  "",
                ].join("\0")
              : input.args[0] === "cat-file" && input.args[1] === "blob"
                ? (blobs[input.args[2] ?? ""] ?? "")
                : "",
          ),
        ),
      );

      expect(template).toEqual(Option.some("safe template"));
    }),
);

// witness: apps/server/src/sourceControl/ForgejoCli.ts | new Set(matches.map((login) => login.url)).size === 1 → new Set(matches.map((login) => login.ssh_host)).size === 1
it("SC4: Two Forgejo logins on one SSH host with different server ports give a remote no default login unless the requested host names the port", () => {
  const logins = ForgejoCli.parseForgejoLogins(
    JSON.stringify([
      {
        name: "one",
        url: "http://forgejo.local:3000",
        ssh_host: "forgejo.local",
        user: "maria",
        default: "true",
      },
      {
        name: "two",
        url: "http://forgejo.local:4000",
        ssh_host: "forgejo.local",
        user: "maria",
        default: "false",
      },
    ]),
  );
  const remote = ForgejoCli.parseForgejoRemote("git@forgejo.local:maria/project.git");
  expect(remote).not.toBeNull();

  expect(ForgejoCli.matchForgejoLogin(logins, remote!)).toBeUndefined();
  expect(ForgejoCli.matchForgejoLogin(logins, remote!, "forgejo.local:4000")?.name).toBe("two");
});

// witness: apps/server/src/sourceControl/SourceControlProvider.ts | url.password = ""; → url.password = url.password;
it("SC5: A value carried in a source-control error loses a URL's credentials, query and fragment", () => {
  expect(
    transportSafeSourceControlErrorValue(
      "https://user:secret@example.test/org/repo/pull/42?token=secret#discussion",
    ),
  ).toBe("https://example.test/org/repo/pull/42");
});

// witness: apps/server/src/sourceControl/SourceControlProviderRegistry.ts | (input.context === undefined → (input.context !== undefined
it.effect(
  "SC6: A provider resolved for a remote the caller selected keeps that remote and only refines its provider kind, never switching to another configured remote",
  () =>
    Effect.gen(function* () {
      const driver = {
        listRemotes: () =>
          Effect.succeed({
            remotes: [
              {
                name: "origin",
                url: "git@github.com:fork/project.git",
                pushUrl: Option.none(),
                isPrimary: true,
              },
            ],
            freshness: {
              source: "live-local" as const,
              observedAt: TEST_EPOCH,
              expiresAt: Option.none(),
            },
          }),
      } satisfies Partial<VcsDriver.VcsDriver["Service"]>;
      const registry = yield* SourceControlProviderRegistry.make.pipe(
        Effect.provide(
          Layer.mergeAll(
            NodeServices.layer,
            Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
              get: () => Effect.succeed(driver as unknown as VcsDriver.VcsDriver["Service"]),
              resolve: () => Effect.succeed(gitRepository(driver)),
            }),
            Layer.mock(VcsProcess.VcsProcess)({
              run: () =>
                Effect.succeed(
                  processOutput(`self-hosted.example.test
  ✓ Logged in to self-hosted.example.test as gitlab-user
`),
                ),
            }),
            Layer.mock(AzureDevOpsCli.AzureDevOpsCli)({}),
            Layer.mock(BitbucketApi.BitbucketApi)({}),
            Layer.mock(GitHubCli.GitHubCli)({}),
            Layer.mock(GitLabCli.GitLabCli)({}),
            Layer.mock(ForgejoCli.ForgejoCli)({ listLogins: () => Effect.succeed([]) }),
            ServerConfig.layerTest(process.cwd(), {
              prefix: "t3-source-control-registry-test-",
            }).pipe(Layer.provide(NodeServices.layer)),
          ),
        ),
      );

      const handle = yield* registry.resolveHandle({
        cwd: "/repo",
        context: {
          provider: {
            kind: "unknown",
            name: "self-hosted.example.test",
            baseUrl: "https://self-hosted.example.test",
          },
          remoteName: "upstream",
          remoteUrl: "https://self-hosted.example.test/group/project.git",
        },
      });

      expect(handle.context?.provider.kind).toBe("gitlab");
      expect(handle.context?.remoteName).toBe("upstream");
    }),
);

const CLONE_URLS = {
  nameWithOwner: "octocat/t3code",
  url: "https://github.com/octocat/t3code",
  sshUrl: "git@github.com:octocat/t3code.git",
};

// witness: apps/server/src/sourceControl/SourceControlRepositoryService.ts | remoteUrl: redactRemoteUrl(remoteUrl), → remoteUrl,
it.effect(
  "SC7: The remote URL a prepared clone reports carries no embedded credentials, while Git still receives the URL that has them",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const parent = yield* fs.makeTempDirectoryScoped({ prefix: "t3-source-control-redact-" });
      const unsupported = () => Effect.die("unexpected provider operation");
      const provider: SourceControlProvider.SourceControlProvider["Service"] = {
        kind: "github",
        listChangeRequests: unsupported,
        getChangeRequest: unsupported,
        createChangeRequest: unsupported,
        getRepositoryCloneUrls: () => Effect.succeed(CLONE_URLS),
        getDefaultBranch: () => Effect.succeed(null),
        checkoutChangeRequest: unsupported,
      };

      const result = yield* Effect.gen(function* () {
        const service = yield* SourceControlRepositoryService.SourceControlRepositoryService;
        return yield* service.prepareClone({
          remoteUrl: "https://user:s3cret@github.com/octocat/t3code.git",
          destinationPath: path.join(parent, "t3code"),
        });
      }).pipe(
        Effect.provide(
          SourceControlRepositoryService.layer.pipe(
            Layer.provide(
              Layer.mock(SourceControlProviderRegistry.SourceControlProviderRegistry)({
                resolveLink: () => undefined,
                get: () => Effect.succeed(provider),
              }),
            ),
            Layer.provide(
              Layer.mock(GitVcsDriver.GitVcsDriver)({
                execute: () => Effect.succeed(processOutput("")),
                ensureRemote: () => Effect.succeed("origin"),
              }),
            ),
            Layer.provide(
              ServerConfig.layerTest(process.cwd(), { prefix: "t3-source-control-repos-" }),
            ),
            Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
          ),
        ),
      );

      expect(result.remoteUrl).toBe("https://github.com/octocat/t3code.git");
      expect(result.cloneUrl).toBe("https://user:s3cret@github.com/octocat/t3code.git");
    }).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
);
