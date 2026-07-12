import os
import threading
from typing import Optional

from fastapi import APIRouter, HTTPException
from openai import OpenAI
from pydantic import BaseModel

from db import get_connection, unpublish_chatroom

router = APIRouter()

_active_jobs: set[int] = set()
_active_jobs_lock = threading.Lock()


class EmbeddingsState(BaseModel):
    chatroom_id: int
    document_id: Optional[int] = None
    has_committed_chunks: bool
    committed_chunk_count: int
    stored_embedding_count: int
    missing_count: int


def purge_embeddings(document_id: int) -> None:
    """Delete all embeddings for a document. Safe to call if absent."""
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM document_embeddings WHERE document_id = %s",
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


def _count_chunks(document_id: int) -> int:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) FROM document_chunks WHERE document_id = %s",
                (document_id,),
            )
            return cur.fetchone()[0]


def _count_embeddings(document_id: int) -> int:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) FROM document_embeddings WHERE document_id = %s",
                (document_id,),
            )
            return cur.fetchone()[0]


def _build_breadcrumb(node_index: Optional[int], nodes_by_index: dict) -> str:
    if node_index is None or node_index not in nodes_by_index:
        return ""
    parts: list[str] = []
    current: Optional[int] = node_index
    visited: set[int] = set()
    while current is not None and current not in visited:
        visited.add(current)
        node = nodes_by_index.get(current)
        if node is None:
            break
        parts.append(node["label"])
        current = node["parent"]
    parts.reverse()  # leaf-to-root → root-to-leaf
    return " > ".join(parts)


def _load_committed_chunks(document_id: int) -> list[dict]:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT node_index, parent_node, label
                FROM document_nodes
                WHERE document_id = %s
                """,
                (document_id,),
            )
            nodes_by_index = {
                row[0]: {"parent": row[1], "label": row[2]}
                for row in cur.fetchall()
            }
            cur.execute(
                """
                SELECT chunk_index, assigned_node_id, text FROM document_chunks
                WHERE document_id = %s ORDER BY chunk_index
                """,
                (document_id,),
            )
            rows = cur.fetchall()

    result = []
    for chunk_index, assigned_node_id, text in rows:
        breadcrumb = _build_breadcrumb(assigned_node_id, nodes_by_index)
        embed_text = f"{breadcrumb}\n\n{text}" if breadcrumb else text
        result.append({"chunk_index": chunk_index, "text": text, "embed_text": embed_text})
    return result


def _generate_embeddings(texts: list[str]) -> list[list[float]]:
    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    results: list[list[float]] = []
    for i in range(0, len(texts), 100):
        batch = texts[i : i + 100]
        response = client.embeddings.create(
            model="text-embedding-3-small",
            input=batch,
        )
        results.extend([item.embedding for item in response.data])
    return results


@router.get("/{chatroom_id}", response_model=EmbeddingsState)
def get_embeddings_state(chatroom_id: int):
    if not _chatroom_exists(chatroom_id):
        raise HTTPException(status_code=404, detail="Chatroom not found")

    document_id = _resolve_doc(chatroom_id)
    if document_id is None:
        return EmbeddingsState(
            chatroom_id=chatroom_id,
            has_committed_chunks=False,
            committed_chunk_count=0,
            stored_embedding_count=0,
            missing_count=0,
        )

    chunk_count = _count_chunks(document_id)
    embedding_count = _count_embeddings(document_id)

    return EmbeddingsState(
        chatroom_id=chatroom_id,
        document_id=document_id,
        has_committed_chunks=chunk_count > 0,
        committed_chunk_count=chunk_count,
        stored_embedding_count=embedding_count,
        missing_count=max(0, chunk_count - embedding_count),
    )


@router.post("/{chatroom_id}/generate", response_model=EmbeddingsState)
def generate_embeddings(chatroom_id: int):
    if not _chatroom_exists(chatroom_id):
        raise HTTPException(status_code=404, detail="Chatroom not found")

    document_id = _resolve_doc(chatroom_id)
    if document_id is None:
        raise HTTPException(status_code=400, detail="No document for chatroom")

    with _active_jobs_lock:
        if document_id in _active_jobs:
            raise HTTPException(
                status_code=409, detail="Embedding generation already in progress for this document"
            )
        _active_jobs.add(document_id)

    try:
        chunks = _load_committed_chunks(document_id)
        if not chunks:
            raise HTTPException(status_code=400, detail="No committed chunks to embed")

        for chunk in chunks:
            if not chunk["text"].strip():
                raise HTTPException(
                    status_code=400,
                    detail=f"Chunk at index {chunk['chunk_index']} has empty text",
                )

        try:
            vectors = _generate_embeddings([c["embed_text"] for c in chunks])
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Embedding generation failed: {e}")

        try:
            with get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "DELETE FROM document_embeddings WHERE document_id = %s",
                        (document_id,),
                    )
                    if chunks:
                        row_ph = "(%s, %s, %s::vector)"
                        placeholders = ", ".join([row_ph] * len(chunks))
                        flat: list = []
                        for chunk, vector in zip(chunks, vectors):
                            flat.extend([document_id, chunk["chunk_index"], str(vector)])
                        cur.execute(
                            f"INSERT INTO document_embeddings (document_id, chunk_index, embedding) VALUES {placeholders}",
                            flat,
                        )
                    cur.execute(
                        """
                        UPDATE documents
                        SET embeddings_last_generated_at = NOW(),
                            embedding_model = %s
                        WHERE id = %s
                        """,
                        ("text-embedding-3-small", document_id),
                    )
                    unpublish_chatroom(cur, chatroom_id)
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to store embeddings: {e}")

    finally:
        with _active_jobs_lock:
            _active_jobs.discard(document_id)

    chunk_count = len(chunks)
    return EmbeddingsState(
        chatroom_id=chatroom_id,
        document_id=document_id,
        has_committed_chunks=True,
        committed_chunk_count=chunk_count,
        stored_embedding_count=chunk_count,
        missing_count=0,
    )
