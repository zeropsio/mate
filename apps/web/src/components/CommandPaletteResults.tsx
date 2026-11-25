import { type ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { ChevronRightIcon } from "lucide-react";
import { shortcutLabelForCommand } from "../keybindings";
import {
  type CommandPaletteActionItem,
  type CommandPaletteGroup,
  type CommandPaletteSubmenuItem,
} from "./CommandPalette.logic";
import {
  CommandCollection,
  CommandGroup,
  CommandGroupLabel,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "./ui/command";
import { ThreadSearchMatchExcerpt } from "./ThreadSearchMatch";
import { Text } from "~/components/ui/text";

interface CommandPaletteResultsProps {
  emptyStateMessage?: string;
  statusMessage?: string | null;
  groups: ReadonlyArray<CommandPaletteGroup>;
  highlightedItemValue?: string | null;
  isActionsOnly: boolean;
  keybindings: ResolvedKeybindingsConfig;
  onExecuteItem: (item: CommandPaletteActionItem | CommandPaletteSubmenuItem) => void;
}

export function CommandPaletteResults(props: CommandPaletteResultsProps) {
  if (props.groups.length === 0) {
    const message =
      props.statusMessage ??
      props.emptyStateMessage ??
      (props.isActionsOnly
        ? "No matching actions."
        : "No matching commands, projects, or threads.");
    return (
      <Text className="py-10 text-center" render={<div />} variant="description">
        {/* Nothing to say yet (`paletteNoMatchMessage`): the line's room is held, so the box never
            grows when the sentence comes. */}
        {message === "" ? <span aria-hidden="true">{"\u00a0"}</span> : message}
      </Text>
    );
  }

  return (
    <>
      {props.statusMessage ? (
        <Text className="px-3 py-2" render={<p />} variant="description" role="status">
          {props.statusMessage}
        </Text>
      ) : null}
      <CommandList>
        {props.groups.map((group) => (
          <CommandGroup items={group.items} key={group.value}>
            <CommandGroupLabel>{group.label}</CommandGroupLabel>
            <CommandCollection>
              {(item) =>
                item.disabled ? (
                  <DisabledCommandPaletteResultRow item={item} key={item.value} />
                ) : (
                  <CommandPaletteResultRow
                    item={item}
                    key={item.value}
                    keybindings={props.keybindings}
                    isActive={props.highlightedItemValue === item.value}
                    onExecuteItem={props.onExecuteItem}
                  />
                )
              }
            </CommandCollection>
          </CommandGroup>
        ))}
      </CommandList>
    </>
  );
}

function DisabledCommandPaletteResultRow(props: {
  item: CommandPaletteActionItem | CommandPaletteSubmenuItem;
}) {
  return (
    <div className="flex min-h-8 select-none items-center gap-2 rounded-control px-2 py-1.5 text-body opacity-64 sm:min-h-7">
      {props.item.icon}
      {props.item.description || props.item.threadContentMatch ? (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5 text-body text-foreground">
            {props.item.titleLeadingContent}
            <span className="truncate">{props.item.title}</span>
          </span>
          {props.item.threadContentMatch ? (
            <ThreadSearchMatchExcerpt match={props.item.threadContentMatch} />
          ) : null}
          {props.item.description ? (
            <span className="min-w-0 text-muted-foreground/70 text-caption">
              {props.item.description}
            </span>
          ) : null}
        </span>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-body text-foreground">
          {props.item.titleLeadingContent}
          <span className="truncate">{props.item.title}</span>
        </span>
      )}
      {props.item.titleTrailingContent}
    </div>
  );
}

function CommandPaletteResultRow(props: {
  item: CommandPaletteActionItem | CommandPaletteSubmenuItem;
  isActive: boolean;
  keybindings: ResolvedKeybindingsConfig;
  onExecuteItem: (item: CommandPaletteActionItem | CommandPaletteSubmenuItem) => void;
}) {
  const shortcutLabel = props.item.shortcutCommand
    ? shortcutLabelForCommand(props.keybindings, props.item.shortcutCommand)
    : null;

  return (
    <CommandItem
      value={props.item.value}
      active={props.isActive}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={() => {
        props.onExecuteItem(props.item);
      }}
    >
      {props.item.icon}
      {props.item.description || props.item.threadContentMatch ? (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5 text-body text-foreground">
            {props.item.titleLeadingContent}
            <span className="truncate">{props.item.title}</span>
          </span>
          {props.item.threadContentMatch ? (
            <ThreadSearchMatchExcerpt match={props.item.threadContentMatch} />
          ) : null}
          {props.item.description ? (
            <span className="min-w-0 text-muted-foreground/70 text-caption">
              {props.item.description}
            </span>
          ) : null}
        </span>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-body text-foreground">
          {props.item.titleLeadingContent}
          <span className="truncate">{props.item.title}</span>
        </span>
      )}
      {props.item.titleTrailingContent}
      {props.item.timestamp ? (
        <span className="min-w-12 shrink-0 text-right text-caption tabular-nums text-muted-foreground/70">
          {props.item.timestamp}
        </span>
      ) : null}
      {shortcutLabel ? <CommandShortcut>{shortcutLabel}</CommandShortcut> : null}
      {props.item.kind === "submenu" ? (
        <ChevronRightIcon className="-me-0.5 ms-auto size-4 shrink-0 text-muted-foreground/70" />
      ) : null}
    </CommandItem>
  );
}
