ALTER TABLE chat_turns
    ADD COLUMN IF NOT EXISTS feedback_categories JSONB NOT NULL DEFAULT '[]';

UPDATE chat_turns
SET feedback_categories = jsonb_build_array(feedback_category)
WHERE feedback_category IS NOT NULL
  AND feedback_categories = '[]';

ALTER TABLE chat_turns
    DROP COLUMN IF EXISTS feedback_category;
