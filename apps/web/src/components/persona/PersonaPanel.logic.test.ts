import type { MatePersona } from "@t3tools/contracts";
import type { PersonaTemplate } from "@t3tools/shared/personaTemplates";
import { describe, expect, it } from "vite-plus/test";

import {
  personaFromEditor,
  personaFromTemplate,
  personaPage,
  type PersonaPageInput,
} from "./PersonaPanel.logic";

const REVIEWER: PersonaTemplate = {
  id: "reviewer",
  name: "Reviewer",
  description: "Questions every change.",
  instructions: "Find problems before they ship.",
  revision: 2,
};
const EXPLAINER: PersonaTemplate = {
  id: "explainer",
  name: "Explainer",
  description: "Talks in plain words.",
  instructions: "Talk in plain words.",
  revision: 1,
};
const HOUSE_STYLE: PersonaTemplate = {
  id: "house-style",
  name: "House style",
  description: "",
  instructions: "Write as Acme does.",
  revision: 3,
};

const BASE: PersonaPageInput = {
  mate: "Nova",
  capability: true,
  settingsLoaded: true,
  persona: null,
  premade: [REVIEWER, EXPLAINER],
  org: { state: "ready", templates: [HOUSE_STYLE], orgName: "Acme", mayWrite: false },
};

const ready = (input: Partial<PersonaPageInput>) => {
  const page = personaPage({ ...BASE, ...input });
  if (page.kind !== "ready") throw new Error(`expected a ready page, got ${page.kind}`);
  return page;
};

describe("the Persona page", () => {
  it.each([
    {
      title: "a Mate whose server lacks persona support offers an update instead",
      input: { capability: false },
      kind: "update",
    },
    {
      title: "the page waits while the Mate's capabilities are unknown",
      input: { capability: null },
      kind: "loading",
    },
    {
      title: "the page waits for the Mate's settings before saying it has no persona",
      input: { settingsLoaded: false },
      kind: "loading",
    },
    {
      title: "a Mate with persona support shows its persona and templates",
      input: {},
      kind: "ready",
    },
  ] as const)("$title", ({ input, kind }) => {
    expect(personaPage({ ...BASE, ...input }).kind).toBe(kind);
  });

  it("a Mate without a persona says it works its own way and offers every template", () => {
    const page = ready({});
    expect(page.persona).toBeNull();
    expect(
      page.groups.map((group) => [group.title, group.rows.map((row) => row.template.id)]),
    ).toEqual([
      ["From Zerops", ["reviewer", "explainer"]],
      ["Acme's templates", ["house-style"]],
    ]);
    expect(page.groups.flatMap((group) => group.rows).every((row) => row.current === null)).toBe(
      true,
    );
  });

  it.each([
    {
      title: "a persona copied from Zerops says which template it came from",
      persona: {
        name: "Reviewer",
        instructions: REVIEWER.instructions,
        template: { source: "premade", id: "reviewer", revision: 2 },
      },
      origin: "From Zerops: Reviewer",
    },
    {
      title: "a persona copied from the organization says whose templates it came from",
      persona: {
        name: "House style",
        instructions: HOUSE_STYLE.instructions,
        template: { source: "org", id: "house-style", revision: 3 },
      },
      origin: "From Acme's templates",
    },
    {
      title: "a persona written by hand says it was written for the Mate",
      persona: { name: "Terse", instructions: "Answer in one line." },
      origin: "Written for Nova",
    },
  ] as const)("$title", ({ persona, origin }) => {
    expect(ready({ persona }).persona?.origin).toBe(origin);
  });

  it("the template a persona came from is marked, and choosing it again offers nothing new", () => {
    const page = ready({
      persona: {
        name: "Reviewer",
        instructions: REVIEWER.instructions,
        template: { source: "premade", id: "reviewer", revision: 2 },
      },
    });
    const rows = page.groups.flatMap((group) => group.rows);
    expect(rows.filter((row) => row.current !== null).map((row) => row.template.id)).toEqual([
      "reviewer",
    ]);
    expect(rows.find((row) => row.template.id === "reviewer")?.current).toBe("same");
  });

  it.each([
    {
      title: "an unedited copy of an older revision offers the newer one",
      template: { source: "premade", id: "reviewer", revision: 1 },
      newer: "Reviewer",
    },
    {
      title: "an unedited copy of an older org revision offers the newer one",
      template: { source: "org", id: "house-style", revision: 2 },
      newer: "House style",
    },
    {
      title: "a copy of the current revision offers no newer version",
      template: { source: "premade", id: "reviewer", revision: 2 },
      newer: null,
    },
    {
      title: "a copy of a template that is gone offers no newer version",
      template: { source: "org", id: "retired", revision: 1 },
      newer: null,
    },
  ] as const)("$title", ({ template, newer }) => {
    const page = ready({ persona: { name: "Copy", instructions: "Old text.", template } });
    expect(page.persona?.newer?.template.name ?? null).toBe(newer);
  });

  it("a persona edited by hand offers no newer version", () => {
    expect(ready({ persona: { name: "Reviewer", instructions: "Mine now." } }).persona?.newer).toBe(
      null,
    );
  });

  it.each([
    {
      title: "Owners and Admins may save a persona written by hand as the organization's template",
      persona: { name: "Terse", instructions: "Answer in one line." },
      mayWrite: true,
      saveAsOrg: true,
    },
    {
      title:
        "Owners and Admins may save a copy of a Zerops template as the organization's template",
      persona: {
        name: "Reviewer",
        instructions: REVIEWER.instructions,
        template: { source: "premade", id: "reviewer", revision: 2 },
      },
      mayWrite: true,
      saveAsOrg: true,
    },
    {
      title: "an unedited copy of an organization template is never saved as another",
      persona: {
        name: "House style",
        instructions: HOUSE_STYLE.instructions,
        template: { source: "org", id: "house-style", revision: 3 },
      },
      mayWrite: true,
      saveAsOrg: false,
    },
    {
      title: "members who may not write the organization's templates are never offered to save one",
      persona: { name: "Terse", instructions: "Answer in one line." },
      mayWrite: false,
      saveAsOrg: false,
    },
  ] as const)("$title", ({ persona, mayWrite, saveAsOrg }) => {
    const page = ready({ persona, org: { ...BASE.org, mayWrite } });
    expect(page.persona?.saveAsOrg).toBe(saveAsOrg);
  });

  it("an organization at its template limit is never offered another", () => {
    const templates = Array.from({ length: 50 }, (_, index) => ({
      ...HOUSE_STYLE,
      id: `t${String(index)}`,
    }));
    const page = ready({
      persona: { name: "Terse", instructions: "Answer in one line." },
      org: { ...BASE.org, templates, mayWrite: true },
    });
    expect(page.persona?.saveAsOrg).toBe(false);
  });

  it.each([
    {
      title: "the organization's templates say they are still loading",
      org: { state: "loading", templates: [], orgName: "Acme", mayWrite: false },
      note: { kind: "loading" },
    },
    {
      title: "an organization without templates says it has none yet",
      org: { state: "ready", templates: [], orgName: "Acme", mayWrite: false },
      note: { kind: "empty", text: "No templates yet." },
    },
    {
      title: "the organization's templates say plainly when they cannot be had",
      org: { state: "unavailable", templates: [], orgName: null, mayWrite: false },
      note: { kind: "unavailable", text: "Not available here." },
    },
    {
      title: "a failed read of the organization's templates gives its cause",
      org: {
        state: "failed",
        cause: "HQ did not answer.",
        templates: [],
        orgName: "Acme",
        mayWrite: false,
      },
      note: { kind: "failed", text: "Couldn't read Acme's templates: HQ did not answer." },
    },
    {
      title: "an organization with templates lists them with no note",
      org: BASE.org,
      note: null,
    },
  ] as const)("$title", ({ org, note }) => {
    const group = ready({ org }).groups.find((entry) => entry.source === "org");
    expect(group?.note ?? null).toEqual(note);
  });
});

describe("writing a Mate's persona", () => {
  it.each([
    {
      title: "choosing a Zerops template writes its text and reference",
      source: "premade",
      template: REVIEWER,
    },
    {
      title: "choosing an organization template writes its text and reference",
      source: "org",
      template: HOUSE_STYLE,
    },
  ] as const)("$title", ({ source, template }) => {
    expect(personaFromTemplate(source, template)).toEqual({
      name: template.name,
      instructions: template.instructions,
      template: { source, id: template.id, revision: template.revision },
    });
  });

  const copied: MatePersona = {
    name: "Reviewer",
    instructions: REVIEWER.instructions,
    template: { source: "premade", id: "reviewer", revision: 2 },
  };

  it.each([
    {
      title: "editing the text drops the template reference",
      draft: { name: "Reviewer", instructions: "Find problems, kindly." },
      written: { name: "Reviewer", instructions: "Find problems, kindly." },
    },
    {
      title: "renaming a copy drops the template reference",
      draft: { name: "Critic", instructions: REVIEWER.instructions },
      written: { name: "Critic", instructions: REVIEWER.instructions },
    },
    {
      title: "saving a copy unchanged keeps its template reference",
      draft: { name: " Reviewer ", instructions: `${REVIEWER.instructions}\n` },
      written: copied,
    },
  ] as const)("$title", ({ draft, written }) => {
    expect(personaFromEditor(copied, draft)).toEqual({ ok: true, persona: written });
  });

  it.each([
    {
      title: "a persona needs a name",
      draft: { name: "  ", instructions: "Answer in one line." },
      errors: { name: "Give it a name." },
    },
    {
      title: "a persona needs instructions",
      draft: { name: "Terse", instructions: "\n " },
      errors: { instructions: "Write how it works and talks." },
    },
    {
      title: "a name past 40 characters is refused",
      draft: { name: "N".repeat(41), instructions: "Answer in one line." },
      errors: { name: "Keep the name to 40 characters." },
    },
    {
      title: "instructions past 3,000 characters are refused",
      draft: { name: "Terse", instructions: "x".repeat(3001) },
      errors: { instructions: "Keep the instructions to 3,000 characters." },
    },
  ] as const)("$title", ({ draft, errors }) => {
    expect(personaFromEditor(null, draft)).toEqual({ ok: false, errors });
  });

  it("a persona written from nothing has no template reference", () => {
    expect(personaFromEditor(null, { name: " Terse ", instructions: " One line. " })).toEqual({
      ok: true,
      persona: { name: "Terse", instructions: "One line." },
    });
  });
});
