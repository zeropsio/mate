next: MC14

- MC1 — A Claude model whose minimum Claude Code version is above the installed one is not offered, and the upgrade hint names that model and its minimum version
- MC2 — A Claude model picked by its alias reaches Claude Code under its slug, with the effort its profile maps the chosen effort to and the suffix its profile gives the chosen option
- MC3 — A custom model named like a built-in alias takes that alias over, and a custom model with its own options resolves effort against them and passes the value to Claude Code unchanged
- MC4 — A built-in model the manifest does not list as current is marked legacy, a listed one loses a stale legacy mark, a custom model is never marked, and a qualified Codex id is judged by its family without changing the id
- MC5 — The manifest's chat default takes the default mark and the previous default's aliases, on the qualified Codex model of its family too, while an account that does not offer it keeps its own default
- MC6 — A provider catalog with a repeated slug, a model naming a missing profile, or a chat default naming no model resolves to nothing, and a valid one gives each model its profile's capabilities and the default mark
- MC7 — The model manifest is fetched at most once while fresh and survives a restart from its disk copy, while an explicit refresh fetches at once and a failed one keeps the last good manifest
- MC8 — A fetched manifest that fails validation never replaces the bundled or the last good manifest, in memory or on disk, and neither does a compatibility policy that fails validation
- MC9 — A disk copy of a manifest edited before the bundled one, or undated, gives way to the bundled manifest, while a newer disk copy outranks it
- MC10 — With provider update checks off, neither a refresh nor an explicit refresh fetches the manifest
- MC11 — A provider CLI version, with or without a leading v, takes the status of the first range that holds it in the policy for its driver and this Mate release, a prerelease, an unlisted version, an unknown tag or no version is unknown, and no policy applies outside its Mate range
- MC12 — A remote compatibility policy replaces its bundled one without touching the provider's own status and message, an omitted one leaves the bundled in force, the latest version gets its own verdict beside the update advice, and a disabled or uninstalled provider carries no compatibility verdict
- MC13 — A compatibility policy is refused when a range is not a version comparison, its Mate range is open, or its recommended version is not a plain version whose first matching range is supported
