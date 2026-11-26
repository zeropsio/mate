/**
 * Whether a Mate asks its person how it should work with them. A persona is chosen once in a
 * Mate's life, so the Mate asks once, as its first message (`PersonaAsk`): under its setup's ask in
 * its main conversation, or where a new project's empty conversation would have its headline. It
 * asks only the person who made it, only while its server takes a persona and it holds none, and
 * only until that person writes to it: what they write instead is their answer, and the Persona
 * page keeps the way to one. Nothing is stored for it.
 */
import type { MatePersona } from "@t3tools/contracts";

export function matePersonaAsked(input: {
  /** Its server takes a persona; null while its configuration is unread. */
  readonly takesPersona: boolean | null;
  /** The persona it holds; undefined while its settings are unread. */
  readonly persona: MatePersona | null | undefined;
  /** Who made it, or asked for its setup; undefined where HQ names nobody. */
  readonly madeBy: string | undefined;
  readonly viewer: string | undefined;
  /** Its person has written to it where the ask stands. */
  readonly written: boolean;
}): boolean {
  return (
    input.takesPersona === true &&
    input.persona === null &&
    input.viewer !== undefined &&
    input.viewer.length > 0 &&
    input.madeBy === input.viewer &&
    !input.written
  );
}
