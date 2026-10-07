# Reviewing changes

A Mate delivers work through a change in HQ. After a change is squash-merged, the next delivery
starts from current main and reports that it kept the previous history. Newer work is carried into
the next change; learning that a merge happened does not change the checkout in the background.

The projects page's **Overview**, its **Next steps**, and the sidebar include both code and recipe
changes. If a Mate leaves the listing, its open changes remain under the application with its
Mate identifier and **Review**.

A collapsed project shows open changes and what its environments run. Expand it to read recipes, repositories and release history; closing it stops those detail reads. The compact fallback uses navigation facts, and can include merged work when its detail is already known.

**Other containers** starts collapsed. A container the current HQ does not hold says **Not in this
HQ**. **Set up Mate** is offered for development environments, declared Mates, and your own plain
projects made before your organization's HQ — never for a project HQ holds any record of, one an
earlier application tagged, one made since (it may be a stage or a production), nor the HQ itself.
It asks first, saying what it adds and that the project's services restart once while it is
closed off.

When main already has the delivered content, the agent receives “nothing to deliver: main already
has this.” No change is opened or updated for that delivery. Previously landed work is excluded
from the next change's commit list.

An existing empty change says “Nothing to merge” in its review and offers only **Close without
merging**, where your access permits it. It offers no Merge action.

Code and recipe changes require Basic user access on at least one of the application's Zerops
projects. Your organization role also applies to listed projects without a separate grant.
The open review checks project access once. A failed check explains the failure and offers **Again**;
a refused check explains the access required.

After a merge or release, **View deploy** on a job opens its build and deploy pipeline. The same
control is available beside a service on its stage or production page, including failed and
completed deploys. **Build log** under the build step opens the log in a dialog. **Hide deploy**
closes the inspection and stops its read. Inspection uses the job's recorded process or version;
if Zerops no longer includes it in the project's recent process history, the inspection says so.

## Releasing to production

A release is your action in Mate. An agent's release request hands the decision to you; it does
not create a release, even when you give the agent a version.

Open the Mate's application on the projects page, choose **Review release**, review what it
carries, then press **Release** with the version shown. HQ creates the release for you.

A release needs a production environment; without one, add it first. Review and **Merge** any still-open changes you want
included. A blocked release review tells you what needs doing first.

HQ deploys production from approved releases. The agent's handoff has not checked whether
production is set up or ready for a release; read those facts in Mate.

Change descriptions can include private PNG, JPEG, GIF, WebP and AVIF pictures, up to 20 MiB each. Pictures require the same access as the change.

A comparison that fails keeps its reason beside the release contents or repository history.
**Compare again** makes one new attempt for those revisions. A failed recipe read retains known
tiers and offers **Read recipe again** on the project page. These failures do not retry on a timer;
a new source revision can supply a new answer.
