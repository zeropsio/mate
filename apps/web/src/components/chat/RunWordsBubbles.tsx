import { use } from "react";

import { useKnownMate } from "../../zerops/useZeropsMates";
import { Bubble, META, SPEECH_PAD } from "./RunBubble";
import { keyedByOccurrence } from "./keyedByOccurrence";
import { TypingDots } from "./RunTypingDots";
import { DisclosureButton, OpensMark, OpensWhole, useDisclosure } from "./RunDisclosure";
import type { ChatMessage } from "../../types";
import ChatMarkdown, { MESSAGE_HEADING_LEVEL } from "../ChatMarkdown";
import { ChangeChipMomentContext } from "../zerops/ZeropsChangeLinkChip";
import { shouldPreserveAssistantLineBreaks, thoughtParagraphs } from "./MessagesTimeline.logic";
import { noteText, thinkingLine } from "./runCard.logic";
import { useEngineLiveMessage, useEngineLiveMessages } from "./useEngineLiveMessage";
import { TimelineRowCtx } from "./timelineContext";
import { InSlotContext } from "./runCardContext";

// ---------------------------------------------------------------------------
// The Mate's words and thoughts
// ---------------------------------------------------------------------------

/** A note of the Mate's, in full: its words as markdown, at the moment it said them. */
function NoteWords({ message }: { readonly message: ChatMessage }) {
  const ctx = use(TimelineRowCtx);
  return (
    <ChangeChipMomentContext value={message.createdAt}>
      <ChatMarkdown
        className="text-foreground"
        cwd={ctx.markdownCwd}
        headingLevelOffset={MESSAGE_HEADING_LEVEL}
        isStreaming={Boolean(message.streaming)}
        lineBreaks={shouldPreserveAssistantLineBreaks(message.text)}
        onOpenImage={ctx.onImageExpand}
        onRunShellCommand={ctx.onRunShellCommand}
        skills={ctx.skills}
        text={noteText(message.text, Boolean(message.streaming))}
        threadRef={ctx.threadRef ?? undefined}
      />
    </ChangeChipMomentContext>
  );
}

/**
 * A stretch of thinking, a paragraph at a time, each keyed where it stands, so
 * the ones written keep their place as the newest grows — the same shape
 * still coming and settled, so it never changes height as it ends.
 */
function ThoughtParagraphs({ messages }: { readonly messages: ReadonlyArray<ChatMessage> }) {
  const ctx = use(TimelineRowCtx);
  const inSlot = use(InSlotContext);
  const paragraphs = messages.flatMap((message) => {
    const said = thoughtParagraphs(message.text);
    return said.map((text, index) => ({
      key: `${message.id}:${index}`,
      text,
      streaming: Boolean(message.streaming) && index === said.length - 1,
    }));
  });
  return (
    <div className="grid gap-2.5">
      {paragraphs.map((paragraph) => (
        <ChatMarkdown
          key={paragraph.key}
          className={inSlot ? THOUGHT_NOW_TEXT : THOUGHT_TEXT}
          cwd={ctx.markdownCwd}
          headingLevelOffset={MESSAGE_HEADING_LEVEL}
          isStreaming={paragraph.streaming}
          skills={ctx.skills}
          text={paragraph.text}
          threadRef={ctx.threadRef ?? undefined}
        />
      ))}
    </div>
  );
}

/**
 * A question it asked the person with its question tool: its own words, in
 * its tint — the person's answer stands under it, in theirs.
 */
export function QuestionBubble({ questions }: { readonly questions: ReadonlyArray<string> }) {
  return (
    <Bubble className={SPEECH_PAD} kind="question" tone="speech">
      <OpensWhole what="question">
        {keyedByOccurrence(questions).map(({ key, value }) => (
          <p key={key} className="whitespace-pre-wrap break-words">
            {value}
          </p>
        ))}
      </OpensWhole>
    </Bubble>
  );
}

/**
 * Its words to the person on the way: the chat's bubble in its fullest fill,
 * in its item's box — the newest words in view while they stream, its head
 * in the log and the whole of them a press away.
 */
export function NoteBubble({ message: recorded }: { readonly message: ChatMessage }) {
  const message = useEngineLiveMessage(recorded);
  const inSlot = use(InSlotContext);
  const bubble = (
    <Bubble className={SPEECH_PAD} kind="note" tone="speech">
      <OpensWhole follows={Boolean(message.streaming)} stood={message.id} what="message" words>
        <NoteWords message={message} />
      </OpensWhole>
    </Bubble>
  );
  if (!inSlot) return bubble;
  // Words still being written say so beside their last line, outside the bubble: the dots follow
  // the words as they do after "Writing", on no text and no edge. Their seat is held while the
  // words stand in the working row, written or not, so the bubble is as wide when they end.
  return (
    <>
      {bubble}
      <span
        aria-hidden="true"
        // A seat the row holds, so the bubble is as wide and as tall when the words end: 8 px
        // after it, the dots' middle on the last line's x-height.
        className="ms-2 mb-2.25 flex h-[21px] w-[19px] flex-none items-center self-end *:flex-none *:origin-left *:scale-70"
        data-note-writing={message.streaming ? "" : undefined}
      >
        {message.streaming ? <TypingDots /> : null}
      </span>
    </>
  );
}

/** A thought's words in the log: the card's quiet size, 13 px on 20 px lines, in the muted ink. */
const THOUGHT_TEXT = "chat-markdown-aside text-muted-foreground text-line leading-5";
/** A thought as it is thought, in the working row: the prose size on 22 px lines, in ink. */
const THOUGHT_NOW_TEXT = "chat-markdown-aside text-foreground text-prose leading-5.5";

/**
 * An agent's thinking, in its box. On an automated Mate — GLM on OpenCode thinks out loud at
 * length, and people read a task's work for what it did — it stands as one quiet line,
 * "Thinking · 12 s", its words behind it.
 */
export function ThoughtBubble({
  messages: recorded,
}: {
  readonly messages: ReadonlyArray<ChatMessage>;
}) {
  const messages = useEngineLiveMessages(recorded);
  const ctx = use(TimelineRowCtx);
  const quiet = useKnownMate(ctx.activeThreadEnvironmentId)?.automated === true;
  const disclosure = useDisclosure();
  const text = messages.map((message) => message.text).join("\n\n");
  if (text.trim().length === 0) return null;
  const words = (
    <OpensWhole
      follows={messages.some((message) => message.streaming)}
      lines="thought"
      what="thought"
    >
      <ThoughtParagraphs messages={messages} />
    </OpensWhole>
  );
  if (!quiet)
    return (
      <Bubble kind="thought" size={META} tone="thought">
        {words}
      </Bubble>
    );
  const line = thinkingLine(messages);
  return (
    <Bubble kind="thought" size={META} tone="thought">
      <DisclosureButton
        label={`${line}. ${disclosure.open ? "Hide" : "Show"} the thought`}
        onToggle={disclosure.toggle}
        open={disclosure.open}
      >
        <span className="flex items-center gap-1.5 text-muted-foreground">
          {line}
          <OpensMark />
        </span>
      </DisclosureButton>
      {disclosure.open ? words : null}
    </Bubble>
  );
}
