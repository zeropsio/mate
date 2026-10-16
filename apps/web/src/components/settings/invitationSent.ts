/**
 * The address an invitation was just sent to, handed from the invite page to the team it returns
 * to. It lives for this visit only: the team takes it once, and a reload or a later visit finds
 * nothing, so the confirmation and the new row's arrival are never replayed.
 */
let sentTo: string | null = null;

export function noteInvitationSent(address: string): void {
  sentTo = address;
}

/** The address just invited, if any; leaves it for `forgetInvitationSent`. */
export function invitationSentTo(): string | null {
  return sentTo;
}

export function forgetInvitationSent(): void {
  sentTo = null;
}
