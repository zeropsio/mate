/**
 * Words a person never reads on a Mate surface, each with the word the copy glossary
 * (docs/internals/zerops/design-system.md §2) puts in its place. `t3code/no-legacy-vocabulary`
 * reports a match in a user-facing string and quotes `say`.
 */
export const LEGACY_VOCABULARY_PATTERNS = [
  { name: "T3 Code", pattern: /\bT3 Code\b/u, say: "Zerops Mate" },
  { name: "T3 Connect", pattern: /\bT3 Connect\b/u, say: "nothing: omit it" },
  { name: "Tailscale", pattern: /\bTailscale\b/u, say: "nothing: omit it" },
  { name: "pairing", pattern: /\bpairing\b/iu, say: "Sign in with Zerops" },
  { name: "worktree", pattern: /\bworktrees?\b/iu, say: "its own copy of {Mate}'s code" },
  { name: "Local checkout", pattern: /\bLocal checkout\b/u, say: "its own copy of {Mate}'s code" },
  {
    name: "control plane",
    pattern: /(?<!Zerops )\bcontrol[- ]plane\b/iu,
    say: "Zerops Mate",
  },
  {
    // A verb, never the noun "log" followed by "in": "its log in Zerops says why" stays.
    name: "log in",
    pattern:
      /\blogg(?:ed|ing) (?:in|out)\b|\blog[- ](?:in|out)(?=[.,!?…:;]|\s+(?:to|with|again|first|here)\b|$)/iu,
    say: "sign in, signed in, sign out",
  },
  { name: "pull request", pattern: /\b[Pp]ull [Rr]equests?\b|\bPRs?\b/u, say: "change" },
  {
    name: "squash",
    pattern: /\bsquash(?:es|ed|ing)?\b/iu,
    say: "adds {Mate}'s work to the main version",
  },
  {
    name: "merge to stage",
    pattern: /\bmerg(?:e|es|ed|ing) (?:it )?(?:to|into) stage\b/iu,
    say: "approve it; it runs on Stage",
  },
  { name: "landed", pattern: /\blanded\b/iu, say: "merged, or in {Mate}'s code" },
  {
    name: "appdev",
    pattern: /\bapp(?:dev|stage)\b/iu,
    say: "{Mate}'s workspace, or {Mate}'s preview for its own address",
  },
  { name: "recipe", pattern: /\brecipes?\b/iu, say: "setup, or setup files" },
  { name: "import files", pattern: /\bimport files?\b/iu, say: "setup files" },
  { name: "zcp", pattern: /\bzcp\b/iu, say: "Zerops Control Plane" },
  {
    name: "sign in an agent",
    pattern: /\bsign in (?:a|an|the|your) (?:coding )?agents?\b/iu,
    say: "Sign {Mate} in with Claude or ChatGPT",
  },
  {
    name: "Basic user",
    pattern: /\bBasic user\b/iu,
    say: "Works on every project, or Edit",
  },
  { name: "accesses", pattern: /\baccesses\b/iu, say: "access, or what it opens: Choose projects" },
  { name: "Add your domain", pattern: /\bAdd your domain\b/u, say: "Put it on your domain" },
  { name: "surface", pattern: /\b(?:a|this|that) surface\b/iu, say: "page" },
] as const;
