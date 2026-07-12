ALTER TABLE chat_turns
    ADD COLUMN IF NOT EXISTS feedback_category TEXT,
    ADD COLUMN IF NOT EXISTS feedback_text TEXT;
