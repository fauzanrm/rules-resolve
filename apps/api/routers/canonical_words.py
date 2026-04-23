import json
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from db import get_connection
from storage import BUCKET, get_supabase

router = APIRouter()

RAW_WORDS_KEY = "derived/raw_words.json"


class CanonicalWord(BaseModel):
    canonical_index: int
    raw_word_index: int
    text: str
    page: int
    block_no: int
    line_no: int
    word_no: int
    quad: List[float]


class CanonicalWordsState(BaseModel):
    chatroom_id: int
    document_id: Optional[int] = None
    has_raw_words: bool
    committed_words: Optional[List[CanonicalWord]] = None
    committed_at: Optional[str] = None


class CommitRequest(BaseModel):
    included_raw_word_indices: List[int]


def purge_canonical_words(document_id: int) -> None:
    """Delete all canonical words for a document. Safe to call if absent."""
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM document_canonical_words WHERE document_id = %s",
                    (document_id,),
                )
    except Exception:
        pass


def _resolve_doc(chatroom_id: int):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT d.id, d.file_name FROM documents d
                JOIN chatroom_documents cd ON cd.document_id = d.id
                WHERE cd.chatroom_id = %s
                ORDER BY d.id ASC LIMIT 1
                """,
                (chatroom_id,),
            )
            row = cur.fetchone()
            if not row:
                return None, None
            return row[0], row[1]


def _chatroom_exists(chatroom_id: int) -> bool:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM chatrooms WHERE id = %s", (chatroom_id,))
            return cur.fetchone() is not None


def _raw_words_path(chatroom_id: int, document_id: int) -> str:
    return f"{chatroom_id}/documents/{document_id}/{RAW_WORDS_KEY}"


def _download_raw_words(supabase, chatroom_id: int, document_id: int) -> Optional[dict]:
    try:
        blob = supabase.storage.from_(BUCKET).download(
            _raw_words_path(chatroom_id, document_id)
        )
        if blob is None:
            return None
        return json.loads(blob.decode("utf-8") if isinstance(blob, (bytes, bytearray)) else blob)
    except Exception:
        return None


def _load_committed(document_id: int) -> tuple[Optional[List[CanonicalWord]], Optional[str]]:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT canonical_index, raw_word_index, text, page,
                       block_no, line_no, word_no, quad, committed_at
                FROM document_canonical_words
                WHERE document_id = %s AND raw_word_index IS NOT NULL
                ORDER BY canonical_index
                """,
                (document_id,),
            )
            rows = cur.fetchall()
    if not rows:
        return None, None
    words = []
    committed_at = None
    for row in rows:
        ci, rwidx, text, page, block_no, line_no, word_no, quad, cat = row
        committed_at = cat.isoformat() if cat else None
        words.append(
            CanonicalWord(
                canonical_index=ci,
                raw_word_index=rwidx,
                text=text or "",
                page=page or 0,
                block_no=block_no or 0,
                line_no=line_no or 0,
                word_no=word_no or 0,
                quad=quad if isinstance(quad, list) else [],
            )
        )
    return words if words else None, committed_at


@router.get("/{chatroom_id}", response_model=CanonicalWordsState)
def get_canonical_words(chatroom_id: int):
    if not _chatroom_exists(chatroom_id):
        raise HTTPException(status_code=404, detail="Chatroom not found")

    document_id, file_name = _resolve_doc(chatroom_id)
    if document_id is None:
        return CanonicalWordsState(chatroom_id=chatroom_id, has_raw_words=False)

    supabase = get_supabase()
    has_raw_words = False
    if supabase:
        raw_data = _download_raw_words(supabase, chatroom_id, document_id)
        has_raw_words = raw_data is not None and bool(raw_data.get("words"))

    committed_words, committed_at = _load_committed(document_id)

    return CanonicalWordsState(
        chatroom_id=chatroom_id,
        document_id=document_id,
        has_raw_words=has_raw_words,
        committed_words=committed_words,
        committed_at=committed_at,
    )


@router.post("/{chatroom_id}/commit", response_model=CanonicalWordsState)
def commit_canonical_words(chatroom_id: int, body: CommitRequest):
    if not _chatroom_exists(chatroom_id):
        raise HTTPException(status_code=404, detail="Chatroom not found")

    document_id, file_name = _resolve_doc(chatroom_id)
    if document_id is None:
        raise HTTPException(status_code=400, detail="No document for chatroom")

    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=500, detail="Storage not configured")

    raw_data = _download_raw_words(supabase, chatroom_id, document_id)
    if raw_data is None:
        raise HTTPException(status_code=400, detail="Raw words not found — regenerate first")

    raw_words = raw_data.get("words", [])
    n = len(raw_words)

    invalid = [i for i in body.included_raw_word_indices if not (0 <= i < n)]
    if invalid:
        raise HTTPException(
            status_code=400,
            detail=f"Out-of-range raw_word_indices: {invalid[:5]}{'...' if len(invalid) > 5 else ''}",
        )

    # Sort included words by reading order, carrying the original raw_word_index
    indexed_words = sorted(
        [(i, raw_words[i]) for i in body.included_raw_word_indices],
        key=lambda t: (t[1]["page"], t[1]["block_no"], t[1]["line_no"], t[1]["word_no"]),
    )

    committed_at = datetime.now(timezone.utc)

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM document_canonical_words WHERE document_id = %s",
                (document_id,),
            )
            if indexed_words:
                row_ph = "(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)"
                placeholders = ",".join([row_ph] * len(indexed_words))
                flat: list = []
                for canonical_idx, (raw_idx, w) in enumerate(indexed_words):
                    flat.extend([
                        document_id, canonical_idx, w["text"], raw_idx,
                        w["page"], w["block_no"], w["line_no"], w["word_no"],
                        json.dumps(w["quad"]), committed_at,
                    ])
                cur.execute(
                    f"""INSERT INTO document_canonical_words
                        (document_id, canonical_index, text, raw_word_index, page,
                         block_no, line_no, word_no, quad, committed_at)
                        VALUES {placeholders}""",
                    flat,
                )

    committed_words = [
        CanonicalWord(
            canonical_index=canonical_idx,
            raw_word_index=raw_idx,
            text=w["text"],
            page=w["page"],
            block_no=w["block_no"],
            line_no=w["line_no"],
            word_no=w["word_no"],
            quad=w["quad"],
        )
        for canonical_idx, (raw_idx, w) in enumerate(indexed_words)
    ]

    from routers.nodes import purge_nodes
    purge_nodes(document_id)
    from routers.chunks import purge_chunks
    purge_chunks(document_id)

    return CanonicalWordsState(
        chatroom_id=chatroom_id,
        document_id=document_id,
        has_raw_words=True,
        committed_words=committed_words if committed_words else None,
        committed_at=committed_at.isoformat(),
    )
