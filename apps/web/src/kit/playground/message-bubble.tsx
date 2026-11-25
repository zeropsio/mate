import { MATE_TINT_IDS } from "@t3tools/shared/brand";

import { MessageBubble } from "~/components/ui/message-bubble";

import { definePlayground, jsxElement } from "../kitPlayground";

export default definePlayground({
  section: "message-bubble",
  name: "MessageBubble",
  imports: 'import { MessageBubble } from "~/components/ui/message-bubble";',
  controls: {
    speaker: {
      kind: "enum",
      options: ["person", "mate", "another-mate"],
      note: "who said it: the person, a Mate in its run, another Mate on the page",
    },
    tint: { kind: "enum", options: MATE_TINT_IDS, note: "a Mate's own hue" },
    queued: { kind: "boolean", note: "the person's words waiting for the running turn" },
    words: { kind: "text" },
  },
  initial: {
    speaker: "person",
    tint: "violet",
    queued: false,
    words: "Can you put the pricing page live once the tests pass?",
  },
  render: ({ speaker, tint, queued, words }) => (
    <div className="flex w-96 justify-end">
      <MessageBubble
        className={speaker === "person" ? "max-w-4/5" : undefined}
        queued={queued}
        speaker={speaker}
        tint={speaker === "person" ? undefined : tint}
      >
        {words}
      </MessageBubble>
    </div>
  ),
  jsx: ({ speaker, tint, queued, words }) =>
    jsxElement(
      "MessageBubble",
      { speaker, ...(speaker === "person" ? { queued } : { tint }) },
      words,
      { speaker: "person", queued: false },
    ),
  usage: {
    do: [
      "Draw every message a person or a Mate said with it, in its speaker's form.",
      "Give a Mate's bubble its tint, or stand it where --mate-tint is set.",
    ],
    dont: [
      "Draw a message's ground, edge or round by hand.",
      "Put a Mate's working rows (what it did, what it thought) in a bubble.",
    ],
  },
});
