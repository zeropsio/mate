/**
 * Offline origin → HQ face mapping for the switch and its one-off repair. Runtime clients read
 * HQ alone. Pass the whole organization's origin candidate pool, even when porting only one app.
 */
import { MATE_SHAPE_OF_TINT, type MateTintId } from "../packages/shared/src/brand.ts";
import { assignMateTints, formatMateFace, readMateFace } from "../packages/shared/src/mateFaces.ts";

export interface OriginFaceProject {
  readonly id: string;
  readonly name: string;
  readonly tags: ReadonlyArray<string>;
  readonly hasMateContainer?: boolean;
}

function inputsOf(project: OriginFaceProject) {
  const bot = project.tags
    .filter((tag) => tag.startsWith("mate:bot:"))
    .map((tag) => tag.slice("mate:bot:".length).trim())
    .find((name) => name.length > 0);
  const face = project.tags
    .filter((tag) => tag.startsWith("mate:face:"))
    .map((tag) => readMateFace(tag.slice("mate:face:".length)))
    .find((face) => face !== undefined);
  const role = project.tags
    .filter((tag) => tag.startsWith("mate:role:"))
    .map((tag) => tag.slice("mate:role:".length))
    .find((role) => ["dev", "devstage", "stage", "prod"].includes(role));
  return { name: bot ?? project.name, face, role };
}

/** What origin renders, encoded as HQ's `<tint>:<shape>[:named]`. Unknown parts derive independently. */
export function originMateFaces(
  projects: ReadonlyArray<OriginFaceProject>,
): ReadonlyMap<string, string> {
  const mates = projects.filter((project) => {
    const { role } = inputsOf(project);
    return (
      !project.tags.includes("mate:tool:gitea") &&
      role !== "stage" &&
      role !== "prod" &&
      (project.tags.includes("mate") || project.hasMateContainer === true)
    );
  });
  const names = mates.flatMap((project) => {
    const { name, face } = inputsOf(project);
    return face?.tint === undefined || face.named === true ? [name] : [];
  });
  const byName = assignMateTints(names);
  const faces = new Map<string, string>();
  for (const project of mates) {
    const { name, face } = inputsOf(project);
    const tint: MateTintId = face?.tint ?? byName.get(name) ?? "slate";
    faces.set(
      project.id,
      formatMateFace(
        { tint, shape: face?.shape ?? MATE_SHAPE_OF_TINT[tint] },
        { named: face?.named === true },
      ),
    );
  }
  return faces;
}

export function facePortPlan(
  projects: ReadonlyArray<OriginFaceProject>,
  records: ReadonlyArray<{ readonly projectId: string; readonly face: string }>,
) {
  const origin = originMateFaces(projects);
  return records.map((record) => {
    const project = projects.find((project) => project.id === record.projectId);
    const newFace = origin.get(record.projectId);
    if (project === undefined || newFace === undefined)
      throw new Error(`No origin Mate for HQ record ${record.projectId}`);
    return {
      projectId: record.projectId,
      name: project.name,
      oldFace: record.face,
      newFace,
      changed: record.face !== newFace,
    };
  });
}

/** A manual port makes one attempt per changed record. The caller supplies HQ's person-authorized PATCH. */
export async function applyFacePort(
  plan: ReturnType<typeof facePortPlan>,
  patch: (projectId: string, face: string) => Promise<void>,
  options: { readonly apply?: boolean } = {},
): Promise<void> {
  if (options.apply !== true) return;
  for (const row of plan) {
    if (row.changed) await patch(row.projectId, row.newFace);
  }
}
