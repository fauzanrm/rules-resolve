import os
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from supabase import create_client

from db import get_connection

router = APIRouter()

BUCKET = "chatroom-assets"


def _get_supabase():
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        return None
    return create_client(url, key)


def _resolve_cover_url(supabase, chatroom_id: int, document_id: int) -> Optional[str]:
    try:
        prefix = f"{chatroom_id}/documents/{document_id}/source"
        files = supabase.storage.from_(BUCKET).list(prefix, {"limit": 100, "offset": 0, "sortBy": {"column": "name", "order": "asc"}})
        webp = next((f for f in files if f["name"].endswith(".webp")), None)
        if not webp:
            return None
        result = supabase.storage.from_(BUCKET).create_signed_url(
            f"{prefix}/{webp['name']}", expires_in=31536000
        )
        return result.get("signedURL")
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

    supabase = _get_supabase()

    result = []
    for chatroom_id, name, first_document_id in rows:
        cover_url = None
        if supabase and first_document_id is not None:
            cover_url = _resolve_cover_url(supabase, chatroom_id, first_document_id)
        result.append(Chatroom(id=chatroom_id, name=name, cover_image_url=cover_url))

    return result
