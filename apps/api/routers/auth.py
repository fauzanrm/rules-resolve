from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from db import get_connection

router = APIRouter()


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    role: str
    username: str


@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT role FROM users WHERE name = %s AND password = %s",
                (body.username, body.password),
            )
            row = cur.fetchone()

    if row is None:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    return LoginResponse(role=row[0], username=body.username)
