# Reviewing changes

A Mate delivers work through a change in HQ. After a change is squash-merged, the next delivery
starts from current main and reports that it kept the previous history. Newer work is carried into
the next change; learning that a merge happened does not change the checkout in the background.

When main already has the delivered content, the agent receives “nothing to deliver: main already
has this.” No change is opened or updated for that delivery. Previously landed work is excluded
from the next change's commit list.

An existing empty change says “Nothing to merge” in its review and offers only **Close without
merging**, where your access permits it. It offers no Merge action.
