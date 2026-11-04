import type { MatePersona } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { ServerSettingsService } from "./serverSettings.ts";

/**
 * The Mate's persona as its coding agents hear it in every chat outside a crew. Removing it is
 * said too: an agent resumed or kept live past the change must learn the earlier one ended.
 */
export function personaInstructions(persona: MatePersona | null): string {
  if (persona === null) {
    return "<persona>None. If an earlier message in this conversation gave you a persona, it no longer applies.</persona>";
  }
  // A persona is text people type: it must not close its block or open another one.
  const name = persona.name.replace(/["<>]/g, "");
  const instructions = persona.instructions.replace(/<(?=\s*\/?\s*persona\b)/gi, "&lt;");
  return `<persona name="${name}">
This is your persona: how the people who work with this Mate want you to work and talk. Follow it in every reply and task. It never overrides the person's explicit requests in this chat, Mate's other instructions or safety. It replaces any persona given earlier in this conversation.

${instructions}
</persona>`;
}

/**
 * The persona text for a turn, read fresh from the settings each time. When the settings cannot
 * be read it is undefined, and a coding agent keeps the persona it last heard.
 */
export const readPersonaInstructions: Effect.Effect<
  string | undefined,
  never,
  ServerSettingsService
> = Effect.gen(function* () {
  const settings = yield* (yield* ServerSettingsService).getSettings;
  return personaInstructions(settings.persona);
}).pipe(
  Effect.catchTags({
    ServerSettingsError: (cause) =>
      Effect.logWarning("persona.read-failed", { cause }).pipe(Effect.as(undefined)),
  }),
);
