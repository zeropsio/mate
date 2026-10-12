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

import { MateMark } from "../../MateMark";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { SidebarWaitingPopover, type WaitingVerbs } from "../SidebarWaiting";
import { waitingSummary, type WaitingItem } from "../SidebarWaiting.logic";
import type { ChiefSetupRowState } from "./chiefTop.logic";
import { carryBandToChief } from "./chiefLitTravel";

export interface SidebarChiefRowProps {
  /** The state its mark wears, as its Mate's face would; at rest, its own idle and blinks. */
  readonly face?: MateMarkState | undefined;
  /** Its second line (`chiefRowLine`), drawn; none, and "Chief" stands alone. */
  readonly line?: ReactNode;
  /** Its conversation, or the Chief page, is the page open now. */
  readonly current: boolean;
  readonly onOpen: () => void;
  /** The organization's Mates: how many, and how many are at work. */
  readonly org?: ChiefOrg | undefined;
  /** What waits on the person, and what its list asks of the menu. */
  readonly waiting?:
    | { readonly items: ReadonlyArray<WaitingItem>; readonly verbs: WaitingVerbs }
    | undefined;
}

export function SidebarChiefRow({
  face,
  line,
  current,
  onOpen,
  waiting,
  org,
}: SidebarChiefRowProps) {
  const items = waiting?.items ?? [];
  const summary = items.length === 0 ? undefined : waitingSummary(items);
  // Under its name, live, as a Mate row's line is (the owner, 2026-10-12: "Ask about any project is
  // pretty mid"): what waits on the person, else how the organization's Mates stand; its setup's
  // line while it has one.
  const shown =
    line ??
    (summary !== undefined ? (
      <span className="menu-line2 menu-chief-asks truncate">
        {summary.more > 0 ? `${summary.words}, ${String(summary.more)} more` : summary.words}
      </span>
    ) : org === undefined ? null : (
      <span className="menu-line2 menu-ink-3 truncate">{chiefOrgLine(org)}</span>
    ));
  return (
    <div className="menu-top-chief" data-zerops-surface="sidebar-chief">
      <button
        aria-current={current ? "page" : undefined}
        className="menu-chief-row"
        data-current={current ? "" : undefined}
        data-lined=""
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
          </span>
          <span className="menu-chief-words">
            <span className="menu-chief-name" data-waiting-line="">
              Chief <span className="menu-chief-name-mate">Mate</span>
            </span>
            <span className="menu-chief-line">{shown}</span>
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
export function SidebarChiefTile({ face, line, current, onOpen, waiting }: SidebarChiefRowProps) {
  const items = waiting?.items ?? [];
  const summary = items.length === 0 ? undefined : waitingSummary(items);
  return (
    <div className="menu-rail-chief" data-zerops-surface="sidebar-chief">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              aria-current={current ? "page" : undefined}
              aria-label="Chief Mate"
              className="menu-rail-head"
              data-current={current ? "" : undefined}
              data-zerops-surface="sidebar-chief-row"
              onClick={onOpen}
              type="button"
            />
          }
        >
          <MateMark
            awake
            playful
            className="h-8.25 w-7"
            {...(face === undefined ? {} : { state: face })}
          />
        </TooltipTrigger>
        <TooltipPopup side="right">
          <span className="menu-rail-tip">
            <span className="menu-rail-tip-name">
              Chief <span className="menu-chief-name-mate">Mate</span>
            </span>
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

/** The organization's Mates as the Chief's line counts them. */
export interface ChiefOrg {
  readonly mates: number;
  readonly working: number;
}

/** How the organization's Mates stand, when nothing waits on the person. */
export function chiefOrgLine(org: ChiefOrg): string {
  const mates = `${String(org.mates)} Mate${org.mates === 1 ? "" : "s"}`;
  return org.working > 0
    ? `${String(org.working)} of ${mates} at work`
    : `All quiet across ${mates}`;
}
