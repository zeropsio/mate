export const LEGACY_VOCABULARY_PATTERNS = [
  { name: "T3 Code", pattern: /\bT3 Code\b/u },
  { name: "T3 Connect", pattern: /\bT3 Connect\b/u },
  { name: "Tailscale", pattern: /\bTailscale\b/u },
  { name: "pairing", pattern: /\bpairing\b/iu },
  { name: "worktree", pattern: /\bworktrees?\b/iu },
  { name: "Local checkout", pattern: /\bLocal checkout\b/u },
  { name: "control plane", pattern: /(?<!Zerops )\bcontrol[- ]plane\b/iu },
] as const;
