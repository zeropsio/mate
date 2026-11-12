/**
 * A production deployed outside Mate, on the project's page: the row that says so in the place of
 * the Going live card (`FollowsMain`), and the short form that says it, changes its address or
 * takes it back (`OutsideProductionForm`), a dialog opened from the section's own action:
 * *Already live elsewhere* over Going live, *Change* over the row. An Owner or Admin presses;
 * anyone else reads the row.
 *
 * It is what somebody said, never something Mate saw: no word here says a deploy ran.
 */
import { FOLLOWS_MAIN_MEANS, PRODUCTION_FOLLOWS_MAIN } from "@t3tools/client-runtime/zerops";
import { OUTSIDE_NEEDS_UPDATE } from "@t3tools/client-runtime/zerops/hq";
import { ArrowUpRightIcon, GlobeIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import type { AppOutsideProduction } from "~/zerops/useAppOutsideProduction";

import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../ui/dialog";
import { SectionAction } from "../system";
import {
  outsideAddressOf,
  outsideAddressShown,
  outsideSaveChanges,
} from "./outsideProduction.logic";

/** The press as the page hands it: who may, how it stands, and the one write. */
export type OutsideControl = Pick<
  AppOutsideProduction,
  "older" | "editable" | "press" | "save" | "reset"
>;

/** What the form's first line calls it, on a project that does not follow `main` yet. */
export const ALREADY_LIVE_ELSEWHERE = "Already live elsewhere";

/**
 * The form, a dialog its own word opens (`children`: the action of the section's label, as *Manage*
 * is a side row's, so the card under it is the same card whoever reads it): one sentence on what
 * it means, an optional Address, Save; where it stands already, *Stop following main*. It stays
 * open while HQ is asked and until the page under it says what HQ took; HQ's refusal is said in it.
 */
export function OutsideProductionForm({
  name,
  current,
  control,
  children,
}: {
  /** The project's name. */
  readonly name: string;
  /** How it stands: `null` where production does not follow `main`. */
  readonly current: { readonly address: string | null } | null;
  readonly control: OutsideControl;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const id = useId();
  const { press, older, save } = control;
  const saving = press.kind === "saving";
  const address = outsideAddressOf(typed);
  const close = () => {
    setOpen(false);
  };
  return (
    <>
      <span data-zerops-outside-production-open="">
        <SectionAction
          onClick={() => {
            setTyped(current?.address ?? "");
            control.reset();
            setOpen(true);
          }}
        >
          {children}
        </SectionAction>
      </span>
      <Dialog
        onOpenChange={(next) => {
          // Asked of HQ, it stays until HQ answered: its answer is said here.
          if (!saving) setOpen(next);
        }}
        open={open}
      >
        <DialogPopup className="max-w-lg">
          <form
            className="contents"
            data-zerops-surface="project-outside-production-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (address.kind !== "ok" || save === undefined) return;
              save({ address: address.address }, close);
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {current === null ? ALREADY_LIVE_ELSEWHERE : PRODUCTION_FOLLOWS_MAIN}
              </DialogTitle>
              <DialogDescription>
                Use this when merging to main already puts {name} live, deployed outside Mate.
              </DialogDescription>
            </DialogHeader>
            <DialogPanel>
              <div className="grid gap-1.5">
                <Label htmlFor={id}>
                  Address
                  <span className="font-normal text-muted-foreground">optional</span>
                </Label>
                <Input
                  aria-invalid={address.kind === "invalid" ? true : undefined}
                  autoComplete="off"
                  disabled={saving || older}
                  id={id}
                  inputMode="url"
                  nativeInput
                  onChange={(event) => {
                    setTyped(event.target.value);
                  }}
                  placeholder="https://"
                  spellCheck={false}
                  value={typed}
                />
                {/* One line's room, held: what is said here never moves the buttons under it. */}
                <p className="min-h-5 text-sm text-muted-foreground">
                  {older ? (
                    <span data-zerops-outside-older="">{OUTSIDE_NEEDS_UPDATE}</span>
                  ) : press.kind === "refused" ? (
                    <span className="text-destructive-foreground" role="alert">
                      {press.words}
                    </span>
                  ) : address.kind === "invalid" ? (
                    address.why
                  ) : (
                    "Where people open it. Leave it empty if there is none to give."
                  )}
                </p>
              </div>
            </DialogPanel>
            <DialogFooter>
              {current === null ? null : (
                <span className="flex sm:me-auto">
                  <Button
                    disabled={saving || older || save === undefined}
                    onClick={() => {
                      save?.(null, close);
                    }}
                    size="sm"
                    variant="destructive-ghost"
                  >
                    {saving && press.lifting ? "Stopping…" : "Stop following main"}
                  </Button>
                </span>
              )}
              <Button disabled={saving} onClick={close} size="sm" variant="ghost">
                Cancel
              </Button>
              <Button
                disabled={
                  saving || older || save === undefined || !outsideSaveChanges(current, address)
                }
                size="sm"
                type="submit"
                variant="primary"
              >
                {saving && !press.lifting ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>
    </>
  );
}

/**
 * Production's row where it follows `main`, in the Going live card's place and frame: what that
 * means in one line, and its address where one was given. Nothing on it is pressed: *Change* is
 * its section's.
 */
export function FollowsMain({ address }: { readonly address: string | null }) {
  return (
    <div className="pp-golive-hero" data-zerops-outside-production="">
      <span aria-hidden="true" className="pp-golive-icon" data-quiet="">
        <GlobeIcon className="size-5" />
      </span>
      <div className="pp-golive-text">
        <p className="pp-golive-title">{PRODUCTION_FOLLOWS_MAIN}</p>
        <p className="pp-golive-why">
          {FOLLOWS_MAIN_MEANS}
          {address === null ? null : (
            <>
              {" "}
              <a
                aria-label={`Open production at ${outsideAddressShown(address)}`}
                className="inline-flex max-w-full items-center gap-0.5 rounded-sm align-bottom text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                data-zerops-place-address=""
                href={address}
                rel="noreferrer"
                target="_blank"
              >
                <span className="truncate">{outsideAddressShown(address)}</span>
                <ArrowUpRightIcon aria-hidden="true" className="size-3 shrink-0" />
              </a>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
