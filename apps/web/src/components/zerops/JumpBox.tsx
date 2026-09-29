/**
 * The jump box: one field that finds anything the left menu holds — a Mate, a
 * project, a change, a stop, words inside a conversation — with what matched
 * marked, and, after `@`, writes to a Mate without opening it.
 *
 * ⌘K opens it, and `/` anywhere nothing is being typed. `@nova`, then Tab or
 * Enter, picks Nova: Nova's chip — its face and name — stands in the field,
 * the field is for Nova from then on, a line under it says who reads what is
 * written and when (`jumpWritePlan`), and Enter sends. The free Mates are
 * listed first, since writing to one starts it at once. Backspace on an empty
 * field goes back to `@nova`; Escape leaves the Mate and then the box.
 *
 * It is the app's own palette — the same field, list and keys row
 * (`CommandPaletteContent`) — with the menu's own glyphs in its rows: a
 * Mate's face, a change's checks, a stop's badge. `>` hands over to the
 * palette's commands.
 *
 * `useJumpBoxState` keeps what is typed and which Mate the words are for,
 * `useJumpBoxModel` reads the menu's index with it, and `JumpBoxView` draws
 * that. What finding and writing do in the app is `SidebarJumpBox`'s; the
 * design harness drives the same three with its own.
 */
import { ArrowDownIcon, ArrowUpIcon, FolderIcon, PlusIcon, SearchIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useSidebarPeek } from "~/zerops/sidebarPeek";

import { CommandPaletteContent } from "../CommandPaletteContent";
import {
  CommandCollection,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandItem,
  CommandList,
} from "../ui/command";
import { Kbd, KbdGroup } from "../ui/kbd";
import {
  highlightParts,
  jumpGroups,
  jumpKey,
  NEW_PROJECT_LABEL,
  readJumpQuery,
  type JumpChange,
  type JumpGroup,
  type JumpHit,
  type JumpItem,
  type JumpMate,
  type JumpStop,
  type SidebarJumpIndex,
} from "./JumpBox.logic";
import { MateFace, StatusDot } from "./primitives";
import { StopMark } from "./SidebarZeropsTree";

export interface JumpBoxModel {
  readonly value: string;
  readonly setValue: (value: string) => void;
  /** The Mate the words are for, once picked. */
  readonly target: JumpMate | undefined;
  readonly groups: ReadonlyArray<JumpGroup>;
  /** The row the keys are on; the list's first until they move. */
  readonly highlighted: JumpItem | undefined;
  readonly setHighlighted: (value: string | null) => void;
  readonly pick: (mate: JumpMate) => void;
  /** Back to the Mates by the picked one's name. */
  readonly backToList: () => void;
  /** Back to finding, the field empty. */
  readonly backToFind: () => void;
}

/** What is typed, the Mate it is for, and the row the keys are on. */
export interface JumpBoxState {
  readonly value: string;
  readonly setRawValue: (value: string) => void;
  readonly targetId: string | null;
  readonly setTargetId: (projectId: string | null) => void;
  readonly highlightedValue: string | null;
  readonly setHighlighted: (value: string | null) => void;
}

export function useJumpBoxState(): JumpBoxState {
  const [value, setRawValue] = useState("");
  const [targetId, setTargetId] = useState<string | null>(null);
  const [highlightedValue, setHighlighted] = useState<string | null>(null);
  return { value, setRawValue, targetId, setTargetId, highlightedValue, setHighlighted };
}

/** The words the conversations are searched for: only while finding. */
export function jumpSearchText(state: Pick<JumpBoxState, "value" | "targetId">): string {
  const query = readJumpQuery(state.value);
  return state.targetId === null && query.mode === "find" ? query.text : "";
}

export function useJumpBoxModel(
  state: JumpBoxState,
  index: SidebarJumpIndex,
  hits: ReadonlyArray<JumpHit>,
  /** The Mates the viewer may not write to (D6): `@` never offers them. */
  readOnly: ReadonlySet<string>,
): JumpBoxModel {
  const { value, setRawValue, targetId, setTargetId, highlightedValue, setHighlighted } = state;
  // A Mate that leaves the menu while the box is open is no one to write to.
  const target =
    targetId === null ? undefined : index.mates.find((mate) => mate.projectId === targetId);
  const groups = useMemo(
    () => (target === undefined ? jumpGroups(index, value, hits, readOnly) : []),
    [hits, index, readOnly, target, value],
  );
  const items = groups.flatMap((group) => group.items);
  const highlighted = items.find((item) => item.value === highlightedValue) ?? items[0];
  const setValue = useCallback(
    (next: string) => {
      setRawValue(next);
      setHighlighted(null);
    },
    [setHighlighted, setRawValue],
  );
  const pick = useCallback(
    (mate: JumpMate) => {
      setTargetId(mate.projectId);
      setRawValue("");
      setHighlighted(null);
    },
    [setHighlighted, setRawValue, setTargetId],
  );
  const backToList = useCallback(() => {
    setRawValue(target === undefined ? "@" : `@${target.name.toLocaleLowerCase()}`);
    setTargetId(null);
    setHighlighted(target === undefined ? null : `write:${target.projectId}`);
  }, [setHighlighted, setRawValue, setTargetId, target]);
  const backToFind = useCallback(() => {
    setRawValue("");
    setTargetId(null);
    setHighlighted(null);
  }, [setHighlighted, setRawValue, setTargetId]);
  return {
    value,
    setValue,
    target,
    groups,
    highlighted,
    setHighlighted,
    pick,
    backToList,
    backToFind,
  };
}

/** Where a find goes where the menu cannot show it: its own page. */
export interface JumpPages {
  readonly openMate: (mate: JumpMate) => void;
  readonly openProject: (groupId: string) => void;
  readonly openStop: (stop: JumpStop) => void;
  readonly openChange: (change: JumpChange) => void;
  /** Starts a new project, where projects are made. */
  readonly newProject: () => void;
}

/**
 * What choosing a row does. `@`'s Mate with a conversation becomes the one
 * written to; any other Mate, or words in its conversation, open it. A
 * project, a stop or a change is shown in the menu, which comes out to show
 * it (`showable`), and opens its own page where the menu cannot.
 */
export function chooseJumpItem(
  item: JumpItem,
  input: {
    readonly model: JumpBoxModel;
    readonly close: () => void;
    readonly showable: boolean;
    readonly pages: JumpPages;
  },
): void {
  const { model, close, showable, pages } = input;
  if (item.kind === "write" && item.mate.conversation !== undefined) {
    model.pick(item.mate);
    return;
  }
  close();
  const { reveal } = useSidebarPeek.getState();
  switch (item.kind) {
    case "mate":
    case "write":
    case "text":
      pages.openMate(item.mate);
      return;
    case "project":
      if (showable) reveal({ kind: "project", groupId: item.project.groupId });
      else pages.openProject(item.project.groupId);
      return;
    case "stop":
      if (showable)
        reveal({ kind: "stop", groupId: item.stop.groupId, projectId: item.stop.projectId });
      else pages.openStop(item.stop);
      return;
    case "change":
      if (showable) {
        reveal({
          kind: "change",
          groupId: item.change.groupId,
          key: item.change.key,
          mateProjectId: item.change.mateProjectId,
        });
      } else pages.openChange(item.change);
      return;
    case "new-project":
      pages.newProject();
      return;
  }
}

/** What the line under a picked Mate says, and what Enter does now. */
export interface JumpWriteLine {
  readonly hint: string;
  /** Enter's word in the keys row; nothing where Enter does nothing. */
  readonly enter: string | undefined;
  readonly error: string | undefined;
  readonly sending: boolean;
}

export function JumpBoxView({
  model,
  write,
  searching,
  onChoose,
  onSend,
  onCommands,
}: {
  readonly model: JumpBoxModel;
  /** The picked Mate's line; unread while nobody is picked. */
  readonly write: JumpWriteLine | undefined;
  /** Conversations are still being searched for what was typed. */
  readonly searching: boolean;
  readonly onChoose: (item: JumpItem) => void;
  readonly onSend: (text: string) => void;
  /** `>` typed first: the palette's commands, from that `>`. */
  readonly onCommands: ((value: string) => void) | undefined;
}) {
  const { target, backToFind } = model;

  // Escape while a Mate is picked leaves the Mate, not the box: caught before
  // the dialog hears it, the way the palette's other modes step back.
  useEffect(() => {
    if (target === undefined) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      backToFind();
    };
    window.addEventListener("keydown", onEscape, true);
    return () => {
      window.removeEventListener("keydown", onEscape, true);
    };
  }, [backToFind, target]);

  return target === undefined ? (
    <JumpFindView model={model} onChoose={onChoose} onCommands={onCommands} searching={searching} />
  ) : (
    <JumpWriteView
      key={target.projectId}
      model={model}
      onSend={onSend}
      target={target}
      write={write}
    />
  );
}

function JumpFindView({
  model,
  searching,
  onChoose,
  onCommands,
}: {
  readonly model: JumpBoxModel;
  readonly searching: boolean;
  readonly onChoose: (item: JumpItem) => void;
  readonly onCommands: ((value: string) => void) | undefined;
}) {
  const { value, groups, highlighted } = model;
  const writing = readJumpQuery(value).mode === "write";
  const footerKeys = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <KbdGroup>
        <Kbd>
          <ArrowUpIcon />
        </Kbd>
        <Kbd>
          <ArrowDownIcon />
        </Kbd>
        <span>Navigate</span>
      </KbdGroup>
      {writing ? (
        <>
          <KbdGroup>
            <Kbd>Tab</Kbd>
            <Kbd>Enter</Kbd>
            <span>Write to</span>
          </KbdGroup>
          <KbdGroup>
            <Kbd>Esc</Kbd>
            <span>Close</span>
          </KbdGroup>
        </>
      ) : (
        <>
          <KbdGroup>
            <Kbd>Enter</Kbd>
            <span>Open</span>
          </KbdGroup>
          <KbdGroup>
            <Kbd>@</Kbd>
            <span>Write to a Mate</span>
          </KbdGroup>
        </>
      )}
    </div>
  );
  return (
    <CommandPaletteContent
      aria-label="Jump to"
      autoHighlight="always"
      footerKeys={footerKeys}
      footerTrailing={
        !writing && onCommands !== undefined ? (
          <KbdGroup>
            <Kbd>&gt;</Kbd>
            <span>Commands</span>
          </KbdGroup>
        ) : null
      }
      inputProps={{
        placeholder: "Jump to a Mate, project, change or stop. Type @ to write to a Mate",
        "aria-label": "Jump to, or write to a Mate",
        onKeyDown: (event) => {
          const action = jumpKey({
            key: event.key,
            shift: event.shiftKey,
            composing: event.nativeEvent.isComposing,
            targeted: false,
            value,
          });
          if (action !== "choose") return;
          event.preventDefault();
          if (highlighted !== undefined) onChoose(highlighted);
        },
      }}
      mode="none"
      onItemHighlighted={(highlightedValue) => {
        model.setHighlighted(typeof highlightedValue === "string" ? highlightedValue : null);
      }}
      onValueChange={(next) => {
        if (next.startsWith(">") && onCommands !== undefined) {
          onCommands(next);
          return;
        }
        model.setValue(next);
      }}
      testId="jump-box"
      value={value}
    >
      {groups.length === 0 ? (
        <div
          className="px-4 py-10 text-center text-sm text-muted-foreground"
          data-zerops-surface="jump-empty"
        >
          {searching ? "Searching conversations…" : emptyLine(value)}
        </div>
      ) : (
        <CommandList>
          {groups.map((group) => (
            <CommandGroup items={group.items} key={group.id}>
              <CommandGroupLabel>{group.label}</CommandGroupLabel>
              <CommandCollection>
                {(item: JumpItem) => (
                  <CommandItem
                    active={highlighted?.value === item.value}
                    key={item.value}
                    onClick={() => {
                      onChoose(item);
                    }}
                    onMouseDown={(event) => {
                      event.preventDefault();
                    }}
                    value={item.value}
                  >
                    <JumpRow item={item} match={group.match} />
                  </CommandItem>
                )}
              </CommandCollection>
            </CommandGroup>
          ))}
        </CommandList>
      )}
    </CommandPaletteContent>
  );
}

/**
 * The field once a Mate is picked: its chip — face and name — where the words
 * start, the words after it, and under them who reads them and when. Drawn in
 * the palette's own field's measure, so the search glyph and the row's height
 * stay where they were when the list steps aside.
 */
function JumpWriteView({
  model,
  target,
  write,
  onSend,
}: {
  readonly model: JumpBoxModel;
  readonly target: JumpMate;
  readonly write: JumpWriteLine | undefined;
  readonly onSend: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  // The list's field leaves as this one comes: the keys follow the words.
  useLayoutEffect(() => {
    input.current?.focus();
  }, []);
  return (
    <div className="contents" data-testid="jump-box">
      <div className="px-2 py-1.5">
        <div className="flex h-10 items-center gap-2 border border-transparent ps-2.25 pe-3 sm:h-9">
          <SearchIcon
            aria-hidden="true"
            className="size-4.5 shrink-0 text-icon-muted opacity-80 sm:size-4"
          />
          <button
            aria-label={`Writing to ${target.name}. Write to another Mate`}
            className="inline-flex h-6.5 max-w-1/2 shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-accent ps-0.75 pe-2.5 text-line font-medium text-accent-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-zerops-surface="jump-target"
            onClick={() => {
              model.backToList();
            }}
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            type="button"
          >
            <MateFace size="sm" state={target.face} tint={target.tint} />
            <span className="min-w-0 truncate">{target.name}</span>
          </button>
          <input
            aria-describedby="jump-write-hint"
            aria-label={`Write to ${target.name}`}
            autoComplete="off"
            className="h-full min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-placeholder sm:text-sm"
            data-zerops-surface="jump-write-input"
            onChange={(event) => {
              setText(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              const action = jumpKey({
                key: event.key,
                shift: event.shiftKey,
                composing: event.nativeEvent.isComposing,
                targeted: true,
                value: text,
              });
              if (action === undefined || action === "back-to-find") return;
              event.preventDefault();
              if (action === "send") onSend(text);
              else if (action === "back-to-list") model.backToList();
            }}
            placeholder={`Write to ${target.name}`}
            ref={input}
            spellCheck={false}
            type="text"
            value={text}
          />
        </div>
      </div>
      <div
        className="flex flex-col gap-1 px-4 pt-1 pb-3.5 text-line leading-5 text-muted-foreground"
        data-zerops-surface="jump-write-hint"
        id="jump-write-hint"
      >
        <p role="status">{write?.sending === true ? `Sending to ${target.name}…` : write?.hint}</p>
        {write?.error === undefined ? null : (
          <p className="text-status-failed-text" role="alert">
            {write.error}
          </p>
        )}
      </div>
      <CommandFooter className="max-sm:flex-col max-sm:items-start">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {write?.enter === undefined ? null : (
            <KbdGroup>
              <Kbd>Enter</Kbd>
              <span>{write.enter}</span>
            </KbdGroup>
          )}
          <KbdGroup>
            <Kbd>Backspace</Kbd>
            <span>Another Mate</span>
          </KbdGroup>
          <KbdGroup>
            <Kbd>Esc</Kbd>
            <span>Cancel</span>
          </KbdGroup>
        </div>
      </CommandFooter>
    </div>
  );
}

/** What the box says when it finds nothing for what was typed. */
function emptyLine(value: string): string {
  const query = readJumpQuery(value);
  if (query.mode === "find") return `Nothing matches “${query.text}”.`;
  return query.name.length === 0
    ? "No Mate you can write to."
    : `No Mate you can write to is called “${query.name}”.`;
}

/** The words, with what matched marked the way the app marks a search's. */
function Marked({ text, match }: { readonly text: string; readonly match: string }) {
  return highlightParts(text, match).map((part) =>
    part.match ? (
      <mark className="bg-transparent font-semibold text-foreground" key={part.start}>
        {part.text}
      </mark>
    ) : (
      part.text
    ),
  );
}

const plural = (count: number, one: string) => `${String(count)} ${one}${count === 1 ? "" : "s"}`;

/** One row: the menu's own glyph, what matched, and where it lives. */
function JumpRow({ item, match }: { readonly item: JumpItem; readonly match: string }) {
  let lead: ReactNode;
  let title: ReactNode;
  let sub: ReactNode;
  switch (item.kind) {
    case "mate":
    case "write": {
      const { mate } = item;
      lead = <MateFace size="sm" state={mate.face} tint={mate.tint} />;
      title = <Marked match={match} text={mate.name} />;
      sub = [mate.projectName, mate.subject].filter((part) => part !== undefined).join(" · ");
      break;
    }
    case "project":
      lead = <FolderIcon aria-hidden="true" className="size-4" />;
      title = <Marked match={match} text={item.project.name} />;
      sub = plural(item.project.mates, "Mate");
      break;
    case "change": {
      const { change } = item;
      lead =
        change.checkTone === undefined || change.checkWord === undefined ? null : (
          <StatusDot dotOnly label={change.checkWord} tone={change.checkTone} />
        );
      title = <Marked match={match} text={change.label} />;
      sub = [change.whose, change.projectName].filter((part) => part !== undefined).join(" · ");
      break;
    }
    case "stop":
      lead = <StopMark tone={item.stop.tone} word={item.stop.word} />;
      title = <Marked match={match} text={item.stop.title} />;
      sub = <Marked match={match} text={item.stop.line} />;
      break;
    case "text":
      lead = <MateFace size="sm" state={item.mate.face} tint={item.mate.tint} />;
      title = <Marked match={match} text={item.snippet} />;
      sub = `${item.mate.name} · in the conversation`;
      break;
    case "new-project":
      lead = <PlusIcon aria-hidden="true" className="size-4" />;
      title = <Marked match={match} text={NEW_PROJECT_LABEL} />;
      sub = "";
      break;
  }
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2.5" data-zerops-jump-kind={item.kind}>
      <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
        {lead}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm leading-5 text-foreground">{title}</span>
        {sub === "" ? null : (
          <span className="truncate text-xs leading-4 text-muted-foreground">{sub}</span>
        )}
      </span>
    </span>
  );
}
