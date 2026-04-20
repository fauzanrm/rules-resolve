import json
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)

SAMPLE_RAW_WORDS = {
    "word_count": 3,
    "page_count": 1,
    "pages": [{"page": 1, "width": 612.0, "height": 792.0}],
    "words": [
        {
            "word_id": "p1-b0-l0-w0",
            "text": "Alpha",
            "quad": [10.0, 20.0, 30.0, 40.0],
            "page": 1,
            "block_no": 0,
            "line_no": 0,
            "word_no": 0,
        },
        {
            "word_id": "p1-b0-l0-w1",
            "text": "Beta",
            "quad": [40.0, 20.0, 60.0, 40.0],
            "page": 1,
            "block_no": 0,
            "line_no": 0,
            "word_no": 1,
        },
        {
            "word_id": "p1-b0-l1-w0",
            "text": "Gamma",
            "quad": [10.0, 50.0, 40.0, 70.0],
            "page": 1,
            "block_no": 0,
            "line_no": 1,
            "word_no": 0,
        },
    ],
}


def _setup_db(mock_conn, chatroom_exists=True, doc=(7, "rules.pdf"), committed_rows=None):
    cur = MagicMock()
    fetchones = [(1,) if chatroom_exists else None]
    if chatroom_exists:
        fetchones.append(doc)
    cur.fetchone.side_effect = fetchones
    cur.fetchall.return_value = committed_rows or []
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur
    return cur


def _mock_storage(raw_words_json=None):
    supabase = MagicMock()
    storage = supabase.storage.from_.return_value

    def download(path):
        if "raw_words.json" in path:
            if raw_words_json is None:
                raise Exception("not found")
            return json.dumps(raw_words_json).encode("utf-8")
        raise Exception("unknown path")

    storage.download.side_effect = download
    return supabase


@patch("routers.canonical_words.get_supabase")
@patch("routers.canonical_words.get_connection")
def test_get_returns_empty_state_when_no_commit(mock_conn, mock_sb):
    _setup_db(mock_conn)
    mock_sb.return_value = _mock_storage(SAMPLE_RAW_WORDS)

    r = client.get("/canonical-words/1")
    assert r.status_code == 200
    data = r.json()
    assert data["chatroom_id"] == 1
    assert data["document_id"] == 7
    assert data["has_raw_words"] is True
    assert data["committed_words"] is None


@patch("routers.canonical_words.get_supabase")
@patch("routers.canonical_words.get_connection")
def test_get_has_raw_words_false_when_no_storage_file(mock_conn, mock_sb):
    _setup_db(mock_conn)
    mock_sb.return_value = _mock_storage(raw_words_json=None)

    r = client.get("/canonical-words/1")
    assert r.status_code == 200
    data = r.json()
    assert data["has_raw_words"] is False


@patch("routers.canonical_words.get_supabase")
@patch("routers.canonical_words.get_connection")
def test_get_returns_committed_words(mock_conn, mock_sb):
    committed_at = datetime(2026, 4, 18, 10, 0, 0, tzinfo=timezone.utc)
    # DB row order: canonical_index, raw_word_index, text, page, block_no, line_no, word_no, quad, committed_at
    rows = [
        (0, 0, "Alpha", 1, 0, 0, 0, [10.0, 20.0, 30.0, 40.0], committed_at),
        (1, 1, "Beta", 1, 0, 0, 1, [40.0, 20.0, 60.0, 40.0], committed_at),
    ]
    _setup_db(mock_conn, committed_rows=rows)
    mock_sb.return_value = _mock_storage(SAMPLE_RAW_WORDS)

    r = client.get("/canonical-words/1")
    assert r.status_code == 200
    data = r.json()
    assert len(data["committed_words"]) == 2
    assert data["committed_words"][0]["raw_word_index"] == 0
    assert data["committed_words"][1]["canonical_index"] == 1
    assert data["committed_at"] is not None


@patch("routers.canonical_words.get_supabase")
@patch("routers.canonical_words.get_connection")
def test_get_chatroom_not_found(mock_conn, mock_sb):
    _setup_db(mock_conn, chatroom_exists=False)
    mock_sb.return_value = MagicMock()

    r = client.get("/canonical-words/999")
    assert r.status_code == 404


@patch("routers.canonical_words.get_supabase")
@patch("routers.canonical_words.get_connection")
def test_commit_writes_contiguous_canonical_index(mock_conn, mock_sb):
    _setup_db(mock_conn)
    mock_sb.return_value = _mock_storage(SAMPLE_RAW_WORDS)

    # Include words at raw indices 0 and 1
    r = client.post(
        "/canonical-words/1/commit",
        json={"included_raw_word_indices": [0, 1]},
    )
    assert r.status_code == 200
    words = r.json()["committed_words"]
    assert len(words) == 2
    assert [w["canonical_index"] for w in words] == [0, 1]
    assert words[0]["raw_word_index"] == 0
    assert words[1]["raw_word_index"] == 1


@patch("routers.canonical_words.get_supabase")
@patch("routers.canonical_words.get_connection")
def test_commit_sorts_in_document_order(mock_conn, mock_sb):
    _setup_db(mock_conn)
    mock_sb.return_value = _mock_storage(SAMPLE_RAW_WORDS)

    # Submit indices in reverse order — response must be sorted by (page, block, line, word)
    # Index 2 = Gamma (line 1), index 0 = Alpha (line 0) → Alpha comes first
    r = client.post(
        "/canonical-words/1/commit",
        json={"included_raw_word_indices": [2, 0]},
    )
    assert r.status_code == 200
    words = r.json()["committed_words"]
    assert words[0]["raw_word_index"] == 0  # Alpha (line 0) first
    assert words[1]["raw_word_index"] == 2  # Gamma (line 1) second
    assert words[0]["canonical_index"] == 0
    assert words[1]["canonical_index"] == 1


@patch("routers.canonical_words.get_supabase")
@patch("routers.canonical_words.get_connection")
def test_commit_empty_included_set_accepted(mock_conn, mock_sb):
    _setup_db(mock_conn)
    mock_sb.return_value = _mock_storage(SAMPLE_RAW_WORDS)

    r = client.post("/canonical-words/1/commit", json={"included_raw_word_indices": []})
    assert r.status_code == 200
    assert r.json()["committed_words"] is None


@patch("routers.canonical_words.get_supabase")
@patch("routers.canonical_words.get_connection")
def test_commit_rejects_out_of_range_index(mock_conn, mock_sb):
    _setup_db(mock_conn)
    mock_sb.return_value = _mock_storage(SAMPLE_RAW_WORDS)

    r = client.post(
        "/canonical-words/1/commit",
        json={"included_raw_word_indices": [99]},  # only 3 words (indices 0-2)
    )
    assert r.status_code == 400
    assert "raw_word_indices" in r.json()["detail"]


@patch("routers.canonical_words.get_supabase")
@patch("routers.canonical_words.get_connection")
def test_commit_fails_when_no_raw_words_in_storage(mock_conn, mock_sb):
    _setup_db(mock_conn)
    mock_sb.return_value = _mock_storage(raw_words_json=None)

    r = client.post("/canonical-words/1/commit", json={"included_raw_word_indices": []})
    assert r.status_code == 400
    assert "Raw words not found" in r.json()["detail"]


@patch("routers.canonical_words.get_connection")
def test_purge_canonical_words_issues_delete(mock_conn):
    from routers.canonical_words import purge_canonical_words

    cur = MagicMock()
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    purge_canonical_words(7)

    cur.execute.assert_called_once()
    sql, params = cur.execute.call_args.args
    assert "DELETE" in sql.upper()
    assert "document_canonical_words" in sql
    assert params == (7,)


@patch("routers.canonical_words.purge_canonical_words")
@patch("routers.raw_words.upload_file")
@patch("routers.raw_words.get_supabase")
@patch("routers.raw_words.get_connection")
def test_raw_words_commit_purges_canonical(mock_conn, mock_sb, mock_upload, mock_purge):
    cur = MagicMock()
    cur.fetchone.side_effect = [(1,), (7, "rules.pdf")]
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    supabase = MagicMock()
    supabase.storage.from_.return_value.list.return_value = [{"name": "rules.pdf"}]
    mock_sb.return_value = supabase

    payload = {
        "word_count": 1,
        "page_count": 1,
        "pages": [{"page": 1, "width": 612.0, "height": 792.0}],
        "words": [
            {
                "word_id": "p1-b0-l0-w0",
                "text": "Hello",
                "quad": [10.0, 20.0, 30.0, 40.0],
                "page": 1,
                "block_no": 0,
                "line_no": 0,
                "word_no": 0,
            }
        ],
    }
    r = client.post("/raw-words/1/commit", json={"payload": payload})
    assert r.status_code == 200
    mock_purge.assert_called_once_with(7)
