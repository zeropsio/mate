-- A Mate's birth intent: its application, name and face, recorded by whoever presses for it before
-- its Zerops project exists. The project is created tagged with the intent's id
-- (`mate:birth:<id>`), so whoever finishes a press cut off between the project and its attach, in
-- any browser, attaches it where and as it was asked for; its attach closes the intent. It goes
-- with its application.
CREATE TABLE hq_birth_intent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq bigint GENERATED ALWAYS AS IDENTITY,
  app_id uuid NOT NULL REFERENCES hq_app (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  face text NOT NULL CHECK (length(face) <= 64),
  made_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
