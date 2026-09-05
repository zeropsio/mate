/**
 * A seed for {@link makeMockZeropsRecipeStore}: one group whose recipes are the
 * real `zeropsio/recipes` `go-hello-world` tiers, fetched 2026-09-05 from
 * https://github.com/zeropsio/recipes/tree/main/go-hello-world.
 *
 * The tier directories map onto environment roles one-to-one, which is the
 * useful part: the recipe repository already thinks in dev / stage /
 * production, so a group's role tag and its recipe are the same axis. The
 * `project:` block each tier ships with is stripped here, because the import
 * endpoint that consumes these takes services only.
 *
 * Multirepo is visible in the content and needs no special handling: the
 * services carry `buildFromGit` URLs into `zerops-recipe-apps/*`, so the
 * recipe is the source of truth for the superordinate unit and each repository
 * stays its own.
 *
 * @module recipeStoreSeed
 */

import { recipeServicesYaml, type ZeropsGroupRecord } from "./recipeStore.ts";

/** The group id the showcase and the mocked golden path both use. */
export const GO_HELLO_WORLD_GROUP_ID = "7k2m9qx4vb1c";

export const GO_HELLO_WORLD_GROUP: ZeropsGroupRecord = {
  groupId: GO_HELLO_WORLD_GROUP_ID,
  name: "Go Hello World",
  recipes: {
    dev: recipeServicesYaml(
      "# Remote (CDE) environment allows developers to build the app\n# within Zerops via SSH, supporting the full development lifecycle\n# without local tool installation.\n\nproject:\n  name: go-hello-world-remote\n\nservices:\n  # Development workspace for remote developers — Zerops pulls\n  # source from the 'buildFromGit' repo using the 'dev' setup,\n  # which deploys full source code and the Go toolchain.\n  # SSH in directly or mount via IDE remote extension (VS Code,\n  # JetBrains Gateway) to edit and run code on the container.\n  # Suggested: raise minRam to 4 GB for a comfortable IDE session.\n  - hostname: appdev\n    type: golang@1.22\n    zeropsSetup: dev\n    buildFromGit: https://github.com/zerops-recipe-apps/go-hello-world-app\n    enableSubdomainAccess: true\n    verticalAutoscaling:\n      minRam: 0.5\n      # minRam: 4  # Uncomment for IDE-mounted sessions\n\n  # Staging app — validates the production build pipeline. Zerops\n  # pulls source and zerops.yaml from the 'buildFromGit' repo,\n  # using the 'prod' zeropsSetup to compile binaries and deploy.\n  # Subdomain access provides a public HTTPS URL for testing.\n  - hostname: appstage\n    type: golang@1.22\n    zeropsSetup: prod\n    buildFromGit: https://github.com/zerops-recipe-apps/go-hello-world-app\n    enableSubdomainAccess: true\n    verticalAutoscaling:\n      minRam: 0.5\n\n  # PostgreSQL for app data. Priority 10 starts data services\n  # before app containers, preventing connection errors on startup.\n  # Accessible as 'db' hostname from 'appdev' and 'appstage'.\n  # A single-node instance — suitable for dev/staging\n  # where HA durability isn't required.\n  - hostname: db\n    type: postgresql:single@16\n    profile: oltp-hobby\n    priority: 10",
    ),
    stage: recipeServicesYaml(
      "# Stage environment uses the same configuration as production,\n# but runs on a single container with lower scaling settings.\n\nproject:\n  name: go-hello-world-stage\n\nservices:\n  # Staging app — validates the production build pipeline before\n  # promoting to production. Zerops pulls source and zerops.yaml\n  # from the 'buildFromGit' repo, using the 'prod' zeropsSetup\n  # to compile binaries and deploy. Subdomain access provides\n  # a public HTTPS URL for QA and stakeholder review.\n  - hostname: app\n    type: golang@1.22\n    zeropsSetup: prod\n    buildFromGit: https://github.com/zerops-recipe-apps/go-hello-world-app\n    enableSubdomainAccess: true\n\n  # PostgreSQL single-node database for staging. Priority 10\n  # starts it before the app container, preventing connection\n  # errors. Single-node is sufficient for staging where HA durability\n  # isn't required.\n  - hostname: db\n    type: postgresql:single@16\n    profile: oltp-staging\n    priority: 10",
    ),
    prod: recipeServicesYaml(
      "# Small production environment offers a production-ready setup\n# optimized for moderate throughput.\n\nproject:\n  name: go-hello-world-small-prod\n\nservices:\n  # Production app — Zerops pulls source and zerops.yaml from\n  # the 'buildFromGit' repo, using the 'prod' zeropsSetup to\n  # compile Go binaries and deploy. 'minContainers: 2' keeps at\n  # least two containers running at all times, enabling load\n  # distribution and zero-downtime deploys. For custom domains,\n  # add a route in the Zerops dashboard after deployment.\n  - hostname: app\n    type: golang@1.22\n    zeropsSetup: prod\n    buildFromGit: https://github.com/zerops-recipe-apps/go-hello-world-app\n    enableSubdomainAccess: true\n    minContainers: 2\n    # Zerops auto-scales RAM within these bounds. minFreeRamGB\n    # reserves headroom for traffic spikes — without it, the\n    # container gets exactly minRam and OOM-kills under load.\n    verticalAutoscaling:\n      minRam: 0.25\n      minFreeRamGB: 0.125\n\n  # PostgreSQL single-node — automatic encrypted backups are on\n  # by default. For production traffic, consider HA mode or\n  # setting up your own backup strategy. Priority 10 starts it\n  # before the app containers, preventing connection errors.\n  - hostname: db\n    type: postgresql:single@16\n    profile: oltp-production\n    priority: 10",
    ),
  },
};
