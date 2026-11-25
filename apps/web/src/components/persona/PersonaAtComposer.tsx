/**
 * A Mate's persona at its composer (prototype, drawn by the arrival flow's persona states).
 *
 * The persona is a setting of the composer's foot, beside the model and the access: one quiet
 * control (`PersonaControl`) names how the Mate works with its person, and its menu changes it. It
 * is the Mate's, not the conversation's, and a choice is saved as it is made, as on the Persona
 * page: the Mate works that way from its next reply, in every conversation. Sending a message
 * writes nothing about it.
 *
 * Until its person first writes to a Mate that holds no persona, the composer suggests the
 * templates about the person (`PersonaSuggestions`): under it while the conversation is a draft (a
 * new project's Mate), over it under a setup's ask. A suggestion picked travels into the control
 * (`travelInto`) and the suggestions fold away; a message sent without one takes them away too,
 * and the Mate holds none. The control keeps the way in, and *None* the way out.
 */
import { ChevronDownIcon, DramaIcon, type LucideIcon } from "lucide-react";
import { type Ref, useId, useState } from "react";

import { prefersReducedMotion } from "~/lib/reducedMotion";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuItemText,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { Text } from "../ui/text";

/** One template as the composer offers it: its name, what it does and its mark (`personaIcon`). */
export interface PersonaChoice {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly icon: LucideIcon;
}

const NONE = "none";

function Glyph(props: { readonly icon: LucideIcon }) {
  const Icon = props.icon;
  return <Icon aria-hidden="true" />;
}

function DescribedRadioItem(props: {
  readonly value: string;
  readonly label: string;
  readonly description: string;
}) {
  const id = useId();
  return (
    <MenuRadioItem aria-describedby={id} value={props.value} variant="check">
      <MenuItemText description={props.description} descriptionId={id} label={props.label} />
    </MenuRadioItem>
  );
}

/**
 * The persona at the composer's foot, in the look of its model and access controls: the persona's
 * mark and name, or "Persona" while the Mate holds none. Its menu lists the templates, *None* and
 * *Edit personas…*, the Persona page.
 */
export function PersonaControl(props: {
  readonly mateName: string;
  readonly choices: readonly PersonaChoice[];
  readonly value: PersonaChoice | null;
  readonly onChange: (key: string | null) => void;
  readonly onEdit: () => void;
  /** The label's element: where a picked suggestion lands (`travelInto`). */
  readonly labelRef?: Ref<HTMLSpanElement>;
  readonly defaultOpen?: boolean;
}) {
  const { value } = props;
  return (
    <Menu defaultOpen={props.defaultOpen}>
      <MenuTrigger
        render={
          <Button
            aria-label={`${props.mateName}'s persona: ${value?.name ?? "none"}`}
            className="min-w-0 shrink"
            data-composer-persona={value?.key ?? NONE}
            size="sm"
            variant="ghost-muted"
          />
        }
      >
        <span className="flex min-w-0 items-center gap-1.5" ref={props.labelRef}>
          <Glyph icon={value?.icon ?? DramaIcon} />
          <span className="truncate">{value?.name ?? "Persona"}</span>
        </span>
        <ChevronDownIcon aria-hidden="true" />
      </MenuTrigger>
      <MenuPopup align="start" side="top" width="md">
        <MenuGroup>
          <MenuGroupLabel>How {props.mateName} works with you</MenuGroupLabel>
          <MenuRadioGroup
            onValueChange={(next: string) => props.onChange(next === NONE ? null : next)}
            value={value?.key ?? NONE}
          >
            {props.choices.map((choice) => (
              <DescribedRadioItem
                description={choice.description}
                key={choice.key}
                label={choice.name}
                value={choice.key}
              />
            ))}
            <DescribedRadioItem
              description={`${props.mateName} works as it does by default.`}
              label="None"
              value={NONE}
            />
          </MenuRadioGroup>
        </MenuGroup>
        <MenuSeparator />
        <MenuItem onClick={props.onEdit}>Edit personas…</MenuItem>
      </MenuPopup>
    </Menu>
  );
}

/**
 * The templates about the person, suggested beside the composer until its person first writes:
 * "Work with Wren as" and one press per template; the line under them says what the one under
 * the pointer or the focus does.
 */
export function PersonaSuggestions(props: {
  readonly mateName: string;
  readonly choices: readonly PersonaChoice[];
  /** `hero`: under a draft's composer, centred; `docked`: over the composer, from its start. */
  readonly layout: "hero" | "docked";
  /** One was picked: they fade and fold away (`--duration-base`), then leave. */
  readonly folding: boolean;
  readonly onPick: (key: string, from: HTMLElement) => void;
}) {
  const [described, setDescribed] = useState<PersonaChoice | null>(null);
  const hero = props.layout === "hero";
  return (
    <div
      className={cn(
        "grid animate-rise-in transition-[grid-template-rows,opacity] duration-200 ease-out-strong motion-reduce:transition-none",
        props.folding ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr]",
      )}
      data-persona-suggestions={props.layout}
      inert={props.folding}
    >
      <div
        className={cn(
          "flex min-h-0 flex-col gap-1.5",
          props.folding && "overflow-hidden",
          hero ? "items-center pt-5" : "items-start px-1 pb-2.5",
        )}
      >
        <div className={cn("flex flex-wrap items-center gap-1.5", hero && "justify-center")}>
          <Text className="pe-1" variant="remark">
            Work with {props.mateName} as
          </Text>
          {props.choices.map((choice) => (
            <Button
              data-persona-suggestion={choice.key}
              key={choice.key}
              onBlur={() => setDescribed(null)}
              onClick={(event) => props.onPick(choice.key, event.currentTarget)}
              onFocus={() => setDescribed(choice)}
              onPointerEnter={() => setDescribed(choice)}
              onPointerLeave={() => setDescribed(null)}
              shape="round"
              size="sm"
              variant="secondary"
            >
              <Glyph icon={choice.icon} />
              {choice.name}
            </Button>
          ))}
        </div>
        {/* One line, held while empty, so nothing under it moves as the pointer passes. */}
        <Text className="min-h-4" render={<p />} variant="note">
          {described?.description ?? "\u00a0"}
        </Text>
      </div>
    </div>
  );
}

/**
 * The picked suggestion's travel into the control: the control's label starts where the press's
 * mark and name were and settles in its own place, so the eye follows the choice to where it now
 * lives. At once where the person asked for less motion.
 */
export function travelInto(from: HTMLElement, label: HTMLElement | null): void {
  if (label === null || prefersReducedMotion()) return;
  const start = (from.querySelector("svg") ?? from).getBoundingClientRect();
  const end = (label.querySelector("svg") ?? label).getBoundingClientRect();
  label.animate(
    [
      { transform: `translate(${start.left - end.left}px, ${start.top - end.top}px)` },
      { transform: "translate(0, 0)" },
    ],
    { duration: 320, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
  );
}
