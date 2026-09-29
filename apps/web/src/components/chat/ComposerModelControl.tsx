/**
 * The composer's one quiet control for what runs the next message (C4), and
 * what its menu holds beside the models: the model's effort and its other
 * choices, and the access. Three dropdowns at 14 px stood here — the model,
 * the traits and the access — and all three are reachable from this one.
 *
 * The access control also stands in the toolbar on its own, but only while it
 * is not the person's usual setting (`showsAccessControl`): a setting that is
 * as usual says nothing.
 */
import type { ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";
import { getProviderOptionCurrentLabel } from "@t3tools/shared/model";
import {
  BotIcon,
  CheckIcon,
  LockIcon,
  LockOpenIcon,
  PencilRulerIcon,
  PenLineIcon,
  SparklesIcon,
  type LucideIcon,
} from "lucide-react";
import { memo, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { Select, SelectItem, SelectPopup, SelectValue } from "../ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ComposerControl, ComposerControlIcon, ComposerSelectControl } from "./ComposerControl";
import { useTraitsControls } from "./TraitsPicker";

/** What the traits are read from and written to: the model, the prompt, the draft. */
export type ComposerTraitsInput = Parameters<typeof useTraitsControls>[0];

export const COMPOSER_ACCESS: Record<
  RuntimeMode,
  { readonly label: string; readonly description: string; readonly icon: LucideIcon }
> = {
  "approval-required": {
    label: "Supervised",
    description: "Ask before commands and file changes.",
    icon: LockIcon,
  },
  "auto-accept-edits": {
    label: "Auto-accept edits",
    description: "Auto-approve edits, ask before other actions.",
    icon: PenLineIcon,
  },
  auto: {
    label: "Auto",
    description: "Supported providers approve routine actions; others still ask.",
    icon: SparklesIcon,
  },
  "full-access": {
    label: "Full access",
    description: "Allow commands and edits without prompts.",
    icon: LockOpenIcon,
  },
};

const ACCESS_MODES = Object.keys(COMPOSER_ACCESS) as RuntimeMode[];

/**
 * Up and down move between a group's choices and pick the one they land on,
 * as a radio group does; Tab leaves the group from its chosen choice.
 */
function moveWithinGroup(event: KeyboardEvent<HTMLButtonElement>) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const group = event.currentTarget.closest('[role="radiogroup"]');
  if (group === null) return;
  const choices = Array.from(
    group.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)'),
  );
  const index = choices.indexOf(event.currentTarget);
  if (index === -1 || choices.length === 0) return;
  const step = event.key === "ArrowDown" ? 1 : -1;
  const next = choices[(index + step + choices.length) % choices.length];
  event.preventDefault();
  next?.focus();
  next?.click();
}

function ChoiceGroup(props: {
  readonly label: string;
  readonly note?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-col" role="radiogroup" aria-label={props.label}>
      <p className="px-2 pt-2 pb-1 font-medium text-muted-foreground text-xs">{props.label}</p>
      {props.note === undefined ? null : (
        <p className="px-2 pb-1 text-muted-foreground text-xs">{props.note}</p>
      )}
      {props.children}
    </div>
  );
}

function Choice(props: {
  readonly checked: boolean;
  /** Takes the Tab stop when nothing in its group is chosen yet. */
  readonly first: boolean;
  readonly disabled?: boolean;
  readonly isDefault?: boolean;
  readonly description?: string | undefined;
  readonly onSelect: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      aria-checked={props.checked}
      className="flex min-h-7 w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-start text-foreground text-line outline-none hover:bg-foreground/6 focus-visible:bg-foreground/6 disabled:cursor-default disabled:opacity-64 aria-checked:font-medium"
      disabled={props.disabled}
      onClick={props.onSelect}
      onKeyDown={moveWithinGroup}
      role="radio"
      tabIndex={props.checked || props.first ? 0 : -1}
      type="button"
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{props.children}</span>
        {props.description === undefined ? null : (
          <span className="text-pretty font-normal text-muted-foreground text-xs">
            {props.description}
          </span>
        )}
      </span>
      {props.isDefault ? (
        <span className="shrink-0 font-normal text-muted-foreground text-xs">Default</span>
      ) : null}
      <CheckIcon
        aria-hidden="true"
        className={cn("size-3.5 shrink-0", props.checked ? "opacity-100" : "opacity-0")}
      />
    </button>
  );
}

/** The model's own choices — its effort first — as the person has them now. */
function TraitsChoices({ traits }: { readonly traits: ComposerTraitsInput }) {
  const {
    descriptors,
    selectDescriptors,
    booleanDescriptors,
    modelIsUnavailable,
    selectedValue,
    isLocked,
    select,
    toggle,
  } = useTraitsControls(traits);

  if (modelIsUnavailable) {
    // The catalog no longer names this model: its saved choices are read,
    // not changed, until it does again.
    return descriptors.map((descriptor) => {
      const value = getProviderOptionCurrentLabel(descriptor);
      if (!value) return null;
      return (
        <div className="flex flex-col px-2 py-1" key={descriptor.id}>
          <span className="font-medium text-muted-foreground text-xs">{descriptor.label}</span>
          <span className="text-foreground text-line">{value}</span>
        </div>
      );
    });
  }

  return (
    <>
      {selectDescriptors.map((descriptor) => {
        const chosen = selectedValue(descriptor);
        const locked = isLocked(descriptor);
        return (
          <ChoiceGroup
            key={descriptor.id}
            label={descriptor.label}
            {...(locked
              ? {
                  note: 'Your prompt says "ultrathink". Remove it to choose another.',
                }
              : {})}
          >
            {descriptor.options.map((option, index) => (
              <Choice
                checked={option.id === chosen}
                description={option.description}
                disabled={locked}
                first={chosen === "" && index === 0}
                isDefault={option.isDefault === true}
                key={option.id}
                onSelect={() => select(descriptor, option.id)}
              >
                {option.label}
              </Choice>
            ))}
          </ChoiceGroup>
        );
      })}
      {booleanDescriptors.map((descriptor) => (
        <ChoiceGroup key={descriptor.id} label={descriptor.label}>
          {([true, false] as const).map((on) => (
            <Choice
              checked={(descriptor.currentValue === true) === on}
              first={false}
              key={String(on)}
              onSelect={() => toggle(descriptor, on)}
            >
              {on ? "On" : "Off"}
            </Choice>
          ))}
        </ChoiceGroup>
      ))}
    </>
  );
}

/**
 * The one menu's second column: the effort and the model's other choices,
 * then the access, with the chosen access said in a sentence under it.
 */
export const ComposerModelChoices = memo(function ComposerModelChoices(props: {
  /** The model's traits; `null` where there is no draft to hold them. */
  readonly traits: ComposerTraitsInput | null;
  readonly runtimeMode: RuntimeMode;
  readonly onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  return (
    <div
      className="flex w-54 shrink-0 flex-col gap-2 overflow-y-auto border-border/70 border-l bg-muted/40 p-1.5 max-sm:w-full max-sm:border-t max-sm:border-l-0"
      data-composer-model-choices="true"
    >
      {props.traits === null ? null : <TraitsChoices traits={props.traits} />}
      <ChoiceGroup label="Access">
        {ACCESS_MODES.map((mode) => (
          <Choice
            checked={mode === props.runtimeMode}
            first={false}
            key={mode}
            onSelect={() => props.onRuntimeModeChange(mode)}
          >
            {COMPOSER_ACCESS[mode].label}
          </Choice>
        ))}
        <p className="px-2 pt-1 pb-1.5 text-pretty text-muted-foreground text-xs">
          {COMPOSER_ACCESS[props.runtimeMode].description}
        </p>
      </ChoiceGroup>
    </div>
  );
});

/** The access, in the toolbar while it is not the usual setting. */
export const ComposerAccessControl = memo(function ComposerAccessControl(props: {
  readonly runtimeMode: RuntimeMode;
  readonly onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  const access = COMPOSER_ACCESS[props.runtimeMode];
  return (
    <Tooltip>
      <Select
        value={props.runtimeMode}
        onValueChange={(value) => {
          if (value !== null) props.onRuntimeModeChange(value);
        }}
      >
        <TooltipTrigger
          render={
            <ComposerSelectControl
              aria-label="Access"
              className="min-w-0 shrink"
              data-composer-shortcut="composer.mode"
              size="quiet"
            />
          }
        >
          <ComposerControlIcon icon={access.icon} size="quiet" />
          <SelectValue>{access.label}</SelectValue>
        </TooltipTrigger>
        <SelectPopup alignItemWithTrigger={false}>
          {ACCESS_MODES.map((mode) => {
            const option = COMPOSER_ACCESS[mode];
            const OptionIcon = option.icon;
            return (
              <SelectItem key={mode} value={mode} hideIndicator className="min-w-64">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                      <OptionIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      {option.label}
                    </span>
                    <span className="text-muted-foreground text-xs leading-4">
                      {option.description}
                    </span>
                  </div>
                </div>
              </SelectItem>
            );
          })}
        </SelectPopup>
      </Select>
      <TooltipPopup side="top">{access.description}</TooltipPopup>
    </Tooltip>
  );
});

/** Plan or build, where plan mode is on in the settings. */
export const ComposerInteractionModeToggle = memo(function ComposerInteractionModeToggle(props: {
  readonly interactionMode: ProviderInteractionMode;
  readonly onToggle: () => void;
}) {
  const planning = props.interactionMode === "plan";
  const tooltip = planning
    ? "Plan mode — click to return to normal build mode"
    : "Default mode — click to enter plan mode";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ComposerControl
            aria-label={tooltip}
            aria-pressed={planning}
            className="shrink-0"
            onClick={props.onToggle}
            size="quiet"
            type="button"
          />
        }
      >
        <ComposerControlIcon icon={planning ? PencilRulerIcon : BotIcon} size="quiet" />
        <span className="sr-only sm:not-sr-only">{planning ? "Plan" : "Build"}</span>
      </TooltipTrigger>
      <TooltipPopup side="top">{tooltip}</TooltipPopup>
    </Tooltip>
  );
});
