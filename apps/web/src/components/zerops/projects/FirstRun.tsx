/**
 * An account's first run is a screen of its own (`useClaimWholeWindow`): the account holds nothing
 * the menu could list yet, so no menu stands around it — Mate's mark in one corner, the account in
 * the other, and the one job between them.
 *
 * One who may start a project meets its first Mate by name: its face, large, its eyes on the
 * pointer, the heading naming it as its name is typed, one sentence on what a Mate is. The New
 * project form is the page itself (`useNewProjectAnswer`, `useNewProjectForm`): the project's name,
 * then the Mate's name and look, whose colour and shape the face above turns into as they are
 * picked. Under the words, what happens after Create (`newProjectNext`) — under the form where the window is narrow, so the form comes first. Create carries the face onto the first Mate's own page (`mate-birth`), and
 * the menu comes with that page.
 *
 * One who may not start a project is told why the page is empty, under a face that waits.
 */
import type { ZeropsMateFace } from "@t3tools/client-runtime/zerops";
import { Building2Icon } from "lucide-react";
import { useEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from "react";

import { cn } from "~/lib/utils";

import { MateMark } from "../../MateMark";
import { sidebarAccountDestinationIcon } from "../../sidebar/SidebarChrome";
import { useClaimWholeWindow } from "../../wholeWindow";
import { MateFacePreview } from "../MateFacePicker";
import { SidebarZeropsAccountRow } from "../SidebarZeropsAccount";
import { SignInPhrase } from "../ZeropsArrivalSteps";
import { useNewProjectAnswer } from "../ZeropsNewProjectHost";
import {
  CreateProjectButton,
  FirstMateField,
  NewProjectFields,
  NewProjectFormFrame,
  NewProjectLine,
  NewProjectLocation,
  ProjectNameField,
  useNewProjectForm,
  type NewProjectForm,
  type NewProjectFormInput,
} from "../ZeropsNewProjectForm";
import { newProjectNext } from "../whatHappensNext.logic";
import { firstRunWords } from "./firstRun.logic";

/** Who waits with a person who may not start a project: nobody yet, in the slate face. */
const NOBODY: ZeropsMateFace = { tint: "slate", shape: "squircle" };

/** The screen, wired: it holds the whole window while it stands. */
export function FirstRunScreen({
  creates,
  reachesEveryProject,
}: {
  /** The viewer's role starts projects. */
  readonly creates: boolean;
  readonly reachesEveryProject: boolean;
}) {
  useClaimWholeWindow();
  const account = <FirstRunAccount />;
  return creates ? (
    <FirstRunStart account={account} reachesEveryProject={reachesEveryProject} />
  ) : (
    <FirstRunView account={account} form={undefined} reachesEveryProject={reachesEveryProject} />
  );
}

function FirstRunStart({
  account,
  reachesEveryProject,
}: {
  readonly account: ReactNode;
  readonly reachesEveryProject: boolean;
}) {
  const answer = useNewProjectAnswer();
  // The organization is chosen before a first run is: its read back is never awaited here.
  if (answer.kind !== "form") return null;
  return (
    <FirstRunFormView
      account={account}
      input={answer.form}
      reachesEveryProject={reachesEveryProject}
    />
  );
}

/** The screen with its form, from the form's input: what the app and the design harness draw. */
export function FirstRunFormView({
  input,
  account,
  reachesEveryProject,
}: {
  readonly input: NewProjectFormInput;
  readonly account: ReactNode;
  readonly reachesEveryProject: boolean;
}) {
  const nameField = useRef<HTMLInputElement>(null);
  const form = useNewProjectForm(input, nameField);
  // It opens on the project's name, ready to type, where a keyboard is at hand: never raising a
  // phone's over the Mate it introduces.
  useEffect(() => {
    if (window.matchMedia("(pointer: fine)").matches) nameField.current?.focus();
  }, []);
  return (
    <FirstRunView
      account={account}
      form={form}
      nameField={nameField}
      reachesEveryProject={reachesEveryProject}
    />
  );
}

/** The account in the screen's corner: who is signed in, the organization, and the way out. */
function FirstRunAccount() {
  return (
    <SidebarZeropsAccountRow
      chiefIcon={<Building2Icon />}
      destinationIcon={sidebarAccountDestinationIcon}
      unlisted
    />
  );
}

export function FirstRunView({
  form,
  nameField,
  account,
  reachesEveryProject,
}: {
  /** The New project form, where the viewer's role starts projects. */
  readonly form: NewProjectForm | undefined;
  /** Its project's name field. */
  readonly nameField?: RefObject<HTMLInputElement | null> | undefined;
  readonly account: ReactNode;
  readonly reachesEveryProject: boolean;
}) {
  const words = firstRunWords({
    create: form !== undefined,
    reachesEveryProject,
    mateName: form?.calledName ?? "",
  });
  const face = form?.face ?? NOBODY;
  const waits = form === undefined;
  return (
    <section
      className="@container/first-run relative isolate flex min-h-0 min-w-0 flex-auto flex-col overflow-y-auto bg-background"
      data-first-run={waits ? "wait" : "start"}
      data-zerops-surface="first-run"
      style={{ "--first-run-tint": `var(--zerops-mate-tint-${face.tint})` } as CSSProperties}
    >
      {/* The faint dotted ground, fading out from behind the words. */}
      {waits ? null : (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-1 bg-radial from-foreground/15 from-6% to-transparent to-8% [background-size:22px_22px] [mask-image:radial-gradient(ellipse_46%_58%_at_34%_46%,var(--foreground)_0%,transparent_76%)]"
        />
      )}
      {/* Along the top: Mate's mark and the account. */}
      <header className="flex h-16 shrink-0 items-center justify-between gap-4 ps-6 pe-3">
        <MateMark awake playful className="h-6 w-auto" />
        <div className="w-68 min-w-0">{account}</div>
      </header>
      {/* The words, the card and the steps after Create: one column, two where it is wide — the
          words and the steps on the left, the card beside both, a little above the window's
          middle (the room under them), where the eye takes its centre to be. */}
      <div className={waits ? WAIT_STAGE_CLASS : START_STAGE_CLASS}>
        <div
          className={cn(
            "flex min-w-0 flex-col @min-[960px]/first-run:self-end",
            waits
              ? "items-center"
              : "items-start @min-[960px]/first-run:col-start-1 @min-[960px]/first-run:row-start-1",
          )}
        >
          {/* The first Mate, large, in a glow of its own colour, on a soft shadow; beside the card
              it steps a touch into the margin so its outline, not its box, lines up with the
              words. */}
          <div
            className={cn(
              "relative grid size-28 place-items-center",
              !waits &&
                "@min-[960px]/first-run:-ms-2 after:absolute after:bottom-0.5 after:left-1/2 after:h-2.5 after:w-18 after:-translate-x-1/2 after:rounded-full after:bg-radial after:from-(--zerops-scrim) after:to-transparent after:to-70%",
            )}
          >
            {waits ? null : (
              <span
                aria-hidden
                className="pointer-events-none absolute -inset-8 rounded-full bg-radial from-(--first-run-tint)/56 via-(--first-run-tint)/18 via-40% to-transparent to-64%"
              />
            )}
            <MateFacePreview
              className={waits ? "size-16" : "size-24"}
              face={face}
              tracks={!waits}
            />
          </div>
          {words.welcome === undefined ? null : (
            <p className="mt-5 text-body leading-4.5 font-medium text-muted-foreground">
              {words.welcome}
            </p>
          )}
          <h1
            className={cn(
              "font-medium tracking-tight text-balance text-foreground",
              waits ? "mt-4 text-title" : "mt-1.5 text-display",
            )}
          >
            {words.heading}
          </h1>
          <p className="mt-2.5 max-w-lg text-emphasis leading-5.75 text-pretty text-muted-foreground">
            {words.body}
          </p>
          {!waits || words.note === undefined ? null : <FirstRunNote note={words.note} />}
        </div>
        {form === undefined || nameField === undefined ? null : (
          <>
            <FirstRunForm form={form} nameField={nameField} />
            <div className="max-w-lg min-w-0 @min-[960px]/first-run:col-start-1 @min-[960px]/first-run:row-start-2 @min-[960px]/first-run:self-start">
              <FirstRunNext form={form} />
              {words.note === undefined ? null : <FirstRunNote note={words.note} />}
            </div>
          </>
        )}
      </div>
      {/* Wide, the room under the stage, which sets it a little above the window's middle. */}
      <div
        aria-hidden
        className="hidden h-[calc(80px+8vh)] shrink-0 @min-[960px]/first-run:block"
      />
    </section>
  );
}

const START_STAGE_CLASS =
  "m-auto grid w-full max-w-270 grid-cols-[minmax(0,1fr)] gap-10 px-6 pt-4 pb-12 @min-[960px]/first-run:grid-cols-[minmax(0,1fr)_minmax(0,480px)] @min-[960px]/first-run:gap-x-20 @min-[960px]/first-run:gap-y-8 @min-[960px]/first-run:pb-0";
const WAIT_STAGE_CLASS =
  "m-auto grid w-full max-w-140 grid-cols-[minmax(0,1fr)] gap-10 px-6 pt-4 pb-12 text-center @min-[960px]/first-run:gap-x-20 @min-[960px]/first-run:gap-y-8 @min-[960px]/first-run:pb-0";

function FirstRunNote({ note }: { readonly note: ReactNode }) {
  return (
    <p className="mt-5 max-w-lg text-caption leading-4.25 text-pretty text-muted-foreground">
      {note}
    </p>
  );
}

/** The New project form, as the page's card: the project, its first Mate, who opens it, Create. */
function FirstRunForm({
  form,
  nameField,
}: {
  readonly form: NewProjectForm;
  readonly nameField: RefObject<HTMLInputElement | null>;
}) {
  const { access, forecast } = form.input;
  return (
    // The New project form as the page's card, lifting off the ground on a shadow.
    <NewProjectFormFrame
      className="flex min-w-0 flex-col gap-6 rounded-sheet border border-border bg-card px-7 pt-7 pb-3 shadow-(--zerops-shadow-card) @min-[960px]/first-run:col-start-2 @min-[960px]/first-run:row-span-2 @min-[960px]/first-run:row-start-1 @min-[960px]/first-run:self-center"
      form={form}
    >
      {form.input.closed === undefined ? (
        <>
          <NewProjectFields className="flex flex-col gap-5" form={form}>
            <ProjectNameField form={form} inputRef={nameField} size="xl" />
            <FirstMateField form={form} label="Your first Mate" size="xl" />
            {access === undefined ? null : access(form.setUserRoles)}
            <NewProjectLocation form={form} />
          </NewProjectFields>
          <div className="grid gap-2">
            <CreateProjectButton form={form} size="lg" />
            <NewProjectLine className="min-h-5" form={form} />
            {forecast}
          </div>
        </>
      ) : (
        <p className="text-body text-muted-foreground">{form.input.closed}</p>
      )}
    </NewProjectFormFrame>
  );
}

/** What happens after Create, as a line of steps. */
function FirstRunNext({ form }: { readonly form: NewProjectForm }) {
  const next = newProjectNext({ projectName: form.name, botName: form.botName });
  return (
    <section aria-label="What happens next">
      {/* The steps down a thin line, each number in the Mate's colour. */}
      <ol className="flex flex-col gap-3.5">
        {next.steps.map((step, index) => (
          <li
            className="relative grid grid-cols-[22px_minmax(0,1fr)] items-start gap-3 not-last:before:absolute not-last:before:top-6.5 not-last:before:-bottom-2.5 not-last:before:left-[10.5px] not-last:before:w-px not-last:before:bg-border"
            key={step.words}
          >
            <span
              aria-hidden
              className="inline-flex size-5.5 items-center justify-center rounded-full bg-(--first-run-tint)/22 text-caption leading-none font-medium text-foreground tabular-nums"
            >
              {index + 1}
            </span>
            <span className="pt-px text-prose leading-5 text-pretty text-foreground">
              {step.phrase === undefined ? step.words : <SignInPhrase parts={step.phrase} />}
              {step.time === undefined ? null : (
                <span className="ms-2 text-body whitespace-nowrap text-muted-foreground tabular-nums">
                  {step.time}
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
      {/* A last caption under the steps, on the steps' words' edge. */}
      <p className="mt-3.5 ps-8.5 text-caption leading-4.25 text-muted-foreground">{next.note}</p>
    </section>
  );
}
