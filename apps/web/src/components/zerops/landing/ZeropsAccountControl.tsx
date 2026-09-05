/**
 * Who is signed in, and the way out — in the top bar of every signed-in
 * Zerops page, so leaving never depends on first choosing an organization.
 *
 * The bar shows the person the way Zerops does: their picture (or initials)
 * and their first name. The email and the sign-out live one click away, in a
 * small menu — an address is for a form, not for a bar.
 */

import { ChevronDownIcon, LogOutIcon } from "lucide-react";
import { useState } from "react";

import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";

import { cn } from "~/lib/utils";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";
import { buttonVariants } from "../../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../../ui/menu";
import { Avatar } from "../primitives";
import { zeropsAccountDisplay, type ZeropsAccountDisplay } from "./ZeropsAccountControl.logic";

export interface ZeropsAccountControlProps {
  readonly account: ZeropsAccountDisplay;
  readonly busy?: boolean;
  readonly error?: string | null;
  readonly onSignOut: () => void;
}

export function ZeropsAccountControl({
  account,
  busy = false,
  error = null,
  onSignOut,
}: ZeropsAccountControlProps) {
  return (
    <Menu>
      <MenuTrigger
        aria-label={`Account: ${account.name}`}
        className={cn(
          buttonVariants({ size: "sm", variant: "ghost" }),
          "min-w-0 gap-2 ps-1 pe-2 data-popup-open:bg-accent",
        )}
        data-zerops-account-control="true"
      >
        <Avatar initials={account.initials} src={account.avatarUrl} />
        <span className="hidden max-w-40 truncate text-sm font-normal sm:inline">
          {account.name}
        </span>
        <ChevronDownIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
      </MenuTrigger>
      <MenuPopup align="end" className="w-64">
        <ZeropsAccountMenu account={account} busy={busy} error={error} onSignOut={onSignOut} />
      </MenuPopup>
    </Menu>
  );
}

/**
 * The menu's body: who, then the one thing to do. Sign-out keeps the menu
 * open (`closeOnClick={false}`) so the busy and failed states show where the
 * click landed; success unmounts the whole control with the session.
 */
export function ZeropsAccountMenu({
  account,
  busy = false,
  error = null,
  onSignOut,
}: ZeropsAccountControlProps) {
  return (
    <>
      <div className="flex items-center gap-3 px-2 py-2" data-zerops-account-identity="true">
        <Avatar initials={account.initials} size="md" src={account.avatarUrl} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {account.fullName ?? account.name}
          </p>
          {account.email === null ? null : (
            <p className="truncate text-xs text-muted-foreground">{account.email}</p>
          )}
        </div>
      </div>
      <MenuSeparator />
      <MenuItem
        closeOnClick={false}
        disabled={busy}
        onClick={onSignOut}
        variant={error === null ? "default" : "destructive"}
      >
        <LogOutIcon />
        {error === null ? "Sign out" : "Sign out failed. Try again"}
      </MenuItem>
    </>
  );
}

/** The control wired to the session; renders nothing while nobody is signed in. */
export function ZeropsSessionAccountControl() {
  const { status, user, signOut } = useZeropsSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (status !== "signed-in") return null;
  return (
    <ZeropsAccountControl
      account={zeropsAccountDisplay(user)}
      busy={busy}
      error={error}
      onSignOut={() => {
        setBusy(true);
        setError(null);
        void signOut()
          .catch((cause: unknown) => {
            setError(zeropsErrorMessage(cause));
          })
          .finally(() => {
            setBusy(false);
          });
      }}
    />
  );
}
