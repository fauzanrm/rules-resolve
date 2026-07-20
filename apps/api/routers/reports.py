from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from db import get_connection

router = APIRouter()


class IssueReportRequest(BaseModel):
    username: Optional[str] = None
    role: Optional[str] = None
    page_url: str
    description: str


@router.post("/")
def create_issue_report(body: IssueReportRequest):
    if not body.description.strip():
        raise HTTPException(status_code=400, detail="description must not be empty")

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO issue_reports (username, role, page_url, description)
                VALUES (%s, %s, %s, %s)
                RETURNING id
                """,
                (body.username, body.role, body.page_url, body.description.strip()),
            )
            row = cur.fetchone()

    return {"id": row[0]}
