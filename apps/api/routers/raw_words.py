import json
from datetime import datetime, timezone
from typing import Any, List, Optional

import fitz
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from db import get_connection
from storage import BUCKET, get_supabase, upload_file

router = APIRouter()


class RawWord(BaseModel):
    word_id: str
    text: str
    quad: List[float]  # [x0, y0, x1, y1] in PDF points
    page: int
    block_no: int
    line_no: int
    word_no: int


class PageDim(BaseModel):
    page: int
    width: float
    height: float


class RawWordsPayload(BaseModel):
    committed_at: Optional[str] = None
    word_count: int
    page_count: int
    pages: List[PageDim]
    words: List[RawWord]


class RawWordsState(BaseModel):
    chatroom_id: int
    document_id: Optional[int] = None
    has_source_pdf: bool
    raw_words: Optional[dict] = None
    error: Optional[str] = None


class CommitRequest(BaseModel):
    payload: RawWordsPayload


RAW_WORDS_KEY = "derived/raw_words.json"


def _resolve_doc(chatroom_id: int) -> tuple[Optional[int], Optional[str]]:
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


def _download_pdf(supabase, chatroom_id: int, document_id: int, file_name: str) -> Optional[bytes]:
    try:
        return supabase.storage.from_(BUCKET).download(
            f"{chatroom_id}/documents/{document_id}/source/{file_name}"
        )
    except Exception:
        return None


def _normalize_raw_words(data: dict) -> dict:
    """Coerce old preseeded format (words nested per page, quad as object) to canonical schema."""
    pages_raw = data.get("pages", [])
    if not pages_raw or "page_number" not in pages_raw[0]:
        return data

    all_words: list = []
    canonical_pages: list = []

    for p in pages_raw:
        page_num = p["page_number"]
        page_height = p.get("page_height", 0.0)
        words_raw = p.get("words", [])

        max_x1 = max(
            (w["quad"]["x1"] for w in words_raw if isinstance(w.get("quad"), dict)),
            default=0.0,
        )
        page_width = max_x1 if max_x1 > 0 else 612.0

        canonical_pages.append({"page": page_num, "width": page_width, "height": page_height})

        for w in words_raw:
            quad = w.get("quad", {})
            block_no = w.get("block_no", 0)
            line_no = w.get("line_no", 0)
            word_no = w.get("word_no", 0)
            wid = f"p{page_num}-b{block_no}-l{line_no}-w{word_no}"
            all_words.append({
                "word_id": wid,
                "text": w.get("text", ""),
                "quad": [quad.get("x0", 0.0), quad.get("y0", 0.0), quad.get("x1", 0.0), quad.get("y1", 0.0)],
                "page": page_num,
                "block_no": block_no,
                "line_no": line_no,
                "word_no": word_no,
            })

    return {
        "committed_at": data.get("committed_at"),
        "word_count": len(all_words),
        "page_count": len(canonical_pages),
        "pages": canonical_pages,
        "words": all_words,
    }


def _download_committed(supabase, chatroom_id: int, document_id: int) -> Optional[bytes]:
    try:
        return supabase.storage.from_(BUCKET).download(
            _raw_words_path(chatroom_id, document_id)
        )
    except Exception:
        return None


def purge_raw_words(supabase, chatroom_id: int, document_id: int) -> None:
    """Delete committed raw words for a document. Safe to call if absent."""
    if not supabase:
        return
    try:
        supabase.storage.from_(BUCKET).remove([_raw_words_path(chatroom_id, document_id)])
    except Exception:
        pass


def _extract_raw_words(pdf_bytes: bytes) -> RawWordsPayload:
    pdf_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    words: List[RawWord] = []
    pages: List[PageDim] = []
    try:
        for page_index in range(len(pdf_doc)):
            page = pdf_doc[page_index]
            rect = page.rect
            pages.append(PageDim(page=page_index + 1, width=rect.width, height=rect.height))
            for w in page.get_text("words"):
                x0, y0, x1, y1, text, block_no, line_no, word_no = w
                if not text.strip():
                    continue
                wid = f"p{page_index + 1}-b{block_no}-l{line_no}-w{word_no}"
                words.append(
                    RawWord(
                        word_id=wid,
                        text=text,
                        quad=[float(x0), float(y0), float(x1), float(y1)],
                        page=page_index + 1,
                        block_no=int(block_no),
                        line_no=int(line_no),
                        word_no=int(word_no),
                    )
                )
    finally:
        pdf_doc.close()

    return RawWordsPayload(
        word_count=len(words),
        page_count=len(pages),
        pages=pages,
        words=words,
    )


@router.get("/{chatroom_id}", response_model=RawWordsState)
def get_raw_words(chatroom_id: int):
    if not _chatroom_exists(chatroom_id):
        raise HTTPException(status_code=404, detail="Chatroom not found")

    document_id, file_name = _resolve_doc(chatroom_id)
    if document_id is None:
        return RawWordsState(chatroom_id=chatroom_id, has_source_pdf=False)

    supabase = get_supabase()
    has_pdf = False
    if supabase:
        try:
            files = supabase.storage.from_(BUCKET).list(
                f"{chatroom_id}/documents/{document_id}/source"
            )
            has_pdf = any(f["name"].lower().endswith(".pdf") for f in (files or []))
        except Exception:
            has_pdf = False

    raw_words: Optional[dict] = None
    error: Optional[str] = None
    if supabase:
        blob = _download_committed(supabase, chatroom_id, document_id)
        if blob is not None:
            try:
                raw_words = json.loads(blob.decode("utf-8") if isinstance(blob, (bytes, bytearray)) else blob)
                raw_words = _normalize_raw_words(raw_words)
                raw_words["status"] = "committed"
            except Exception:
                error = "Committed raw words file is corrupted"

    return RawWordsState(
        chatroom_id=chatroom_id,
        document_id=document_id,
        has_source_pdf=has_pdf,
        raw_words=raw_words,
        error=error,
    )


@router.post("/{chatroom_id}/generate", response_model=RawWordsPayload)
def generate_raw_words(chatroom_id: int):
    if not _chatroom_exists(chatroom_id):
        raise HTTPException(status_code=404, detail="Chatroom not found")

    document_id, file_name = _resolve_doc(chatroom_id)
    if document_id is None or not file_name:
        raise HTTPException(status_code=400, detail="Upload a source PDF first")

    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=500, detail="Storage not configured")

    pdf_bytes = _download_pdf(supabase, chatroom_id, document_id, file_name)
    if pdf_bytes is None:
        raise HTTPException(status_code=400, detail="Source PDF not found in storage")

    try:
        payload = _extract_raw_words(pdf_bytes)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse PDF: {e}")

    return payload


@router.post("/{chatroom_id}/commit", response_model=RawWordsPayload)
def commit_raw_words(chatroom_id: int, body: CommitRequest):
    if not _chatroom_exists(chatroom_id):
        raise HTTPException(status_code=404, detail="Chatroom not found")

    document_id, file_name = _resolve_doc(chatroom_id)
    if document_id is None or not file_name:
        raise HTTPException(status_code=400, detail="Source PDF is missing")

    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=500, detail="Storage not configured")

    # Guard: PDF still present
    try:
        files = supabase.storage.from_(BUCKET).list(
            f"{chatroom_id}/documents/{document_id}/source"
        )
        if not any(f["name"].lower().endswith(".pdf") for f in (files or [])):
            raise HTTPException(status_code=400, detail="Source PDF is missing")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to verify source PDF")

    envelope: dict[str, Any] = body.payload.model_dump()
    envelope["committed_at"] = datetime.now(timezone.utc).isoformat()

    try:
        upload_file(
            supabase,
            _raw_words_path(chatroom_id, document_id),
            json.dumps(envelope).encode("utf-8"),
            "application/json",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to persist raw words: {e}")

    from routers.canonical_words import purge_canonical_words
    purge_canonical_words(document_id)

    from routers.nodes import purge_nodes
    purge_nodes(document_id)

    from routers.chunks import purge_chunks
    purge_chunks(document_id)

    return RawWordsPayload(**envelope)
