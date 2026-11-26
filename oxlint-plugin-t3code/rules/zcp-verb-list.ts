// The Mate server spawns `zcp` with no argv outside a closed list; the contract
// is `zeropsio/zcp:docs/spec-mate.md` §0, invariant MA-6. Each verb has one
// spawner:
// - `mate status`, `mate update` (ZeropsCli.ts, spec §2.9 MU-2);
// - `version` (ZeropsCli.ts: which zcp the container runs);
// - `where` (ZeropsCli.ts: where the work stands, before a run's message);
// - `lease acquire` (ZeropsCli.ts: a crew writer takes its own copy);
// - `lease release` (ZeropsCli.ts: a removed writer or archived conversation
//   gives its workspace back; zcp refuses while work is unsaved);
// - `studio console serve` (ZeropsDataConsole.ts, the Data Console engine host);
// - `git <host> ls-remote` (ZeropsGitRemoteProbe.ts: a checkout's remote health).
// The agent sign-in flag is written through the API (ZeropsAgentFlag.ts), not
// by spawning `zcp agent mark-oauth`.
// Everything else the product needs from the platform is read by the client
// with the user's own token (rule 1), and zcp never grows a layer for mate
// (rule 3).
// A zcp argv is an array whose first element spreads `baseArgs` or
// `<object>.baseArgs`. It is read element by element after that spread: a string
// literal gives its value, any other expression (the host, a branch) gives `*`,
// and a spread or an empty slot ends the reading.
import { defineRule } from "@oxlint/plugins";

const ALLOWED_ARGV = [
  "mate status",
  "mate update",
  "studio console serve",
  "lease acquire",
  "lease release",
  "version",
  "where",
  "git * ls-remote",
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
        if (spread?.type !== "SpreadElement") return;
        const base = spread.argument;
        const spreadsBaseArgs =
          (base.type === "Identifier" && base.name === "baseArgs") ||
          (base.type === "MemberExpression" &&
            !base.computed &&
            base.property.type === "Identifier" &&
            base.property.name === "baseArgs");
        if (!spreadsBaseArgs) return;
        const words: string[] = [];
        for (const arg of args) {
          if (!arg || arg.type === "SpreadElement") break;
          words.push(arg.type === "Literal" && typeof arg.value === "string" ? arg.value : "*");
        }
        if (!words.length) return;
        const argv = words.join(" ");
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
