import json
import logging
import os
import re
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from openai import OpenAI
from psycopg2.extras import Json
from pydantic import BaseModel

from db import get_connection

router = APIRouter()

logger = logging.getLogger(__name__)

EMBED_MODEL = "text-embedding-3-small"
COMPLETION_MODEL = "gpt-4o-mini"
TOP_K = 6
MAX_CITATIONS = 6

_PROMPTS_DIR = Path(__file__).parent.parent / "prompts"


def _load_system_prompt() -> str:
    """Load the ask system prompt from file. Read fresh each call so edits take effect immediately."""
    path = _PROMPTS_DIR / "ask_system.txt"
    return path.read_text().replace("{max_citations}", str(MAX_CITATIONS))
MAX_COMPLETION_TOKENS = 600


class ChatMessage(BaseModel):
    role: str
    content: str


class CitationWord(BaseModel):
    canonical_index: int
    text: str
    quad: list[float]
    page: int


class Citation(BaseModel):
    index: int
    document_id: int
    chunk_id: int
    chunk_index: int
    cited_text: str
    page: int
    highlight_mode: str  # "word_span" | "chunk_span"
    words: list[CitationWord]
    start_canonical_index: Optional[int] = None
    end_canonical_index: Optional[int] = None


class ChatQueryRequest(BaseModel):
    question: str
    history: list[ChatMessage] = []
    session_id: Optional[str] = None
    username: Optional[str] = None


class ChatQueryResponse(BaseModel):
    turn_id: int
    answer: str
    citations: list[Citation]


class RatingRequest(BaseModel):
    rating: Optional[str] = None


def _assert_published(chatroom_slug: str) -> tuple[int, int]:
    """Resolve (chatroom_id, document_id) from slug. Enforce published state and embeddings."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, published_at FROM chatrooms WHERE LOWER(REPLACE(name, ' ', '-')) = LOWER(%s)",
                (chatroom_slug,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Chatroom not found")
            chatroom_id, published_at = row
            if published_at is None:
                raise HTTPException(status_code=403, detail="Chatroom is not published")

            cur.execute(
                """
                SELECT d.id
                FROM documents d
                JOIN chatroom_documents cd ON cd.document_id = d.id
                WHERE cd.chatroom_id = %s
                ORDER BY d.id ASC
                LIMIT 1
                """,
                (chatroom_id,),
            )
            doc_row = cur.fetchone()
            if not doc_row:
                raise HTTPException(status_code=400, detail="No document attached to chatroom")
            document_id = doc_row[0]

            cur.execute(
                "SELECT COUNT(*) FROM document_embeddings WHERE document_id = %s",
                (document_id,),
            )
            count = cur.fetchone()[0]
            if count == 0:
                raise HTTPException(status_code=400, detail="No embeddings available for this chatroom")

    return chatroom_id, document_id


def _embed_query(question: str) -> list[float]:
    try:
        client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
        response = client.embeddings.create(model=EMBED_MODEL, input=[question])
        return response.data[0].embedding
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Embedding generation failed: {e}")


def _retrieve_chunks(document_id: int, query_vector: list[float], top_k: int = TOP_K) -> list[dict]:
    vector_str = str(query_vector)
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    dc.id          AS chunk_id,
                    dc.chunk_index,
                    dc.text,
                    dc.start_canonical_index,
                    dc.end_canonical_index,
                    1 - (de.embedding <=> %s::vector) AS similarity
                FROM document_embeddings de
                JOIN document_chunks dc
                  ON dc.document_id = de.document_id
                 AND dc.chunk_index = de.chunk_index
                WHERE de.document_id = %s
                ORDER BY de.embedding <=> %s::vector
                LIMIT %s
                """,
                (vector_str, document_id, vector_str, top_k),
            )
            rows = cur.fetchall()
    return [
        {
            "chunk_id": row[0],
            "chunk_index": row[1],
            "text": row[2],
            "start_canonical_index": row[3],
            "end_canonical_index": row[4],
            "similarity": float(row[5]),
        }
        for row in rows
    ]


def _resolve_word_quads(
    document_id: int,
    start_ci: int,
    end_ci: int,
    cited_text: str,
) -> tuple[str, list[dict]]:
    """Return (highlight_mode, words). highlight_mode is 'word_span' or 'chunk_span'."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT canonical_index, text, page, quad
                FROM document_canonical_words
                WHERE document_id = %s
                  AND canonical_index >= %s
                  AND canonical_index <= %s
                ORDER BY canonical_index
                """,
                (document_id, start_ci, end_ci),
            )
            rows = cur.fetchall()

    if not rows:
        return "chunk_span", []

    all_words = [
        {
            "canonical_index": r[0],
            "text": r[1],
            "page": r[2],
            "quad": r[3] if isinstance(r[3], list) else [],
        }
        for r in rows
    ]

    cited_normalized = " ".join(cited_text.lower().split())
    joined = " ".join(w["text"] for w in all_words).lower()

    if cited_normalized and cited_normalized in joined:
        pos = 0
        word_ranges = []
        for w in all_words:
            start = pos
            end = pos + len(w["text"])
            word_ranges.append((start, end))
            pos = end + 1  # +1 for the joining space

        span_start = joined.find(cited_normalized)
        span_end = span_start + len(cited_normalized)

        matched = [
            all_words[i]
            for i, (ws, we) in enumerate(word_ranges)
            if ws < span_end and we > span_start
        ]
        if matched:
            return "word_span", matched

    return "chunk_span", all_words


def _build_citation(
    index: int,
    chunk: dict,
    cited_text: str,
    document_id: int,
) -> Optional[Citation]:
    try:
        highlight_mode, words = _resolve_word_quads(
            document_id,
            chunk["start_canonical_index"],
            chunk["end_canonical_index"],
            cited_text,
        )
        page = words[0]["page"] if words else 1
        return Citation(
            index=index,
            document_id=document_id,
            chunk_id=chunk["chunk_id"],
            chunk_index=chunk["chunk_index"],
            cited_text=cited_text,
            page=page,
            highlight_mode=highlight_mode,
            words=[
                CitationWord(
                    canonical_index=w["canonical_index"],
                    text=w["text"],
                    quad=w["quad"],
                    page=w["page"],
                )
                for w in words
            ],
            start_canonical_index=chunk["start_canonical_index"],
            end_canonical_index=chunk["end_canonical_index"],
        )
    except Exception:
        return None


def _call_openai(
    question: str,
    chunks: list[dict],
    history: list[ChatMessage],
) -> tuple[str, list[dict]]:
    """Call OpenAI completion. Returns (answer_text, raw_citations_from_model)."""
    context_parts = [f"[{i}]\n{chunk['text']}" for i, chunk in enumerate(chunks, 1)]
    context = "\n\n".join(context_parts)

    system_prompt = _load_system_prompt()

    prior_turns = []
    for msg in history[-6:]:
        if msg.role == "user":
            prior_turns.append(f"User: {msg.content}")
        elif msg.role == "assistant":
            content = re.sub(r"\[\d+\]", "", msg.content).strip()
            prior_turns.append(f"Assistant: {content}")

    history_block = ""
    if prior_turns:
        history_block = "Prior conversation:\n" + "\n".join(prior_turns) + "\n\n"

    messages = [{
        "role": "user",
        "content": f"{history_block}Rulebook excerpts:\n{context}\n\nQuestion: {question}",
    }]

    try:
        client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
        response = client.chat.completions.create(
            model=COMPLETION_MODEL,
            max_tokens=MAX_COMPLETION_TOKENS,
            temperature=0.2,
            messages=[{"role": "system", "content": system_prompt}] + messages,
        )
        raw = response.choices[0].message.content or ""
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Answer generation failed: {e}")

    match = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw)
    json_str = match.group(1).strip() if match else raw.strip()

    try:
        data = json.loads(json_str)
        answer = str(data.get("answer", "")).strip()
        raw_citations = data.get("citations", []) if isinstance(data.get("citations"), list) else []
    except (json.JSONDecodeError, AttributeError):
        answer = raw.strip()
        raw_citations = []

    return answer, raw_citations


def _record_chat_turn(
    chatroom_id: int,
    document_id: int,
    session_id: str,
    username: Optional[str],
    question: str,
    answer: str,
    citations: list[Citation],
) -> int:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO chat_turns
                    (chatroom_id, document_id, session_id, username, question, answer, citations)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    chatroom_id,
                    document_id,
                    session_id,
                    username,
                    question,
                    answer,
                    Json([c.model_dump() for c in citations]),
                ),
            )
            return cur.fetchone()[0]


@router.post("/{chatroom_slug}", response_model=ChatQueryResponse)
def chat_query(chatroom_slug: str, body: ChatQueryRequest):
    question = body.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question must not be empty")

    session_id = body.session_id or str(uuid.uuid4())

    chatroom_id, document_id = _assert_published(chatroom_slug)

    query_vector = _embed_query(question)
    chunks = _retrieve_chunks(document_id, query_vector)

    if not chunks:
        logger.info("ask chatroom=%s doc=%s: no chunks retrieved", chatroom_id, document_id)
        answer = "I don't have enough information in the rulebook to answer that."
        turn_id = _record_chat_turn(
            chatroom_id, document_id, session_id, body.username, question, answer, [],
        )
        return ChatQueryResponse(turn_id=turn_id, answer=answer, citations=[])

    answer, raw_citations = _call_openai(question, chunks, body.history)

    citations: list[Citation] = []
    seen_chunk_refs: set[int] = set()
    # Maps the model's original inline marker (e.g. "3") → our sequential index (e.g. "1")
    index_map: dict[str, str] = {}

    for rc in raw_citations[:MAX_CITATIONS]:
        if not isinstance(rc, dict):
            continue
        chunk_ref = rc.get("chunk_ref")
        model_index = rc.get("index")
        cited_text = str(rc.get("cited_text") or "").strip()
        if not isinstance(chunk_ref, int) or chunk_ref < 1 or chunk_ref > len(chunks):
            continue
        if chunk_ref in seen_chunk_refs:
            continue
        seen_chunk_refs.add(chunk_ref)
        sequential_index = len(citations) + 1
        if model_index is not None:
            index_map[str(int(model_index))] = str(sequential_index)
        chunk = chunks[chunk_ref - 1]
        citation = _build_citation(sequential_index, chunk, cited_text or chunk["text"], document_id)
        if citation:
            citations.append(citation)

    # Rewrite inline markers in the answer so [3] becomes [1] etc.
    if index_map:
        answer = re.sub(
            r"\[(\d+)\]",
            lambda m: f"[{index_map.get(m.group(1), m.group(1))}]",
            answer,
        )

    logger.info(
        "ask chatroom=%s doc=%s retrieved=%d citations=%d success=True",
        chatroom_id, document_id, len(chunks), len(citations),
    )

    turn_id = _record_chat_turn(
        chatroom_id, document_id, session_id, body.username, question, answer, citations,
    )

    return ChatQueryResponse(turn_id=turn_id, answer=answer, citations=citations)


@router.patch("/turns/{turn_id}/rating")
def rate_turn(turn_id: int, body: RatingRequest):
    if body.rating is not None and body.rating not in ("up", "down"):
        raise HTTPException(status_code=400, detail="rating must be 'up', 'down', or null")

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE chat_turns
                SET rating = %s, rated_at = CASE WHEN %s IS NULL THEN NULL ELSE now() END
                WHERE id = %s
                RETURNING id
                """,
                (body.rating, body.rating, turn_id),
            )
            row = cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Chat turn not found")

    return {"turn_id": turn_id, "rating": body.rating}
