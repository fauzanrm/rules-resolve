from datetime import datetime
from typing import Optional

import io

import fitz
from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import Response
from PIL import Image
from pydantic import BaseModel

from db import get_connection
from storage import BUCKET, get_supabase, get_signed_url, upload_file
from routers.raw_words import purge_raw_words
from routers.canonical_words import purge_canonical_words

router = APIRouter()

MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 MB


class DocumentMeta(BaseModel):
    id: int
    file_name: str
    file_size: int
    page_count: int
    last_updated_at: datetime
    pdf_url: Optional[str] = None
    cover_url: Optional[str] = None


class ConfigPageResponse(BaseModel):
    chatroom_id: int
    chatroom_name: str
    document: Optional[DocumentMeta] = None


def _build_document_meta(chatroom_id: int, doc_row: tuple, supabase) -> DocumentMeta:
    doc_id, file_name, file_size, page_count, last_updated_at = doc_row
    pdf_url = None
    cover_url = None
    if supabase:
        pdf_url = get_signed_url(supabase, f"{chatroom_id}/documents/{doc_id}/source/{file_name}")
        cover_url = get_signed_url(supabase, f"{chatroom_id}/documents/{doc_id}/source/cover.webp")
    return DocumentMeta(
        id=doc_id,
        file_name=file_name,
        file_size=file_size,
        page_count=page_count,
        last_updated_at=last_updated_at,
        pdf_url=pdf_url,
        cover_url=cover_url,
    )


@router.get("/{chatroom_slug}", response_model=ConfigPageResponse)
def get_config(chatroom_slug: str):
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id, name FROM chatrooms WHERE LOWER(REPLACE(name, ' ', '-')) = LOWER(%s)",
                    (chatroom_slug,),
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Chatroom not found")
                chatroom_id, chatroom_name = row

                cur.execute(
                    """
                    SELECT d.id, d.file_name, d.file_size, d.page_count, d.last_updated_at
                    FROM documents d
                    JOIN chatroom_documents cd ON cd.document_id = d.id
                    WHERE cd.chatroom_id = %s
                    ORDER BY d.id ASC
                    LIMIT 1
                    """,
                    (chatroom_id,),
                )
                doc_row = cur.fetchone()
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to fetch config")

    document = None
    if doc_row:
        document = _build_document_meta(chatroom_id, doc_row, get_supabase())

    return ConfigPageResponse(
        chatroom_id=chatroom_id,
        chatroom_name=chatroom_name,
        document=document,
    )


@router.post("/{chatroom_slug}/commit", response_model=DocumentMeta)
async def commit_pdf(chatroom_slug: str, file: UploadFile = File(...)):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="File must be a PDF")

    contents = await file.read()

    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File exceeds 20 MB limit")

    try:
        pdf_doc = fitz.open(stream=contents, filetype="pdf")
        page_count = len(pdf_doc)
    except Exception:
        raise HTTPException(status_code=400, detail="Could not read PDF file")

    cover_bytes = None
    try:
        page = pdf_doc[0]
        pix = page.get_pixmap(matrix=fitz.Matrix(2.0, 2.0))
        png_bytes = pix.tobytes("png")
        buf = io.BytesIO()
        Image.open(io.BytesIO(png_bytes)).save(buf, format="webp")
        cover_bytes = buf.getvalue()
    except Exception:
        pass
    finally:
        pdf_doc.close()

    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id FROM chatrooms WHERE LOWER(REPLACE(name, ' ', '-')) = LOWER(%s)",
                    (chatroom_slug,),
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Chatroom not found")
                chatroom_id = row[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to resolve chatroom: {e}")

    old_file_name = None
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT d.id, d.file_name FROM documents d
                    JOIN chatroom_documents cd ON cd.document_id = d.id
                    WHERE cd.chatroom_id = %s
                    ORDER BY d.id ASC
                    LIMIT 1
                    """,
                    (chatroom_id,),
                )
                existing = cur.fetchone()

                if existing:
                    doc_id, old_file_name = existing
                    cur.execute(
                        """
                        UPDATE documents
                        SET file_name = %s, file_size = %s, page_count = %s, last_updated_at = NOW()
                        WHERE id = %s
                        RETURNING id, file_name, file_size, page_count, last_updated_at
                        """,
                        (file.filename, len(contents), page_count, doc_id),
                    )
                    doc_row = cur.fetchone()
                else:
                    cur.execute(
                        """
                        INSERT INTO documents (file_name, file_size, page_count, last_updated_at)
                        VALUES (%s, %s, %s, NOW())
                        RETURNING id, file_name, file_size, page_count, last_updated_at
                        """,
                        (file.filename, len(contents), page_count),
                    )
                    doc_row = cur.fetchone()
                    doc_id = doc_row[0]
                    cur.execute(
                        "INSERT INTO chatroom_documents (chatroom_id, document_id) VALUES (%s, %s)",
                        (chatroom_id, doc_id),
                    )
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to save document metadata")

    supabase = get_supabase()
    if supabase:
        purge_raw_words(supabase, chatroom_id, doc_id)
        purge_canonical_words(doc_id)
        from routers.nodes import purge_nodes
        purge_nodes(doc_id)
        from routers.chunks import purge_chunks
        purge_chunks(doc_id)
        if old_file_name and old_file_name != file.filename:
            try:
                supabase.storage.from_("chatroom-assets").remove(
                    [f"{chatroom_id}/documents/{doc_id}/source/{old_file_name}"]
                )
            except Exception:
                pass

        try:
            upload_file(
                supabase,
                f"{chatroom_id}/documents/{doc_id}/source/{file.filename}",
                contents,
                "application/pdf",
            )
        except Exception:
            raise HTTPException(status_code=500, detail="Failed to upload PDF to storage")

        if cover_bytes:
            source_prefix = f"{chatroom_id}/documents/{doc_id}/source"
            existing = supabase.storage.from_(BUCKET).list(source_prefix)
            old_webps = [
                f"{source_prefix}/{f['name']}"
                for f in (existing or [])
                if f["name"].endswith(".webp")
            ]
            if old_webps:
                supabase.storage.from_(BUCKET).remove(old_webps)
            upload_file(
                supabase,
                f"{source_prefix}/cover.webp",
                cover_bytes,
                "image/webp",
            )

    return _build_document_meta(chatroom_id, doc_row, supabase)


@router.get("/{chatroom_slug}/page-image/{page_num}")
def get_page_image(chatroom_slug: str, page_num: int):
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id FROM chatrooms WHERE LOWER(REPLACE(name, ' ', '-')) = LOWER(%s)",
                    (chatroom_slug,),
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Chatroom not found")
                chatroom_id = row[0]

                cur.execute(
                    """
                    SELECT d.id, d.file_name FROM documents d
                    JOIN chatroom_documents cd ON cd.document_id = d.id
                    WHERE cd.chatroom_id = %s
                    ORDER BY d.id ASC LIMIT 1
                    """,
                    (chatroom_id,),
                )
                doc_row = cur.fetchone()
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to resolve chatroom")

    if not doc_row:
        raise HTTPException(status_code=404, detail="No document for chatroom")

    doc_id, file_name = doc_row
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=500, detail="Storage not configured")

    try:
        pdf_bytes = supabase.storage.from_(BUCKET).download(
            f"{chatroom_id}/documents/{doc_id}/source/{file_name}"
        )
    except Exception:
        raise HTTPException(status_code=404, detail="PDF not found in storage")

    try:
        pdf_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        if page_num < 1 or page_num > len(pdf_doc):
            raise HTTPException(status_code=400, detail="Invalid page number")
        page = pdf_doc[page_num - 1]
        pix = page.get_pixmap(matrix=fitz.Matrix(2.0, 2.0))
        png_bytes = pix.tobytes("png")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to render page: {e}")
    finally:
        pdf_doc.close()

    return Response(content=png_bytes, media_type="image/png")
