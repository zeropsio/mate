export type UpgradeProbe = "compatible" | "incompatible" | "unreachable";

/** One explicit restart, followed only by reads. A healthy old process is not success. */
export async function restartAndVerifyMate(input: {
  readonly restart: () => Promise<unknown>;
  readonly probe: () => Promise<UpgradeProbe>;
  readonly wait: () => Promise<void>;
  readonly isCurrent: () => boolean;
  readonly attempts?: number;
}): Promise<"compatible" | "incompatible" | "unreachable" | "cancelled"> {
  if (!input.isCurrent()) return "cancelled";
  await input.restart();
  let last: UpgradeProbe = "unreachable";
  for (let attempt = 0; attempt < (input.attempts ?? 60); attempt++) {
    if (!input.isCurrent()) return "cancelled";
    await input.wait();
    if (!input.isCurrent()) return "cancelled";
    last = await input.probe();
    if (!input.isCurrent()) return "cancelled";
    if (last === "compatible") return "compatible";
  }
  return last;
}
