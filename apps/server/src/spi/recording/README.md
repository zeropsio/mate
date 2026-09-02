# Claude fixture recorder

`record-claude.mjs` drives `@anthropic-ai/claude-agent-sdk` `query()` directly
(no mate/T3 server) with the same streaming-input options
`ClaudeAdapter.ts`'s `makeClaudeAdapter` passes, and tees every `SDKMessage`
plus every control callback (`canUseTool`, `onUserDialog`) to a JSONL file in
arrival order. Used to record the fixtures under `../fixtures/claude/`.

Run **on a container with the Claude Agent SDK installed and Claude Code
logged in** (e.g. `zcp` on the `z3-eval` project) — it is a zero-dependency
Node script, copy it over with `scp` and run it in place:

```sh
scp record-claude.mjs zcp:/tmp/
ssh zcp 'cd /var/www && node /tmp/record-claude.mjs \
  --prompt "Reply with the single word ok." \
  --out /tmp/plain-text-turn.jsonl'
scp zcp:/tmp/plain-text-turn.jsonl zcp:/tmp/plain-text-turn.meta.json .
```

## Output

- `<out>` — JSONL, one line per event: `{"kind":"message","message":<SDKMessage>}`
  or `{"kind":"control","name":"canUseTool"|"onUserDialog"|"interrupt",...}`.
- `<out-without-.jsonl>.meta.json` — sidecar: driver, CLI/SDK versions, model,
  capture timestamp/location, prompt, the recorder's `--allowed-tools`
  safety allowlist, and a redacted snapshot of the SDK options object (`env`
  omitted, `$HOME` paths replaced with `~`).

No `{"kind":"meta",...}` line is ever written into the JSONL — meta lives
only in the sidecar.

## Flags

See the header comment in `record-claude.mjs` for the full flag list
(`--prompt`, `--cwd`, `--out`, `--allowed-tools`, `--answer`,
`--abort-after`, `--permission-mode`, `--claude-binary`, `--sdk-path`,
`--max-wait-ms`, `--notes`).

## Safety

`--allowed-tools` (default: the read-only `zerops_workflow` / `zerops_mount`
/ `zerops_discover` status calls) is a recorder-side gate enforced inside
this script's own `canUseTool` — it is NOT an SDK option (the adapter never
sets `allowedTools` either; production access control is `permissionMode` +
`canUseTool` only). Anything not on the list is denied. Never widen it to a
mutating `zerops_*` tool when recording on a shared rig.
