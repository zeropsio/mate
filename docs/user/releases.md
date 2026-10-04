# Releasing an application

Open **Review release** and review the merged changes and where they will deploy. Only a person
with release access can press **Release**. An agent can prepare and merge code; it cannot release it.

The **Version** field starts at the next patch above the highest existing release. You can type a
different `major.minor.patch`, with or without `v`; it must be newer than every release. HQ checks
the name again when you release, so a release made from another window can make your choice stale.

When main declares a newer version in a root `VERSION` file or `package.json`, the dialog offers
**Use v…** beside the file it read. `VERSION` takes precedence over `package.json` in the same
repository. Suggestions come from the recipe repository and the repositories production builds
from. They do not change the default or tag anything until you choose one and release.

After you press Release, the dialog keeps the changes and the production version you reviewed,
while showing the deployment's progress. **Replaces v…** names the release whose commits production
ran. **Replaces what production runs** means those commits matched no recorded release, for example
after a direct deployment or a partial deployment. A rollback is a new release of earlier code,
so its own release name is shown when its commits match production.
