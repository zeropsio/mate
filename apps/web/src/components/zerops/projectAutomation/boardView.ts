/**
 * The Board as its views draw it — the project page's short Board, the Board's own page and a
 * task's panel — every read already done and handed in, so the harness can draw it with no account.
 */
import type { BoardTaskOffer } from "@t3tools/client-runtime/data";

import type { BoardFace } from "~/zerops/useBoardTasks";

import type { BoardAnswerState } from "../board/BoardTaskRow";
import type { RowPress, SourceKind, SourceRow } from "./projectAutomation.logic";
import type { Board, BoardRow, PredictedBoard } from "./taskBoard.logic";

/** How many rows each lane will hold while the Board reads (`predictedBoard`); none, no lane. */
export interface Predicted extends PredictedBoard {
  /** The line that opens the ones that ended earlier. */
  readonly doneMore?: boolean | undefined;
}

/** What the reader may do with each task on the Board, and the presses; absent: a reader only. */
export interface BoardVerbs {
  /** The task's verbs as the rules offer them (`boardOffers`); `undefined`: none known. */
  readonly offerOf: (taskId: string) => BoardTaskOffer | undefined;
  /** A Mate of the reader's a Take may open in, by its project: its name. */
  readonly mateName: (projectId: string) => string;
  /** Where the task's press stands: its Stop asking, a write under way or refused (`taskRowPress`). */
  readonly pressOf: (taskId: string) => RowPress;
  /** HQ took it for the reader, but none of their Mate's conversations carries it (`strandedTakes`). */
  readonly strandedOf: (taskId: string) => boolean;
  /** Opens a stranded Take's conversation again, under the same task. */
  readonly onOpenTaken: (taskId: string) => void;
  readonly onAsk: (taskId: string) => void;
  readonly onKeep: () => void;
  readonly onStop: (taskId: string) => void;
  readonly onTake: (taskId: string, mateProjectId: string) => void;
  readonly onRelease: (taskId: string) => void;
  readonly onDone: (taskId: string) => void;
  /** Where its putter's answer stands (`boardAnswerState`), for a task answered on the Board. */
  readonly answerOf: (taskId: string) => BoardAnswerState;
  /** Its putter's answer, for a task answered on the Board (`BoardRow.answeredHere`). */
  readonly onAnswer: (taskId: string, text: string) => void;
  /** Drops one of a held task's needs that broke (`dropNeed`). */
  readonly onDropNeed: (taskId: string, neededId: string) => void;
}

/**
 * The Board as its views draw it: what HQ answered, or how its read stands (`reading`, with how
 * many rows navigation says each lane will hold, so the Board keeps its height when they land;
 * `none` where the reader may not read it).
 */
export interface BoardView {
  readonly read:
    | {
        readonly state: "reading";
        readonly predicted: Predicted;
      }
    | { readonly state: "known"; readonly board: Board }
    | { readonly state: "failed"; readonly words: string }
    | { readonly state: "none" };
  /** The organization's spend this month against its budget (`spendLine`); `null` unknown. */
  readonly spend: string | null;
  readonly onReadAgain: () => void;
  /** Opens a task's conversation or its change, by its in-app path. */
  readonly onOpen: (route: string) => void;
  /** Opens the conversation a task was put from. */
  readonly onOpenConversation?:
    | ((conversation: NonNullable<BoardRow["origin"]["conversation"]>) => void)
    | undefined;
  /** A Mate's face by its project: a pool Mate's, or a person's own; `undefined` unknown. */
  readonly faceOf?: ((projectId: string) => BoardFace | undefined) | undefined;
  readonly verbs?: BoardVerbs | undefined;
  /**
   * Picks a task: on the Board's page its panel opens beside the list; on the project page the
   * Board's page opens with it picked. `answer`: its answer field takes the focus as it opens.
   */
  readonly onPick?: ((taskId: string, answer?: boolean) => void) | undefined;
  /** The task whose panel stands open, on the Board's page; absent or `null`: none. */
  readonly selected?: string | null | undefined;
  /** Where picking a task leads, for a press opened elsewhere (a new tab); absent: in place only. */
  readonly pickHref?: ((taskId: string) => string) | undefined;
}

/** What an Owner or Admin does with the sources, on the Board's page. */
export interface SourceControls {
  /** A kind of source chosen from *Add*: its form. */
  readonly onTakeFrom: (kind: SourceKind) => void;
  /** A source's row, pressed: its form, where its Stop and its Delete are. */
  readonly onEdit: (row: SourceRow) => void;
  readonly onReadAgain: (source: Exclude<SourceKind, "github">) => void;
  readonly onOpenSettings: () => void;
}
