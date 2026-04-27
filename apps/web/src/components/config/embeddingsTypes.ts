export interface EmbeddingsApiState {
  chatroom_id: number;
  document_id: number | null;
  has_committed_chunks: boolean;
  committed_chunk_count: number;
  stored_embedding_count: number;
  missing_count: number;
}
