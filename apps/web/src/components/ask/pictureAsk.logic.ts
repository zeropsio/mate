/**
 * A picture a Mate asks the person for, set up in its answer as a `picture-ask` fence: one to make
 * from words, pictures to edit, or a design. The conversation draws it as an ask. A person with
 * Adobe Express opens it there already set up (the prompt, the shape, a picture to match or start
 * from, the editing tool, a template search); anyone can answer with their own picture. What comes
 * back is the person's next message, its pictures named for the ask and the step they answer, so
 * the card reads its progress from the conversation itself.
 */
import type { ChatMessage } from "~/types";

export type PictureShape = "square" | "portrait" | "landscape" | "widescreen";
const SHAPES: ReadonlySet<string> = new Set(["square", "portrait", "landscape", "widescreen"]);

/** The editing tools an edit can open on, in Adobe's names, and the words the card says. */
export const PICTURE_TOOLS = {
  "remove-background": "Remove the background",
  "gen-fill": "Generative fill",
  "remove-object": "Remove an object",
  "insert-object": "Insert an object",
  "crop-image": "Crop",
  "resize-image": "Resize",
  "auto-enhance": "Enhance",
  erase: "Erase",
} as const;
export type PictureTool = keyof typeof PICTURE_TOOLS;

/** The places in an app a design can be made for, and the words the card says. */
export const PICTURE_CANVASES = {
  "link-preview": "Link preview, 1200 × 630",
  "page-banner": "Page banner, 1920 × 640",
  "email-header": "Email header, 600 × 200",
  logo: "Logo, 500 × 500",
} as const;
export type PictureCanvas = keyof typeof PICTURE_CANVASES;

/** An edit names a handful of pictures, one press each. */
const MOST_PICTURES = 12;
const LONGEST_TEXT = 2000;

interface PictureAskHead {
  /** The ask's name in its conversation: the same fence is the same ask. */
  readonly key: string;
  /** A verb and its subject: "Make the homepage hero". */
  readonly title: string;
  readonly why: string | undefined;
  /** Where the Mate puts what comes back: a file, a folder. */
  readonly target: string | undefined;
}

export type PictureAsk = PictureAskHead &
  (
    | {
        readonly kind: "generate";
        readonly prompt: string;
        readonly shape: PictureShape;
        /** A picture the new one should look like. */
        readonly styleLike: string | undefined;
      }
    | {
        readonly kind: "edit";
        readonly tool: PictureTool;
        readonly pictures: ReadonlyArray<string>;
      }
    | {
        readonly kind: "design";
        /** What Adobe's template search starts on. */
        readonly templates: string | undefined;
        readonly canvas: PictureCanvas | undefined;
        /** A picture placed on the canvas: a screenshot the Mate took. */
        readonly startWith: string | undefined;
        /** Words for the design, for the person to paste. */
        readonly words: string | undefined;
      }
  );

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed.slice(0, LONGEST_TEXT);
}

function isKey<T extends object>(table: T, value: unknown): value is keyof T {
  return typeof value === "string" && Object.hasOwn(table, value);
}

/** A short name for a fence's words, the same each time they are read. */
function keyOf(source: string): string {
  let hash = 5381;
  for (let index = 0; index < source.length; index++) {
    hash = ((hash << 5) + hash + source.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/** The ask a `picture-ask` fence sets up, or `null` for words that set up none. */
export function parsePictureAsk(source: string): PictureAsk | null {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const fields = raw as Record<string, unknown>;
  const title = text(fields.title);
  if (title === undefined) return null;
  const head = {
    key: keyOf(source.trim()),
    title,
    why: text(fields.why),
    target: text(fields.for),
  };
  switch (fields.do) {
    case "generate": {
      const prompt = text(fields.prompt);
      if (prompt === undefined) return null;
      const shape =
        typeof fields.shape === "string" && SHAPES.has(fields.shape)
          ? (fields.shape as PictureShape)
          : "landscape";
      return { ...head, kind: "generate", prompt, shape, styleLike: text(fields.styleLike) };
    }
    case "edit": {
      if (!isKey(PICTURE_TOOLS, fields.tool) || !Array.isArray(fields.pictures)) return null;
      const pictures = fields.pictures
        .map(text)
        .filter((picture): picture is string => picture !== undefined)
        .slice(0, MOST_PICTURES);
      if (pictures.length === 0) return null;
      return { ...head, kind: "edit", tool: fields.tool, pictures };
    }
    case "design":
      return {
        ...head,
        kind: "design",
        templates: text(fields.templates),
        canvas: isKey(PICTURE_CANVASES, fields.size) ? fields.size : undefined,
        startWith: text(fields.startWith),
        words: text(fields.words),
      };
    default:
      return null;
  }
}

/** How many presses the ask takes: one per picture to edit, else one. */
export function pictureAskSteps(ask: PictureAsk): number {
  return ask.kind === "edit" ? ask.pictures.length : 1;
}

/** The picture a step starts from, if it starts from one. */
export function pictureAskSource(ask: PictureAsk, step: number): string | undefined {
  switch (ask.kind) {
    case "generate":
      return ask.styleLike;
    case "edit":
      return ask.pictures[step];
    case "design":
      return ask.startWith;
  }
}

export const fileNameOf = (path: string) => path.split(/[\\/]/u).findLast(Boolean) ?? path;

const ANSWER = /^ask-([a-z0-9]+)-(\d+)-/u;

/** A picture's name as it answers a step: the ask and the step lead, then its own name. */
export function pictureAnswerName(key: string, step: number, name: string): string {
  return `ask-${key}-${step}-${name}`;
}

/** The ask and step a picture's name answers, or `null` for any other picture. */
export function pictureAnswerOf(
  name: string,
): { readonly key: string; readonly step: number } | null {
  const match = ANSWER.exec(name);
  return match === null ? null : { key: match[1]!, step: Number(match[2]) };
}

/** Where the answer came from, for the words the Mate is sent. */
export type PictureAnswerSource =
  | { readonly kind: "express"; readonly prompt: string | undefined }
  | { readonly kind: "upload" };

/** The words sent with an answer's picture: what it is, where it goes, what it came from. */
export function pictureAnswerWords(
  ask: PictureAsk,
  step: number,
  source: PictureAnswerSource,
): string {
  const from = source.kind === "express" ? " from Adobe Express" : "";
  const target = ask.target === undefined ? "" : ` It goes to ${ask.target}.`;
  switch (ask.kind) {
    case "generate": {
      const prompt =
        source.kind === "express" && source.prompt !== undefined && source.prompt !== ask.prompt
          ? ` I changed the prompt to: ${source.prompt}`
          : "";
      return `Here's the picture for “${ask.title}”${from}.${target}${prompt}`;
    }
    case "edit": {
      const picture = ask.pictures[step] ?? "";
      const count = ask.pictures.length > 1 ? ` (${step + 1} of ${ask.pictures.length})` : "";
      return `Here's ${fileNameOf(picture)}${from}, edited: ${PICTURE_TOOLS[ask.tool].toLowerCase()}${count}. Its source is ${picture}.${target}`;
    }
    case "design":
      return `Here's the design for “${ask.title}”${from}.${target}`;
  }
}

// A conversation's messages keep their identity until they change: only a changed one is read again.
const read = new WeakMap<ChatMessage, ReadonlyArray<{ key: string; step: number }>>();

/** The steps each ask has had answered in a conversation, by the pictures the person sent. */
export function pictureAnswersOf(
  messages: ReadonlyArray<ChatMessage>,
): ReadonlyMap<string, ReadonlySet<number>> {
  const answers = new Map<string, Set<number>>();
  for (const message of messages) {
    if (message.role !== "user") continue;
    let answered = read.get(message);
    if (answered === undefined) {
      answered = (message.attachments ?? []).flatMap((attachment) => {
        const answer = pictureAnswerOf(attachment.name);
        return answer === null ? [] : [answer];
      });
      read.set(message, answered);
    }
    for (const { key, step } of answered) {
      const steps = answers.get(key) ?? new Set<number>();
      steps.add(step);
      answers.set(key, steps);
    }
  }
  return answers;
}
