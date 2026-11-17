/**
 * Zerops HQ's sudo prompt over Mate, in a `zerops-hq` build, for a reveal that needs one
 * (`zeropsHq.ts`). Where HQ's bridge refuses this origin, it is a device login's wait instead,
 * while the person answers in the Zerops window. HQ's sign-in is the landing's own
 * (`ZeropsHostedLanding.tsx`).
 */
import { useEffect, useRef, useSyncExternalStore } from "react";

import type { ZeropsHqPrompt, ZeropsHqPrompts } from "~/zerops/zeropsHq";
import { useZeropsSessionOptional } from "~/zerops/ZeropsSessionProvider";

import { Dialog, DialogPopup, DialogTitle } from "../../ui/dialog";
import { Spinner } from "../../ui/spinner";
import { ZeropsDeviceLoginWait } from "./ZeropsDeviceLoginWait";

const CLOSED: ZeropsHqPrompt = { kind: "closed" };
const noPrompts = () => () => undefined;

export function ZeropsHqOverlay() {
  const prompts = useZeropsSessionOptional()?.zeropsHq ?? null;
  const prompt = useSyncExternalStore(
    prompts?.subscribe ?? noPrompts,
    prompts?.state ?? (() => CLOSED),
  );
  if (prompts === null || prompt.kind !== "sudo") return null;
  return <ZeropsHqPanel prompts={prompts} prompt={prompt} />;
}

function ZeropsHqPanel({
  prompts,
  prompt,
}: {
  readonly prompts: ZeropsHqPrompts;
  readonly prompt: Exclude<ZeropsHqPrompt, { kind: "closed" }>;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const shown = prompt.phase === "shown";
  // Chromium refuses HQ's passkey prompt to a page without focus, and the keyboard works there.
  useEffect(() => {
    if (shown) frame.current?.focus();
  }, [shown]);
  const size = prompts.frameSizes()?.sudo ?? null;
  const framing = prompt.frame !== null && (prompt.phase === "framed" || shown);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !prompt.busy) prompts.close();
      }}
    >
      <DialogPopup
        className="max-w-fit"
        showCloseButton={!prompt.busy}
        placement="center"
        bottomStickOnMobile={false}
      >
        <DialogTitle className="sr-only">Confirm it's you</DialogTitle>
        {framing ? (
          <div
            className="relative max-h-[calc(100dvh-3rem)] max-w-[calc(100vw-3rem)]"
            style={
              size === null
                ? undefined
                : { width: size.width, height: prompt.frameHeight ?? size.height }
            }
          >
            {shown ? null : <Spinner size="lg" className="absolute inset-0 m-auto" />}
            {/* The address is HQ's, built by the session package from this build's own settings. */}
            <iframe
              ref={frame}
              className={shown ? "size-full" : "invisible size-full"}
              src={prompt.frame ?? undefined}
              title="Confirm it's you"
              allow="publickey-credentials-get; publickey-credentials-create; clipboard-write"
            />
          </div>
        ) : (
          <div className="w-sm max-w-full space-y-4 p-6 text-center">
            {prompt.phase === "waiting" && prompt.progress !== null ? (
              <ZeropsDeviceLoginWait
                progress={prompt.progress}
                onReopen={prompts.reopen}
                onCancel={prompts.close}
              />
            ) : (
              <Spinner size="lg" className="mx-auto" />
            )}
          </div>
        )}
      </DialogPopup>
    </Dialog>
  );
}
