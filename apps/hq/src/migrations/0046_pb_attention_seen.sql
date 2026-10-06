CREATE TABLE hq_attention_seen (
  user_id text NOT NULL,
  project_id text NOT NULL REFERENCES hq_mate (project_id) ON DELETE CASCADE,
  result_id text NOT NULL,
  PRIMARY KEY (user_id, project_id, result_id)
);
