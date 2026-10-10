/**
 * A Mate's own menu in the left menu, and its name edited in place.
 *
 * The menu lives in the row's time slot: on hover and on focus the time gives
 * way to the menu's trigger, in a slot that is always reserved, so nothing on
 * the row moves when it appears; a right-click on the row opens the same menu
 * at the pointer. What it offers, in order: the ways in (*Open*, then *Crew*
 * or *Set up a crew* on the viewer's own Mate with crew mode on, *Open app*,
 * *Copy link*), what this viewer keeps about it (*Mute notifications*,
 * *Mark as unread*, *Rename*, *Change face…*), the verbs the projects screen
 * offers too (`useMateActions`: *Restart* or *Start*, *Register in …*,
 * *Hand over…*, *Move to project…*) and its update's (*Check for updates*,
 * *Update to x.y.z*, `ZeropsMateUpdateControl`), while it works *Stop the run*, and last,
 * a line apart and in red, *Delete {name}…* where this viewer may delete it.
 * No snooze and no pin: the owner left both out.
 *
 * Renaming happens where the name stands: the name becomes a field in its own
 * place and size, and a reason it will not do floats under it rather than
 * pushing the rows below.
 */
import { MoreHorizontalIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import type { EnvironmentId } from "@t3tools/contracts";

import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuShortcut, MenuTrigger } from "../ui/menu";
import { CHANGE_FACE_VERB } from "./ZeropsChangeFaceDialog.logic";
import { ZeropsMateUpdateControl } from "./ZeropsMateUpdateControl";
import type { ZeropsMenuAction, ZeropsMenuEntry } from "./ZeropsProjectMenu";

/** One Mate's name, edited where it stands (`useMateActions.renameInPlace`). */
export interface MateRenameAction {
  readonly initialValue: string;
  readonly validate: (value: string) => string | undefined;
  readonly commit: (value: string) => void;
}

/** What a Mate's menu can do beyond opening it, as the caller wires it. */
export interface MateRowActions {
  /** Whether this viewer muted it here. */
  readonly muted: boolean;
  /** Absent where there is nothing to mute — a Mate with no conversation yet. */
  readonly toggleMute?: (() => void) | undefined;
  /** Absent where it has finished nothing to mark. */
  readonly toggleUnread?: (() => void) | undefined;
  readonly copyLink?: (() => void) | undefined;
  /** Absent where this viewer may not rename it. */
  readonly rename?: MateRenameAction | undefined;
  /** Opens its Change face dialog (`useMateActions`); absent where Rename is. */
  readonly changeFace?: (() => void) | undefined;
  /** Stops the run it is on; absent while it rests. */
  readonly stop?: (() => void) | undefined;
  /**
   * The verbs the projects screen offers too: start or restart, register, hand over, move — and
   * delete, which the menu keeps for its end.
   */
  readonly entries: ReadonlyArray<ZeropsMenuEntry>;
  /** Where it acts: its update's entries are read off this environment's record, once open. */
  readonly environmentId?: EnvironmentId | undefined;
  /**
   * Its row is drawn, until the function this returns is called: its project's container is read
   * meanwhile, what *Restart* stands on. The same function on every render.
   */
  readonly drawn?: (() => () => void) | undefined;
}

/** A point the menu opens at, for a right-click. */
export interface MenuPoint {
  readonly x: number;
  readonly y: number;
}

const ROW_ACTION_CLASS =
  "inline-flex size-5 cursor-pointer items-center justify-center rounded text-sidebar-muted-foreground outline-none transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-sidebar-row-active data-popup-open:text-sidebar-foreground";

/** The crew's door (`mateCrewItem`): its conversation on the Crew tab, set up or not. */
export interface MateCrewEntry {
  readonly label: string;
  readonly onSelect: () => void;
}

/** What a Mate's menu lists: see the module's own comment for the order. */
export interface MateMenuItemsProps {
  readonly actions: MateRowActions;
  /** Absent where it is not the viewer's own Mate, or crew mode is not on. */
  readonly crew?: MateCrewEntry | undefined;
  readonly unread: boolean;
  /** The Mate's app — its pair's stage route — where it has one. */
  readonly appUrl: string | undefined;
  readonly onOpenMate: () => void;
  readonly onRename: () => void;
  /** The keys the list answers, shown beside their items. */
  readonly shortcuts: boolean;
  /** Who *Update to x.y.z* asks about. */
  readonly name?: string | undefined;
}

export function MateMenuItems({
  actions,
  crew,
  unread,
  appUrl,
  onOpenMate,
  onRename,
  shortcuts,
  name,
}: MateMenuItemsProps) {
  const hint = (key: string): ReactNode => (shortcuts ? <MenuShortcut>{key}</MenuShortcut> : null);
  const entries = actions.entries.filter(
    (entry): entry is Extract<ZeropsMenuEntry, { readonly label: string }> =>
      !("separator" in entry),
  );
  // What takes the Mate away for good stands last, a line apart — after the stop too.
  const verbs = entries.filter((entry) => entry.variant !== "destructive");
  const final = entries.filter((entry) => entry.variant === "destructive");
  return (
    <>
      <MenuItem data-zerops-mate-menu="open" onClick={onOpenMate}>
        Open
        {hint("↵")}
      </MenuItem>
      {crew === undefined ? null : (
        <MenuItem data-zerops-mate-menu="crew" onClick={crew.onSelect}>
          {crew.label}
        </MenuItem>
      )}
      {appUrl === undefined ? (
        <MenuItem data-zerops-mate-menu="open-app" disabled>
          Open app
        </MenuItem>
      ) : (
        <MenuItem
          data-zerops-mate-menu="open-app"
          render={<a href={appUrl} rel="noreferrer" target="_blank" />}
        >
          Open app
          {hint("↗")}
        </MenuItem>
      )}
      <MenuItem
        data-zerops-mate-menu="copy-link"
        disabled={actions.copyLink === undefined}
        onClick={actions.copyLink}
      >
        Copy link
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        data-zerops-mate-menu="mute"
        disabled={actions.toggleMute === undefined}
        onClick={actions.toggleMute}
      >
        {actions.muted ? "Unmute notifications" : "Mute notifications"}
      </MenuItem>
      <MenuItem
        data-zerops-mate-menu="unread"
        disabled={actions.toggleUnread === undefined}
        onClick={actions.toggleUnread}
      >
        {unread ? "Mark as read" : "Mark as unread"}
        {hint("E")}
      </MenuItem>
      {actions.rename === undefined ? null : (
        <MenuItem data-zerops-mate-menu="rename" onClick={onRename}>
          Rename
        </MenuItem>
      )}
      {actions.changeFace === undefined ? null : (
        <MenuItem data-zerops-mate-menu="face" onClick={actions.changeFace}>
          {CHANGE_FACE_VERB}
        </MenuItem>
      )}
      {actions.environmentId === undefined ? (
        <MateVerbs verbs={verbs} />
      ) : (
        <ZeropsMateUpdateControl environmentId={actions.environmentId} mateName={name}>
          {({ menuActions }) => <MateVerbs verbs={[...verbs, ...menuActions]} />}
        </ZeropsMateUpdateControl>
      )}
      {actions.stop === undefined ? null : (
        <>
          <MenuSeparator />
          <MenuItem data-zerops-mate-menu="stop" onClick={actions.stop} variant="destructive">
            Stop the run
            {hint("X")}
          </MenuItem>
        </>
      )}
      {final.length === 0 ? null : (
        <>
          <MenuSeparator />
          {final.map((entry) => (
            <MenuItem
              data-zerops-mate-menu={entry.id}
              disabled={entry.disabled === true}
              key={entry.id}
              onClick={entry.onSelect}
              variant="destructive"
            >
              {entry.label}
            </MenuItem>
          ))}
        </>
      )}
    </>
  );
}

function MateVerbs({ verbs }: { readonly verbs: ReadonlyArray<ZeropsMenuAction> }) {
  if (verbs.length === 0) return null;
  return (
    <>
      <MenuSeparator />
      {verbs.map((entry) => (
        <MenuItem
          data-zerops-mate-menu={entry.id}
          disabled={entry.disabled === true}
          key={entry.id}
          onClick={entry.onSelect}
          title={entry.why}
        >
          {entry.label}
        </MenuItem>
      ))}
    </>
  );
}

export function MateMenu({
  name,
  open,
  at,
  onOpenChange,
  ...items
}: MateMenuItemsProps & {
  readonly name: string;
  readonly open: boolean;
  /** A right-click's point; absent, the menu hangs off its trigger. */
  readonly at: MenuPoint | undefined;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <Menu onOpenChange={onOpenChange} open={open}>
      <MenuTrigger
        render={
          <button
            aria-label={`More for ${name}`}
            className={ROW_ACTION_CLASS}
            data-zerops-surface="sidebar-mate-more"
            type="button"
          />
        }
      >
        <MoreHorizontalIcon aria-hidden="true" className="size-3.5" />
      </MenuTrigger>
      <MenuPopup
        align="start"
        {...(at === undefined
          ? { side: "right" as const }
          : {
              side: "bottom" as const,
              sideOffset: 0,
              anchor: {
                getBoundingClientRect: () =>
                  DOMRect.fromRect({ x: at.x, y: at.y, width: 0, height: 0 }),
              },
            })}
        className="w-56"
        data-zerops-surface="sidebar-mate-menu"
      >
        <MateMenuItems {...items} name={name} />
      </MenuPopup>
    </Menu>
  );
}

/**
 * The name, as a field in its own place: the same size, weight and left edge
 * as the words it replaces. Enter writes it, Escape leaves it, and leaving
 * the field writes it too — a rename abandoned by a click elsewhere is still
 * the name the person typed. A reason it will not do floats under the field.
 */
export function MateRenameField({
  rename,
  onDone,
}: {
  readonly rename: MateRenameAction;
  readonly onDone: () => void;
}) {
  const [value, setValue] = useState(rename.initialValue);
  const [tried, setTried] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const error = rename.validate(value);
  const finish = (write: boolean) => {
    if (finished.current) return;
    if (write && value.trim() !== rename.initialValue.trim()) {
      if (error !== undefined) {
        setTried(true);
        return;
      }
      rename.commit(value);
    }
    finished.current = true;
    onDone();
  };
  return (
    <span
      className="absolute start-17.25 end-15.5 top-2.5 flex h-5"
      data-zerops-surface="sidebar-mate-rename"
    >
      <input
        aria-invalid={tried && error !== undefined}
        aria-label="Mate's name"
        className="-ms-1 h-5 min-w-0 flex-1 rounded-sm bg-popover px-1 text-sm leading-5 font-medium text-sidebar-foreground ring-1 ring-ring outline-none aria-invalid:ring-destructive"
        id="sidebar-mate-rename"
        onBlur={() => {
          finish(true);
        }}
        onChange={(event) => {
          setValue(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            finish(true);
          } else if (event.key === "Escape") {
            event.preventDefault();
            finish(false);
          }
        }}
        ref={input}
        spellCheck={false}
        value={value}
      />
      {tried && error !== undefined ? (
        <span
          className="absolute start-0 top-full z-10 mt-1 max-w-full rounded-md border border-border bg-popover px-2 py-1 text-xs text-destructive-foreground shadow-md"
          data-zerops-surface="sidebar-mate-rename-error"
          role="alert"
        >
          {error}
        </span>
      ) : null}
    </span>
  );
}
