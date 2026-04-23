-- Recreates document_chunks with the schema expected by chunks.py.
-- The previous table used different column names (title, assigned_node_index).
-- Existing chunk rows are dropped as they are incompatible with the new schema.

DROP TABLE IF EXISTS document_chunks;

CREATE TABLE document_chunks (
    id                    SERIAL PRIMARY KEY,
    document_id           INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index           INTEGER NOT NULL,
    assigned_node_id      INTEGER,
    start_canonical_index INTEGER NOT NULL,
    end_canonical_index   INTEGER NOT NULL,
    text                  TEXT NOT NULL
);

CREATE INDEX idx_document_chunks_document_id ON document_chunks(document_id);
