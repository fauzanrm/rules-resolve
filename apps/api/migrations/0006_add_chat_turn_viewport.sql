ALTER TABLE chat_turns
    ADD COLUMN IF NOT EXISTS viewport_width INTEGER,
    ADD COLUMN IF NOT EXISTS viewport_height INTEGER;
