import type { MatePersona } from "@t3tools/contracts";
import type { PersonaTemplate } from "@t3tools/shared/personaTemplates";
import { describe, expect, it } from "vite-plus/test";

import {
  orgTemplateDraft,
  personaEditorOpening,
  personaFromEditor,
  personaLeavesTemplate,
  samePersona,
  savedTemplateLink,
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
  org: {
    state: "ready",
    templates: [HOUSE_STYLE],
    orgName: "Acme",
    mayWrite: false,
    failure: null,
  },
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
      expected: {
        kind: "update",
        line: "Update Nova to give it a persona.",
        action: "update-mate",
      },
    },
    {
      title: "the page waits while the Mate's capabilities are unknown",
      input: { capability: null },
      expected: { kind: "loading" },
    },
    {
      title: "the page waits for the Mate's settings before saying it has no persona",
      input: { settingsLoaded: false },
      expected: { kind: "loading" },
    },
    {
      title: "a Mate with persona support shows its persona and templates",
      input: {},
      expected: { kind: "ready" },
    },
  ] as const)("$title", ({ input, expected }) => {
    expect(personaPage({ ...BASE, ...input })).toMatchObject(expected);
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
        name: "Critic",
        instructions: REVIEWER.instructions,
        template: { source: "premade", id: "reviewer", revision: 1 },
      },
      origin: "From Zerops: Reviewer",
    },
    {
      title: "a Zerops copy under its template's own name says only that it came from Zerops",
      persona: {
        name: "Reviewer",
        instructions: REVIEWER.instructions,
        template: { source: "premade", id: "reviewer", revision: 2 },
      },
      origin: "From Zerops",
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
      org: { state: "loading", templates: [], orgName: "Acme", mayWrite: false, failure: null },
      note: { kind: "loading" },
    },
    {
      title: "an organization without templates says it has none yet",
      org: { state: "ready", templates: [], orgName: "Acme", mayWrite: false, failure: null },
      note: { kind: "empty", text: "No templates yet." },
    },
    {
      title: "the organization's templates say plainly when they cannot be had",
      org: { state: "unavailable", templates: [], orgName: null, mayWrite: false, failure: null },
      note: { kind: "unavailable", text: "Not available here." },
    },
    {
      title: "a failed read of the organization's templates gives its cause",
      org: {
        state: "failed",
        failure: "HQ did not answer.",
        templates: [],
        orgName: "Acme",
        mayWrite: false,
      },
      note: { kind: "failed", text: "Couldn't read Acme's templates: HQ did not answer." },
    },
    {
      title: "a list that may be out of date says so quietly and keeps its rows",
      org: { ...BASE.org, failure: "HQ stopped answering." },
      note: { kind: "stale", text: "This list may be out of date: HQ stopped answering." },
    },
    {
      title: "an organization with templates lists them with no note",
      org: BASE.org,
      note: null,
    },
  ] as const)("$title", ({ org, note }) => {
    const group = ready({ org }).groups.find((entry) => entry.source === "org");
    expect(group?.note ?? null).toEqual(note);
    expect(group?.rows.length).toBe(org.state === "ready" ? org.templates.length : 0);
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

describe("opening the persona editor", () => {
  const copied = personaFromTemplate("premade", REVIEWER);
  const rowOf = (persona: MatePersona | null, key: string) => {
    const row = ready({ persona })
      .groups.flatMap((group) => group.rows)
      .find((candidate) => candidate.key === key);
    if (row === undefined) throw new Error(`no row ${key}`);
    return row;
  };

  it.each([
    {
      title:
        "a template opens in the editor with its text, and saving it unchanged uses the template",
      persona: null,
      start: { kind: "template", row: rowOf(null, "premade:explainer") },
      draft: { name: "Explainer", instructions: EXPLAINER.instructions },
      save: "Use for Nova",
      saved: personaFromTemplate("premade", EXPLAINER),
    },
    {
      title: "an organization template opens in the editor with its text",
      persona: copied,
      start: { kind: "template", row: rowOf(copied, "org:house-style") },
      draft: { name: "House style", instructions: HOUSE_STYLE.instructions },
      save: "Use for Nova",
      saved: personaFromTemplate("org", HOUSE_STYLE),
    },
    {
      title: "the template a Mate already uses opens on its text and saves rather than switches",
      persona: copied,
      start: { kind: "template", row: rowOf(copied, "premade:reviewer") },
      draft: { name: "Reviewer", instructions: REVIEWER.instructions },
      save: "Save",
      saved: copied,
    },
    {
      title: "a template's newer version opens in the editor before it is used",
      persona: {
        ...copied,
        instructions: "Old text.",
        template: { ...copied.template!, revision: 1 },
      },
      start: { kind: "newer" },
      draft: { name: "Reviewer", instructions: REVIEWER.instructions },
      save: "Use for Nova",
      saved: copied,
    },
    {
      title: "editing opens on the persona's own text",
      persona: copied,
      start: { kind: "edit" },
      draft: { name: "Reviewer", instructions: REVIEWER.instructions },
      save: "Save",
      saved: copied,
    },
    {
      title: "writing your own opens an empty editor with no template behind it",
      persona: copied,
      start: { kind: "blank" },
      draft: { name: "", instructions: "" },
      save: "Use for Nova",
      saved: null,
    },
  ] as const)("$title", ({ persona, start, draft, save, saved }) => {
    const opening = personaEditorOpening(start, {
      mate: "Nova",
      persona,
      page: ready({ persona }),
    });
    expect(opening?.draft).toEqual(draft);
    expect(opening?.save).toBe(save);
    const written = personaFromEditor(opening?.base ?? null, draft);
    if (saved === null) expect(written.ok).toBe(false);
    else expect(written).toEqual({ ok: true, persona: saved });
  });

  it("editing or taking a newer version needs a persona to open on", () => {
    for (const kind of ["edit", "newer"] as const)
      expect(personaEditorOpening({ kind }, { mate: "Nova", persona: null, page: ready({}) })).toBe(
        null,
      );
  });

  it.each([
    {
      title: "changing a template's text before saving leaves the template",
      draft: { name: "Reviewer", instructions: "Find problems, kindly." },
      leaves: true,
    },
    {
      title: "renaming a template before saving leaves the template",
      draft: { name: "Critic", instructions: REVIEWER.instructions },
      leaves: true,
    },
    {
      title: "a template saved as it opened stays tied to it",
      draft: { name: " Reviewer", instructions: `${REVIEWER.instructions} ` },
      leaves: false,
    },
  ] as const)("$title", ({ draft, leaves }) => {
    expect(personaLeavesTemplate(copied, draft)).toBe(leaves);
  });

  it("text written from nothing has no template to leave", () => {
    expect(personaLeavesTemplate(null, { name: "Terse", instructions: "One line." })).toBe(false);
  });
});

describe("saving a persona as the organization's template", () => {
  const terse: MatePersona = { name: "Terse", instructions: "Answer in one line." };
  const record: PersonaTemplate = {
    id: "t-1",
    name: "Terse",
    description: "",
    instructions: "Answer in one line.",
    revision: 1,
  };

  it("saving as the organization's template creates a new one from the persona's text", () => {
    expect(orgTemplateDraft(terse, "t-1")).toEqual({
      templateId: "t-1",
      revision: 0,
      name: "Terse",
      description: "",
      instructions: "Answer in one line.",
    });
  });

  // The save began after the page's third write; the Mate's settings echo writes late.
  const saving = { id: "t-1", persona: terse, revision: 1, writesAtStart: 3 };
  const linked = { ...terse, template: { source: "org", id: "t-1", revision: 1 } } as const;

  it.each([
    {
      title: "once the saved template is in the organization's list, the Mate is tied to it",
      templates: [HOUSE_STYLE, record],
      current: terse,
      writes: 3,
      link: { kind: "link", persona: linked },
    },
    {
      title: "the Mate is not tied before the saved template is in the list",
      templates: [HOUSE_STYLE],
      current: terse,
      writes: 3,
      link: { kind: "wait" },
    },
    {
      title: "a persona changed while its template was saved is never tied to it",
      templates: [record],
      current: { name: "Terse", instructions: "Answer in two lines." },
      writes: 3,
      link: { kind: "abandon" },
    },
    {
      title: "a persona removed while its template was saved stays removed",
      templates: [record],
      current: null,
      writes: 3,
      link: { kind: "abandon" },
    },
    {
      title:
        "a choice made on the page while its template was saved is never undone, even before the Mate shows it",
      templates: [record],
      current: terse,
      writes: 4,
      link: { kind: "abandon" },
    },
    {
      title: "the Mate is tied to the revision it saved, never a newer one somebody else made",
      templates: [{ ...record, instructions: "Answer in one word.", revision: 2 }],
      current: terse,
      writes: 3,
      link: { kind: "link", persona: linked },
    },
  ] as const)("$title", ({ templates, current, writes, link }) => {
    expect(savedTemplateLink(saving, templates, current, writes)).toEqual(link);
  });
});

describe("a write to the Mate's persona", () => {
  const reviewer = personaFromTemplate("premade", REVIEWER);
  it.each([
    {
      title: "a removal counts once the Mate shows no persona",
      written: null,
      shown: null,
      done: true,
    },
    {
      title: "a removal waits while the Mate still shows one",
      written: null,
      shown: reviewer,
      done: false,
    },
    {
      title: "a persona counts once the Mate shows the same one",
      written: reviewer,
      shown: { ...reviewer },
      done: true,
    },
    {
      title: "a persona waits while the Mate shows the old text",
      written: reviewer,
      shown: { name: "Reviewer", instructions: "Old text." },
      done: false,
    },
    {
      title: "a persona waits while the Mate shows the text without its template",
      written: reviewer,
      shown: { name: reviewer.name, instructions: reviewer.instructions },
      done: false,
    },
    {
      title: "a persona waits while the Mate shows another revision of its template",
      written: reviewer,
      shown: { ...reviewer, template: { source: "premade", id: "reviewer", revision: 1 } },
      done: false,
    },
  ] as const)("$title", ({ written, shown, done }) => {
    expect(samePersona(written, shown)).toBe(done);
  });
});
