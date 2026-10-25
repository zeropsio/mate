/**
 * The Chief, the menu's top row (`SidebarChromeHeader`'s brand): the bar's whole width, the
 * squares floating over its end. Its mark wears the Chief's state as a Mate's face does; "Chief";
 * and a second line only while it has something to say (`chiefRowLine`), the name centred in the
 * row otherwise. What waits on the person counts just left of the squares, its own door to the
 * list. While its setup runs the same row opens the Chief page; before that there is no row.
 */
import type { MateMarkState } from "@t3tools/shared/brand";
import { Link } from "@tanstack/react-router";
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
import { SidebarWaitingCount, type WaitingVerbs } from "../SidebarWaiting";
import type { WaitingItem } from "../SidebarWaiting.logic";
import { chiefNameParts, type ChiefSetupRowState } from "./chiefTop.logic";
import { carryBandToChief } from "./chiefLitTravel";

export interface SidebarChiefRowProps {
  /** The state its mark wears, as its Mate's face would; at rest, its own idle and blinks. */
  readonly face?: MateMarkState | undefined;
  /** A result of it not seen (`MateRowView.unseen`): the unread dot on its mark's corner. */
  readonly unseen?: boolean | undefined;
  /** Its second line (`chiefRowLine`), drawn; none, and "Chief" stands alone. */
  readonly line?: ReactNode;
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
  current,
  onOpen,
  waiting,
}: SidebarChiefRowProps) {
  const items = waiting?.items ?? [];
  // The person's own Chief, by their name and with their picture on its mark (the owner,
  // 2026-10-13: "Aleš's Chief Mate and combine it with avatar, no second line"); a line only while
  // its setup has one to say.
  const account = useSignedInAccount();
  const shown = line ?? null;
  return (
    <div className="menu-top-chief" data-zerops-surface="sidebar-chief">
      <button
        aria-current={current ? "page" : undefined}
        className="menu-chief-row"
        data-current={current ? "" : undefined}
        data-lined={shown === null ? undefined : ""}
        data-waits={items.length === 0 ? undefined : ""}
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
            <ChiefName title={chiefRowName(account)} />
            {shown === null ? null : <span className="menu-chief-line">{shown}</span>}
          </span>
        </span>
      </button>
      {waiting === undefined || items.length === 0 ? null : (
        <SidebarWaitingCount className="menu-chief-count" items={items} verbs={waiting.verbs} />
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
  current,
  onOpen,
  waiting,
}: SidebarChiefRowProps) {
  const items = waiting?.items ?? [];
  // Named as its row names it: one name on the rail and in the open menu.
  const name = chiefRowName(useSignedInAccount());
  return (
    <div className="menu-rail-chief" data-zerops-surface="sidebar-chief">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              aria-current={current ? "page" : undefined}
              aria-label={name}
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
            <span className="menu-rail-tip-name">{name}</span>
            {line === undefined || line === null ? null : (
              <span className="menu-rail-tip-line">{line}</span>
            )}
          </span>
        </TooltipPopup>
      </Tooltip>
      {waiting === undefined || items.length === 0 ? null : (
        <SidebarWaitingCount className="menu-rail-count" items={items} verbs={waiting.verbs} />
      )}
    </div>
  );
}

/**
 * The Chief's place at the menu's top while the person has none: the Chief's row's box, bare, the
 * product's mark where the Chief's stands, leading to the overview, and what waits on the person
 * counted where the Chief's row counts it. The bar keeps the height the boot frame draws, so the
 * rows under it never move when a Chief comes, or on a reload.
 */
export function SidebarChiefPlace({
  waiting,
}: {
  readonly waiting: SidebarChiefRowProps["waiting"];
}) {
  const items = waiting?.items ?? [];
  return (
    <div className="menu-top-chief" data-zerops-surface="sidebar-chief-place">
      <Link aria-label="Overview" className="menu-chief-place" to="/zerops">
        <span className="menu-chief-body">
          <span aria-hidden="true" className="menu-chief-mark">
            <MateMark awake playful className="h-9 w-7.5" />
          </span>
        </span>
      </Link>
      {waiting === undefined || items.length === 0 ? null : (
        <SidebarWaitingCount className="menu-chief-count" items={items} verbs={waiting.verbs} />
      )}
    </div>
  );
}

function useSignedInAccount() {
  const session = useZeropsSessionOptional();
  return session !== null && session.status === "signed-in"
    ? zeropsAccountDisplay(session.user)
    : null;
}

/** The Chief's one name in the menu, by its person: "Ada's Chief Mate". */
function chiefRowName(account: { readonly name: string } | null): string {
  return account === null ? "Chief Mate" : `${account.name}'s Chief Mate`;
}

const SETUP_WORDS: Readonly<Record<ChiefSetupRowState, string>> = {
  running: "Being set up",
  stopped: "Setting up stopped",
};

/**
 * Its line before it is up: its setup running, muted; stopped, in the attention ink with its mark,
 * as a Mate's that did not come.
 */
export function ChiefSetupRowLine({ state }: { readonly state: ChiefSetupRowState }) {
  return (
    <span
      className={cn(
        "menu-line2 truncate",
        state === "running" ? "text-muted-foreground" : "text-status-attention-text",
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
