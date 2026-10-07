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
import { projectActivityPayload } from "../orchestration/ActivityPayloadProjection.ts";
import { resolveAttachmentPathById } from "../attachmentStore.ts";
import { mediaMimeTypeFromExtension } from "@t3tools/shared/filePreview";
import { contentAssetsAt } from "./ContentAssets.ts";
import { findRetainedMedia, retainedMediaDirectory } from "./RetainedMedia.ts";

/** Capture only locally authored images. External URLs remain external. */
export const captureConversationText = Effect.fn("captureConversationText")(function* (
  text: string,
  threadId: ThreadId,
  ownerId: string,
  workspaceRoot: string,
  legacy = false,
) {
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

export const captureActivityMedia = Effect.fn("captureActivityMedia")(function* (
  activity: OrchestrationThreadDetailSnapshot["thread"]["activities"][number],
  threadId: ThreadId,
  workspaceRoot: string,
) {
  const config = yield* ServerConfig;
  const store = contentAssetsAt(config.stateDir);
  const owner = { threadId: threadId, ownerId: activity.id, provenance: "capture" as const };
  const capture = async (value: unknown): Promise<unknown> => {
    if (Array.isArray(value)) return Promise.all(value.map(capture));
    if (!value || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    if (
      typeof record.mimeType === "string" &&
      record.mimeType.startsWith("image/") &&
      typeof record.data === "string"
    ) {
      const asset = await store.legacy([threadId, activity.id, record.data], () =>
        store.ingestBytes(Buffer.from(record.data as string, "base64"), {
          ...owner,
          name: "tool-image",
          mimeType: record.mimeType as string,
        }),
      );
      return {
        mimeType: record.mimeType,
        asset,
        ...(asset.original.status === "ready"
          ? { width: asset.original.width, height: asset.original.height }
          : {}),
      };
    }
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record)) {
      if (key === "imagePath" && typeof item === "string" && !item.startsWith("mate-asset:")) {
        const asset = await store.legacy([threadId, activity.id, item], () =>
          store.ingestFile(NodePath.resolve(workspaceRoot, item), {
            ...owner,
            name: NodePath.basename(item),
          }),
        );
        result[key] =
          `mate-asset:${asset.id}${asset.original.status === "failed" ? `:${asset.original.code}` : ""}`;
      } else result[key] = await capture(item);
    }
    return result;
  };
  return { ...activity, payload: yield* Effect.promise(() => capture(activity.payload)) };
});

export const backfillThreadMedia = Effect.fn("backfillThreadMedia")(function* (
  snapshot: OrchestrationThreadDetailSnapshot,
  workspaceRoot: string,
) {
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
        captureActivityMedia(projectActivityPayload(activity), snapshot.thread.id, workspaceRoot),
      ),
    },
  };
});
