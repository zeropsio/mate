/**
 * The frame every crew editor shares (PRD §4.7): a sheet from the right with
 * a title, a scrolling body and a footer, labelled fields, and the split save
 * button whose first choice is the default (§5.6).
 *
 * A sheet's contents mount while it is open, so an editor reads the crew home
 * each time it opens (`useCrewHome` in the contents, never in the frame).
 */
import type { CrewApplyChoice } from "@t3tools/contracts";
import type { CrewDefinitionIssue } from "@t3tools/shared/crewHome";
import { ChevronDownIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../../ui/menu";
import { ScrollArea } from "../../ui/scroll-area";
import { Sheet, SheetDescription, SheetHeader, SheetPopup, SheetTitle } from "../../ui/sheet";
import { Pill } from "../primitives";
import { CREW_SAVE_CHOICES } from "./CrewEditors.logic";

export function CrewSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description?: string | undefined;
  /** `CrewSheetBody` then `CrewSheetFooter`. */
  readonly children: ReactNode;
}) {
  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetPopup>
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {description === undefined ? null : <SheetDescription>{description}</SheetDescription>}
        </SheetHeader>
        {children}
      </SheetPopup>
    </Sheet>
  );
}

export function CrewSheetBody({ children }: { readonly children: ReactNode }) {
  return (
    <div className="min-h-0 flex-1">
      <ScrollArea className="h-full">
        <div className="space-y-4 px-6 pb-6">{children}</div>
      </ScrollArea>
    </div>
  );
}

export function CrewSheetFooter({
  error,
  children,
}: {
  /** The last refusal's sentence. */
  readonly error: string | null;
  readonly children: ReactNode;
}) {
  return (
    <div className="space-y-2 border-t border-border px-6 py-4">
      {error === null ? null : (
        <p className="text-xs text-status-failed-text" role="alert">
          {error}
        </p>
      )}
      {children}
    </div>
  );
}

export function CrewField({
  label,
  hint,
  children,
}: {
  readonly label: string;
  readonly hint?: string | undefined;
  readonly children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-sm font-medium text-foreground">{label}</span>
      {children}
      {hint === undefined ? null : (
        <span className="block text-xs text-muted-foreground">{hint}</span>
      )}
    </label>
  );
}

/**
 * The split save button: the chosen choice as the press, the others in its
 * menu. `only` narrows the choices (a changed login saves only fresh).
 */
export function CrewSaveButton({
  choice,
  onChoice,
  onSave,
  only,
  disabled,
}: {
  readonly choice: CrewApplyChoice;
  readonly onChoice: (choice: CrewApplyChoice) => void;
  readonly onSave: (choice: CrewApplyChoice) => void;
  readonly only?: ReadonlyArray<CrewApplyChoice> | undefined;
  readonly disabled: boolean;
}) {
  const choices = CREW_SAVE_CHOICES.filter(
    (candidate) => only === undefined || only.includes(candidate.apply),
  );
  const current = choices.find((candidate) => candidate.apply === choice) ?? choices[0]!;
  return (
    <div className="flex items-center gap-1">
      <Pill disabled={disabled} label={current.label} onClick={() => onSave(current.apply)} />
      {choices.length === 1 ? null : (
        <Menu>
          <MenuTrigger
            render={<Button aria-label="Other ways to save" size="icon" variant="ghost" />}
          >
            <ChevronDownIcon className="size-4" />
          </MenuTrigger>
          <MenuPopup align="end">
            {choices.map((candidate) => (
              <MenuItem key={candidate.apply} onClick={() => onChoice(candidate.apply)}>
                <span className="block space-y-0.5">
                  <span className="block text-sm">{candidate.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {candidate.description}
                  </span>
                </span>
              </MenuItem>
            ))}
          </MenuPopup>
        </Menu>
      )}
    </div>
  );
}

/** An editor's place while the crew home is being read. */
export function CrewSheetReading({ error }: { readonly error: string | null }) {
  return (
    <>
      <CrewSheetBody>
        <p className="text-sm text-muted-foreground">Reading the crew's files…</p>
      </CrewSheetBody>
      <CrewSheetFooter error={error}>{null}</CrewSheetFooter>
    </>
  );
}

/** The crew home's issues, each in the format's own words. */
export function CrewIssues({ issues }: { readonly issues: ReadonlyArray<CrewDefinitionIssue> }) {
  if (issues.length === 0) return null;
  return (
    <ul className="space-y-1" role="alert">
      {issues.map((issue) => (
        <li
          className="text-xs text-status-failed-text"
          key={`${issue.code}:${issue.path}:${issue.handle ?? ""}`}
        >
          {issue.message}
        </li>
      ))}
    </ul>
  );
}
