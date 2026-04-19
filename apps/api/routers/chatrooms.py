import io
from typing import Optional

import fitz
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from PIL import Image
from pydantic import BaseModel

from db import get_connection
from storage import BUCKET, get_supabase, get_signed_url, upload_file

MAX_FILE_SIZE = 25 * 1024 * 1024  # 25 MB
MAX_NAME_LENGTH = 50

router = APIRouter()


def _validate_and_normalize_name(cur, name: str, exclude_id: Optional[int] = None) -> str:
    """Shared name validation rules used by both create and rename.

    - trims whitespace
    - rejects empty names (400)
    - enforces 50-char max (400)
    - rejects duplicates case-insensitively (409), ignoring `exclude_id`
    """
    trimmed = (name or "").strip()
    if not trimmed:
        raise HTTPException(status_code=400, detail="Name cannot be empty")
    if len(trimmed) > MAX_NAME_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Name must be {MAX_NAME_LENGTH} characters or fewer",
        )
    if exclude_id is None:
        cur.execute("SELECT id FROM chatrooms WHERE LOWER(name) = LOWER(%s)", (trimmed,))
    else:
        cur.execute(
            "SELECT id FROM chatrooms WHERE LOWER(name) = LOWER(%s) AND id <> %s",
            (trimmed, exclude_id),
        )
    if cur.fetchone():
        raise HTTPException(status_code=409, detail="A chatroom with that name already exists")
    return trimmed


def _generate_cover(contents: bytes) -> Optional[bytes]:
    try:
        pdf_doc = fitz.open(stream=contents, filetype="pdf")
        pix = pdf_doc[0].get_pixmap(matrix=fitz.Matrix(2.0, 2.0))
        png_bytes = pix.tobytes("png")
        pdf_doc.close()
        buf = io.BytesIO()
        Image.open(io.BytesIO(png_bytes)).save(buf, format="webp")
        return buf.getvalue()
    except Exception:
        return None


def _resolve_cover_url(supabase, chatroom_id: int, document_id: int) -> Optional[str]:
    prefix = f"{chatroom_id}/documents/{document_id}/source"
    try:
        files = supabase.storage.from_(BUCKET).list(prefix, {"limit": 100, "offset": 0, "sortBy": {"column": "name", "order": "asc"}})
        webp = next((f for f in files if f["name"].endswith(".webp")), None)
        if not webp:
            return None
        return get_signed_url(supabase, f"{prefix}/{webp['name']}")
    except Exception:
        return None


class Chatroom(BaseModel):
    id: int
    name: str
    cover_image_url: Optional[str] = None


@router.get("/", response_model=list[Chatroom])
def list_chatrooms():
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT c.id, c.name, MIN(cd.document_id) AS first_document_id
                    FROM chatrooms c
                    LEFT JOIN chatroom_documents cd ON cd.chatroom_id = c.id
                    GROUP BY c.id, c.name
                    ORDER BY c.name ASC
                    """
                )
                rows = cur.fetchall()
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to fetch chatrooms")

    supabase = get_supabase()

    result = []
    for chatroom_id, name, first_document_id in rows:
        cover_url = None
        if supabase and first_document_id is not None:
            cover_url = _resolve_cover_url(supabase, chatroom_id, first_document_id)
        result.append(Chatroom(id=chatroom_id, name=name, cover_image_url=cover_url))

    return result


@router.post("/", response_model=Chatroom)
async def create_chatroom(name: str = Form(...), file: UploadFile = File(...)):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="File must be a PDF")

    contents = await file.read()

    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File exceeds 25 MB limit")

    try:
        pdf_doc = fitz.open(stream=contents, filetype="pdf")
        page_count = len(pdf_doc)
        pdf_doc.close()
    except Exception:
        raise HTTPException(status_code=400, detail="Could not read PDF file")

    cover_bytes = _generate_cover(contents)

    chatroom_id = None
    doc_id = None
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                normalized_name = _validate_and_normalize_name(cur, name)

                cur.execute(
                    "INSERT INTO chatrooms (name, last_updated_at) VALUES (%s, NOW()) RETURNING id",
                    (normalized_name,),
                )
                chatroom_id = cur.fetchone()[0]

                cur.execute(
                    """
                    INSERT INTO documents (file_name, file_size, page_count, last_updated_at)
                    VALUES (%s, %s, %s, NOW()) RETURNING id
                    """,
                    (file.filename, len(contents), page_count),
                )
                doc_id = cur.fetchone()[0]

                cur.execute(
                    "INSERT INTO chatroom_documents (chatroom_id, document_id) VALUES (%s, %s)",
                    (chatroom_id, doc_id),
                )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create chatroom: {e}")

    supabase = get_supabase()
    cover_url = None
    if supabase:
        source_prefix = f"{chatroom_id}/documents/{doc_id}/source"
        try:
            upload_file(supabase, f"{source_prefix}/{file.filename}", contents, "application/pdf")
        except Exception as e:
            try:
                with get_connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute("DELETE FROM chatroom_documents WHERE chatroom_id = %s AND document_id = %s", (chatroom_id, doc_id))
                        cur.execute("DELETE FROM documents WHERE id = %s", (doc_id,))
                        cur.execute("DELETE FROM chatrooms WHERE id = %s", (chatroom_id,))
            except Exception:
                pass
            raise HTTPException(status_code=500, detail=f"Failed to upload PDF to storage: {e}")

        if cover_bytes:
            try:
                upload_file(supabase, f"{source_prefix}/cover.webp", cover_bytes, "image/webp")
                cover_url = get_signed_url(supabase, f"{source_prefix}/cover.webp")
            except Exception:
                pass

    return Chatroom(id=chatroom_id, name=normalized_name, cover_image_url=cover_url)


class RenameRequest(BaseModel):
    name: str


@router.patch("/{chatroom_id}", response_model=Chatroom)
def rename_chatroom(chatroom_id: int, body: RenameRequest):
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT id, name FROM chatrooms WHERE id = %s", (chatroom_id,))
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Chatroom not found")
                current_name = row[1]

                candidate = (body.name or "").strip()
                if candidate == current_name:
                    new_name = current_name
                else:
                    new_name = _validate_and_normalize_name(cur, body.name, exclude_id=chatroom_id)
                    cur.execute(
                        "UPDATE chatrooms SET name = %s, last_updated_at = NOW() WHERE id = %s",
                        (new_name, chatroom_id),
                    )

                cur.execute(
                    "SELECT MIN(document_id) FROM chatroom_documents WHERE chatroom_id = %s",
                    (chatroom_id,),
                )
                doc_row = cur.fetchone()
                first_document_id = doc_row[0] if doc_row else None
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to rename chatroom: {e}")

    supabase = get_supabase()
    cover_url = None
    if supabase and first_document_id is not None:
        cover_url = _resolve_cover_url(supabase, chatroom_id, first_document_id)

    return Chatroom(id=chatroom_id, name=new_name, cover_image_url=cover_url)
