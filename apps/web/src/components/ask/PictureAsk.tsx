/**
 * A Mate's picture ask (`picture-ask` fence) as its card: what the Mate set up, and its one press.
 * With Adobe Express on, the press opens the Express tab on it already set up, and the save goes
 * straight back to the Mate; anyone can answer with their own picture instead. Its progress is read
 * from the conversation, so a reload shows the same: answered, or passed once the person wrote
 * about something else, it shrinks to its title and one line, with nothing left to press.
 */
import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { createContext, type ReactNode, use, useMemo, useRef, useState } from "react";

import { useMateImage } from "~/assets/MateImages";
import type { ChatMessage } from "~/types";
import { useRightPanelStore } from "../../rightPanelStore";
import { useExpressOpen } from "../express/expressOpen";
import { useExpressGate } from "../express/useExpressGate";
import { Button } from "../ui/button";
import { AskCard, AskFooter, type AskStep, AskSteps } from "./AskCard";
import type { AskState } from "./ask.logic";
import {
  PICTURE_CANVASES,
  PICTURE_TOOLS,
  type PictureAsk,
  fileNameOf,
  parsePictureAsk,
  pictureAnswerName,
  pictureAnswersOf,
  pictureAnswerWords,
  pictureAskSteps,
  pictureAsksPassed,
} from "./pictureAsk.logic";

export interface PictureAskScope {
  /** The steps each ask has had answered (`pictureAnswersOf`). */
  readonly answers: ReadonlyMap<string, ReadonlySet<number>>;
  /** The asks the person moved past (`pictureAsksPassed`). */
  readonly passed: ReadonlySet<string>;
  /** Sends an answer's pictures with its words; `null` where the conversation takes none. */
  readonly answer: ((files: File[], words: string) => void) | null;
  readonly mate: string | undefined;
}

export const PictureAskContext = createContext<PictureAskScope>({
  answers: new Map(),
  passed: new Set(),
  answer: null,
  mate: undefined,
});

const NO_STEPS: ReadonlySet<number> = new Set();
const NO_ANSWERS: ReadonlyMap<string, ReadonlySet<number>> = new Map();
const NO_KEYS: ReadonlySet<string> = new Set();

/**
 * The conversation's picture asks as their cards read them: the steps answered and the asks
 * passed. The values change when one of those does, never on each word a Mate writes, so the
 * cards draw only then.
 */
export function usePictureAsks(messages: ReadonlyArray<ChatMessage> | undefined): {
  readonly answers: ReadonlyMap<string, ReadonlySet<number>>;
  readonly passed: ReadonlySet<string>;
} {
  const answers = useMemo(() => pictureAnswersOf(messages ?? []), [messages]);
  const passed = useMemo(() => pictureAsksPassed(messages ?? []), [messages]);
  const identity = [
    [...answers].map(([key, steps]) => `${key}:${[...steps].toSorted((a, b) => a - b).join(",")}`),
    [...passed].toSorted(),
  ].join("|");
  const [held, hold] = useState({ identity: "", answers: NO_ANSWERS, passed: NO_KEYS });
  if (identity !== held.identity) hold({ identity, answers, passed });
  return identity === held.identity ? held : { answers, passed };
}

/** A fence's card once its words are whole; words that set up no ask stay the code they are. */
export function PictureAskFence({
  code,
  isStreaming,
  threadRef,
  children,
}: {
  readonly code: string;
  readonly isStreaming: boolean;
  readonly threadRef: ScopedThreadRef | undefined;
  readonly children: ReactNode;
}) {
  const ask = useMemo(() => (isStreaming ? null : parsePictureAsk(code)), [code, isStreaming]);
  // Half-written JSON is nothing to read: the card appears once the Mate finished it.
  if (isStreaming) return null;
  if (ask === null || threadRef === undefined) return children;
  return (
    // The card sits in an answer's words; it keeps its own rhythm, not the answer's paragraphs.
    <div className="chat-markdown-island my-4 max-w-[34rem]">
      <PictureAskCard ask={ask} threadRef={threadRef} />
    </div>
  );
}

function PictureAskCard({
  ask,
  threadRef,
}: {
  readonly ask: PictureAsk;
  readonly threadRef: ScopedThreadRef;
}) {
  const { answers, passed, answer, mate } = use(PictureAskContext);
  const express = useExpressGate() === "on";
  const working = useExpressOpen((state) => state.working);
  const upload = useRef<HTMLInputElement>(null);
  const answered = answers.get(ask.key) ?? NO_STEPS;
  const steps = pictureAskSteps(ask);
  const next = Array.from({ length: steps }, (_, step) => step).find((step) => !answered.has(step));
  const name = mate ?? "this Mate";

  const open = (step: number) => {
    useRightPanelStore.getState().open(threadRef, "express");
    useExpressOpen.getState().request({ kind: "ask", ask, step });
  };
  const state: AskState =
    next === undefined
      ? {
          kind: "done",
          words: steps > 1 ? `${steps} pictures sent to ${name}` : `Sent to ${name}`,
          told: null,
        }
      : passed.has(ask.key)
        ? { kind: "replaced", words: "Not answered" }
        : working?.key === ask.key
          ? {
              kind: "working",
              words: `Finish in Adobe Express, then press Use for ${name}.`,
              pressed: null,
            }
          : { kind: "waiting" };
  const live = state.kind === "waiting" || state.kind === "working";
  const ownPicture = live && answer !== null && next !== undefined ? next : null;
  const main = !live
    ? null
    : express
      ? { label: expressPress(ask, answered.size), onPress: () => open(next!) }
      : ownPicture === null
        ? null
        : { label: "Upload a picture", onPress: () => upload.current?.click() };

  return (
    <AskCard
      askId={`picture:${ask.key}`}
      density="full"
      footer={
        <>
          <AskFooter
            also={
              express && ownPicture !== null ? (
                <Button onClick={() => upload.current?.click()} size="md" variant="secondary">
                  Use my own picture
                </Button>
              ) : undefined
            }
            density="full"
            main={main}
            state={state}
          />
          <input
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file === undefined || ownPicture === null || answer === null) return;
              const renamed = new File([file], pictureAnswerName(ask.key, ownPicture, file.name), {
                type: file.type,
              });
              answer([renamed], pictureAnswerWords(ask, ownPicture, { kind: "upload" }));
            }}
            ref={upload}
            type="file"
          />
        </>
      }
      kind="picture"
      state={state.kind}
      title={ask.title}
      where={null}
      why={live && ask.why !== undefined ? { who: name, words: ask.why } : null}
    >
      {live ? (
        <PictureAskBody answered={answered} ask={ask} next={next} threadRef={threadRef} />
      ) : null}
    </AskCard>
  );
}

/** The main press while Express is on: what opening it does. */
function expressPress(ask: PictureAsk, answered: number): string {
  switch (ask.kind) {
    case "generate":
      return "Generate in Adobe Express";
    case "design":
      return "Design in Adobe Express";
    case "edit":
      if (ask.pictures.length === 1) return "Edit in Adobe Express";
      return answered === 0 ? "Start in Adobe Express" : "Next picture in Adobe Express";
  }
}

function PictureAskBody({
  ask,
  answered,
  next,
  threadRef,
}: {
  readonly ask: PictureAsk;
  readonly answered: ReadonlySet<number>;
  readonly next: number | undefined;
  readonly threadRef: ScopedThreadRef;
}) {
  const picture = (path: string, size: "sm" | "lg") => (
    <AskPicture
      environmentId={threadRef.environmentId}
      path={path}
      size={size}
      threadId={threadRef.threadId}
    />
  );
  const goesTo = ask.target === undefined ? [] : [{ label: "Goes to", value: ask.target }];
  switch (ask.kind) {
    case "generate":
      return (
        <>
          <PictureWords label="Picture of" words={ask.prompt} />
          <PictureFacts
            picture={ask.styleLike === undefined ? null : picture(ask.styleLike, "lg")}
            rows={[
              { label: "Shape", value: ask.shape },
              ...(ask.styleLike === undefined
                ? []
                : [{ label: "Matches", value: fileNameOf(ask.styleLike) }]),
              ...goesTo,
            ]}
          />
        </>
      );
    case "edit": {
      const steps: AskStep[] = ask.pictures.map((path, step) => ({
        id: `${step}`,
        label: (
          <span className="inline-flex min-w-0 items-center gap-2 align-middle">
            {picture(path, "sm")}
            <span className="truncate">{fileNameOf(path)}</span>
          </span>
        ),
        state: answered.has(step) ? "done" : step === next ? "now" : "next",
        end: answered.has(step) ? "Sent" : undefined,
      }));
      return (
        <>
          <PictureFacts
            picture={null}
            rows={[{ label: "Edit", value: PICTURE_TOOLS[ask.tool] }, ...goesTo]}
          />
          <AskSteps steps={steps} />
        </>
      );
    }
    case "design":
      return (
        <>
          <PictureFacts
            picture={ask.startWith === undefined ? null : picture(ask.startWith, "lg")}
            rows={[
              ...(ask.canvas === undefined
                ? []
                : [{ label: "Size", value: PICTURE_CANVASES[ask.canvas] }]),
              ...(ask.startWith === undefined
                ? []
                : [{ label: "Starts with", value: fileNameOf(ask.startWith) }]),
              ...(ask.templates === undefined
                ? []
                : [{ label: "Templates", value: `“${ask.templates}”` }]),
              ...goesTo,
            ]}
          />
          {ask.words === undefined ? null : (
            <PictureWords copy label="Words for the design" words={ask.words} />
          )}
        </>
      );
  }
}

/** What the ask is set up with, beside the picture it starts from. */
function PictureFacts({
  picture,
  rows,
}: {
  readonly picture: ReactNode;
  readonly rows: ReadonlyArray<{ readonly label: string; readonly value: string }>;
}) {
  if (rows.length === 0 && picture === null) return null;
  return (
    <div className="flex min-w-0 items-start gap-3">
      {picture}
      <dl className="grid min-w-0 flex-1 grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 text-caption">
        {rows.map((row) => (
          <div className="contents" key={row.label}>
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0 break-words text-foreground">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Words the ask carries, under their name: the picture's description, or text to paste. */
function PictureWords({
  label,
  words,
  copy = false,
}: {
  readonly label: string;
  readonly words: string;
  readonly copy?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <figure className="grid min-w-0 gap-1">
      <figcaption className="flex min-h-7 items-center justify-between gap-3 text-caption text-muted-foreground">
        {label}
        {copy ? (
          <Button
            onClick={() =>
              void navigator.clipboard.writeText(words).then(
                () => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                },
                () => undefined,
              )
            }
            size="sm"
            variant="ghost"
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        ) : null}
      </figcaption>
      <div className="whitespace-pre-line border-foreground/15 border-s-2 ps-3 text-body text-foreground">
        {words}
      </div>
    </figure>
  );
}

/** A picture the ask names, small: what the Mate means at a glance. */
function AskPicture({
  environmentId,
  threadId,
  path,
  size,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly path: string;
  readonly size: "sm" | "lg";
}) {
  const { url } = useMateImage({
    environmentId,
    resource: { _tag: "media-file", threadId, path },
    // Twice the pixels it is drawn at: 32 or 72 px.
    rendition: size === "sm" ? { width: 64, height: 64 } : { width: 144, height: 144 },
  });
  return (
    <span
      className={
        size === "sm"
          ? "inline-block size-8 shrink-0 overflow-hidden rounded-md bg-muted"
          : "inline-block size-18 shrink-0 overflow-hidden rounded-lg bg-muted"
      }
    >
      {url === undefined ? null : (
        <img alt={fileNameOf(path)} className="size-full object-cover" src={url} />
      )}
    </span>
  );
}
