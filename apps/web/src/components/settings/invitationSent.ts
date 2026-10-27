/**
 * The addresses invitations were just sent to, handed from the invite page to the team it returns
 * to. They live for this visit only: the team takes them once, and a reload or a later visit finds
 * nothing, so the new rows' arrival is never replayed.
 */
let sentTo: ReadonlyArray<string> = [];

export function noteInvitationSent(address: string): void {
  sentTo = [...sentTo, address];
}

/** The addresses just invited, oldest first; leaves them for `forgetInvitationSent`. */
export function invitationSentTo(): ReadonlyArray<string> {
  return sentTo;
}

export function forgetInvitationSent(): void {
  sentTo = [];
}
