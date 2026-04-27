-- Requires pgvector extension (already enabled in Supabase via public.vector).
-- Embedding dimension 1536 matches text-embedding-3-small.

CREATE TABLE IF NOT EXISTS document_embeddings (
    document_id  INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index  INTEGER NOT NULL,
    embedding    vector(1536) NOT NULL,
    PRIMARY KEY (document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_document_embeddings_document_id
    ON document_embeddings(document_id);
