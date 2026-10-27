/**
 * What HQ's birth reads of Zerops besides the account's facts, executor-side: its setup journal in
 * a project's env file, the births under way in the organization (each found by its journal), and
 * the HQ its member list marks. Each is read once where the birth asks, never on a
 * clock.
 *
 * @module data/operations/executors/hqBirthReads
 */
import type { ZeropsApiClient } from "../../../zerops/api.ts";
import { findOfficialHq, type OfficialHq } from "../../../zerops/hq/anchor.ts";
import type { HqBirthRecord } from "../../../zerops/hq/birth.ts";
import { readBirthRecord } from "../../../zerops/hq/birthJournal.ts";

/** A project on its way out, or out: nothing a birth counts. */
const GONE_PROJECT_STATUSES: ReadonlySet<string> = new Set(["DELETING", "DELETED"]);
/** The services an import of HQ's makes, which a project holding no record must not look like. */
const HQ_SERVICES = ["db", "vol", "hq"] as const;

export interface HqBirthReads {
  /** HQ's setup journal: its project's env slots. */
  readonly journal: (projectId: string) => Promise<ReadonlyMap<string, string>>;
  /**
   * The organization's births under way, each its project and its record; `unrecorded` where a
   * project looks like HQ's — its services all there — but holds no record.
   */
  readonly births: (orgId: string) => Promise<{
    readonly underway: ReadonlyArray<{
      readonly projectId: string;
      readonly record: HqBirthRecord;
    }>;
    readonly unrecorded: boolean;
  }>;
  /** The HQ the organization's member list marks: its official one, none, or more than one. */
  readonly markedHq: (orgId: string) => Promise<OfficialHq>;
}

export function hqBirthReads(
  platform: Pick<
    ZeropsApiClient,
    "readProjectBirthEnv" | "listClientProjects" | "listProjectServices" | "listOrganizationMembers"
  >,
): HqBirthReads {
  return {
    journal: (projectId) => platform.readProjectBirthEnv(projectId),
    births: async (orgId) => {
      const underway: Array<{ projectId: string; record: HqBirthRecord }> = [];
      let unrecorded = false;
      for (const project of await platform.listClientProjects(orgId)) {
        if (GONE_PROJECT_STATUSES.has(project.status)) continue;
        const record = readBirthRecord(await platform.readProjectBirthEnv(project.id));
        if (record !== undefined) {
          if (record.step !== "done") underway.push({ projectId: project.id, record });
          continue;
        }
        const services = await platform.listProjectServices(project.id);
        if (HQ_SERVICES.every((name) => services.some((service) => service.name === name)))
          unrecorded = true;
      }
      return { underway, unrecorded };
    },
    markedHq: async (orgId) => findOfficialHq(await platform.listOrganizationMembers(orgId)),
  };
}
