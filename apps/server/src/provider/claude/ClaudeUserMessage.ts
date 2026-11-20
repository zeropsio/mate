import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ProviderInstanceId, ProviderSendTurnInput } from "@t3tools/contracts";
import {
  applyClaudePromptEffortPrefix,
  getModelSelectionStringOptionValue,
  resolvePromptInjectedEffort,
} from "@t3tools/shared/model";
import { ATTACHED_PICTURE_UNREADABLE } from "@t3tools/shared/threadStatus";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { placeClaudePictures } from "../../providerPictures.ts";
import {
  type ClaudeModelCatalog,
  getClaudeCatalogModelCapabilities,
} from "../ClaudeModelCatalog.ts";
import { planClaudeSkillDispatch, type ClaudeSkillTarget } from "../Drivers/ClaudeSkillDispatch.ts";
import { ProviderAdapterRequestError } from "../Errors.ts";
import { PROVIDER } from "./ClaudeSessionState.ts";

const SUPPORTED_CLAUDE_IMAGE_MIME_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function buildPromptText(
  input: ProviderSendTurnInput,
  boundInstanceId: ProviderInstanceId,
  catalog: ClaudeModelCatalog,
): string {
  const rawEffort =
    input.modelSelection?.instanceId === boundInstanceId
      ? getModelSelectionStringOptionValue(input.modelSelection, "effort")
      : null;
  const claudeModel =
    input.modelSelection?.instanceId === boundInstanceId ? input.modelSelection.model : undefined;
  const caps = getClaudeCatalogModelCapabilities(catalog, claudeModel);

  const promptEffort = resolvePromptInjectedEffort(caps, rawEffort);
  return applyClaudePromptEffortPrefix(input.input?.trim() ?? "", promptEffort);
}

function buildUserMessage(input: {
  readonly sdkContent: Array<Record<string, unknown>>;
}): SDKUserMessage {
  return {
    type: "user",
    session_id: "",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: input.sdkContent as unknown as SDKUserMessage["message"]["content"],
    },
  } as SDKUserMessage;
}

function buildClaudeImageContentBlock(input: {
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}): Record<string, unknown> {
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: input.mimeType,
      data: Buffer.from(input.bytes).toString("base64"),
    },
  };
}

export const buildUserMessageEffect = Effect.fn("buildUserMessageEffect")(function* (
  input: ProviderSendTurnInput,
  dependencies: {
    readonly fileSystem: FileSystem.FileSystem;
    readonly attachmentsDir: string;
    readonly boundInstanceId: ProviderInstanceId;
    readonly modelCatalog: ClaudeModelCatalog;
    /** The skills Claude Code can run for this session's cwd, by name. */
    readonly skills: ReadonlyMap<string, ClaudeSkillTarget>;
    /** Text the message leads with, ahead of everything the person sent. */
    readonly preface?: string | undefined;
  },
) {
  const text = buildPromptText(input, dependencies.boundInstanceId, dependencies.modelCatalog);
  const sdkContent: Array<Record<string, unknown>> = [];

  // Claude Code expands a skill only from the LAST text block, and only when
  // `/name` is its first character. A `$skill` chip anywhere in the prompt
  // therefore becomes [whole request, "/name trailing text"] so the CLI runs
  // it natively and the model still reads the full request. See ClaudeSkillDispatch.
  const dispatch = planClaudeSkillDispatch(text, dependencies.skills);
  if (dispatch?.leadingText !== undefined) {
    sdkContent.push({ type: "text", text: dispatch.leadingText });
  }

  for (const attachment of input.attachments ?? []) {
    // Claude ingests images only. Generic files reach the agent through the
    // path line ProviderService puts in the prompt.
    if (attachment.type !== "image") {
      continue;
    }

    if (!SUPPORTED_CLAUDE_IMAGE_MIME_TYPES.has(attachment.mimeType)) {
      return yield* new ProviderAdapterRequestError({
        provider: PROVIDER,
        method: "turn/start",
        detail: `Unsupported Claude image attachment type '${attachment.mimeType}'.`,
      });
    }

    const attachmentPath = resolveAttachmentPath({
      attachmentsDir: dependencies.attachmentsDir,
      attachment,
    });
    if (!attachmentPath) {
      return yield* new ProviderAdapterRequestError({
        provider: PROVIDER,
        method: "turn/start",
        detail: ATTACHED_PICTURE_UNREADABLE,
        cause: `Invalid attachment id '${attachment.id}'.`,
      });
    }

    const bytes = yield* dependencies.fileSystem.readFile(attachmentPath).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "turn/start",
            detail: ATTACHED_PICTURE_UNREADABLE,
            cause,
          }),
      ),
    );

    sdkContent.push(
      buildClaudeImageContentBlock({
        mimeType: attachment.mimeType,
        bytes,
      }),
    );
  }

  // The final text block goes last on purpose. The Claude CLI only reads a
  // streamed user message as a slash-command invocation when the last content
  // block is text; image blocks ahead of it ride along as preceding input.
  // Leading with the text made every image-carrying turn fall back to a plain
  // prompt, so a hand-typed `/skill args` reached the agent unexpanded.
  if (dispatch) {
    sdkContent.push({ type: "text", text: dispatch.commandText });
  } else if (text.length > 0) {
    sdkContent.push({ type: "text", text });
  }

  return buildUserMessage({
    sdkContent: [
      ...(dependencies.preface === undefined ? [] : [{ type: "text", text: dependencies.preface }]),
      ...placeClaudePictures(sdkContent),
    ],
  });
});
