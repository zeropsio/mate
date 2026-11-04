import type { MatePersona } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import type { ServerSettingsService } from "./serverSettings.ts";

/** An opening or closing tag of a wrapper the persona travels inside. */
const PERSONA_WRAPPER_TAG = /<(?=\s*\/?\s*(?:persona|system-reminder|mate_persona(?:_\d+)?)\b)/gi;

/**
 * The Mate's persona as its coding agents hear it in every chat outside a crew. Removing it is
 * said too: an agent resumed or kept live past the change must learn the earlier one ended.
 */
export function personaInstructions(persona: MatePersona | null): string {
  if (persona === null) {
    return "<persona>None. If an earlier message in this conversation gave you a persona, it no longer applies.</persona>";
  }
  // A persona is text people type: it must not close or open a wrapper it travels inside —
  // its block, Claude's refresh reminder, Codex's context entries.
  const name = persona.name.replace(/["<>]/g, "");
  const instructions = persona.instructions.replace(PERSONA_WRAPPER_TAG, "&lt;");
  return `<persona name="${name}">
This is your persona: how the people who work with this Mate want you to work and talk. Follow it in every reply and task. It never overrides the person's explicit requests in this chat, Mate's other instructions or safety. It replaces any persona given earlier in this conversation.

${instructions}
</persona>`;
}

/**
 * Reads the persona text fresh from the settings for each turn. While the settings cannot be
 * read it hands back the last text read, so a coding agent keeps the persona it heard; before
 * any read succeeded that is undefined, and the turn carries none.
 */
export const makePersonaReader = (settings: ServerSettingsService["Service"]) =>
  Effect.gen(function* () {
    const lastRead = yield* Ref.make<string | undefined>(undefined);
    const failing = yield* Ref.make(false);
    return settings.getSettings.pipe(
      Effect.map((current) => personaInstructions(current.persona)),
      Effect.tap((text) => Ref.set(lastRead, text).pipe(Effect.andThen(Ref.set(failing, false)))),
      Effect.catchTags({
        ServerSettingsError: (cause) =>
          Effect.gen(function* () {
            // Once per failing stretch: a read is retried every turn.
            if (!(yield* Ref.getAndSet(failing, true))) {
              yield* Effect.logWarning("persona.read-failed", { cause });
            }
            return yield* Ref.get(lastRead);
          }),
      }),
    );
  });
