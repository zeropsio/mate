/**
 * The operation id of a press of Move. HQ answers a repeated id with the operation it already
 * holds, whatever that move's body was, so a project keeps one attempt: the same body after an
 * answer that did not come sends its id again, and any other body is a new start.
 */
export interface MoveAttempt {
  readonly body: string;
  readonly id: string;
}

export function moveAttemptFor(
  held: MoveAttempt | undefined,
  body: string,
  newId: () => string,
): MoveAttempt {
  return held?.body === body ? held : { body, id: newId() };
}
