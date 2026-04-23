from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from db import get_connection

router = APIRouter()


class ChunkItem(BaseModel):
    chunk_index: int
    assigned_node_id: Optional[int] = None
    start_canonical_index: int
    end_canonical_index: int
    text: str


class ChunksState(BaseModel):
    chatroom_id: int
    document_id: Optional[int] = None
    has_nodes: bool
    committed_chunks: Optional[List[ChunkItem]] = None


class CommitChunksRequest(BaseModel):
    chunks: List[ChunkItem]


def purge_chunks(document_id: int) -> None:
    """Delete all chunks for a document. Safe to call if absent."""
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM document_chunks WHERE document_id = %s",
                    (document_id,),
                )
    except Exception:
        pass


def purge_chunk_assignments(document_id: int) -> None:
    """Clear node assignments on all chunks for a document. Preserves chunks."""
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE document_chunks SET assigned_node_id = NULL WHERE document_id = %s",
                    (document_id,),
                )
    except Exception:
        pass


def _chatroom_exists(chatroom_id: int) -> bool:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM chatrooms WHERE id = %s", (chatroom_id,))
            return cur.fetchone() is not None


def _resolve_doc(chatroom_id: int) -> Optional[int]:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT d.id FROM documents d
                JOIN chatroom_documents cd ON cd.document_id = d.id
                WHERE cd.chatroom_id = %s
                ORDER BY d.id ASC LIMIT 1
                """,
                (chatroom_id,),
            )
            row = cur.fetchone()
            return row[0] if row else None


def _has_nodes(document_id: int) -> bool:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) FROM document_nodes WHERE document_id = %s",
                (document_id,),
            )
            row = cur.fetchone()
            return (row[0] > 0) if row else False


def _load_committed(document_id: int) -> Optional[List[ChunkItem]]:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT chunk_index, assigned_node_id, start_canonical_index,
                       end_canonical_index, text
                FROM document_chunks
                WHERE document_id = %s
                ORDER BY chunk_index
                """,
                (document_id,),
            )
            rows = cur.fetchall()
    if not rows:
        return None
    return [
        ChunkItem(
            chunk_index=row[0],
            assigned_node_id=row[1],
            start_canonical_index=row[2],
            end_canonical_index=row[3],
            text=row[4],
        )
        for row in rows
    ]


def _validate_chunks(document_id: int, chunks: List[ChunkItem], cur) -> None:
    for i, chunk in enumerate(chunks):
        if not chunk.text.strip():
            raise HTTPException(status_code=400, detail=f"Chunk at index {i} has empty text")
        if chunk.start_canonical_index > chunk.end_canonical_index:
            raise HTTPException(
                status_code=400,
                detail=f"Chunk at index {i}: start_canonical_index must be <= end_canonical_index",
            )

    sorted_chunks = sorted(chunks, key=lambda c: c.start_canonical_index)
    for k in range(len(sorted_chunks) - 1):
        curr = sorted_chunks[k]
        nxt = sorted_chunks[k + 1]
        if curr.end_canonical_index >= nxt.start_canonical_index:
            raise HTTPException(
                status_code=400,
                detail="Chunks have overlapping canonical index ranges",
            )

    assigned_ids = {c.assigned_node_id for c in chunks if c.assigned_node_id is not None}
    if assigned_ids:
        cur.execute(
            "SELECT COUNT(*) FROM document_nodes WHERE document_id = %s",
            (document_id,),
        )
        node_count = cur.fetchone()[0]
        invalid = {x for x in assigned_ids if x < 0 or x >= node_count}
        if invalid:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid assigned_node_id values (must be 0-based node array positions 0–{node_count - 1}): {sorted(invalid)}",
            )


@router.get("/{chatroom_id}", response_model=ChunksState)
def get_chunks(chatroom_id: int):
    if not _chatroom_exists(chatroom_id):
        raise HTTPException(status_code=404, detail="Chatroom not found")

    document_id = _resolve_doc(chatroom_id)
    if document_id is None:
        return ChunksState(chatroom_id=chatroom_id, has_nodes=False)

    return ChunksState(
        chatroom_id=chatroom_id,
        document_id=document_id,
        has_nodes=_has_nodes(document_id),
        committed_chunks=_load_committed(document_id),
    )


@router.post("/{chatroom_id}/commit", response_model=ChunksState)
def commit_chunks(chatroom_id: int, body: CommitChunksRequest):
    if not _chatroom_exists(chatroom_id):
        raise HTTPException(status_code=404, detail="Chatroom not found")

    document_id = _resolve_doc(chatroom_id)
    if document_id is None:
        raise HTTPException(status_code=400, detail="No document for chatroom")

    indexed_chunks = list(body.chunks)
    for i, chunk in enumerate(indexed_chunks):
        chunk.chunk_index = i

    with get_connection() as conn:
        with conn.cursor() as cur:
            _validate_chunks(document_id, indexed_chunks, cur)
            cur.execute(
                "DELETE FROM document_chunks WHERE document_id = %s",
                (document_id,),
            )
            if indexed_chunks:
                row_ph = "(%s,%s,%s,%s,%s,%s)"
                placeholders = ",".join([row_ph] * len(indexed_chunks))
                flat: list = []
                for chunk in indexed_chunks:
                    flat.extend([
                        document_id,
                        chunk.chunk_index,
                        chunk.assigned_node_id,
                        chunk.start_canonical_index,
                        chunk.end_canonical_index,
                        chunk.text,
                    ])
                cur.execute(
                    f"""INSERT INTO document_chunks
                        (document_id, chunk_index, assigned_node_id,
                         start_canonical_index, end_canonical_index, text)
                        VALUES {placeholders}""",
                    flat,
                )

    return ChunksState(
        chatroom_id=chatroom_id,
        document_id=document_id,
        has_nodes=True,
        committed_chunks=indexed_chunks if indexed_chunks else None,
    )
