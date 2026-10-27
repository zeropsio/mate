/**
 * The frame every Crew tab view shares — setup, the crew's goal, a
 * crewmate's job — in place of the tab's column: "‹ Crew" back to it (or the
 * setup's ×), a heading, the view's fields, and a footer that stays in reach
 * at the panel's foot with its one line and its presses.
 *
 * A view's contents mount while it is open, so it reads the crew home each
 * time it opens (`useCrewHome` in the view, never in the frame).
 */
import { CREW_VIEW_WORDS } from "@t3tools/client-runtime/zerops/crew/phrases";
import type { CrewDefinitionIssue } from "@t3tools/shared/crewHome";
import { ChevronLeftIcon } from "lucide-react";
import type { ReactNode, TextareaHTMLAttributes } from "react";

export function CrewView({
  onBack,
  children,
}: {
  /** "‹ Crew": back to the tab's column; `null` where the view has its own way out. */
  readonly onBack: (() => void) | null;
  /** The view's heading and fields, then its `CrewViewFoot`. */
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col px-4 pt-3" data-crew-view>
      {onBack === null ? null : (
        <button
          className="-ms-1.5 flex h-7 cursor-pointer items-center gap-0.5 self-start rounded-lg ps-0.5 pe-2 font-medium text-line leading-4.5 text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          data-crew-view-back
          onClick={onBack}
          type="button"
        >
          <ChevronLeftIcon aria-hidden="true" className="size-4" />
          {CREW_VIEW_WORDS.back}
        </button>
      )}
      {children}
    </div>
  );
}

/** A view's footer, at the panel's foot while the view is short, in reach while it scrolls. */
export function CrewViewFoot({ children }: { readonly children: ReactNode }) {
  return (
    <>
      <span className="min-h-6 grow" />
      <div className="crew-view-foot -mx-4">{children}</div>
    </>
  );
}

/** A view's field: its name, the line saying what it is, whether it may stay empty. */
/** The room above a field: 20 px between fields, 22 under a view's heading, 24 under a face. */
const FIELD_GAP = { 20: "mt-5", 22: "mt-5.5", 24: "mt-6" } as const;

export function CrewViewField({
  label,
  line,
  optional = false,
  gap = 20,
  children,
}: {
  readonly label: string;
  readonly line?: string | undefined;
  readonly optional?: boolean;
  readonly gap?: keyof typeof FIELD_GAP;
  readonly children: ReactNode;
}) {
  return (
    <div className={`${FIELD_GAP[gap]} flex flex-col`}>
      <span className="flex items-baseline gap-1.5">
        <span className="font-medium text-sm leading-5">{label}</span>
        {optional ? (
          <span className="text-line leading-4.5 text-muted-foreground">
            {CREW_VIEW_WORDS.optional}
          </span>
        ) : null}
      </span>
      {line === undefined ? null : (
        <span className="mt-0.5 text-line leading-4.5 text-muted-foreground">{line}</span>
      )}
      <div className="mt-2">{children}</div>
    </div>
  );
}

/**
 * A text box that grows with what is written (`field-sizing: content`, as the
 * kit's own text box does), from `lines` lines while nearly empty.
 */
export function CrewTextArea({
  lines,
  ...props
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className" | "rows"> & {
  readonly value: string;
  /** Its height while nearly empty: four lines, or six. */
  readonly lines?: 4 | 6;
}) {
  return <textarea {...props} className="crew-field" data-lines={lines} rows={1} />;
}

/** The crew home's issues, each in the format's own words. */
export function CrewIssues({ issues }: { readonly issues: ReadonlyArray<CrewDefinitionIssue> }) {
  if (issues.length === 0) return null;
  return (
    <ul className="space-y-1" role="alert">
      {issues.map((issue) => (
        <li
          className="text-line leading-4.5 text-status-failed-text"
          key={`${issue.code}:${issue.path}:${issue.handle ?? ""}`}
        >
          {issue.message}
        </li>
      ))}
    </ul>
  );
}

/** A view's place while the crew home is being read: nothing to take back, or why it failed. */
export function CrewViewReading({ error }: { readonly error: string | null }) {
  return error === null ? null : (
    <p className="mt-6 text-line text-status-failed-text" role="alert">
      {error}
    </p>
  );
}
