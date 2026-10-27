// @effect-diagnostics nodeBuiltinImport:off
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

/**
 * Expand a leading `~` (or `~/…`, `~\…`) in a user-supplied path to `homeDir`.
 * Spawned processes don't get shell expansion, so env vars like
 * `CODEX_HOME=~/.codex-work` would be passed verbatim and treated as relative
 * paths by the receiver.
 *
 * Server code passes `ServerConfig.homeDir`; only the ported provider drivers
 * still take the host default. Returns the input unchanged if it doesn't
 * start with `~` or is empty. Does not handle `~user` (other-user) expansion.
 */
export function expandHomePath(value: string, homeDir: string = NodeOS.homedir()): string {
  if (!value) return value;
  if (value === "~") return homeDir;
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return NodePath.join(homeDir, value.slice(2));
  }
  return value;
}
