// @effect-diagnostics nodeBuiltinImport:off - producer fixtures remove their own temporary sources.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { EventId, ThreadId, OrchestrationThreadDetailSnapshot } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import sharp from "sharp";
import { ServerConfig, layerTest } from "../config.ts";
import {
  backfillThreadMedia,
  captureActivityMedia,
  captureConversationText,
} from "./ConversationMedia.ts";
import * as AssetSigningKey from "./AssetSigningKey.ts";
import * as ProjectFaviconResolver from "../project/ProjectFaviconResolver.ts";
import * as T3ProjectFileLoader from "../project/T3ProjectFileLoader.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import { resolveImageAsset } from "./ImageAsset.ts";
import { ContentAssets, contentAssetsAt } from "./ContentAssets.ts";
import {
  projectActivityPayload,
  projectThreadDetailSnapshot,
} from "../orchestration/ActivityPayloadProjection.ts";
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const layer = Layer.mergeAll(
  layerTest(process.cwd(), { prefix: "mate-capture-" }),
  WorkspacePaths.layer,
  ProjectFaviconResolver.layer.pipe(
    Layer.provide(WorkspacePaths.layer),
    Layer.provide(T3ProjectFileLoader.layer),
  ),
  Layer.succeed(AssetSigningKey.AssetSigningKey, { get: Effect.die("legacy signing is not used") }),
).pipe(Layer.provideMerge(NodeServices.layer));
it.effect(
  "captures a produced image without a viewer and gives pathname reuse a new occurrence",
  () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig;
      const source = NodePath.join(config.stateDir, "shot.png");
      const bytes = yield* Effect.promise(() =>
        sharp({ create: { width: 200, height: 120, channels: 4, background: "red" } })
          .png()
          .toBuffer(),
      );
      yield* Effect.promise(() => NodeFSP.writeFile(source, bytes));
      const first = yield* captureConversationText(
        `![first](${source})`,
        ThreadId.make("thread"),
        "first-message",
        config.stateDir,
      );
      yield* Effect.promise(() => NodeFSP.unlink(source));
      expect(first).toMatch(/^!\[first\]\(mate-asset:[a-f0-9-]{36}\)$/);
      const occurrence = yield* Effect.promise(() =>
        contentAssetsAt(config.stateDir).occurrence(
          first.slice(first.indexOf("mate-asset:") + 11, -1),
        ),
      );
      if (occurrence.original.status !== "ready") throw new Error("not retained");
      const digest = occurrence.original.digest;
      expect(
        yield* Effect.promise(async () =>
          NodeFSP.readFile((await contentAssetsAt(config.stateDir).object(digest)).path),
        ),
      ).toEqual(bytes);
      yield* Effect.promise(() => NodeFSP.writeFile(source, bytes));
      const second = yield* captureConversationText(
        `![second](${source})`,
        ThreadId.make("thread"),
        "second-message",
        config.stateDir,
      );
      expect(second).not.toContain(occurrence.id);
    }).pipe(Effect.provide(layer)),
);
it.effect("a tool-card snapshot contains an occurrence and no image body", () =>
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const bytes = yield* Effect.promise(() =>
      sharp({ create: { width: 200, height: 120, channels: 4, background: "blue" } })
        .png()
        .toBuffer(),
    );
    const activity = yield* captureActivityMedia(
      {
        id: EventId.make("tool"),
        kind: "tool.completed",
        tone: "tool",
        summary: "Screenshot",
        createdAt: "2026-10-07T00:00:00.000Z",
        turnId: null,
        payload: {
          data: { zerops: { images: [{ mimeType: "image/png", data: bytes.toString("base64") }] } },
        },
      },
      ThreadId.make("thread"),
      config.stateDir,
    );
    expect(activity.payload).toMatchObject({
      data: {
        zerops: { images: [{ asset: { original: { status: "ready", sizeBytes: bytes.length } } }] },
      },
    });
    expect(activity.payload).not.toMatchObject({
      data: { zerops: { images: [{ data: expect.anything() }] } },
    });
  }).pipe(Effect.provide(layer)),
);
it.effect.each(["https://example.org/picture.png", "movie.mp4"])(
  "keeps external and non-image destinations unchanged: %s",
  (destination) =>
    Effect.gen(function* () {
      const config = yield* ServerConfig;
      const text = `![media](${destination})`;
      expect(
        yield* captureConversationText(text, ThreadId.make("thread"), "message", config.stateDir),
      ).toBe(text);
    }).pipe(Effect.provide(layer)),
);

it.effect.each(["inline", "reference"])(
  "retains exact originals for unsupported preview codecs without a Markdown body leak: %s",
  (syntax) =>
    Effect.gen(function* () {
      const config = yield* ServerConfig;
      const bytes = Buffer.from("original codec bytes");
      const source = `data:image/x-unrecognized;base64,${bytes.toString("base64")}`;
      const text =
        syntax === "inline"
          ? `![picture](${source})`
          : `![picture][shot]\n\n[shot]: ${source} "Title"`;
      const captured = yield* captureConversationText(
        text,
        ThreadId.make("thread"),
        "message",
        config.stateDir,
      );
      expect(captured).not.toContain(source);
      const id = /mate-asset:([a-f0-9-]{36})/.exec(captured)?.[1];
      if (!id) throw new Error("No occurrence");
      const result = yield* resolveImageAsset({
        resource: {
          _tag: "workspace-file",
          threadId: ThreadId.make("thread"),
          path: `mate-asset:${id}`,
        },
        imageMode: "reference",
        preview: { width: 80, height: 40 },
        workspaceRoot: config.stateDir,
      });
      expect(result?.renditionFailure).toBe("preview-unavailable");
      const original = result?.occurrence?.original;
      if (original?.status !== "ready") throw new Error("No retained original");
      expect(
        yield* Effect.promise(async () =>
          NodeFSP.readFile((await contentAssetsAt(config.stateDir).object(original.digest)).path),
        ),
      ).toEqual(bytes);
    }).pipe(Effect.provide(layer)),
);

it.effect(
  "captures reference and parenthesized image paths while leaving code examples intact",
  () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig;
      const source = "shot (1).png";
      const bytes = yield* Effect.promise(() =>
        sharp({ create: { width: 20, height: 12, channels: 4, background: "red" } })
          .png()
          .toBuffer(),
      );
      yield* Effect.promise(() => NodeFSP.writeFile(NodePath.join(config.stateDir, source), bytes));
      const code = "```md\n![example](<shot (1).png>)\n```";
      const captured = yield* captureConversationText(
        `![one](<${source}> "Title")\n![two][shot]\n\n[shot]: <${source}>\n${code}`,
        ThreadId.make("thread"),
        "message",
        config.stateDir,
      );
      expect(captured).toContain(code);
      expect(captured.match(/mate-asset:/g)).toHaveLength(2);
      expect(captured).toContain('"Title"');
    }).pipe(Effect.provide(layer)),
);

it.effect.each(["storage-full", "source-missing", "source-changed"] as const)(
  "retains the producer's refusal when the occurrence file could not be published: %s",
  (code) =>
    Effect.gen(function* () {
      const config = yield* ServerConfig;
      const result = yield* resolveImageAsset({
        resource: {
          _tag: "workspace-file",
          threadId: ThreadId.make("thread"),
          path: `mate-asset:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa:${code}`,
        },
        imageMode: "reference",
        preview: { width: 80, height: 40 },
        workspaceRoot: config.stateDir,
      });
      expect(result?.occurrence?.original).toEqual({ status: "failed", code });
    }).pipe(Effect.provide(layer)),
);

it.effect.each(["Read", "read", "Codex", "ACP"])(
  "a %s screenshot survives source cleanup and a fresh asset store before anyone views it",
  (provider) =>
    Effect.gen(function* () {
      const config = yield* ServerConfig;
      const source = NodePath.join(config.stateDir, "tool-shot.png");
      const bytes = yield* Effect.promise(() =>
        sharp({ create: { width: 20, height: 12, channels: 4, background: "red" } })
          .png()
          .toBuffer(),
      );
      yield* Effect.promise(() => NodeFSP.writeFile(source, bytes));
      const first = yield* captureActivityMedia(
        {
          id: EventId.make("tool"),
          kind: "tool.completed",
          tone: "tool",
          summary: "Screenshot",
          createdAt: "2026-10-07T00:00:00.000Z",
          turnId: null,
          payload: {
            itemType: "image_view",
            data:
              provider === "Codex"
                ? { item: { type: "imageView", path: source } }
                : provider === "ACP"
                  ? { imagePath: source }
                  : { toolName: provider, input: { file_path: source } },
          },
        },
        ThreadId.make("thread"),
        config.stateDir,
      );
      yield* Effect.promise(() => NodeFSP.unlink(source));
      const projectedFirst = projectActivityPayload(first);
      const path = (projectedFirst.payload as { data: { imagePath: string } }).data.imagePath;
      expect(path).toMatch(/^mate-asset:[a-f0-9-]{36}$/);
      const restarted = new ContentAssets(NodePath.join(config.stateDir, "assets"));
      const occurrence = yield* Effect.promise(() => restarted.occurrence(path.slice(11)));
      if (occurrence.original.status !== "ready") throw new Error("Screenshot not retained");
      expect(
        yield* Effect.promise(async () =>
          NodeFSP.readFile(
            (
              await restarted.object(
                occurrence.original.status === "ready" ? occurrence.original.digest : "",
              )
            ).path,
          ),
        ),
      ).toEqual(bytes);
      const replay = yield* captureActivityMedia(first, ThreadId.make("thread"), config.stateDir);
      expect(replay.payload).toEqual(first.payload);
      const projected = projectActivityPayload(replay);
      expect(projected.payload).toMatchObject({
        data: {
          imagePath: expect.stringMatching(/^mate-asset:/),
          imageDimensions: { width: 20, height: 12 },
          imageName: "tool-shot.png",
        },
      });
      expect(encodeJson(projected.payload)).not.toContain(`"imagePath":"${source}"`);
    }).pipe(Effect.provide(layer)),
);

// Asset occurrences belong to activity identities. Project completion echoes before capture,
// otherwise the two occurrence ids make identical provider pictures look like different facts.
it.effect.each([false, true])(
  "a snapshot retains each distinct screenshot result once (changed update: %s)",
  (changedUpdate) =>
    Effect.gen(function* () {
      const config = yield* ServerConfig;
      const bytes = yield* Effect.promise(() =>
        sharp({ create: { width: 200, height: 120, channels: 4, background: "blue" } })
          .png()
          .toBuffer(),
      );
      const completion = {
        id: EventId.make("completion"),
        kind: "tool.completed",
        tone: "tool" as const,
        summary: "Screenshot",
        createdAt: "2026-10-07T00:00:00.000Z",
        turnId: null,
        payload: {
          itemType: "mcp_tool_call",
          toolCallId: "browser-call",
          status: "completed",
          data: {
            toolName: "mcp__zerops__zerops_browser",
            input: { url: "https://example.org" },
            result: {
              content: [
                { type: "text", text: "Page inspected" },
                { type: "image", mimeType: "image/png", data: bytes.toString("base64") },
              ],
            },
          },
        },
      };
      const update = projectActivityPayload({
        ...completion,
        id: EventId.make("update"),
        kind: "tool.updated",
        payload: {
          ...completion.payload,
          status: "inProgress",
          data: {
            ...completion.payload.data,
            result: {
              content: [
                { type: "text", text: changedUpdate ? "Different observation" : "Page inspected" },
                completion.payload.data.result.content[1]!,
              ],
            },
          },
        },
      });
      const snapshot = yield* Schema.decodeUnknownEffect(OrchestrationThreadDetailSnapshot)({
        snapshotSequence: 42,
        page: {
          hasMore: true,
          beforeCursor: "older-page",
          snapshotSequence: 42,
          threadSequence: 40,
        },
        thread: {
          id: "thread",
          projectId: "project",
          title: "Screenshot history",
          modelSelection: { provider: "claudeCode", model: "claude-sonnet-4-6" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          latestTurn: null,
          createdAt: completion.createdAt,
          updatedAt: completion.createdAt,
          deletedAt: null,
          messages: [],
          proposedPlans: [],
          checkpoints: [],
          session: null,
          // The completion can sort before its echo when both have the same instant.
          activities: [completion, update],
        },
      });
      const result = projectThreadDetailSnapshot(
        yield* backfillThreadMedia(snapshot, config.stateDir),
      );
      expect(result.snapshotSequence).toBe(snapshot.snapshotSequence);
      expect(result.page).toEqual(snapshot.page);
      expect(result.thread.activities.map((activity) => activity.id)).toEqual(
        changedUpdate ? [completion.id, update.id] : [completion.id],
      );
      expect(encodeJson(result)).not.toContain(bytes.toString("base64"));
      const occurrences = yield* Effect.promise(() =>
        NodeFSP.readdir(NodePath.join(contentAssetsAt(config.stateDir).directory, "occurrences")),
      );
      expect(occurrences).toHaveLength(changedUpdate ? 2 : 1);
      for (const file of occurrences) {
        const store = contentAssetsAt(config.stateDir);
        const occurrence = yield* Effect.promise(() =>
          store.occurrence(file.replace(/\.json$/, "")),
        );
        if (occurrence.original.status !== "ready") throw new Error("Screenshot not retained");
        const digest = occurrence.original.digest;
        expect(
          yield* Effect.promise(async () => NodeFSP.readFile((await store.object(digest)).path)),
        ).toEqual(bytes);
      }
    }).pipe(Effect.provide(layer)),
);

it.effect("an engine conversation resolves the screenshot captured by its provider session", () =>
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const bytes = yield* Effect.promise(() =>
      sharp({ create: { width: 200, height: 120, channels: 4, background: "red" } })
        .png()
        .toBuffer(),
    );
    const occurrence = yield* Effect.promise(() =>
      contentAssetsAt(config.stateDir).ingestBytes(bytes, {
        threadId: ThreadId.make("conversation/s/1"),
        ownerId: "browser-call",
        name: "screenshot.png",
        provenance: "capture",
      }),
    );
    const result = yield* resolveImageAsset({
      resource: {
        _tag: "media-file",
        threadId: ThreadId.make("conversation"),
        path: `mate-asset:${occurrence.id}`,
      },
      imageMode: "reference",
    }).pipe(Effect.provideService(ServerConfig, { ...config, mateEngine: "mate" }), Effect.result);
    expect(
      result._tag,
      "ASSERTION: the engine conversation can resolve its provider-session screenshot",
    ).toBe("Success");
  }).pipe(Effect.provide(layer)),
);
