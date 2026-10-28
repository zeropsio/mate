/**
 * The press that installs the organization's GitHub app further, wherever a repository it does
 * not reach is asked for (the mirror dialog, the origin sheet): an Owner or Admin leaves through
 * HQ's install trip and comes back here with it accepted; anyone else opens GitHub's own page and
 * is told what they install waits for an admin's OK (`installOffer`).
 */
import { InlineButton } from "../ui/button";
import { OutLink } from "../settings/automationParts";
import { type GitMirrorApp, installOffer } from "./gitMirror.logic";

export function GithubInstallOffer({
  app,
  admin,
  onInstall,
  children,
}: {
  readonly app: Extract<GitMirrorApp, { readonly kind: "connected" }>;
  readonly admin: boolean;
  /** Leaves through HQ's install trip. */
  readonly onInstall: () => void;
  /** The press's words. */
  readonly children: string;
}) {
  const offer = installOffer(app, admin);
  if (offer.kind === "trip") return <InlineButton onClick={onInstall}>{children}</InlineButton>;
  return (
    <>
      <OutLink href={offer.url}>{children}</OutLink>
      {offer.note === null ? null : <> {offer.note}</>}
    </>
  );
}
