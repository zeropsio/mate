/**
 * A Mate's public addresses as a person picks them: in the conversation's top
 * bar (`ChatHeaderLinks`) and in the panel's Browser view. A pick opens the
 * address as its own tab in the panel; the arrow, or a new-tab gesture, opens
 * it in a new browser tab.
 */
import type { ScopedThreadRef } from "@t3tools/contracts";
import { ExternalLinkIcon } from "lucide-react";
import type { MouseEvent } from "react";

import { cn } from "~/lib/utils";
import type { MateAddress } from "~/zerops/mateAddresses.logic";
import { useRightPanelStore } from "../../rightPanelStore";
import { mateAddressOpenTarget, mateAddressRoleWord } from "./MateAddresses.logic";

/** Opens the address where the gesture asks; a click on the row's own arrow is the arrow's. */
export function openMateAddress(
  threadRef: ScopedThreadRef,
  address: MateAddress,
  event?: MouseEvent<HTMLElement>,
): void {
  if (event?.target instanceof Element && event.target.closest("[data-mate-address-external]"))
    return;
  const target = mateAddressOpenTarget(event);
  if (target === "none") return;
  if (target === "new-tab") {
    window.open(address.url, "_blank", "noopener,noreferrer");
    return;
  }
  useRightPanelStore.getState().openService(threadRef, address.service, address.url);
}

/** The address's name, what it is, and — where there is room — where it answers. */
export function MateAddressLabel({
  address,
  showHost = false,
}: {
  readonly address: MateAddress;
  readonly showHost?: boolean;
}) {
  const role = mateAddressRoleWord(address.role);
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="truncate text-foreground">{address.service}</span>
        {role === undefined ? null : (
          <span className="shrink-0 text-muted-foreground text-xs">{role}</span>
        )}
      </span>
      {showHost ? (
        <span className="truncate text-muted-foreground text-xs">{address.host}</span>
      ) : null}
    </span>
  );
}

/** The row's second action: the address in a new browser tab. */
export function MateAddressExternalLink({
  address,
  className,
}: {
  readonly address: MateAddress;
  readonly className?: string;
}) {
  return (
    <a
      aria-label={`Open ${address.service} in a new tab`}
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground",
        className,
      )}
      data-mate-address-external
      href={address.url}
      rel="noreferrer"
      target="_blank"
    >
      <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
    </a>
  );
}
