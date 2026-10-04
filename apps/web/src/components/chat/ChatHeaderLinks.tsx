/**
 * The Mate's public addresses in the conversation's top bar: one compact
 * control, each address with what it is (dev, stage, production). A pick opens
 * it as its own tab in the panel's Browser; the row's arrow, or ⌘-click, opens
 * it in a new browser tab. Nothing is drawn while the Mate has no address.
 *
 * The owner, 2026-10-03: "I also question whether ability to open public
 * links shouldnt be in top bar of the main convo".
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { ChevronDownIcon, GlobeIcon } from "lucide-react";

import { useMateAddresses } from "~/zerops/useMateAddresses";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import {
  MateAddressExternalLink,
  MateAddressLabel,
  openMateAddress,
} from "../zerops/MateAddresses";

export function ChatHeaderLinks({
  environmentId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const addresses = useMateAddresses(environmentId);
  if (addresses.length === 0) return null;
  const threadRef = scopeThreadRef(environmentId, threadId);
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            aria-label="Open the Mate's sites"
            data-chat-header-ghost
            size="sm"
            variant="ghost-muted"
          />
        }
      >
        <GlobeIcon className="size-3.5 shrink-0" />
        <span className="hidden text-line @3xl/header-actions:inline">Sites</span>
        <ChevronDownIcon className="size-3 shrink-0 opacity-70" />
      </MenuTrigger>
      <MenuPopup align="end" aria-label="The Mate's sites" className="w-72">
        {addresses.map((address) => (
          <MenuItem
            data-mate-address={address.service}
            key={address.url}
            onAuxClick={(event) => openMateAddress(threadRef, address, event)}
            onClick={(event) => openMateAddress(threadRef, address, event)}
          >
            <MateAddressLabel address={address} showHost />
            <MateAddressExternalLink address={address} />
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}
