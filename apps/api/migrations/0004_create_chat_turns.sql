CREATE TABLE IF NOT EXISTS chat_turns (
    id           SERIAL PRIMARY KEY,
    chatroom_id  INTEGER NOT NULL REFERENCES chatrooms(id) ON DELETE CASCADE,
    document_id  INTEGER REFERENCES documents(id) ON DELETE SET NULL,
    session_id   UUID NOT NULL,
    username     TEXT,
    question     TEXT NOT NULL,
    answer       TEXT NOT NULL,
    citations    JSONB NOT NULL DEFAULT '[]',
    rating       TEXT CHECK (rating IN ('up', 'down')),
    rated_at     TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_turns_chatroom_id ON chat_turns(chatroom_id);
CREATE INDEX IF NOT EXISTS idx_chat_turns_session_id ON chat_turns(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_turns_created_at ON chat_turns(created_at DESC);
