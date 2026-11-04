/**
 * The signed-in account's organization's persona templates, read from HQ through the account's
 * data, and the writes an Owner or Admin makes of them. HQ authorizes every write itself;
 * `mayWrite` only decides which controls a page offers.
 */
import {
  orgPersonaTemplates,
  personaTemplateWrite,
  type OrgPersonaTemplates,
  type PersonaTemplateWrite,
} from "@t3tools/client-runtime/data";
import type { PersonaTemplate } from "@t3tools/shared/personaTemplates";
import { roleAtLeast } from "@t3tools/shared/zeropsRoles";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useState } from "react";

import { randomUUID } from "~/lib/utils";
import { useAccountOperationsOptional, type AccountOperations } from "./accountOperations";
import {
  useAccountDataOptional,
  useAccountOrgId,
  useAccountStoreForAdapters,
} from "./ZeropsAccountData";
import { useZeropsSession } from "./ZeropsSessionProvider";

export interface OrgPersonaTemplatesView {
  /** `unavailable`: the organization's HQ offers no persona templates (an HQ that predates them). */
  readonly state: "loading" | "ready" | "unavailable" | "failed";
  /** HQ's templates, oldest first; empty unless `ready`. */
  readonly templates: ReadonlyArray<PersonaTemplate>;
  readonly orgName: string | null;
  /** Owner or Admin: may add, edit and delete them. */
  readonly mayWrite: boolean;
  /** Why the read failed, or why the list shown may be out of date; `null` while it holds. */
  readonly failure: string | null;
  /** Reads them again after a failure. */
  readonly retry: () => void;
}

const UNREAD = Atom.make<OrgPersonaTemplates>({ state: "loading" });

export function useOrgPersonaTemplates(): OrgPersonaTemplatesView {
  const account = useAccountDataOptional();
  const store = useAccountStoreForAdapters();
  const orgId = useAccountOrgId();
  const { activeOrganization } = useZeropsSession();
  const read = useAtomValue(
    store === null || orgId === null ? UNREAD : store.data.project(orgPersonaTemplates, orgId),
  );
  return {
    state: read.state,
    templates: read.state === "ready" ? read.templates : [],
    orgName: activeOrganization?.name ?? null,
    mayWrite: roleAtLeast(activeOrganization?.roleCode, "ADMIN"),
    failure: read.state === "ready" || read.state === "failed" ? read.failure : null,
    retry: () => account?.retry(),
  };
}

/** What a save sends: a new template has no `templateId` and revision 0. */
export interface PersonaTemplateDraft {
  readonly templateId?: string;
  /** The revision its writer saw; 0 for a new template. */
  readonly revision: number;
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
}

export interface PersonaTemplateWriter {
  /** Where the last save or delete stands: `idle` before one, or after `reset`. */
  readonly write: PersonaTemplateWrite;
  readonly save: (draft: PersonaTemplateDraft) => void;
  readonly remove: (template: PersonaTemplate) => void;
  /** Forgets the last write's state, as a closed editor does; the write itself goes on. */
  readonly reset: () => void;
}

const IDLE = Atom.make<PersonaTemplateWrite>({ stage: "idle" });

/** Saves and deletes the organization's templates, one at a time, each its own operation. */
export function usePersonaTemplateWriter(): PersonaTemplateWriter {
  const store = useAccountStoreForAdapters();
  const operations = useAccountOperationsOptional();
  const orgId = useAccountOrgId();
  const [requestId, setRequestId] = useState<string | null>(null);
  const write = useAtomValue(
    store === null || requestId === null
      ? IDLE
      : store.data.project(personaTemplateWrite, requestId),
  );
  const submit = (intent: Parameters<AccountOperations["submit"]>[0]) => {
    if (operations === null) return;
    const id = randomUUID();
    setRequestId(id);
    void operations.submit(intent, id);
  };
  return {
    write,
    save: (draft) => {
      if (orgId === null) return;
      submit({
        kind: "save-persona-template",
        orgId,
        // Made here, before sending: the template's identity is the write's own.
        templateId: draft.templateId ?? randomUUID(),
        revision: draft.revision,
        // HQ keeps the text trimmed; the record shows it so.
        name: draft.name.trim(),
        description: draft.description.trim(),
        instructions: draft.instructions.trim(),
      });
    },
    remove: (template) => {
      if (orgId === null) return;
      submit({
        kind: "delete-persona-template",
        orgId,
        templateId: template.id,
        revision: template.revision,
      });
    },
    reset: () => setRequestId(null),
  };
}
