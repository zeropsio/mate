/**
 * An account's first run is a screen of its own (`useClaimWholeWindow`): the account holds nothing
 * the menu could list yet, so no menu stands around it — Zerops' logo in one corner, the account
 * in the other, and the one job between them.
 *
 * One who may start a project meets its first Mate by name, centred (the owner's design,
 * 2026-11-26): its face, large, its eyes on the pointer, with its colours and shapes opening as a
 * ring around it (*Change style*); the heading naming it, its name editable where it stands;
 * *Shuffle*; then the project's name and the press that starts the project with it, its access
 * and region folded under it. The New project form is the page itself (`useNewProjectAnswer`,
 * `useNewProjectForm`). Create carries the face onto the first Mate's own page (`mate-birth`), and
 * the menu comes with that page.
 *
 * One who may not start a project is told why the page is empty, under a face that waits.
 */
import type { ZeropsMateFace } from "@t3tools/client-runtime/zerops";
import { Building2Icon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import { Text } from "~/components/ui/text";
import { cn } from "~/lib/utils";

import { ZeropsMark } from "../../ZeropsMark";
import { sidebarAccountDestinationIcon } from "../../sidebar/SidebarChrome";
import { useClaimWholeWindow } from "../../wholeWindow";
import { MateFacePreview, MateFaceRing } from "../MateFacePicker";
import { MateNameText } from "../MateNameText";
import { SidebarZeropsAccountRow } from "../SidebarZeropsAccount";
import { useNewProjectAnswer } from "../ZeropsNewProjectHost";
import {
  CreateProjectButton,
  NEW_PROJECT_HEADING_CLASS,
  NEW_PROJECT_LINE,
  NewMateTools,
  NewProjectFormFrame,
  NewProjectLine,
  NewProjectNameInput,
  NewProjectSetup,
  useNewMateShuffle,
  useNewProjectForm,
  type NewProjectForm,
  type NewProjectFormInput,
} from "../ZeropsNewProjectForm";
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
  const words = firstRunWords({ create: form !== undefined, reachesEveryProject });
  return (
    <section
      className="@container/first-run relative isolate flex min-h-0 min-w-0 flex-auto flex-col overflow-y-auto bg-background"
      data-first-run={words.kind}
      data-zerops-surface="first-run"
    >
      {/* Along the top: Zerops' logo and the account. */}
      <header className="flex h-16 shrink-0 items-center justify-between gap-4 ps-6 pe-3">
        <ZeropsMark className="h-6.5 w-auto text-foreground" named variant="company" />
        <div className="w-68 min-w-0">{account}</div>
      </header>
      {words.kind === "start" && form !== undefined && nameField !== undefined ? (
        <FirstRunStage form={form} nameField={nameField} note={words.note} />
      ) : words.kind === "wait" ? (
        <div className="m-auto flex w-full max-w-140 flex-col items-center px-6 pt-4 pb-16 text-center">
          <MateFacePreview className="size-16" face={NOBODY} />
          <FirstRunTitle className="mt-4 text-title font-medium tracking-tight text-balance text-foreground">
            {words.heading}
          </FirstRunTitle>
          <p className="mt-2.5 max-w-lg text-emphasis leading-5.75 text-pretty text-muted-foreground">
            {words.body}
          </p>
        </div>
      ) : null}
    </section>
  );
}

/**
 * The first Mate and the project, one centred column, to the design's measures: the face's ring
 * 16 px in from above and below, 10 px over the heading; *Shuffle* and *Change style* 16 px under
 * it and 64 px over the project's name; the form 480 px wide, its name and press 48 px each, 16 px apart,
 * the setup 20 px under the press.
 */
function FirstRunStage({
  form,
  nameField,
  note,
}: {
  readonly form: NewProjectForm;
  readonly nameField: RefObject<HTMLInputElement | null>;
  readonly note: string | undefined;
}) {
  const [styling, setStyling] = useState(false);
  const shuffle = useNewMateShuffle(form);
  const { closed, creating, forecast } = form.input;
  // By the name as it is typed; with none yet, the Mate it will be.
  const called = form.botName.replace(/\s+/g, " ").trim();
  return (
    <NewProjectFormFrame
      className="m-auto flex w-full max-w-176 flex-col items-center px-6 pt-4 pb-16"
      form={form}
    >
      <MateFaceRing
        className="my-4"
        face={form.face}
        onPickShape={form.pickShape}
        onPickTint={form.pickTint}
        open={styling}
        size="page"
      />
      <FirstRunTitle className={cn(NEW_PROJECT_HEADING_CLASS, "mt-2.5")}>
        Meet{" "}
        <MateNameText
          describedBy={NEW_PROJECT_LINE}
          invalid={form.refused !== undefined}
          onValueChange={form.nameMate}
          readOnly={creating}
          value={form.botName}
        />
        , your first Mate
      </FirstRunTitle>
      <NewMateTools
        className="mt-4"
        form={form}
        onStyling={setStyling}
        shuffle={shuffle}
        styling={styling}
      />
      <div className="flex w-full max-w-120 flex-col gap-4 px-2 pt-16 pb-10">
        {closed === undefined ? (
          <>
            <NewProjectNameInput form={form} inputRef={nameField} />
            <CreateProjectButton
              className="w-full"
              form={form}
              label={called === "" ? "Start a project" : `Start a project with ${called}`}
              rolling={shuffle.rolling}
              size="lg"
            />
            {/* What is wrong or what it waits on; saying nothing, it gives the gap back. */}
            <NewProjectLine className="text-center empty:-mt-4" form={form} />
            {forecast}
            <NewProjectSetup className="pt-1" form={form} />
            {note === undefined ? null : (
              <p className="mt-2 text-center text-caption leading-4.25 text-pretty text-muted-foreground">
                {note}
              </p>
            )}
          </>
        ) : (
          <Text className="m-0 text-center" render={<p />} variant="description">
            {closed}
          </Text>
        )}
      </div>
    </NewProjectFormFrame>
  );
}

/** The screen's one headline: its own, with no page around it. */
function FirstRunTitle({
  className,
  children,
}: {
  readonly className: string;
  readonly children: ReactNode;
}) {
  return <h1 className={className}>{children}</h1>;
}
