import type { SharedBirth } from "../projections/birthProgress.ts";

export interface ContinueBirthPorts {
  readonly read: () => SharedBirth | undefined;
  readonly bind: (birth: SharedBirth, projectId: string) => Promise<void>;
  readonly attach: (birth: SharedBirth) => Promise<void>;
  /** Wait for the answered write to appear in the shared navigation, or for authority to end. */
  readonly waitForPlacement: (
    projectId: string,
    placement: "bound" | "attached",
  ) => Promise<SharedBirth | undefined>;
  readonly run: (birth: SharedBirth, from: "create" | "import") => Promise<void>;
  readonly recordImport: (birth: SharedBirth, receipt: string) => Promise<void>;
}

/** Acts on the account projection again after binding; a prior view never authorizes the next write. */
export async function continueBirth(
  ports: ContinueBirthPorts,
): Promise<"started" | "waiting" | "unavailable"> {
  let birth = ports.read();
  if (birth === undefined || !birth.canContinue) return "unavailable";
  if (birth.progress.next.kind === "bind") {
    const id = birth.id;
    const projectId = birth.progress.next.projectId;
    await ports.bind(birth, projectId);
    birth = await ports.waitForPlacement(projectId, "bound");
    if (
      birth === undefined ||
      birth.id !== id ||
      birth.projectId !== projectId ||
      !birth.canContinue
    )
      return "unavailable";
  }
  const next = birth.progress.next;
  switch (next.kind) {
    case "create":
      if (birth.projectId !== null || birth.intent === undefined) return "unavailable";
      await ports.run(birth, "create");
      return "started";
    case "import":
      if (birth.projectId === null || birth.intent === undefined) return "unavailable";
      if (birth.placement === "unknown") return "waiting";
      await ports.run(birth, "import");
      return "started";
    case "record-import":
      if (birth.projectId === null) return "unavailable";
      if (birth.placement === "unknown") return "waiting";
      if (birth.placement === "unplaced") {
        const { id, projectId } = birth;
        await ports.attach(birth);
        birth = await ports.waitForPlacement(projectId, "attached");
        if (
          birth === undefined ||
          birth.id !== id ||
          birth.projectId !== projectId ||
          !birth.canContinue
        )
          return "unavailable";
        if (
          birth.placement !== "attached" ||
          birth.progress.next.kind !== "record-import" ||
          birth.progress.next.receipt !== next.receipt
        )
          return "waiting";
      }
      await ports.recordImport(birth, next.receipt);
      return "started";
    case "wait":
      if (next.attach) {
        await ports.attach(birth);
        return "started";
      }
      return "waiting";
    case "bind":
    case "unknown":
    case "blocked":
      return "unavailable";
  }
}
