/**
 * The Chief, the menu's top row (`SidebarChromeHeader`'s brand): the bar's whole width, the
 * squares floating over its end. Its mark wears the Chief's state as a Mate's face does; "Chief";
 * and a second line only while it has something to say (`chiefRowLine`), the name centred in the
 * row otherwise. What waits on the person counts just left of the squares, its own door to the
 * list. The person with no Chief sees the same row, which opens the Chief page.
 */
import type { MateMarkState } from "@t3tools/shared/brand";
import { CircleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { useZeropsSessionOptional } from "~/zerops/ZeropsSessionProvider";

import { MateMark } from "../../MateMark";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { zeropsAccountDisplay } from "../landing/ZeropsAccountControl.logic";
import { MateDot } from "../MateDot";
import { MateOwnerMark } from "../MateOwnerMark";
import { ownerMark } from "../SidebarMateRow.logic";
import { SidebarWaitingPopover, type WaitingVerbs } from "../SidebarWaiting";
import { waitingSummary, type WaitingItem } from "../SidebarWaiting.logic";
import { chiefNameParts, type ChiefSetupRowState } from "./chiefTop.logic";
import { carryBandToChief } from "./chiefLitTravel";

export interface SidebarChiefRowProps {
  /** The state its mark wears, as its Mate's face would; at rest, its own idle and blinks. */
  readonly face?: MateMarkState | undefined;
  /** A result of it not seen (`MateRowView.unseen`): the unread dot on its mark's corner. */
  readonly unseen?: boolean | undefined;
  /** Its second line (`chiefRowLine`), drawn; none, and "Chief" stands alone. */
  readonly line?: ReactNode;
  readonly title?: string | undefined;
  /** Its conversation, or the Chief page, is the page open now. */
  readonly current: boolean;
  readonly onOpen: () => void;
  /** What waits on the person, and what its list asks of the menu. */
  readonly waiting?:
    | { readonly items: ReadonlyArray<WaitingItem>; readonly verbs: WaitingVerbs }
    | undefined;
}

/** The title, its noun whole: the words before "Chief" give way first in a narrow menu. */
function ChiefName({ title }: { readonly title: string }) {
  const { head, noun } = chiefNameParts(title);
  return (
    <span className="menu-chief-name" data-waiting-line="">
      {head === "" ? null : (
        <>
          <span className="menu-chief-name-head">{head}</span>{" "}
        </>
      )}
      <span className="menu-chief-name-noun">{noun}</span>
    </span>
  );
}

export function SidebarChiefRow({
  face,
  unseen = false,
  line,
  title,
  current,
  onOpen,
  waiting,
}: SidebarChiefRowProps) {
  const items = waiting?.items ?? [];
  const summary = items.length === 0 ? undefined : waitingSummary(items);
  // The person's own Chief, by their name and with their picture on its mark (the owner,
  // 2026-10-13: "Aleš's Chief Mate and combine it with avatar, no second line"); a line only while
  // its setup has one to say.
  const session = useZeropsSessionOptional();
  const account =
    session !== null && session.status === "signed-in" ? zeropsAccountDisplay(session.user) : null;
  const shown = line ?? null;
  return (
    <div className="menu-top-chief" data-zerops-surface="sidebar-chief">
      <button
        aria-current={current ? "page" : undefined}
        className="menu-chief-row"
        data-current={current ? "" : undefined}
        data-lined={shown === null ? undefined : ""}
        data-waits={summary === undefined ? undefined : ""}
        data-zerops-surface="sidebar-chief-row"
        onClick={(event) => {
          // Lit at once, over its own hover, as a Mate's row is (`slideSelectedBandTo`), until its
          // conversation is the open one; the band, where a Mate's stood, travels up into it.
          const row = event.currentTarget;
          if (row.dataset["current"] === undefined) carryBandToChief();
          row.dataset["pressed"] = "";
          setTimeout(() => {
            delete row.dataset["pressed"];
          }, 600);
          onOpen();
        }}
        type="button"
      >
        <span aria-hidden="true" className="menu-chief-lit" />
        <span className="menu-chief-body">
          <span className="menu-chief-mark" aria-hidden="true">
            <MateMark
              awake
              playful
              className="h-9 w-7.5"
              {...(face === undefined ? {} : { state: face })}
            />
            {unseen ? (
              <MateDot place="corner" surface="sidebar-chief-unread" tone="unread" />
            ) : null}
            {account === null ? null : (
              <MateOwnerMark
                seat={{
                  kind: "person",
                  mark: ownerMark({
                    name: account.fullName ?? account.name,
                    initials: account.initials,
                    avatarUrl: account.avatarUrl,
                  }),
                }}
              />
            )}
          </span>
          <span className="menu-chief-words">
            <ChiefName
              title={title ?? (account === null ? "Chief Mate" : `${account.name}'s Chief Mate`)}
            />
            {shown === null ? null : <span className="menu-chief-line">{shown}</span>}
          </span>
        </span>
      </button>
      {waiting === undefined || summary === undefined ? null : (
        <SidebarWaitingPopover
          items={items}
          trigger={
            <button
              aria-label={`${String(items.length)} waiting on you: ${summary.words}${summary.more > 0 ? `, ${String(summary.more)} more` : ""}`}
              className="menu-chief-count"
              data-waiting-trigger=""
              data-zerops-surface="sidebar-waiting"
              type="button"
            />
          }
          verbs={waiting.verbs}
        >
          <span data-zerops-surface="sidebar-waiting-count">{items.length}</span>
        </SidebarWaitingPopover>
      )}
    </div>
  );
}

/**
 * The Chief on the closed menu's rail, in Overview's old place: its mark as a tile, wearing its
 * state, what waits on the person counted on its corner; its name and line in its card.
 */
export function SidebarChiefTile({
  face,
  unseen = false,
  line,
  title,
  current,
  onOpen,
  waiting,
}: SidebarChiefRowProps) {
  const items = waiting?.items ?? [];
  const summary = items.length === 0 ? undefined : waitingSummary(items);
  return (
    <div className="menu-rail-chief" data-zerops-surface="sidebar-chief">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              aria-current={current ? "page" : undefined}
              aria-label={title ?? "Chief Mate"}
              className="menu-rail-head"
              data-current={current ? "" : undefined}
              data-zerops-surface="sidebar-chief-row"
              onClick={onOpen}
              type="button"
            />
          }
        >
          <span className="relative flex">
            <MateMark
              awake
              playful
              className="h-8.25 w-7"
              {...(face === undefined ? {} : { state: face })}
            />
            {unseen ? (
              <MateDot place="corner" surface="sidebar-chief-unread" tone="unread" />
            ) : null}
          </span>
        </TooltipTrigger>
        <TooltipPopup side="right">
          <span className="menu-rail-tip">
            <span className="menu-rail-tip-name">{title ?? "Chief Mate"}</span>
            {line === undefined || line === null ? null : (
              <span className="menu-rail-tip-line">{line}</span>
            )}
          </span>
        </TooltipPopup>
      </Tooltip>
      {waiting === undefined || summary === undefined ? null : (
        <SidebarWaitingPopover
          items={items}
          trigger={
            <button
              aria-label={`${String(items.length)} waiting on you: ${summary.words}${summary.more > 0 ? `, ${String(summary.more)} more` : ""}`}
              className="menu-rail-count"
              data-waiting-trigger=""
              data-zerops-surface="sidebar-waiting"
              type="button"
            />
          }
          verbs={waiting.verbs}
        >
          <span data-zerops-surface="sidebar-waiting-count">{items.length}</span>
        </SidebarWaitingPopover>
      )}
    </div>
  );
}

const SETUP_WORDS: Readonly<Record<ChiefSetupRowState, string>> = {
  running: "Being set up",
  stopped: "Setting up stopped",
  unfinished: "Finish its setup",
};

/**
 * Its line before it is up: its setup running, muted; stopped, in the attention ink with its mark,
 * as a Mate's that did not come; or waiting on the person to finish it, in ink.
 */
export function ChiefSetupRowLine({ state }: { readonly state: ChiefSetupRowState }) {
  return (
    <span
      className={cn(
        "menu-line2 truncate",
        state === "running"
          ? "text-muted-foreground"
          : state === "stopped"
            ? "text-status-attention-text"
            : "text-sidebar-foreground",
      )}
      data-chief-setup={state}
      data-zerops-surface="sidebar-chief-setup"
    >
      {state === "stopped" ? (
        <CircleAlertIcon aria-hidden="true" className="mr-1 inline size-3" />
      ) : null}
      {SETUP_WORDS[state]}
    </span>
  );
}
