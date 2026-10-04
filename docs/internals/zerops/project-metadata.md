# Project metadata

A Zerops project that has a Mate carries the exact `mate` marker beside its person's own tags, and
no other `mate:` tag. Project names, services
and access roles come from Zerops. Application membership and kind, faces, makers, birth intents,
name sources and preserved signer identities are HQ records joined by project id. Desktop uses
the web client. Mobile shares the client runtime but reads nothing from HQ — no structure, placement
or stream: it gates a Mate's close-off on the project's own isolation, read once as the person
opens it (`apps/mobile/src/features/zerops/close-off.ts`).

The client records a birth intent before creating a project and retains its id in the creation
plan. Once Zerops returns the project handle, registration binds that handle to the intent at HQ
before attaching it. A failed registration retains its project handle and ends visibly. Another
browser finds the open intent by its project id in HQ's structure. A closed intent's id stays on
the Mate record; project names never establish relations.

HQ bootstrap cannot use a running HQ. Its existing import-seeded journal holds the import id and
receipts until the organization anchor names the official HQ. Recovery reads that journal by
project id, never a project tag. A project with HQ's services and no readable journal stops setup
for inspection instead of authorizing another import.

The local cleanup command reads legacy tags only through `scripts/project-tag-port.mjs` and
`scripts/port-mate-faces.ts`.
It resolves missing faces with `scripts/port-mate-faces.ts` from the whole organization’s origin
pool, sharing the face port’s assignment. It preserves absent HQ facts through the admin-only
`/api/project-metadata/port` endpoint,
verifies the HQ structure, then removes tags in one checked attempt. Existing HQ facts win.
Unknown metadata and unresolved application ids block removal. The command defaults to dry-run;
its apply guard comes from the cutover tooling's project allowlists. Old Gitea registry records
require the existing bundle port first. zcp must stop seeding signers from project tags and read
the preserved signer map at HQ before cleanup is applied to an unseeded Mate.
