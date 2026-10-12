/**
 * Setting up the person's Chief: what a Chief is, in plain words, then *Set up Chief* — and, once
 * pressed, its three steps in place, a stopped one saying why with *Try again*. Props only: the
 * host runs the steps (`chiefSetup.ts`).
 */
import { useNowMs } from "~/zerops/useNowMs";

import { MateMark } from "../../MateMark";
import { Button } from "../../ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../ui/dialog";
import { ProcessSteps } from "../primitives";
import { birthStepToProcessStep } from "../ZeropsBirthProgress.logic";
import { chiefSetupSteps, type ChiefSetup } from "./chiefSetup.logic";

/** What a Chief is, for people: one line each. */
export const CHIEF_IS: ReadonlyArray<string> = [
  "A Mate for your whole organization.",
  "It lives in its own project, with one container.",
  "It runs on your own coding agent's sign-in.",
  "It sees what you can see.",
  "It changes nothing without your Approve.",
];

export interface ChiefSetupBodyProps {
  readonly setup: ChiefSetup;
  /** Why it cannot start here, where it cannot. */
  readonly blocked?: string | undefined;
  readonly onSetUp: () => void;
  readonly onAgain: () => void;
}

/** The dialog's content, for the dialog and a design harness alike. */
export function ChiefSetupBody({ setup, blocked, onSetUp, onAgain }: ChiefSetupBodyProps) {
  // Its steps carry no clock of their own: none says how long it took.
  const now = useNowMs();
  const steps = chiefSetupSteps(setup);
  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-3">
          <MateMark className="h-9 w-7.5 shrink-0" />
          <DialogTitle>Set up your Chief</DialogTitle>
        </div>
        <DialogDescription className="sr-only">
          What your Chief is, then its setup.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel data-zerops-surface="chief-setup">
        <div className="grid gap-4">
          <ul className="grid gap-1.5 text-sm text-foreground">
            {CHIEF_IS.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {setup.phase === "idle" ? null : (
            <ProcessSteps
              aria-label="Setting up your Chief"
              steps={steps.map((step) => birthStepToProcessStep(step, now))}
            />
          )}
          {blocked === undefined ? null : (
            <p className="text-xs text-muted-foreground">{blocked}</p>
          )}
        </div>
      </DialogPanel>
      <DialogFooter>
        <DialogClose
          render={
            <Button size="sm" variant="ghost">
              {setup.phase === "idle" ? "Not now" : "Close"}
            </Button>
          }
        />
        {setup.phase === "idle" ? (
          <Button disabled={blocked !== undefined} onClick={onSetUp} size="sm">
            Set up Chief
          </Button>
        ) : setup.phase === "failed" ? (
          <Button onClick={onAgain} size="sm">
            Try again
          </Button>
        ) : null}
      </DialogFooter>
    </>
  );
}

export function ChiefSetupDialog(
  props: ChiefSetupBodyProps & {
    readonly open: boolean;
    readonly onOpenChange: (open: boolean) => void;
  },
) {
  const { open, onOpenChange, ...body } = props;
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup className="max-w-md">
        <ChiefSetupBody {...body} />
      </DialogPopup>
    </Dialog>
  );
}
