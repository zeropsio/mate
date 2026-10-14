/**
 * The menu's top row as the menu mounts it: the person's Chief once it is listed, read as the
 * list's row would read it (`MenuMateLine`), else the same row with its setup's line. Its press
 * opens the Chief's conversation, or the Chief page while there is none to open (`chiefRowOpens`).
 * The closed menu's rail draws the same Chief as a tile.
 */
import type { MateComing } from "@t3tools/client-runtime/data";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";

import { MenuMateLine } from "../SidebarZeropsTree";
import { chiefRowLine, chiefRowOpens } from "./chiefTop.logic";
import {
  ChiefSetupRowLine,
  SidebarChiefRow,
  SidebarChiefTile,
  type SidebarChiefRowProps,
} from "./SidebarChiefRow";

export function SidebarChiefTop<T extends ZeropsCandidate>({
  chief,
  coming,
  conversationsRead,
  timestampFormat,
  setup,
  unfinished,
  currentMate,
  currentPage,
  onOpenMate,
  onOpenPage,
  waiting,
  tile = false,
  offer = false,
}: {
  /** The person's own Chief among the listed Mates; undefined while it is not listed. */
  readonly chief: T | undefined;
  readonly coming: MateComing | undefined;
  readonly conversationsRead: boolean;
  readonly timestampFormat: TimestampFormat;
  /** `chiefSetupLine`. */
  readonly setup: "offer" | "running" | "stopped" | null;
  /** Its Chief stands without its access (`useChiefUnfinished`). */
  readonly unfinished: boolean;
  /** The Chief's conversation is open. */
  readonly currentMate: boolean;
  /** The Chief page is open. */
  readonly currentPage: boolean;
  readonly onOpenMate: (chief: T) => void;
  readonly onOpenPage: () => void;
  readonly waiting: SidebarChiefRowProps["waiting"];
  /** Drawn as the closed menu's rail draws it (`SidebarChiefTile`). */
  readonly tile?: boolean;
  readonly offer?: boolean;
}) {
  const Row = tile ? SidebarChiefTile : SidebarChiefRow;
  if (chief === undefined) {
    const line = chiefRowLine({ setup, unfinished: false, mate: undefined });
    return (
      <Row
        current={currentPage}
        title={offer ? "Set up your Chief" : undefined}
        line={
          offer ? (
            "Across this organization"
          ) : line?.kind === "setup" ? (
            <ChiefSetupRowLine state={line.state} />
          ) : undefined
        }
        onOpen={onOpenPage}
        waiting={waiting}
      />
    );
  }
  return (
    <MenuMateLine
      candidate={chief}
      coming={coming}
      conversationsRead={conversationsRead}
      timestampFormat={timestampFormat}
    >
      {(read) => {
        const line = chiefRowLine({ setup, unfinished, mate: read });
        const opens = chiefRowOpens({ listed: true, line });
        return (
          <Row
            current={currentPage || currentMate}
            face={read.face}
            // Its words live in its conversation; the row says only what its setup needs.
            line={line?.kind === "setup" ? <ChiefSetupRowLine state={line.state} /> : undefined}
            onOpen={opens === "mate" ? () => onOpenMate(chief) : onOpenPage}
            waiting={waiting}
          />
        );
      }}
    </MenuMateLine>
  );
}
