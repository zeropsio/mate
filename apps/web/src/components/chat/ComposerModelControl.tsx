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
import { Select as SelectPrimitive } from "@base-ui/react/select";
import {
  BotIcon,
  ChevronDownIcon,
  LockIcon,
  LockOpenIcon,
  PencilRulerIcon,
  PenLineIcon,
  SparklesIcon,
  type LucideIcon,
} from "lucide-react";
import { memo, type ReactNode } from "react";

import { Button } from "../ui/button";
import { RadioGroup, RadioRow } from "../ui/radio-group";
import { Select, SelectItem, SelectPopup, SelectValue } from "../ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useTraitsControls } from "./TraitsPicker";
import { Text } from "~/components/ui/text";

/** What the traits are read from and written to: the model, the prompt, the draft. */
export type ComposerTraitsInput = Parameters<typeof useTraitsControls>[0];

const COMPOSER_ACCESS: Record<
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

/** A group of the menu's choices under its label; the arrow keys walk them and pick as they go. */
function ChoiceGroup(props: {
  readonly label: string;
  readonly note?: ReactNode;
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly disabled?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <RadioGroup
      aria-label={props.label}
      disabled={props.disabled}
      layout="list"
      onValueChange={(value) => {
        if (typeof value === "string") props.onValueChange(value);
      }}
      value={props.value}
    >
      <Text className="px-2 pt-2 pb-1" render={<p />} variant="label">
        {props.label}
      </Text>
      {props.note === undefined ? null : (
        <Text className="px-2 pb-1" render={<p />} variant="note">
          {props.note}
        </Text>
      )}
      {props.children}
    </RadioGroup>
  );
}

function Choice(props: {
  readonly value: string;
  readonly isDefault?: boolean;
  readonly description?: string | undefined;
  readonly children: ReactNode;
}) {
  return (
    <RadioRow
      line={props.description}
      lineWraps
      meta={props.isDefault ? "Default" : undefined}
      size="xs"
      title={props.children}
      value={props.value}
    />
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
          <Text variant="label">{descriptor.label}</Text>
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
            disabled={locked}
            key={descriptor.id}
            label={descriptor.label}
            onValueChange={(id) => select(descriptor, id)}
            value={chosen}
            {...(locked
              ? {
                  note: 'Your prompt says "ultrathink". Remove it to choose another.',
                }
              : {})}
          >
            {descriptor.options.map((option) => (
              <Choice
                description={option.description}
                isDefault={option.isDefault === true}
                key={option.id}
                value={option.id}
              >
                {option.label}
              </Choice>
            ))}
          </ChoiceGroup>
        );
      })}
      {booleanDescriptors.map((descriptor) => (
        <ChoiceGroup
          key={descriptor.id}
          label={descriptor.label}
          onValueChange={(value) => toggle(descriptor, value === "on")}
          value={descriptor.currentValue === true ? "on" : "off"}
        >
          <Choice value="on">On</Choice>
          <Choice value="off">Off</Choice>
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
      <ChoiceGroup
        label="Access"
        onValueChange={(value) => {
          const mode = ACCESS_MODES.find((each) => each === value);
          if (mode !== undefined) props.onRuntimeModeChange(mode);
        }}
        value={props.runtimeMode}
      >
        {ACCESS_MODES.map((mode) => (
          <Choice key={mode} value={mode}>
            {COMPOSER_ACCESS[mode].label}
          </Choice>
        ))}
        <Text className="px-2 pt-1 pb-1.5" render={<p />} variant="note">
          {COMPOSER_ACCESS[props.runtimeMode].description}
        </Text>
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
  const AccessIcon = access.icon;
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
            <SelectPrimitive.Trigger
              render={
                <Button
                  aria-label="Access"
                  className="min-w-0 shrink"
                  data-composer-shortcut="composer.mode"
                  size="sm"
                  variant="ghost-muted"
                />
              }
            />
          }
        >
          <AccessIcon aria-hidden="true" />
          <SelectValue>{access.label}</SelectValue>
          <ChevronDownIcon aria-hidden="true" />
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
                    <Text variant="note">{option.description}</Text>
                  </div>
                </div>
              </SelectItem>
            );
          })}
        </SelectPopup>
      </Select>
      <TooltipPopup side="top">Change access</TooltipPopup>
    </Tooltip>
  );
});

/** Plan or build, where plan mode is on in the settings. */
export const ComposerInteractionModeToggle = memo(function ComposerInteractionModeToggle(props: {
  readonly interactionMode: ProviderInteractionMode;
  readonly onToggle: () => void;
}) {
  const planning = props.interactionMode === "plan";
  const tooltip = planning ? "Back to build mode" : "Switch to plan mode";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={tooltip}
            aria-pressed={planning}
            className="shrink-0"
            // Plan mode on wears the ghost's pressed ground.
            data-pressed={planning ? "" : undefined}
            onClick={props.onToggle}
            size="sm"
            variant="ghost-muted"
          />
        }
      >
        {planning ? <PencilRulerIcon aria-hidden="true" /> : <BotIcon aria-hidden="true" />}
        <span className="sr-only sm:not-sr-only">{planning ? "Plan" : "Build"}</span>
      </TooltipTrigger>
      <TooltipPopup side="top">{tooltip}</TooltipPopup>
    </Tooltip>
  );
});
