from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)

SLUG = "catan"
DOC_ID = 10
CHATROOM_ID = 5

SAMPLE_CHUNKS = [
    {
        "chunk_id": 1,
        "chunk_index": 0,
        "text": "Players take turns rolling dice to collect resources.",
        "start_canonical_index": 0,
        "end_canonical_index": 9,
        "similarity": 0.91,
    },
    {
        "chunk_id": 2,
        "chunk_index": 1,
        "text": "The longest road card goes to the player with at least five roads.",
        "start_canonical_index": 10,
        "end_canonical_index": 22,
        "similarity": 0.85,
    },
]

SAMPLE_WORDS = [
    (0, "Players", 1, [10.0, 20.0, 50.0, 30.0]),
    (1, "take", 1, [55.0, 20.0, 80.0, 30.0]),
    (2, "turns", 1, [85.0, 20.0, 115.0, 30.0]),
]


TURN_ID = 42


def _mock_conn_published(mock_conn, chatroom_id=CHATROOM_ID, doc_id=DOC_ID, embedding_count=5, turn_id=TURN_ID):
    """Set up db mock for a published chatroom with embeddings."""
    from datetime import datetime, timezone
    cur = MagicMock()
    cur.fetchone.side_effect = [
        (chatroom_id, datetime(2024, 1, 1, tzinfo=timezone.utc)),  # chatroom lookup
        (doc_id,),                   # document lookup
        (embedding_count,),          # embedding count
        (turn_id,),                  # chat_turns insert
    ]
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur
    return cur


def _mock_conn_unpublished(mock_conn):
    cur = MagicMock()
    cur.fetchone.side_effect = [(CHATROOM_ID, None)]
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur
    return cur


def _mock_conn_no_doc(mock_conn):
    from datetime import datetime, timezone
    cur = MagicMock()
    cur.fetchone.side_effect = [
        (CHATROOM_ID, datetime(2024, 1, 1, tzinfo=timezone.utc)),
        None,  # no document
    ]
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur
    return cur


def _openai_response(answer: str, citations: list):
    import json
    return json.dumps({"answer": answer, "citations": citations})


# ── 1. Blank question ─────────────────────────────────────────────────────────

def test_blank_question():
    resp = client.post(f"/ask/{SLUG}", json={"question": "  "})
    assert resp.status_code == 400


# ── 2. Unpublished chatroom ───────────────────────────────────────────────────

@patch("routers.ask.get_connection")
def test_unpublished_chatroom(mock_conn):
    _mock_conn_unpublished(mock_conn)
    resp = client.post(f"/ask/{SLUG}", json={"question": "How do I win?"})
    assert resp.status_code == 403


# ── 3. No document attached ───────────────────────────────────────────────────

@patch("routers.ask.get_connection")
def test_no_document(mock_conn):
    _mock_conn_no_doc(mock_conn)
    resp = client.post(f"/ask/{SLUG}", json={"question": "How do I win?"})
    assert resp.status_code == 400


# ── 4. No embeddings → returns not-enough-info answer ────────────────────────

@patch("routers.ask._retrieve_chunks", return_value=[])
@patch("routers.ask._embed_query", return_value=[0.1] * 1536)
@patch("routers.ask.get_connection")
def test_no_embeddings_returns_fallback(mock_conn, mock_embed, mock_retrieve):
    _mock_conn_published(mock_conn, embedding_count=1)
    resp = client.post(f"/ask/{SLUG}", json={"question": "How do I win?"})
    assert resp.status_code == 200
    data = resp.json()
    assert "don't have enough information" in data["answer"].lower()
    assert data["citations"] == []
    assert data["turn_id"] == TURN_ID


# ── 5. Happy path — 3 valid citations ────────────────────────────────────────

@patch("routers.ask._build_citation")
@patch("routers.ask._call_openai")
@patch("routers.ask._retrieve_chunks", return_value=SAMPLE_CHUNKS)
@patch("routers.ask._embed_query", return_value=[0.1] * 1536)
@patch("routers.ask.get_connection")
def test_happy_path_three_citations(mock_conn, mock_embed, mock_retrieve, mock_openai, mock_build):
    from routers.ask import Citation, CitationWord
    _mock_conn_published(mock_conn)

    mock_openai.return_value = (
        "Players roll dice [1] and collect resources [2].",
        [
            {"index": 1, "chunk_ref": 1, "cited_text": "Players take turns rolling dice"},
            {"index": 2, "chunk_ref": 2, "cited_text": "longest road card"},
        ],
    )
    mock_build.side_effect = [
        Citation(
            index=1, document_id=DOC_ID, chunk_id=1, chunk_index=0,
            cited_text="Players take turns rolling dice", page=1,
            highlight_mode="word_span",
            words=[CitationWord(canonical_index=0, text="Players", quad=[10, 20, 50, 30], page=1)],
            start_canonical_index=0, end_canonical_index=9,
        ),
        Citation(
            index=2, document_id=DOC_ID, chunk_id=2, chunk_index=1,
            cited_text="longest road card", page=2,
            highlight_mode="word_span",
            words=[CitationWord(canonical_index=10, text="longest", quad=[10, 20, 50, 30], page=2)],
            start_canonical_index=10, end_canonical_index=22,
        ),
    ]

    resp = client.post(f"/ask/{SLUG}", json={"question": "How do I collect resources?"})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["citations"]) == 2
    assert data["citations"][0]["chunk_id"] == 1
    assert data["citations"][1]["chunk_id"] == 2
    assert data["turn_id"] == TURN_ID


# ── 6. Model returns more citations than MAX_CITATIONS — capped ───────────────

@patch("routers.ask._build_citation")
@patch("routers.ask._call_openai")
@patch("routers.ask._retrieve_chunks", return_value=SAMPLE_CHUNKS * 4)
@patch("routers.ask._embed_query", return_value=[0.1] * 1536)
@patch("routers.ask.get_connection")
def test_citations_capped_at_max(mock_conn, mock_embed, mock_retrieve, mock_openai, mock_build):
    from routers.ask import Citation, MAX_CITATIONS

    _mock_conn_published(mock_conn)

    def make_raw(n, ref):
        return {"index": n, "chunk_ref": ref, "cited_text": "some text"}

    # Send more raw citations than MAX_CITATIONS
    excess = MAX_CITATIONS + 2
    mock_openai.return_value = (
        "Answer " + " ".join(f"[{i}]" for i in range(1, excess + 1)) + ".",
        [make_raw(i, i) for i in range(1, excess + 1)],
    )

    def _dummy_citation(index, chunk, cited_text, document_id):
        return Citation(
            index=index, document_id=document_id, chunk_id=chunk["chunk_id"],
            chunk_index=chunk["chunk_index"], cited_text=cited_text, page=1,
            highlight_mode="chunk_span", words=[], start_canonical_index=None, end_canonical_index=None,
        )

    mock_build.side_effect = _dummy_citation

    resp = client.post(f"/ask/{SLUG}", json={"question": "Question?"})
    assert resp.status_code == 200
    assert len(resp.json()["citations"]) <= MAX_CITATIONS


# ── 7. Citation maps to valid word span ───────────────────────────────────────

@patch("routers.ask.get_connection")
def test_resolve_word_quads_word_span(mock_conn):
    from routers.ask import _resolve_word_quads

    cur = MagicMock()
    cur.fetchall.return_value = [
        (0, "Players", 1, [10.0, 20.0, 50.0, 30.0]),
        (1, "take", 1, [55.0, 20.0, 80.0, 30.0]),
        (2, "turns", 1, [85.0, 20.0, 115.0, 30.0]),
    ]
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    mode, words = _resolve_word_quads(DOC_ID, 0, 2, "Players take")
    assert mode == "word_span"
    assert len(words) == 2
    assert words[0]["text"] == "Players"


# ── 8. Exact match fails → chunk_span fallback ───────────────────────────────

@patch("routers.ask.get_connection")
def test_resolve_word_quads_chunk_fallback(mock_conn):
    from routers.ask import _resolve_word_quads

    cur = MagicMock()
    cur.fetchall.return_value = [
        (0, "Players", 1, [10.0, 20.0, 50.0, 30.0]),
        (1, "take", 1, [55.0, 20.0, 80.0, 30.0]),
    ]
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    mode, words = _resolve_word_quads(DOC_ID, 0, 1, "zzz not in chunk")
    assert mode == "chunk_span"
    assert len(words) == 2


# ── 9. Retrieval filters by document_id ──────────────────────────────────────

@patch("routers.ask.get_connection")
def test_retrieve_chunks_uses_document_id(mock_conn):
    from routers.ask import _retrieve_chunks

    cur = MagicMock()
    cur.fetchall.return_value = []
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    _retrieve_chunks(DOC_ID, [0.1] * 1536)

    sql_call = cur.execute.call_args
    args = sql_call[0][1]
    assert DOC_ID in args


# ── 10. Embedding call fails → 502 ───────────────────────────────────────────

@patch("routers.ask._embed_query", side_effect=Exception("OpenAI down"))
@patch("routers.ask.get_connection")
def test_embed_failure_returns_502(mock_conn, mock_embed):
    from fastapi import HTTPException
    from routers.ask import _embed_query
    _mock_conn_published(mock_conn)

    # _embed_query raises HTTPException(502) internally — test via endpoint
    with patch("routers.ask._embed_query") as m:
        from fastapi import HTTPException as FE
        m.side_effect = FE(status_code=502, detail="Embedding generation failed")
        resp = client.post(f"/ask/{SLUG}", json={"question": "test?"})
    assert resp.status_code == 502


# ── 11. Completion call fails → 502 ──────────────────────────────────────────

@patch("routers.ask._call_openai")
@patch("routers.ask._retrieve_chunks", return_value=SAMPLE_CHUNKS)
@patch("routers.ask._embed_query", return_value=[0.1] * 1536)
@patch("routers.ask.get_connection")
def test_completion_failure_returns_502(mock_conn, mock_embed, mock_retrieve, mock_openai):
    _mock_conn_published(mock_conn)
    from fastapi import HTTPException as FE
    mock_openai.side_effect = FE(status_code=502, detail="Answer generation failed")
    resp = client.post(f"/ask/{SLUG}", json={"question": "test?"})
    assert resp.status_code == 502


# ── 12. GET method not allowed ────────────────────────────────────────────────

def test_get_not_allowed():
    resp = client.get(f"/ask/{SLUG}")
    assert resp.status_code == 405


# ── 13. Chat turn recorded with session_id/username passed through ────────────

@patch("routers.ask._build_citation")
@patch("routers.ask._call_openai")
@patch("routers.ask._retrieve_chunks", return_value=SAMPLE_CHUNKS)
@patch("routers.ask._embed_query", return_value=[0.1] * 1536)
@patch("routers.ask.get_connection")
def test_chat_turn_recorded(mock_conn, mock_embed, mock_retrieve, mock_openai, mock_build):
    cur = _mock_conn_published(mock_conn)
    mock_openai.return_value = ("An answer.", [])

    resp = client.post(
        f"/ask/{SLUG}",
        json={"question": "How do I win?", "session_id": "abc-123", "username": "alice"},
    )
    assert resp.status_code == 200
    assert resp.json()["turn_id"] == TURN_ID

    insert_call = cur.execute.call_args_list[-1]
    sql, params = insert_call[0]
    assert "INSERT INTO chat_turns" in sql
    assert params[2] == "abc-123"  # session_id
    assert params[3] == "alice"    # username
    assert params[4] == "How do I win?"  # question
    assert params[5] == "An answer."     # answer


# ── 14. Rate a turn up ─────────────────────────────────────────────────────────

@patch("routers.ask.get_connection")
def test_rate_turn_up(mock_conn):
    cur = MagicMock()
    cur.fetchone.return_value = (TURN_ID,)
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    resp = client.patch(f"/ask/turns/{TURN_ID}/rating", json={"rating": "up"})
    assert resp.status_code == 200
    assert resp.json() == {"turn_id": TURN_ID, "rating": "up"}


# ── 15. Clear a rating ─────────────────────────────────────────────────────────

@patch("routers.ask.get_connection")
def test_rate_turn_clear(mock_conn):
    cur = MagicMock()
    cur.fetchone.return_value = (TURN_ID,)
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    resp = client.patch(f"/ask/turns/{TURN_ID}/rating", json={"rating": None})
    assert resp.status_code == 200
    assert resp.json() == {"turn_id": TURN_ID, "rating": None}


# ── 16. Invalid rating value rejected ──────────────────────────────────────────

def test_rate_turn_invalid_value():
    resp = client.patch(f"/ask/turns/{TURN_ID}/rating", json={"rating": "sideways"})
    assert resp.status_code == 400


# ── 17. Rating a nonexistent turn returns 404 ──────────────────────────────────

@patch("routers.ask.get_connection")
def test_rate_turn_not_found(mock_conn):
    cur = MagicMock()
    cur.fetchone.return_value = None
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    resp = client.patch(f"/ask/turns/999/rating", json={"rating": "up"})
    assert resp.status_code == 404
