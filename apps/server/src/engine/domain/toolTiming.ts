import type { CommandClass } from "@t3tools/contracts";

import { bareToolName } from "./mateAsks.ts";

export const TOOL_CLASSES = [
  "person",
  "deploy",
  "lease",
  "browser",
  "zcp_run",
  "git",
  "zcp",
  "other",
] as const;
export type ToolClass = (typeof TOOL_CLASSES)[number];

/** Classify the whole command before its display copy is cut. */
export const commandClass = (input: string): CommandClass => {
  if (
    /^(?:[A-Za-z][\w-]*:\s*)?(?:\{\s*"(?:command|cmd)"\s*:\s*")?zcp\s+lease\s+(?:acquire|release)(?=$|[\s;&|)'"}])/u.test(
      input,
    )
  )
    return "lease";
  if (/(?:^|[\s;&|('"`])zcp\s+run(?=$|[\s;&|)'"`])/u.test(input)) return "zcp_run";
  if (/(?:^|[\s;&|('"`])(?:zcp\s+git|git)(?=$|[\s;&|)'"`])/u.test(input)) return "git";
  return "other";
};

/** Command input is used only to classify the call, never written to the trace. */
export const toolClass = ({
  step,
  tool,
  input,
  action,
  command,
}: {
  readonly step: string | null;
  readonly tool: string | null;
  readonly input: string | null;
  readonly action?: string | null;
  readonly command?: CommandClass | null;
}): ToolClass => {
  const name = bareToolName(tool ?? "");
  if (name === "AskUserQuestion") return "person";
  if (name === "zerops_deploy" || name === "zerops_deploy_batch") return "deploy";
  if (name === "zerops_lease") {
    const leaseAction =
      action ??
      input?.match(/["']?action["']?\s*[:=]\s*["']?(acquire|release)(?=["'\s,}]|$)/u)?.[1];
    if (leaseAction === "acquire" || leaseAction === "release") return "lease";
  }
  if (name === "zerops_browser") return "browser";
  if (step === "command") {
    const classified = command ?? (input === null ? "other" : commandClass(input));
    if (classified !== "other") return classified;
  }
  if (name.startsWith("zerops_")) return "zcp";
  return "other";
};
