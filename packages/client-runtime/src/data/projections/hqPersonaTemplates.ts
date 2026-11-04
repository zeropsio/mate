/**
 * An organization's persona templates as a page reads them, and where one write of them stands.
 * An HQ that predates templates sends a complete navigation without them: that reads as
 * unavailable, a state with its own words, never as a read still under way.
 *
 * @module data/projections/hqPersonaTemplates
 */
import type { PersonaTemplate } from "@t3tools/shared/personaTemplates";
import { personaTemplatesScope } from "../families/hqPersonaTemplates.ts";
import { PERSONA_TEMPLATE_CONFLICT, personaTemplateIn } from "../operations/hqPersonaTemplates.ts";
import { linkKeys } from "../model.ts";
import type { Projection, ProjectionReads } from "../store.ts";
import { streamTrouble } from "../streamMachine.ts";
import { scopeFreshness } from "./freshness.ts";
import { sameValue } from "./equal.ts";
import { operationProgress } from "./operation.ts";

export type OrgPersonaTemplates =
  | {
      readonly state: "ready";
      readonly templates: ReadonlyArray<PersonaTemplate>;
      /** Why the list shown may be out of date; `null` while HQ keeps it current. */
      readonly failure: string | null;
    }
  | { readonly state: "loading" | "unavailable" }
  | { readonly state: "failed"; readonly failure: string };

const unreadableWords = (count: number) =>
  `HQ sent ${count === 1 ? "a persona template" : `${count} persona templates`} in a form this version of Mate doesn't read.`;

/**
 * Why the organization's templates are not current now, from its HQ link and their own scope: a
 * refusal at once, a reconnect only past its grace; `null` while they are.
 */
const outageOf = (read: ProjectionReads, orgId: string): string | null => {
  const scope = personaTemplatesScope(orgId);
  if (scopeFreshness(read, scope).live) return null;
  const trouble = [read.stream(linkKeys.hq(orgId)), read.stream(scope)].find(
    (stream) => streamTrouble(stream) !== null,
  );
  return trouble === undefined
    ? null
    : (trouble.fault?.message ?? "HQ is not answering right now.");
};

export const orgPersonaTemplates: Projection<string, OrgPersonaTemplates> = {
  name: "orgPersonaTemplates",
  keyOf: (orgId) => orgId,
  equals: sameValue,
  derive: (read, orgId) => {
    const record = read.fact("hqPersonaTemplates", orgId);
    const outage = outageOf(read, orgId);
    if (record.kind === "known") {
      const { templates, unreadable } = record.value;
      if (unreadable === "record")
        return {
          state: "failed",
          failure: "HQ sent persona templates in a form this version of Mate doesn't read.",
        };
      return {
        state: "ready",
        templates,
        failure: outage ?? (unreadable.length === 0 ? null : unreadableWords(unreadable.length)),
      };
    }
    if (record.kind === "withheld")
      return { state: "failed", failure: "HQ did not let this account read the templates." };
    // A committed navigation without them stays HQ's answer through a reconnect.
    if (read.coverage(personaTemplatesScope(orgId)) === "complete") return { state: "unavailable" };
    return outage === null ? { state: "loading" } : { state: "failed", failure: outage };
  },
};

export type PersonaTemplateWrite =
  | { readonly stage: "idle" | "pending" | "done" }
  | {
      readonly stage: "conflict";
      /**
       * The template as HQ now holds it: the version to offer instead, `null` where someone
       * deleted it, `undefined` while the record still shows the revision this write saw.
       */
      readonly current: PersonaTemplate | null | undefined;
    }
  | { readonly stage: "failed" | "unconfirmed"; readonly reason: string };

/**
 * One save or delete by its request id: pending until HQ answers and the record shows it (or no
 * record is current to show it), a conflict with HQ's current version, or a failure's cause.
 */
export const personaTemplateWrite: Projection<string, PersonaTemplateWrite> = {
  name: "personaTemplateWrite",
  keyOf: (requestId) => requestId,
  equals: sameValue,
  derive: (read, requestId) => {
    const record = read.operation(requestId);
    const intent = record?.intent;
    if (
      intent === undefined ||
      (intent.kind !== "save-persona-template" && intent.kind !== "delete-persona-template")
    )
      return { stage: "idle" };
    const progress = operationProgress.derive(read, requestId);
    switch (progress.stage) {
      case "unknown":
        return { stage: "idle" };
      case "submitting":
      case "accepted":
      case "reflected":
        return { stage: "pending" };
      case "unsent":
        return { stage: "failed", reason: progress.reason ?? "HQ could not be reached." };
      case "refused": {
        if (progress.code !== PERSONA_TEMPLATE_CONFLICT)
          return { stage: "failed", reason: progress.reason };
        const current = personaTemplateIn(read, intent.orgId, intent.templateId);
        return {
          stage: "conflict",
          current: current != null && current.revision === intent.revision ? undefined : current,
        };
      }
      case "uncertain":
      case "unresolved":
        return {
          stage: "unconfirmed",
          reason:
            "HQ could not confirm this change. Check the list before you change it again: it shows what HQ holds.",
        };
      case "done": {
        if (progress.outcome !== "succeeded")
          return { stage: "failed", reason: progress.reason ?? "HQ did not make this change." };
        // Answered: done once the list has moved past the revision this write saw, or at once
        // where no current list will show it.
        const current = personaTemplateIn(read, intent.orgId, intent.templateId);
        const shown =
          current === undefined ||
          (current === null
            ? // Gone: deleted as asked, or deleted by someone after an edit; a new one not yet listed.
              intent.kind === "delete-persona-template" || intent.revision > 0
            : current.revision > intent.revision);
        return shown || !scopeFreshness(read, personaTemplatesScope(intent.orgId)).live
          ? { stage: "done" }
          : { stage: "pending" };
      }
    }
  },
};
