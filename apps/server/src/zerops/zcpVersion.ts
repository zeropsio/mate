/** A zcp version as people read it: zcp writes `v9.226.0`, the app reads and says `9.226.0`. */
export const zcpVersionText = (version: string): string => version.replace(/^v(?=\d)/u, "");
