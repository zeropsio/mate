/** One-off port only: legacy Zerops tags are admitted here, never by product readers. */
import { originMateFaces } from "./port-mate-faces.ts";
const valueOf = (tags, prefix) => tags.find((tag) => tag.startsWith(prefix))?.slice(prefix.length);
const rowsOf = (snapshot) => [
  ...(snapshot.ungrouped ?? []).map((row) => ({ ...row, kind: "mate", appId: null })),
  ...(snapshot.apps ?? []).flatMap((app) => app.projects.map((row) => ({ ...row, appId: app.id }))),
];
const roleKind = { dev: "mate", devstage: "devstage", stage: "stage", prod: "production" };

export function planProjectTagPort(project, snapshot, projects = []) {
  const tags = project.tags ?? [];
  const held = rowsOf(snapshot).find((row) => row.projectId === project.id);
  const fill = [];
  const blocked = [];
  const fact = (field, value, current) => {
    if (value !== undefined && (current === undefined || current === null || current === ""))
      fill.push({ field, value });
  };
  const pool = projects.length === 0 ? [project] : projects;
  const faces = originMateFaces(
    pool
      .filter((candidate) => typeof candidate.name === "string")
      .map((candidate) => ({
        ...candidate,
        hasMateContainer: rowsOf(snapshot).some(
          (row) => row.projectId === candidate.id && row.mate != null,
        ),
      })),
  );
  fact("face", faces.get(project.id) ?? valueOf(tags, "mate:face:"), held?.mate?.face);
  fact("madeBy", valueOf(tags, "mate:by:"), held?.mate?.madeBy);
  fact("birthId", valueOf(tags, "mate:birth:"), held?.mate?.birthId);
  fact("standupRequestedBy", valueOf(tags, "mate:standup:"), held?.mate?.standupRequestedBy);
  fact(
    "nameSource",
    valueOf(tags, "mate:bot:") === undefined ? undefined : "picked",
    held?.mate?.nameSource,
  );
  if (tags.includes("mate:closed-off") && held?.mate === undefined) fact("closedOff", true);
  const tool = valueOf(tags, "mate:tool:");
  if (tool !== undefined) {
    if (tool !== "gitea") blocked.push(`Unknown tool kind: ${tool}`);
    else fact("tool", tool, snapshot.tools?.find((row) => row.projectId === project.id)?.kind);
  }
  for (const tag of tags.filter((tag) => tag.startsWith("mate:signer:"))) {
    const rest = tag.slice("mate:signer:".length);
    const at = rest.indexOf(":");
    if (at <= 0 || rest.slice(at + 1) === "") {
      blocked.push(`Invalid signer: ${tag}`);
      continue;
    }
    const key = rest.slice(0, at);
    const by = rest.slice(at + 1);
    const login = snapshot.mates?.[project.id]?.logins?.[key];
    fact(
      `signers.${key}`,
      by,
      held?.mate?.signers?.[key] ?? login?.signedInBy ?? login?.lastSignedInBy,
    );
  }
  let membership;
  const group = valueOf(tags, "mate:g:");
  if (group !== undefined && held?.appId == null) {
    const ids = new Set(
      projects
        .filter((row) => valueOf(row.tags ?? [], "mate:g:") === group)
        .flatMap((row) =>
          rowsOf(snapshot)
            .filter((held) => held.projectId === row.id && held.appId !== null)
            .map((held) => held.appId),
        ),
    );
    if (ids.size !== 1) blocked.push(`No HQ application id for legacy group ${group}`);
    else {
      const kind = roleKind[valueOf(tags, "mate:role:")];
      if (kind === undefined) blocked.push(`No known role for legacy group ${group}`);
      else membership = { appId: [...ids][0], kind };
    }
  }
  const known = [
    "mate:g:",
    "mate:role:",
    "mate:name:",
    "mate:bot:",
    "mate:face:",
    "mate:by:",
    "mate:birth:",
    "mate:standup:",
    "mate:signer:",
    "mate:tool:",
    "mate:hq-birth:",
    "mate:gm:",
    "mate:gn:",
  ];
  for (const tag of tags) {
    if (
      tag.startsWith("mate:") &&
      !["mate:closed-off", "mate:hq"].includes(tag) &&
      !known.some((prefix) => tag.startsWith(prefix))
    )
      blocked.push(`Unknown Mate metadata: ${tag}`);
  }
  // Registry tags on the old tool must go through the existing application bundle port first.
  if (tags.some((tag) => tag.startsWith("mate:gm:") || tag.startsWith("mate:gn:")))
    blocked.push("Legacy application registry requires the bundle port before cleanup");
  return {
    projectId: project.id,
    name: project.name,
    keep: tags.includes("mate") ? ["mate"] : [],
    remove: tags.filter((tag) => tag !== "mate"),
    fill,
    ...(membership === undefined ? {} : { membership }),
    blocked,
  };
}

export async function runProjectTagPort(argv, tooling) {
  const { actorOf, orgOf, projectsOf, hqOf, hqApi, assertWritable, KRLS, call, mask } = tooling;
  if (argv.includes("--apply") && argv.includes("--dry-run"))
    throw new Error("Choose --apply or --dry-run");
  const apply = argv.includes("--apply");
  const org = orgOf(argv);
  const actor = await actorOf(org);
  const hq = await hqOf(actor, org);
  const api = hqApi(org, hq);
  const session = await api.door(actor);
  let failure;
  try {
    const projects = await projectsOf(actor, org);
    const snapshot = await api.snapshot(session);
    console.log(
      JSON.stringify({
        org: org.name,
        mode: apply ? "apply" : "dry-run",
        marker: "mate",
        hq: hq.projectId,
      }),
    );
    for (const project of projects) {
      const plan = planProjectTagPort(project, snapshot, projects);
      let writable = true;
      try {
        if (!(org.id === KRLS && project.id === hq.projectId)) assertWritable(org, project);
      } catch {
        writable = false;
      }
      console.log(JSON.stringify({ ...plan, writable }));
      if (!apply || !writable || plan.remove.length === 0) continue;
      if (plan.blocked.length > 0) throw new Error(`${project.id}: ${plan.blocked.join("; ")}`);
      // Re-read before any write; changed tags require another explicit run.
      const read = await call(actor, "GET", `/project/${project.id}`);
      if (read.status !== 200 || read.json.clientId !== org.id)
        throw new Error(`${project.id}: project read refused`);
      if (!(org.id === KRLS && project.id === hq.projectId))
        assertWritable(org, { ...project, name: read.json.name });
      if (JSON.stringify(read.json.tagList ?? []) !== JSON.stringify(project.tags))
        throw new Error(`${project.id}: tags changed; run again`);
      const facts = { projectId: project.id, mate: plan.keep.includes("mate") };
      for (const { field, value } of plan.fill) {
        if (field.startsWith("signers."))
          (facts.signers ??= {})[field.slice("signers.".length)] = value;
        else facts[field] = value;
      }
      const ported = await api.api("POST", "/api/project-metadata/port", { session, body: facts });
      if (ported.status !== 200)
        throw new Error(`${project.id}: HQ port refused (${ported.status}); tags retained`);
      if (plan.membership !== undefined) {
        const { appId, kind } = plan.membership;
        const attached = await api.api("POST", `/api/apps/${encodeURIComponent(appId)}/projects`, {
          session,
          body: {
            projectId: project.id,
            kind,
            ...(["mate", "devstage"].includes(kind) ? { mate: { face: facts.face ?? "" } } : {}),
          },
        });
        if (attached.status !== 200 && attached.status !== 201)
          throw new Error(
            `${project.id}: HQ placement refused (${attached.status}); tags retained`,
          );
      }
      const verified = await api.api("GET", "/api/structure", { session });
      if (verified.status !== 200)
        throw new Error(`${project.id}: HQ verification refused; tags retained`);
      const remaining = planProjectTagPort(project, verified.json, projects);
      if (
        remaining.fill.length > 0 ||
        remaining.membership !== undefined ||
        remaining.blocked.length > 0
      )
        throw new Error(`${project.id}: HQ facts still missing; tags retained`);
      const fresh = await call(actor, "GET", `/project/${project.id}`);
      if (
        fresh.status !== 200 ||
        fresh.json.clientId !== org.id ||
        JSON.stringify(fresh.json.tagList ?? []) !== JSON.stringify(project.tags)
      )
        throw new Error(`${project.id}: project changed; tags retained`);
      if (!(org.id === KRLS && project.id === hq.projectId))
        assertWritable(org, { ...project, name: fresh.json.name });
      const updated = await call(actor, "PUT", `/project/${project.id}`, {
        name: fresh.json.name,
        description: fresh.json.description ?? "",
        tagList: plan.keep,
        publicIpV4Shared: fresh.json.publicIpV4Shared ?? false,
        publicIpV6Shared: fresh.json.publicIpV6Shared ?? false,
      });
      if (updated.status !== 200)
        throw new Error(`${project.id}: tag removal failed (${updated.status}); HQ facts retained`);
      const after = await call(actor, "GET", `/project/${project.id}`);
      if (
        after.status !== 200 ||
        JSON.stringify(after.json.tagList ?? []) !== JSON.stringify(plan.keep)
      )
        throw new Error(`${project.id}: tag removal not confirmed; inspect before running again`);
      console.log(JSON.stringify({ projectId: project.id, state: "done" }));
    }
  } catch (cause) {
    failure = new Error(mask(cause instanceof Error ? cause.message : String(cause)));
  } finally {
    const deleted = await api.api("DELETE", "/api/session", { session });
    if (deleted.status !== 200 && deleted.status !== 204)
      failure ??= new Error("HQ session cleanup failed");
  }
  if (failure !== undefined) throw failure;
}
