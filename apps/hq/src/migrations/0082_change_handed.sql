-- A change a person handed to another Mate of its application once its own Mate was gone: the Mate
-- it was opened by (`handed_from`), its branch kept. Its new Mate's state says so (`MateChange.handed`).
ALTER TABLE hq_change ADD COLUMN handed_from text;

ALTER TABLE hq_git_event DROP CONSTRAINT hq_git_event_kind_check;
ALTER TABLE hq_git_event ADD CONSTRAINT hq_git_event_kind_check
  CHECK (kind IN ('pushed', 'opened', 'main_moved', 'merged', 'closed', 'commented', 'released',
    'delivery_empty', 'handed'));
