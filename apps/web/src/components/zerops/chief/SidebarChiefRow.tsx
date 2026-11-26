/**
 * The Chief, the open menu's first row, over every project's: its mark on the faces' column,
 * wearing the Chief's state as a Mate's face does; "Chief"; and a second line only while it has
 * something to say (`chiefRowLine`), the name centred in the row otherwise. While its setup runs
 * the same row opens the Chief page; before that there is no row. What waits on the person counts
 * in the menu's headline, and on the rail's Overview.
 */
import type { MateMarkState } from "@t3tools/shared/brand";
import { CircleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { useZeropsSessionOptional } from "~/zerops/ZeropsSessionProvider";
import { useViewerCalled } from "~/zerops/useZeropsMateOwners";

import { MateMark } from "../../MateMark";
import { Row } from "../../ui/row";
import { zeropsAccountDisplay } from "@t3tools/client-runtime/zerops";
import { MateDot } from "../MateDot";
import { MateOwnerMark } from "../MateOwnerMark";
import { ownerMark } from "../SidebarMateRow.logic";
import { chiefNameParts, type ChiefSetupRowState } from "./chiefTop.logic";
import { carryBandToChief } from "./chiefLitTravel";
import { RAIL_NAME_CLASS, RailControl } from "../SidebarRail";
import { RailTip } from "../SidebarRailTip";

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
}

/** The title, its noun whole: the words before "Chief" give way first in a narrow menu. */
function ChiefName({ title }: { readonly title: string }) {
  const { head, noun } = chiefNameParts(title);
  return (
    <span
      className="flex min-w-0 gap-x-1 text-emphasis leading-5.25 font-medium whitespace-nowrap text-sidebar-foreground"
      data-waiting-line=""
    >
      {head === "" ? null : (
        <>
          <span className="min-w-0 truncate @max-[350px]/sidebar-header:in-data-[mobile=true]:hidden">
            {head}
          </span>{" "}
        </>
      )}
      <span className="flex-none">{noun}</span>
    </span>
  );
}

export function SidebarChiefRow({
  face,
  unseen = false,
  line,
  current,
  onOpen,
}: SidebarChiefRowProps) {
  // The person's own Chief, by their name and with their picture on its mark (the owner,
  // 2026-10-13: "Aleš's Chief Mate and combine it with avatar, no second line"); a line only while
  // its setup has one to say.
  const account = useSignedInAccount();
  const shown = line ?? null;
  return (
    // The list's first row, right under the headline; the projects a row's 6 px under it (`!`
    // over the list's own top padding).
    <div
      className="[&+[data-zerops-surface=sidebar-environments]]:pt-1.5!"
      data-zerops-surface="sidebar-chief"
    >
      <Row
        aria-current={current ? "page" : undefined}
        className="group/chief h-(--sidebar-chief-row-height) w-full items-center"
        columns
        data-current={current ? "" : undefined}
        data-lined={shown === null ? undefined : ""}
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
        ground="menu"
        pressable="band"
        render={<button type="button" />}
      >
        {/* Lit from the press, as a Mate's row is under its band: its own layer, grown into
            place by opacity and scale, or carried from the band and back (`chiefLitTravel`) —
            the compositor runs either while the page it opens is drawn. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-1 scale-96 rounded-card bg-sidebar-row-active opacity-0 ease-out-strong will-change-[opacity,transform] group-data-current/chief:scale-100 group-data-current/chief:opacity-100 group-data-pressed/chief:scale-100 group-data-pressed/chief:opacity-100 motion-safe:not-data-travel:transition-[opacity,scale] motion-safe:not-data-travel:duration-260"
          data-chief-lit=""
        />
        <span className="col-start-1 flex min-w-0 flex-auto items-center gap-3 ps-2.5 pe-3">
          <span className="relative grid h-10 w-9 flex-none place-items-center" aria-hidden="true">
            <MateMark
              awake
              playful
              className="h-9 w-7.5"
              {...(face === undefined ? {} : { state: face })}
            />
            {unseen ? (
              <MateDot
                className="top-0.5 end-0.25"
                ground="row"
                place="corner"
                surface="sidebar-chief-unread"
                tone="unread"
              />
            ) : null}
            {account === null ? null : (
              <MateOwnerMark
                className="top-auto -right-1 -bottom-0.5 left-auto ring-2 ring-(--row-ground)"
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
          {/* The name alone stands in the row's middle; a line arriving under it lifts it as it
              grows in. */}
          <span className="grid min-w-0 flex-auto grid-rows-[auto_0fr] group-data-lined/chief:grid-rows-[auto_1fr] motion-safe:transition-[grid-template-rows] motion-safe:duration-200 motion-safe:ease-out-strong">
            <ChiefName title={chiefRowName(account)} />
            {shown === null ? null : (
              <span className="flex min-h-0 min-w-0 overflow-hidden whitespace-nowrap *:min-w-0 *:truncate">
                {shown}
              </span>
            )}
          </span>
        </span>
      </Row>
    </div>
  );
}

/**
 * The Chief on the closed menu's rail, the first of its tiles: its mark wearing its state over
 * "Chief Mate"; its whole name and line in its card.
 */
export function SidebarChiefTile({
  face,
  unseen = false,
  line,
  current,
  onOpen,
}: SidebarChiefRowProps) {
  // Named as its row names it: one name on the rail and in the open menu.
  const name = chiefRowName(useSignedInAccount());
  return (
    <RailControl
      aria-current={current ? "page" : undefined}
      aria-label={name}
      data-current={current ? "" : undefined}
      data-zerops-surface="sidebar-chief-row"
      look="tile"
      onClick={onOpen}
      tip={<RailTip line={line} name={name} />}
    >
      <span className="relative grid size-9 place-items-center" data-zerops-surface="sidebar-chief">
        <MateMark
          awake
          playful
          className="h-8.25 w-7"
          {...(face === undefined ? {} : { state: face })}
        />
        {unseen ? <MateDot place="corner" surface="sidebar-chief-unread" tone="unread" /> : null}
      </span>
      <span aria-hidden="true" className={RAIL_NAME_CLASS} data-zerops-surface="sidebar-rail-name">
        Chief Mate
      </span>
    </RailControl>
  );
}

function useSignedInAccount() {
  const session = useZeropsSessionOptional();
  const called = useViewerCalled();
  return session !== null && session.status === "signed-in"
    ? zeropsAccountDisplay(session.user, called)
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
        "block truncate text-body leading-5.5",
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
