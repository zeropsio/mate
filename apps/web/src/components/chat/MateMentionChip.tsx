import { createContext, type ReactNode } from "react";

import {
  findMateMentions,
  type MateMentionMatcher,
  type MentionableMate,
} from "../../zerops/mateMentions";
import {
  CHAT_INLINE_CHIP_LABEL_CLASS_NAME,
  CHAT_INLINE_MATE_CHIP_CLASS_NAME,
} from "../composerInlineChip";
import { MateFace } from "../zerops/primitives";

/**
 * The person's other Mates their own bubble draws as chips: given around a person's message only,
 * so the agent's words and every other markdown read nothing.
 */
export const MateMentionsContext = createContext<MateMentionMatcher | null>(null);

/** `text` with each `@Name` of one of the person's Mates drawn as that Mate; `rest` draws the words between. */
export function renderMateMentions(
  text: string,
  matcher: MateMentionMatcher | null,
  rest: (text: string, key: string) => ReactNode,
): ReactNode {
  const pieces = findMateMentions(text, matcher);
  if (pieces.length === 0) return rest(text, "0");
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const piece of pieces) {
    if (piece.start > cursor) nodes.push(rest(text.slice(cursor, piece.start), `t${cursor}`));
    const mate = piece.mates[0];
    if (mate !== undefined)
      nodes.push(<MateMentionChip key={`m${piece.start}`} mate={mate} source={piece.source} />);
    cursor = piece.end;
  }
  if (cursor < text.length) nodes.push(rest(text.slice(cursor), `t${cursor}`));
  return nodes;
}

/** A named Mate in a message: its face and name in its hue; copying gives back what was typed. */
function MateMentionChip(props: { readonly mate: MentionableMate; readonly source: string }) {
  return (
    <span className="inline-flex align-middle leading-none" data-markdown-copy={props.source}>
      <span className={CHAT_INLINE_MATE_CHIP_CLASS_NAME} data-mate-tint={props.mate.tint}>
        <MateFace size={16} state="idle" tint={props.mate.tint} shape={props.mate.shape} />
        <span className={CHAT_INLINE_CHIP_LABEL_CLASS_NAME}>{props.mate.name}</span>
      </span>
    </span>
  );
}
