import { OpenCodeSettings, ProviderInstanceId, TextGenerationError } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import * as NetService from "@t3tools/shared/Net";
import { beforeEach, expect } from "vite-plus/test";

import * as ServerConfig from "../config.ts";
import {
  OpenCodeRuntimeCapabilityTest,
  OpenCodeRuntimeError,
  OpenCodeServerOwnerCapabilityTest,
  type OpenCodeRuntimeCapability,
  type OpenCodeServerOwnerCapability,
} from "../spi/openCodeRuntime.ts";
import * as OpenCodeTextGeneration from "./OpenCodeTextGeneration.ts";
import * as TextGeneration from "./TextGeneration.ts";

const LOCAL_SERVER_URL = "http://127.0.0.1:4301";

const runtimeMock = {
  state: {
    promptUrls: [] as string[],
    promptParts: [] as ReadonlyArray<unknown>[],
    authHeaders: [] as Array<string | null>,
    sessionCreateCalls: 0,
    connectionError: undefined as Error | undefined,
    sessionCreateError: undefined as unknown,
    sessionResult: undefined as { data?: { id: string } } | undefined,
    promptRequestError: undefined as unknown,
    promptResult: undefined as
      | { data?: { info?: { error?: unknown }; parts?: Array<unknown> } }
      | undefined,
  },
  reset() {
    this.state.promptUrls.length = 0;
    this.state.promptParts.length = 0;
    this.state.authHeaders.length = 0;
    this.state.sessionCreateCalls = 0;
    this.state.connectionError = undefined;
    this.state.sessionCreateError = undefined;
    this.state.sessionResult = undefined;
    this.state.promptRequestError = undefined;
    this.state.promptResult = undefined;
  },
};

// Local-server reuse/idle-close is `OpenCodeServerOwner`'s own contract
// (OpenCodeServerOwner.test.ts) — this double just hands back one fixed
// connection so `OpenCodeTextGeneration.ts`'s own delegation to
// `serverOwner.withServer` can be exercised without re-testing ownership.
const OpenCodeServerOwnerTestDouble: OpenCodeServerOwnerCapability = {
  withServer: (use) => use({ url: LOCAL_SERVER_URL, version: "1.14.19" }),
};

const OpenCodeRuntimeTestDouble: OpenCodeRuntimeCapability = {
  connectToOpenCodeServer: ({ serverUrl, serverPassword }) =>
    runtimeMock.state.connectionError
      ? Effect.fail(
          new OpenCodeRuntimeError({
            operation: "global.health",
            detail: runtimeMock.state.connectionError.message,
            cause: runtimeMock.state.connectionError,
          }),
        )
      : Effect.succeed({
          url: serverUrl ?? LOCAL_SERVER_URL,
          ...(serverPassword ? { serverPassword } : {}),
          version: "1.14.19",
        }),
  createOpenCodeSdkClient: ({ baseUrl, serverPassword }) =>
    ({
      session: {
        create: async () => {
          runtimeMock.state.sessionCreateCalls += 1;
          if (runtimeMock.state.sessionCreateError !== undefined) {
            throw runtimeMock.state.sessionCreateError;
          }
          return runtimeMock.state.sessionResult ?? { data: { id: `${baseUrl}/session` } };
        },
        prompt: async (input: { readonly parts: ReadonlyArray<unknown> }) => {
          runtimeMock.state.promptUrls.push(baseUrl);
          runtimeMock.state.promptParts.push(input.parts);
          runtimeMock.state.authHeaders.push(
            serverPassword ? `Basic ${btoa(`opencode:${serverPassword}`)}` : null,
          );
          if (runtimeMock.state.promptRequestError !== undefined) {
            throw runtimeMock.state.promptRequestError;
          }
          return (
            runtimeMock.state.promptResult ?? {
              data: {
                parts: [
                  {
                    type: "text",
                    text: JSON.stringify({
                      subject: "Improve OpenCode reuse",
                      body: "Reuse one server for the full action.",
                    }),
                  },
                ],
              },
            }
          );
        },
      },
    }) as unknown as ReturnType<OpenCodeRuntimeCapability["createOpenCodeSdkClient"]>,
};

const DEFAULT_TEST_MODEL_SELECTION = {
  instanceId: ProviderInstanceId.make("opencode"),
  model: "openai/gpt-5",
};
const DEFAULT_COMMIT_MESSAGE_INPUT = {
  cwd: process.cwd(),
  branch: "feature/opencode-reuse",
  stagedSummary: "M README.md",
  stagedPatch: "diff --git a/README.md b/README.md",
  modelSelection: DEFAULT_TEST_MODEL_SELECTION,
};

const OpenCodeTextGenerationTestLayer = Layer.merge(
  OpenCodeRuntimeCapabilityTest.make(OpenCodeRuntimeTestDouble),
  OpenCodeServerOwnerCapabilityTest.make(OpenCodeServerOwnerTestDouble),
).pipe(
  Layer.provideMerge(
    ServerConfig.ServerConfig.layerTest(process.cwd(), {
      prefix: "t3code-opencode-text-generation-test-",
    }),
  ),
  Layer.provideMerge(NetService.layer),
  Layer.provideMerge(NodeServices.layer),
);

const OpenCodeTextGenerationExistingServerTestLayer = Layer.merge(
  OpenCodeRuntimeCapabilityTest.make(OpenCodeRuntimeTestDouble),
  OpenCodeServerOwnerCapabilityTest.make(OpenCodeServerOwnerTestDouble),
).pipe(
  Layer.provideMerge(
    ServerConfig.ServerConfig.layerTest(process.cwd(), {
      prefix: "t3code-opencode-text-generation-existing-server-test-",
    }),
  ),
  Layer.provideMerge(NetService.layer),
  Layer.provideMerge(NodeServices.layer),
);

const DEFAULT_OPENCODE_SETTINGS = Schema.decodeSync(OpenCodeSettings)({
  binaryPath: "fake-opencode",
});
const EXISTING_SERVER_OPENCODE_SETTINGS = Schema.decodeSync(OpenCodeSettings)({
  binaryPath: "fake-opencode",
  serverUrl: "http://127.0.0.1:9999",
  serverPassword: "secret-password",
});
const EXTERNAL_SERVER_WITHOUT_AUTH_OPENCODE_SETTINGS = Schema.decodeSync(OpenCodeSettings)({
  binaryPath: "fake-opencode",
  serverUrl: "http://127.0.0.1:9999",
});

function withOpenCodeTextGeneration<A, E, R>(
  settings: OpenCodeSettings,
  effectFn: (textGeneration: TextGeneration.TextGeneration["Service"]) => Effect.Effect<A, E, R>,
) {
  return Effect.gen(function* () {
    const textGeneration = yield* OpenCodeTextGeneration.makeOpenCodeTextGeneration(settings);
    return yield* effectFn(textGeneration);
  }).pipe(Effect.scoped);
}

beforeEach(() => {
  runtimeMock.reset();
});

it.layer(OpenCodeTextGenerationTestLayer)("OpenCodeTextGeneration", (it) => {
  it.effect("excludes generic files from thread title generation", () =>
    withOpenCodeTextGeneration(DEFAULT_OPENCODE_SETTINGS, (textGeneration) =>
      Effect.gen(function* () {
        runtimeMock.state.promptResult = {
          data: {
            parts: [{ type: "text", text: '{"title":"Review uploaded report"}' }],
          },
        };

        yield* textGeneration.generateThreadTitle({
          cwd: process.cwd(),
          message: "Review these attachments.",
          modelSelection: DEFAULT_TEST_MODEL_SELECTION,
          attachments: [
            {
              type: "image",
              id: "thread-image-attachment",
              name: "screenshot.png",
              mimeType: "image/png",
              sizeBytes: 3,
            },
            {
              type: "file",
              id: "thread-report-attachment-pdf",
              name: "report.pdf",
              mimeType: "application/pdf",
              sizeBytes: 42,
            },
          ],
        });

        expect(runtimeMock.state.promptParts[0]).toEqual([
          expect.objectContaining({ type: "text" }),
          expect.objectContaining({ type: "file", filename: "screenshot.png" }),
        ]);
      }),
    ),
  );

  it.effect("routes local requests through the shared server owner", () =>
    withOpenCodeTextGeneration(DEFAULT_OPENCODE_SETTINGS, (textGeneration) =>
      Effect.gen(function* () {
        yield* textGeneration.generateCommitMessage(DEFAULT_COMMIT_MESSAGE_INPUT);
        yield* textGeneration.generateCommitMessage(DEFAULT_COMMIT_MESSAGE_INPUT);

        expect(runtimeMock.state.promptUrls).toEqual([LOCAL_SERVER_URL, LOCAL_SERVER_URL]);
      }),
    ),
  );

  it.effect("preserves the SDK cause when session creation fails", () =>
    withOpenCodeTextGeneration(DEFAULT_OPENCODE_SETTINGS, (textGeneration) =>
      Effect.gen(function* () {
        const sdkCause = new Error("session endpoint unavailable");
        runtimeMock.state.sessionCreateError = sdkCause;

        const error = yield* textGeneration
          .generateCommitMessage(DEFAULT_COMMIT_MESSAGE_INPUT)
          .pipe(Effect.flip);

        expect(error).toBeInstanceOf(TextGenerationError);
        expect(error.message).toContain("OpenCode session.create request failed.");
        expect(error.cause).toMatchObject({
          _tag: "OpenCodeTextGenerationSessionRequestError",
          operation: "generateCommitMessage",
          cwd: process.cwd(),
          cause: sdkCause,
        });
        expect((error.cause as { cause: unknown }).cause).toBe(sdkCause);
      }),
    ),
  );

  it.effect("reports a missing session payload without manufacturing a cause", () =>
    withOpenCodeTextGeneration(DEFAULT_OPENCODE_SETTINGS, (textGeneration) =>
      Effect.gen(function* () {
        runtimeMock.state.sessionResult = {};

        const error = yield* textGeneration
          .generateCommitMessage(DEFAULT_COMMIT_MESSAGE_INPUT)
          .pipe(Effect.flip);

        expect(error.message).toContain("OpenCode session.create returned no session payload.");
        expect(error.cause).toMatchObject({
          _tag: "OpenCodeTextGenerationSessionPayloadError",
          operation: "generateCommitMessage",
          cwd: process.cwd(),
        });
        expect(error.cause).not.toHaveProperty("cause");
      }),
    ),
  );

  it.effect("preserves the SDK cause and request context when prompting fails", () =>
    withOpenCodeTextGeneration(DEFAULT_OPENCODE_SETTINGS, (textGeneration) =>
      Effect.gen(function* () {
        const sdkCause = new Error("prompt endpoint unavailable");
        runtimeMock.state.promptRequestError = sdkCause;

        const error = yield* textGeneration
          .generateCommitMessage(DEFAULT_COMMIT_MESSAGE_INPUT)
          .pipe(Effect.flip);

        expect(error.message).toContain("OpenCode session.prompt request failed.");
        expect(error.cause).toMatchObject({
          _tag: "OpenCodeTextGenerationPromptRequestError",
          operation: "generateCommitMessage",
          cwd: process.cwd(),
          sessionId: `${LOCAL_SERVER_URL}/session`,
          providerId: "openai",
          modelId: "gpt-5",
          cause: sdkCause,
        });
        expect((error.cause as { cause: unknown }).cause).toBe(sdkCause);
      }),
    ),
  );

  it.effect("returns a typed empty-output error for malformed and blank response parts", () =>
    withOpenCodeTextGeneration(DEFAULT_OPENCODE_SETTINGS, (textGeneration) =>
      Effect.gen(function* () {
        runtimeMock.state.promptResult = {
          data: {
            parts: [null, { type: "tool" }, { type: "text", text: "   " }],
          },
        };

        const error = yield* textGeneration
          .generateCommitMessage(DEFAULT_COMMIT_MESSAGE_INPUT)
          .pipe(Effect.flip);

        expect(error.message).toContain("OpenCode returned empty output.");
        expect(error.cause).toMatchObject({
          _tag: "OpenCodeTextGenerationEmptyOutputError",
          operation: "generateCommitMessage",
          cwd: process.cwd(),
          sessionId: `${LOCAL_SERVER_URL}/session`,
          providerId: "openai",
          modelId: "gpt-5",
          responsePartCount: 3,
          textPartCount: 1,
        });
        expect(error.cause).not.toHaveProperty("cause");
      }),
    ),
  );

  it.effect("parses JSON returned as plain text output", () =>
    withOpenCodeTextGeneration(DEFAULT_OPENCODE_SETTINGS, (textGeneration) =>
      Effect.gen(function* () {
        runtimeMock.state.promptResult = {
          data: {
            parts: [
              {
                type: "text",
                text: 'Here is the result:\n{"subject":"Tighten OpenCode parsing","body":"Handle JSON text output locally."}',
              },
            ],
          },
        };

        const result = yield* textGeneration.generateCommitMessage({
          cwd: process.cwd(),
          branch: "feature/opencode-reuse",
          stagedSummary: "M README.md",
          stagedPatch: "diff --git a/README.md b/README.md",
          modelSelection: DEFAULT_TEST_MODEL_SELECTION,
        });

        expect(result).toEqual({
          subject: "Tighten OpenCode parsing",
          body: "Handle JSON text output locally.",
        });
      }),
    ),
  );

  it.effect("surfaces the upstream OpenCode structured-output error message", () =>
    withOpenCodeTextGeneration(DEFAULT_OPENCODE_SETTINGS, (textGeneration) =>
      Effect.gen(function* () {
        runtimeMock.state.promptResult = {
          data: {
            info: {
              error: {
                name: "StructuredOutputError",
                data: {
                  message: "Model did not produce structured output",
                  retries: 2,
                },
              },
            },
          },
        };

        const error = yield* textGeneration
          .generateCommitMessage(DEFAULT_COMMIT_MESSAGE_INPUT)
          .pipe(Effect.flip);

        expect(error.message).toContain("Model did not produce structured output");
        expect(error.cause).toMatchObject({
          _tag: "OpenCodeTextGenerationPromptResponseError",
          operation: "generateCommitMessage",
          cwd: process.cwd(),
          sessionId: `${LOCAL_SERVER_URL}/session`,
          providerId: "openai",
          modelId: "gpt-5",
          providerErrorName: "StructuredOutputError",
          providerMessage: "Model did not produce structured output",
        });
        expect(error.cause).not.toHaveProperty("cause");
      }),
    ),
  );
});

it.layer(OpenCodeTextGenerationExistingServerTestLayer)(
  "OpenCodeTextGeneration with configured server URL",
  (it) => {
    it.effect(
      "does not send a serverPassword to a configured server when settings don't set one",
      () =>
        withOpenCodeTextGeneration(
          EXTERNAL_SERVER_WITHOUT_AUTH_OPENCODE_SETTINGS,
          (textGeneration) =>
            Effect.gen(function* () {
              yield* textGeneration.generateCommitMessage(DEFAULT_COMMIT_MESSAGE_INPUT);
              expect(runtimeMock.state.authHeaders).toEqual([null]);
            }),
        ),
    );

    it.effect("does not create a session when the server version is unsupported", () =>
      withOpenCodeTextGeneration(EXISTING_SERVER_OPENCODE_SETTINGS, (textGeneration) =>
        Effect.gen(function* () {
          runtimeMock.state.connectionError = new Error(
            "OpenCode v1.14.18 is too old. Upgrade to v1.14.19 or newer.",
          );

          const error = yield* textGeneration
            .generateCommitMessage(DEFAULT_COMMIT_MESSAGE_INPUT)
            .pipe(Effect.flip);

          expect(error).toBeInstanceOf(TextGenerationError);
          expect(error.message).toContain("v1.14.18 is too old");
          expect(runtimeMock.state.sessionCreateCalls).toBe(0);
        }),
      ),
    );

    it.effect("reuses a configured OpenCode server URL without spawning", () =>
      withOpenCodeTextGeneration(EXISTING_SERVER_OPENCODE_SETTINGS, (textGeneration) =>
        Effect.gen(function* () {
          yield* textGeneration.generateCommitMessage({
            cwd: process.cwd(),
            branch: "feature/opencode-reuse",
            stagedSummary: "M README.md",
            stagedPatch: "diff --git a/README.md b/README.md",
            modelSelection: DEFAULT_TEST_MODEL_SELECTION,
          });
          yield* textGeneration.generateCommitMessage({
            cwd: process.cwd(),
            branch: "feature/opencode-reuse",
            stagedSummary: "M README.md",
            stagedPatch: "diff --git a/README.md b/README.md",
            modelSelection: DEFAULT_TEST_MODEL_SELECTION,
          });

          expect(runtimeMock.state.promptUrls).toEqual([
            "http://127.0.0.1:9999",
            "http://127.0.0.1:9999",
          ]);
          expect(runtimeMock.state.authHeaders).toEqual([
            `Basic ${btoa("opencode:secret-password")}`,
            `Basic ${btoa("opencode:secret-password")}`,
          ]);
        }),
      ).pipe(Effect.provide(TestClock.layer())),
    );
  },
);
