export interface DraftChunk {
  clientId: string;
  assignedNodeIndex: number | null;
  startCanonicalIndex: number;
  endCanonicalIndex: number;
  text: string;
}

export interface ChunkItemApi {
  chunk_index: number;
  assigned_node_id: number | null;
  start_canonical_index: number;
  end_canonical_index: number;
  text: string;
}

export interface ChunksApiResponse {
  chatroom_id: number;
  document_id: number | null;
  has_nodes: boolean;
  committed_chunks: ChunkItemApi[] | null;
}

export function committedToDraft(chunk: ChunkItemApi): DraftChunk {
  return {
    clientId: crypto.randomUUID(),
    assignedNodeIndex: chunk.assigned_node_id,
    startCanonicalIndex: chunk.start_canonical_index,
    endCanonicalIndex: chunk.end_canonical_index,
    text: chunk.text,
  };
}

export function draftToApi(chunk: DraftChunk, chunkIndex: number): ChunkItemApi {
  return {
    chunk_index: chunkIndex,
    assigned_node_id: chunk.assignedNodeIndex,
    start_canonical_index: chunk.startCanonicalIndex,
    end_canonical_index: chunk.endCanonicalIndex,
    text: chunk.text,
  };
}
