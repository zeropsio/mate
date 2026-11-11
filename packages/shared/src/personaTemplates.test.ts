import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { PREMADE_PERSONA_TEMPLATES, PersonaTemplate } from "./personaTemplates.ts";

const decodeTemplate = Schema.decodeUnknownSync(PersonaTemplate);

describe("Zerops persona templates", () => {
  it.each(PREMADE_PERSONA_TEMPLATES.map((template) => [template.name, template] as const))(
    "%s fits the limits a persona is held to",
    (_name, template) => {
      expect(() => decodeTemplate(template)).not.toThrow();
    },
  );

  it("each Zerops persona template has its own id", () => {
    const ids = PREMADE_PERSONA_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
