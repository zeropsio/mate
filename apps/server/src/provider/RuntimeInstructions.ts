import { CONTENT_CONTRACT } from "../contentContract.ts";
import { MAC_HOST_INSTRUCTIONS } from "../macHostInstructions.ts";

/**
 * Shared runtime context; omit model and effort when the harness manages them dynamically.
 * `modelName` is the display name users see in the model picker; `model` is the slug.
 * The Mate's content contract follows it, then, for a model that takes no image
 * input, how to verify without seeing, then how to work on a paired Mac.
 */
export function buildRuntimeInstructions(runtime: {
  readonly harness: string;
  readonly model?: string | undefined;
  readonly modelName?: string | undefined;
  readonly reasoningEffort?: string | undefined;
  /** `false` when the model reads no images; absent when it does or nobody says. */
  readonly imageInput?: boolean | undefined;
}): string {
  const harness = toSingleLine(runtime.harness);
  const model = toSingleLine(runtime.model ?? "");
  const modelName = toSingleLine(runtime.modelName ?? "");
  const effort = toSingleLine(runtime.reasoningEffort ?? "");
  const modelLabel =
    modelName && modelName !== model ? `${modelName} (model slug: ${model})` : model;
  const modelInfo = model && model !== "auto" && model !== "default" ? `, as ${modelLabel}` : "";
  const effortInfo = effort ? ` with ${effort} reasoning effort` : "";
  return `<runtime_info>In case you're asked: you are running in Zerops Mate through the ${harness} harness${modelInfo}${effortInfo}. No need to mention this otherwise. You can embed images and videos in your response using Markdown with absolute file paths.</runtime_info>\n${CONTENT_CONTRACT}\n${runtime.imageInput === false ? `${TEXT_ONLY_INSTRUCTIONS}\n` : ""}${MAC_HOST_INSTRUCTIONS}`;
}

/**
 * A text-only model's harness swaps every image for an error (OpenCode: "Cannot
 * read image"), so a screenshot is never evidence to it.
 */
const TEXT_ONLY_INSTRUCTIONS = `<image_input>Your model takes no image input: you cannot see images. A screenshot, a pasted picture or an image a tool returns reaches you as an error, never as its content.
- Verify a UI by text: zerops_browser get, is, find text and snapshot, its console and network output, and HTTP responses.
- Take a screenshot only to show the person, and caption it only with what that text evidence proves.
- Never say what an image shows, and never report a check as passed on an image. When a check needs eyes, say you could not look and ask the person to.
- When the person sends a picture, tell them you cannot see it and ask what it shows.
</image_input>`;

function toSingleLine(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}
