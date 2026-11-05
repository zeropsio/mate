/**
 * A Mate's picture ask (`picture-ask` fence) as its card: what the Mate set up, and its one press.
 * With Adobe Express on, the press opens the Express tab on it already set up, and the save goes
 * straight back to the Mate; anyone can answer with their own picture instead. Its progress is read
 * from the pictures the conversation holds, so a reload shows the same.
 */
import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { createContext, type ReactNode, use, useMemo, useRef, useState } from "react";

import { useMateImage } from "~/assets/MateImages";
import type { ChatMessage } from "~/types";
import { useRightPanelStore } from "../../rightPanelStore";
import { useExpressOpen } from "../express/expressOpen";
import { useExpressGate } from "../express/useExpressGate";
import { Button } from "../ui/button";
import { AskCard, AskFacts, AskFooter, type AskStep, AskSteps } from "./AskCard";
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
} from "./pictureAsk.logic";

export interface PictureAskScope {
  /** The steps each ask has had answered (`pictureAnswersOf`). */
  readonly answers: ReadonlyMap<string, ReadonlySet<number>>;
  /** Sends an answer's pictures with its words; `null` where the conversation takes none. */
  readonly answer: ((files: File[], words: string) => void) | null;
  readonly mate: string | undefined;
}

export const PictureAskContext = createContext<PictureAskScope>({
  answers: new Map(),
  answer: null,
  mate: undefined,
});

const NO_STEPS: ReadonlySet<number> = new Set();
const NO_ANSWERS: ReadonlyMap<string, ReadonlySet<number>> = new Map();

/**
 * The conversation's answered picture ask steps. The value changes when an answer does, never on
 * each word a Mate writes, so the cards draw only then.
 */
export function usePictureAnswers(
  messages: ReadonlyArray<ChatMessage> | undefined,
): ReadonlyMap<string, ReadonlySet<number>> {
  const answers = useMemo(() => pictureAnswersOf(messages ?? []), [messages]);
  const identity = [...answers]
    .map(([key, steps]) => `${key}:${[...steps].toSorted((a, b) => a - b).join(",")}`)
    .join(";");
  const [held, hold] = useState({ identity: "", answers: NO_ANSWERS });
  if (identity !== held.identity) hold({ identity, answers });
  return identity === held.identity ? held.answers : answers;
}
/** A picture beside its line: 40 px at twice the pixels. */
const THUMB = { width: 80, height: 80 } as const;

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
  return <PictureAskCard ask={ask} threadRef={threadRef} />;
}

function PictureAskCard({
  ask,
  threadRef,
}: {
  readonly ask: PictureAsk;
  readonly threadRef: ScopedThreadRef;
}) {
  const { answers, answer, mate } = use(PictureAskContext);
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
      : working?.key === ask.key
        ? {
            kind: "working",
            words: `Finish in Adobe Express, then press Use for ${name}.`,
            pressed: null,
          }
        : { kind: "waiting" };
  const ownPicture = answer === null || next === undefined ? null : next;
  const main =
    next === undefined
      ? null
      : express
        ? { label: expressPress(ask, answered.size), onPress: () => open(next) }
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
      where={{ scope: "mate", detail: ask.target ?? null }}
      why={ask.why === undefined ? null : { who: name, words: ask.why }}
    >
      <PictureAskBody answered={answered} ask={ask} next={next} threadRef={threadRef} />
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
  const picture = (path: string) => (
    <AskPicture environmentId={threadRef.environmentId} path={path} threadId={threadRef.threadId} />
  );
  switch (ask.kind) {
    case "generate":
      return (
        <>
          <p className="text-body text-foreground" data-picture-prompt>
            {ask.prompt}
          </p>
          <AskFacts
            rows={[
              { label: "Shape", value: ask.shape },
              ...(ask.styleLike === undefined
                ? []
                : [{ label: "Style like", value: fileNameOf(ask.styleLike) }]),
            ]}
          />
          {ask.styleLike === undefined ? null : picture(ask.styleLike)}
        </>
      );
    case "edit": {
      const steps: AskStep[] = ask.pictures.map((path, step) => ({
        id: `${step}`,
        label: (
          <span className="inline-flex min-w-0 items-center gap-2 align-middle">
            {picture(path)}
            <span className="truncate font-mono text-caption">{fileNameOf(path)}</span>
          </span>
        ),
        state: answered.has(step) ? "done" : step === next ? "now" : "next",
        end: answered.has(step) ? "Sent" : undefined,
      }));
      return (
        <>
          <p className="text-caption text-muted-foreground">{PICTURE_TOOLS[ask.tool]}</p>
          <AskSteps steps={steps} />
        </>
      );
    }
    case "design":
      return (
        <>
          <AskFacts
            rows={[
              ...(ask.templates === undefined
                ? []
                : [{ label: "Templates", value: ask.templates }]),
              ...(ask.canvas === undefined
                ? []
                : [{ label: "Size", value: PICTURE_CANVASES[ask.canvas] }]),
              ...(ask.startWith === undefined
                ? []
                : [{ label: "Starts with", value: fileNameOf(ask.startWith) }]),
            ]}
          />
          {ask.startWith === undefined ? null : picture(ask.startWith)}
          {ask.words === undefined ? null : <DesignWords words={ask.words} />}
        </>
      );
  }
}

/** Words for the design, with a copy for pasting into it. */
function DesignWords({ words }: { readonly words: string }) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <p className="min-w-0 flex-1 text-body">{words}</p>
      <Button
        onClick={() => void navigator.clipboard.writeText(words).catch(() => undefined)}
        size="sm"
        variant="secondary"
      >
        Copy
      </Button>
    </div>
  );
}

/** A picture the ask names, small: what the Mate means at a glance. */
function AskPicture({
  environmentId,
  threadId,
  path,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly path: string;
}) {
  const { url } = useMateImage({
    environmentId,
    resource: { _tag: "media-file", threadId, path },
    rendition: THUMB,
  });
  return (
    <span className="inline-block size-10 shrink-0 overflow-hidden rounded-md bg-muted">
      {url === undefined ? null : (
        <img alt={fileNameOf(path)} className="size-full object-cover" src={url} />
      )}
    </span>
  );
}
