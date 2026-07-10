from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from db import get_connection

router = APIRouter()

STAGE_KEYS = ["pdf", "raw_words", "canonical_words", "nodes", "chunks", "embeddings"]
STAGE_LABELS = {
    "pdf": "PDF Upload",
    "raw_words": "Raw Words Detection",
    "canonical_words": "Canonical Words Selection",
    "nodes": "Outline Generation",
    "chunks": "Chunk Assignment",
    "embeddings": "Embeddings Generation",
}


class StageStatus(BaseModel):
    complete: bool
    stale: bool
    committed_at: Optional[datetime] = None


class ChatroomReadiness(BaseModel):
    chatroom_id: int
    published_at: Optional[datetime] = None
    is_ask_ready: bool
    stages: dict[str, StageStatus]


def _stage_status(ts: Optional[datetime], upstream_ts: Optional[datetime]) -> StageStatus:
    if ts is None:
        return StageStatus(complete=False, stale=False, committed_at=None)
    if upstream_ts is None or ts >= upstream_ts:
        return StageStatus(complete=True, stale=False, committed_at=ts)
    return StageStatus(complete=False, stale=True, committed_at=ts)


def _build_readiness(
    chatroom_id: int,
    published_at: Optional[datetime],
    pdf_ts: Optional[datetime],
    rw_ts: Optional[datetime],
    cw_ts: Optional[datetime],
    nodes_ts: Optional[datetime],
    chunks_ts: Optional[datetime],
    emb_ts: Optional[datetime],
    chunk_count: int,
    embedding_count: int,
) -> ChatroomReadiness:
    pdf_status = StageStatus(
        complete=pdf_ts is not None,
        stale=False,
        committed_at=pdf_ts,
    )
    rw_status = _stage_status(rw_ts, pdf_ts)
    cw_status = _stage_status(cw_ts, rw_ts)
    nodes_status = _stage_status(nodes_ts, cw_ts)
    chunks_status = _stage_status(chunks_ts, nodes_ts)

    emb_complete = (
        emb_ts is not None
        and (chunks_ts is None or emb_ts >= chunks_ts)
        and chunk_count > 0
        and embedding_count >= chunk_count
    )
    emb_stale = emb_ts is not None and not emb_complete
    emb_status = StageStatus(complete=emb_complete, stale=emb_stale, committed_at=emb_ts)

    stages = {
        "pdf": pdf_status,
        "raw_words": rw_status,
        "canonical_words": cw_status,
        "nodes": nodes_status,
        "chunks": chunks_status,
        "embeddings": emb_status,
    }

    all_complete = all(s.complete for s in stages.values())
    is_ask_ready = published_at is not None and all_complete

    return ChatroomReadiness(
        chatroom_id=chatroom_id,
        published_at=published_at,
        is_ask_ready=is_ask_ready,
        stages=stages,
    )


@router.get("", response_model=list[ChatroomReadiness])
def get_all_readiness():
    """Readiness for every chatroom in a single connection, so the admin
    dashboard doesn't fan out one request per chatroom and exhaust the
    Supabase pooler's session-mode connection cap."""
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT chatroom_id, published_at, source_pdf_last_updated_at,
                           raw_words_last_generated_at, canonical_words_last_generated_at,
                           nodes_last_generated_at, chunks_last_generated_at,
                           embeddings_last_generated_at, document_id
                    FROM (
                        SELECT
                            c.id AS chatroom_id,
                            c.published_at,
                            d.source_pdf_last_updated_at,
                            d.raw_words_last_generated_at,
                            d.canonical_words_last_generated_at,
                            d.nodes_last_generated_at,
                            d.chunks_last_generated_at,
                            d.embeddings_last_generated_at,
                            d.id AS document_id,
                            ROW_NUMBER() OVER (PARTITION BY c.id ORDER BY d.id ASC) AS rn
                        FROM chatrooms c
                        LEFT JOIN chatroom_documents cd ON cd.chatroom_id = c.id
                        LEFT JOIN documents d ON d.id = cd.document_id
                    ) ranked
                    WHERE rn = 1
                    ORDER BY chatroom_id
                    """
                )
                rows = cur.fetchall()

                doc_ids = [r[8] for r in rows if r[8] is not None]
                chunk_counts: dict[int, int] = {}
                embedding_counts: dict[int, int] = {}
                if doc_ids:
                    cur.execute(
                        "SELECT document_id, COUNT(*) FROM document_chunks WHERE document_id = ANY(%s) GROUP BY document_id",
                        (doc_ids,),
                    )
                    chunk_counts = dict(cur.fetchall())
                    cur.execute(
                        "SELECT document_id, COUNT(*) FROM document_embeddings WHERE document_id = ANY(%s) GROUP BY document_id",
                        (doc_ids,),
                    )
                    embedding_counts = dict(cur.fetchall())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch readiness: {e}")

    results = []
    for (chatroom_id, published_at, pdf_ts, rw_ts, cw_ts, nodes_ts, chunks_ts, emb_ts, doc_id) in rows:
        chunk_count = chunk_counts.get(doc_id, 0) if doc_id is not None else 0
        embedding_count = embedding_counts.get(doc_id, 0) if doc_id is not None else 0
        results.append(
            _build_readiness(
                chatroom_id, published_at, pdf_ts, rw_ts, cw_ts, nodes_ts, chunks_ts, emb_ts,
                chunk_count, embedding_count,
            )
        )
    return results


@router.get("/{chatroom_id}", response_model=ChatroomReadiness)
def get_readiness(chatroom_id: int):
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM chatrooms WHERE id = %s", (chatroom_id,))
                if cur.fetchone() is None:
                    raise HTTPException(status_code=404, detail="Chatroom not found")

                cur.execute(
                    """
                    SELECT
                        c.published_at,
                        d.source_pdf_last_updated_at,
                        d.raw_words_last_generated_at,
                        d.canonical_words_last_generated_at,
                        d.nodes_last_generated_at,
                        d.chunks_last_generated_at,
                        d.embeddings_last_generated_at,
                        d.id AS document_id
                    FROM chatrooms c
                    LEFT JOIN chatroom_documents cd ON cd.chatroom_id = c.id
                    LEFT JOIN documents d ON d.id = cd.document_id
                    WHERE c.id = %s
                    ORDER BY d.id ASC
                    LIMIT 1
                    """,
                    (chatroom_id,),
                )
                row = cur.fetchone()

                chunk_count = 0
                embedding_count = 0
                if row and row[7] is not None:
                    doc_id = row[7]
                    cur.execute(
                        "SELECT COUNT(*) FROM document_chunks WHERE document_id = %s",
                        (doc_id,),
                    )
                    chunk_count = cur.fetchone()[0]
                    cur.execute(
                        "SELECT COUNT(*) FROM document_embeddings WHERE document_id = %s",
                        (doc_id,),
                    )
                    embedding_count = cur.fetchone()[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch readiness: {e}")

    if row is None:
        return ChatroomReadiness(
            chatroom_id=chatroom_id,
            published_at=None,
            is_ask_ready=False,
            stages={k: StageStatus(complete=False, stale=False, committed_at=None) for k in STAGE_KEYS},
        )

    (published_at, pdf_ts, rw_ts, cw_ts, nodes_ts, chunks_ts, emb_ts, _doc_id) = row

    return _build_readiness(
        chatroom_id, published_at, pdf_ts, rw_ts, cw_ts, nodes_ts, chunks_ts, emb_ts,
        chunk_count, embedding_count,
    )
