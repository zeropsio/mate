// @effect-diagnostics nodeBuiltinImport:off - producer capture checks canonical filesystem roots before copying.
import type {
  OrchestrationEvent,
  OrchestrationReadModel,
  OrchestrationThreadDetailSnapshot,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as NodePath from "node:path";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import { fromMarkdown } from "mdast-util-from-markdown";

import { ServerConfig } from "../config.ts";
import {
  projectActivityPayload,
  projectThreadDetailSnapshot,
} from "../orchestration/ActivityPayloadProjection.ts";
import { resolveAttachmentPathById } from "../attachmentStore.ts";
import { mediaMimeTypeFromExtension } from "@t3tools/shared/filePreview";
import { contentAssetsAt, type ContentAssets } from "./ContentAssets.ts";
import { findRetainedMedia, retainedMediaDirectory } from "./RetainedMedia.ts";

/** Capture only locally authored images. External URLs remain external. */
export const captureConversationText = Effect.fn("captureConversationText")(function* (
  text: string,
  threadId: ThreadId,
  ownerId: string,
  workspaceRoot: string,
  legacy = false,
) {
  // Both inline and reference Markdown images require this opener. Ordinary code and
  // prose need no media read and no Markdown AST on every warm snapshot.
  if (!text.includes("![")) return text;
  const config = yield* ServerConfig;
  const store = contentAssetsAt(config.stateDir);
  const tree = fromMarkdown(text);
  type Node = typeof tree | (typeof tree.children)[number];
  const definitions = new Map<string, Extract<Node, { readonly type: "definition" }>>();
  const capturedDefinitions = new Set<string>();
  const images: {
    start: number;
    end: number;
    url: string;
    alt: string;
    reference?: string;
    title?: string | null | undefined;
  }[] = [];
  const visit = (node: Node, collect: boolean): void => {
    if (node.type === "definition") definitions.set(node.identifier.toLowerCase(), node);
    if (collect && (node.type === "image" || node.type === "imageReference")) {
      const destination =
        node.type === "image" ? node : definitions.get(node.identifier.toLowerCase());
      const reference = node.type === "imageReference" ? node.identifier.toLowerCase() : undefined;
      if (reference !== undefined && capturedDefinitions.has(reference)) return;
      const position = reference === undefined ? node.position : destination?.position;
      const start = position?.start.offset;
      const end = position?.end.offset;
      if (destination && start !== undefined && end !== undefined)
        images.push({
          start,
          end,
          url: destination.url,
          alt: node.alt ?? "",
          title: destination.title,
          ...(reference === undefined ? {} : { reference }),
        });
      if (reference !== undefined) capturedDefinitions.add(reference);
    }
    if ("children" in node) for (const child of node.children) visit(child, collect);
  };
  visit(tree, false);
  visit(tree, true);
  let result = text;
  for (const image of images.toSorted((a, b) => b.start - a.start)) {
    const raw = image.url;
    if (/^(?:https?:|blob:|\/\/|mate-asset:)/i.test(raw)) continue;
    let occurrence;
    if (/^data:image\/[^;,]+;base64,/i.test(raw)) {
      occurrence = yield* Effect.promise(() =>
        store.legacy([threadId, ownerId, raw], () =>
          store.ingestBytes(Buffer.from(raw.slice(raw.indexOf(",") + 1), "base64"), {
            threadId,
            ownerId,
            name: "image",
            mimeType: raw.slice(5, raw.indexOf(";")),
            provenance: legacy ? "legacy" : "capture",
          }),
        ),
      );
    } else {
      if (
        !mediaMimeTypeFromExtension(NodePath.extname(raw.split(/[?#]/)[0]!))?.startsWith("image/")
      )
        continue;
      let source = raw;
      try {
        source = raw.startsWith("file:")
          ? decodeURIComponent(new URL(raw).pathname)
          : decodeURIComponent(raw.split(/[?#]/)[0]!);
      } catch {
        continue;
      }
      const retained = legacy
        ? yield* findRetainedMedia(
            { _tag: "workspace-file", threadId, path: source },
            NodePath.resolve(workspaceRoot, source),
          ).pipe(Effect.orElseSucceed(() => null))
        : null;
      const retainedFile =
        retained === null ? null : NodePath.join(yield* retainedMediaDirectory, retained);
      const canonical =
        retainedFile ??
        (yield* Effect.promise(async () => {
          const file = await NodeFSP.realpath(NodePath.resolve(workspaceRoot, source)).catch(
            () => null,
          );
          if (file === null) return null;
          const roots = await Promise.all(
            [workspaceRoot, NodeOS.homedir(), NodeOS.tmpdir()].map((root) =>
              NodeFSP.realpath(root).catch(() => root),
            ),
          );
          return roots.some((root) => {
            const relative = NodePath.relative(root, file);
            return relative !== "" && !relative.startsWith("..") && !NodePath.isAbsolute(relative);
          })
            ? file
            : null;
        }));
      const owner = {
        threadId,
        ownerId,
        name: NodePath.basename(source) || "image",
        provenance: legacy ? ("legacy" as const) : ("capture" as const),
      };
      const ingest = () =>
        canonical === null
          ? store.failure(owner, "source-missing")
          : store.ingestFile(canonical, owner);
      occurrence = yield* Effect.promise(() =>
        legacy ? store.legacy([threadId, ownerId, raw], ingest) : ingest(),
      );
    }
    const alt = image.alt.replace(/[\\[\]]/g, "\\$&");
    const title = image.title
      ? ` ${yield* Schema.encodeEffect(Schema.fromJsonString(Schema.String))(image.title).pipe(Effect.orDie)}`
      : "";
    const reference = `mate-asset:${occurrence.id}${occurrence.original.status === "failed" ? `:${occurrence.original.code}` : ""}`;
    const replacement = image.reference
      ? `[${image.reference.replace(/[\\[\]]/g, "\\$&")}]: ${reference}${title}`
      : `![${alt}](${reference}${title})`;
    result = result.slice(0, image.start) + replacement + result.slice(image.end);
  }
  return result;
});

type PlannedEvent = OrchestrationEvent extends infer E
  ? E extends unknown
    ? Omit<E, "sequence">
    : never
  : never;

export const captureConversationEvent = Effect.fn("captureConversationEvent")(function* (
  event: PlannedEvent,
  model: OrchestrationReadModel,
) {
  if (event.type !== "thread.message-sent" && event.type !== "thread.activity-appended")
    return event;
  const config = yield* Effect.serviceOption(ServerConfig);
  if (Option.isNone(config)) return event;
  const thread = model.threads.find((value) => value.id === event.payload.threadId);
  const project = model.projects.find((value) => value.id === thread?.projectId);
  const workspaceRoot = thread?.worktreePath ?? project?.workspaceRoot;
  if (!workspaceRoot) return event;
  if (event.type === "thread.message-sent") {
    if (event.payload.role === "reasoning") return event;
    const messageId = event.payload.messageId;
    const text =
      event.payload.text || thread?.messages.find((value) => value.id === messageId)?.text || "";
    const captured = yield* captureConversationText(
      text,
      event.payload.threadId,
      event.payload.messageId,
      workspaceRoot,
    ).pipe(Effect.provideService(ServerConfig, config.value));
    return captured === text ? event : { ...event, payload: { ...event.payload, text: captured } };
  }
  const projected = projectActivityPayload(event.payload.activity);
  const hasImageBody = (value: unknown): boolean => {
    if (!value || typeof value !== "object") return false;
    const record = value as Record<string, unknown>;
    return (
      (typeof record.mimeType === "string" &&
        record.mimeType.startsWith("image/") &&
        typeof record.data === "string") ||
      Object.values(record).some(hasImageBody)
    );
  };
  // The image projection removes duplicate provider bodies. Other tool metadata keeps its
  // existing persistence contract; its presentation projection still happens on reads.
  const activity = hasImageBody(projected.payload) ? projected : event.payload.activity;
  return {
    ...event,
    payload: {
      ...event.payload,
      activity: yield* captureActivityMedia(activity, event.payload.threadId, workspaceRoot).pipe(
        Effect.provideService(ServerConfig, config.value),
      ),
    },
  };
});

/**
 * A tool result's inline picture (`{mimeType: "image/…", data: base64}`) as a stored reference:
 * its bytes kept once by their content, its occurrence keyed by the thread, the activity and the
 * bytes, so the same picture of the same activity is one occurrence whoever keeps it.
 */
export const isInlineImage = (
  value: unknown,
): value is { readonly mimeType: string; readonly data: string } =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Record<string, unknown>).mimeType === "string" &&
  ((value as Record<string, unknown>).mimeType as string).startsWith("image/") &&
  typeof (value as Record<string, unknown>).data === "string";

export const keepInlineImage = async (
  store: ContentAssets,
  threadId: ThreadId,
  activityId: string,
  image: { readonly mimeType: string; readonly data: string },
) => {
  const asset = await store.legacy([threadId, activityId, image.data], () =>
    store.ingestBytes(Buffer.from(image.data, "base64"), {
      threadId,
      ownerId: activityId,
      provenance: "capture",
      name: "tool-image",
      mimeType: image.mimeType,
    }),
  );
  const size =
    asset.original.status === "ready"
      ? {
          ...(asset.original.width === undefined ? {} : { width: asset.original.width }),
          ...(asset.original.height === undefined ? {} : { height: asset.original.height }),
        }
      : {};
  return { mimeType: image.mimeType, asset, ...size };
};

function payloadMediaNeedsCapture(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(payloadMediaNeedsCapture);
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    isInlineImage(value) ||
    (typeof record.imagePath === "string" && !record.imagePath.startsWith("mate-asset:")) ||
    Object.values(record).some(payloadMediaNeedsCapture)
  );
}

function activityMediaNeedsCapture(
  activity: OrchestrationThreadDetailSnapshot["thread"]["activities"][number],
): boolean {
  // Native Read/image-view paths are media only after the shared tool projection names them.
  return (
    payloadMediaNeedsCapture(activity.payload) ||
    payloadMediaNeedsCapture(projectActivityPayload(activity).payload)
  );
}

/**
 * A picture a call looked at, kept as V1 keeps it: once per thread, call and path (the store's
 * legacy binding), so V1's capture, its backfill and the engine's import of the call share one
 * occurrence. Its reference names the occurrence, with the store's code when it could not be kept.
 */
export const keepLookedPicture = async (
  store: ContentAssets,
  threadId: ThreadId,
  activityId: string,
  path: string,
  workspaceRoot: string,
): Promise<{
  readonly imagePath: string;
  readonly imageName: string;
  readonly imageDimensions?: { width: number; height: number };
}> => {
  const asset = await store.legacy([threadId, activityId, path], () =>
    store.ingestFile(NodePath.resolve(workspaceRoot, path), {
      threadId,
      ownerId: activityId,
      provenance: "capture",
      name: NodePath.basename(path),
    }),
  );
  return {
    imagePath: `mate-asset:${asset.id}${asset.original.status === "failed" ? `:${asset.original.code}` : ""}`,
    imageName: asset.name,
    ...(asset.original.status === "ready" && asset.original.width && asset.original.height
      ? { imageDimensions: { width: asset.original.width, height: asset.original.height } }
      : {}),
  };
};

export const captureActivityMedia = Effect.fn("captureActivityMedia")(function* (
  activity: OrchestrationThreadDetailSnapshot["thread"]["activities"][number],
  threadId: ThreadId,
  workspaceRoot: string,
) {
  // A captured or image-free tool result needs no asset store and no async payload clone.
  if (!activityMediaNeedsCapture(activity)) return activity;
  const config = yield* ServerConfig;
  const store = contentAssetsAt(config.stateDir);
  const capture = async (value: unknown): Promise<unknown> => {
    if (Array.isArray(value)) return Promise.all(value.map(capture));
    if (!value || typeof value !== "object") return value;
    if (isInlineImage(value)) return keepInlineImage(store, threadId, activity.id, value);
    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    let imageDimensions: { width: number; height: number } | undefined;
    let imageName: string | undefined;
    for (const [key, item] of Object.entries(record)) {
      if (key === "imagePath" && typeof item === "string" && !item.startsWith("mate-asset:")) {
        const looked = await keepLookedPicture(store, threadId, activity.id, item, workspaceRoot);
        imageName = looked.imageName;
        imageDimensions = looked.imageDimensions;
        result[key] = looked.imagePath;
      } else result[key] = await capture(item);
    }
    return {
      ...result,
      ...(imageDimensions ? { imageDimensions } : {}),
      ...(imageName ? { imageName } : {}),
    };
  };
  // Native Read exposes its screenshot through its input path. Persist the captured
  // reference before the tool event becomes durable, rather than deriving it on first view.
  const recordOf = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  const projected = recordOf(projectActivityPayload(activity).payload);
  const imagePath = recordOf(projected?.data)?.imagePath;
  const payload = recordOf(activity.payload);
  const data = recordOf(payload?.data);
  const capturePayload =
    typeof imagePath === "string" && payload && data
      ? { ...payload, data: { ...data, imagePath } }
      : activity.payload;
  return { ...activity, payload: yield* Effect.promise(() => capture(capturePayload)) };
});

export const backfillThreadMedia = Effect.fn("backfillThreadMedia")(function* (
  source: OrchestrationThreadDetailSnapshot,
  workspaceRoot: string,
) {
  // Compare provider echoes before capture gives each activity its own asset occurrence.
  // Only the rows the snapshot retains need media; their cursor and watermarks stay intact.
  const snapshot = projectThreadDetailSnapshot(source);
  if (
    !snapshot.thread.messages.some(
      (message) =>
        message.text.includes("![") ||
        message.attachments?.some(
          (attachment) =>
            attachment.type === "image" &&
            (!("asset" in attachment) || attachment.asset === undefined),
        ),
    ) &&
    !snapshot.thread.activities.some(activityMediaNeedsCapture)
  )
    return snapshot;
  return {
    ...snapshot,
    thread: {
      ...snapshot.thread,
      messages: yield* Effect.forEach(snapshot.thread.messages, (message) =>
        Effect.gen(function* () {
          const config = yield* ServerConfig;
          const store = contentAssetsAt(config.stateDir);
          const text = yield* captureConversationText(
            message.text,
            snapshot.thread.id,
            message.id,
            workspaceRoot,
            true,
          );
          const attachments = yield* Effect.forEach(message.attachments ?? [], (attachment) =>
            Effect.gen(function* () {
              if (
                attachment.type !== "image" ||
                ("asset" in attachment && attachment.asset !== undefined)
              )
                return attachment;
              const file = resolveAttachmentPathById({
                attachmentsDir: config.attachmentsDir,
                attachmentId: attachment.id,
              });
              const asset = yield* Effect.promise(() =>
                store.legacy([snapshot.thread.id, attachment.id], () =>
                  file === null
                    ? store.failure(
                        {
                          threadId: snapshot.thread.id,
                          ownerId: attachment.id,
                          name: attachment.name,
                          provenance: "legacy",
                        },
                        "source-missing",
                      )
                    : store.ingestFile(file, {
                        threadId: snapshot.thread.id,
                        ownerId: attachment.id,
                        name: attachment.name,
                        mimeType: attachment.mimeType,
                        provenance: "legacy",
                      }),
                ),
              );
              return { ...attachment, asset };
            }),
          );
          return { ...message, text, attachments };
        }),
      ),
      activities: yield* Effect.forEach(snapshot.thread.activities, (activity) =>
        captureActivityMedia(activity, snapshot.thread.id, workspaceRoot),
      ),
    },
  };
});
