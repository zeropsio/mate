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
  return (
    <section
      className="first-run"
      data-first-run={form === undefined ? "wait" : "start"}
      data-zerops-surface="first-run"
      style={{ "--first-run-tint": `var(--zerops-mate-tint-${face.tint})` } as CSSProperties}
    >
      <div aria-hidden className="first-run-ground" />
      <header className="first-run-bar">
        <MateMark awake playful className="h-6 w-auto" />
        <div className="first-run-account">{account}</div>
      </header>
      <div className="first-run-stage">
        <div className="first-run-intro">
          <div className="first-run-hero">
            <span aria-hidden className="first-run-glow" />
            <MateFacePreview className="first-run-face" face={face} tracks={form !== undefined} />
          </div>
          {words.welcome === undefined ? null : (
            <p className="first-run-welcome">{words.welcome}</p>
          )}
          <h1 className="first-run-heading">{words.heading}</h1>
          <p className="first-run-body">{words.body}</p>
          {form !== undefined || words.note === undefined ? null : (
            <p className="first-run-note">{words.note}</p>
          )}
        </div>
        {form === undefined || nameField === undefined ? null : (
          <>
            <FirstRunForm form={form} nameField={nameField} />
            <div className="first-run-after">
              <FirstRunNext form={form} />
              {words.note === undefined ? null : <p className="first-run-note">{words.note}</p>}
            </div>
          </>
        )}
      </div>
    </section>
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
    <NewProjectFormFrame className="first-run-form" form={form}>
      {form.input.closed === undefined ? (
        <>
          <NewProjectFields className="flex flex-col gap-5" form={form}>
            <ProjectNameField form={form} inputRef={nameField} size="xl" />
            <FirstMateField form={form} label="Your first Mate" look="apart" size="xl" />
            {access === undefined ? null : access(form.setUserRoles)}
            <NewProjectLocation form={form} />
          </NewProjectFields>
          <div className="first-run-create">
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
      <ol className="first-run-steps">
        {next.steps.map((step, index) => (
          <li className="first-run-step" key={step.words}>
            <span aria-hidden className="first-run-step-number">
              {index + 1}
            </span>
            <span className="first-run-step-words">
              {step.phrase === undefined ? step.words : <SignInPhrase parts={step.phrase} />}
              {step.time === undefined ? null : (
                <span className="first-run-step-time">{step.time}</span>
              )}
            </span>
          </li>
        ))}
      </ol>
      <p className="first-run-leave">{next.note}</p>
    </section>
  );
}
