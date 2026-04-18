from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from db import get_connection

router = APIRouter()


class Chatroom(BaseModel):
    id: int
    name: str
    cover_image_url: Optional[str] = None


@router.get("/", response_model=list[Chatroom])
def list_chatrooms():
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT id, name FROM chatrooms ORDER BY name ASC")
                rows = cur.fetchall()
        return [Chatroom(id=row[0], name=row[1]) for row in rows]
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to fetch chatrooms")
