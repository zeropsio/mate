// Spec §0 Boundaries, invariant MA-6: the mate server spawns `zcp` for a
// closed list of verbs — `mate status`/`mate update` (ZeropsCli.ts, spec §2.9
// MU-2), `studio console serve` (ZeropsDataConsole.ts, the Data Console
// engine host), `lease acquire` (ZeropsCli.ts: a crew writer takes its own copy),
// `lease release` (ZeropsCli.ts: a removed writer or archived conversation
// gives its workspace back; zcp refuses while work is unsaved), `version`
// (ZeropsCli.ts: whether this zcp can release or restart yet) and `self restart`
// (ZeropsCli.ts: a Mate that only a container restart gets current restarts its
// own zcp service once idle). The agent sign-in flag is
// written through the API (ZeropsAgentFlag.ts), not by spawning
// `zcp agent mark-oauth`.
// Everything else the product needs from the platform is read by the client
// with the user's own token (rule 1), and zcp never grows a layer for mate
// (rule 3). Every zcp argv in the zone starts with a spread of baseArgs
// followed by the verb as a sequence of string literals.
import { defineRule } from "@oxlint/plugins";

const ALLOWED_ARGV = [
  "mate status",
  "mate update",
  "studio console serve",
  "lease acquire",
  "lease release",
  "version",
  "self restart",
];

export default defineRule({
  meta: {
    type: "problem",
    docs: { description: "Restrict zcp commands spawned by the server to the verbs in MA-6." },
  },
  create(context) {
    const file = context.filename
      .replaceAll("\\", "/")
      .match(/(?:^|\/)(apps\/server\/src\/zerops\/.*\.tsx?)$/u)?.[1];
    if (!file || /\.test\.tsx?$/u.test(file)) return {};

    return {
      ArrayExpression(node) {
        const [spread, ...args] = node.elements;
        if (
          spread?.type !== "SpreadElement" ||
          spread.argument.type !== "Identifier" ||
          spread.argument.name !== "baseArgs"
        )
          return;
        const literals: string[] = [];
        for (const arg of args) {
          if (arg?.type !== "Literal" || typeof arg.value !== "string") break;
          literals.push(arg.value);
        }
        if (!literals.length) return;
        const argv = literals.join(" ");
        if (!ALLOWED_ARGV.some((verb) => argv.startsWith(verb))) {
          context.report({
            node,
            message: `${file}: zcp argv "${argv}" is outside the MA-6 verb list.`,
          });
        }
      },
    };
  },
});
