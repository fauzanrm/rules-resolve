import json
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def _make_minimal_pdf() -> bytes:
    import fitz

    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), "Hello World")
    buf = doc.tobytes()
    doc.close()
    return buf


def _setup_db(mock_conn, chatroom_exists=True, doc=(7, "rules.pdf")):
    cur = MagicMock()
    fetchones = []
    # Call order inside routes: chatroom exists → resolve doc
    fetchones.append((1,) if chatroom_exists else None)
    if chatroom_exists:
        fetchones.append(doc)
    cur.fetchone.side_effect = fetchones
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur
    return cur


def _mock_supabase_with_pdf(pdf_bytes, committed_json=None):
    supabase = MagicMock()
    storage = supabase.storage.from_.return_value
    storage.list.return_value = [{"name": "rules.pdf"}]

    def download(path):
        if path.endswith(".pdf"):
            return pdf_bytes
        if path.endswith("latest.json"):
            if committed_json is None:
                raise Exception("not found")
            return json.dumps(committed_json).encode("utf-8")
        raise Exception("unknown")

    storage.download.side_effect = download
    return supabase


@patch("routers.raw_words.get_supabase")
@patch("routers.raw_words.get_connection")
def test_get_raw_words_empty_state(mock_conn, mock_sb):
    _setup_db(mock_conn)
    mock_sb.return_value = _mock_supabase_with_pdf(_make_minimal_pdf(), committed_json=None)

    r = client.get("/raw-words/1")
    assert r.status_code == 200
    data = r.json()
    assert data["has_source_pdf"] is True
    assert data["raw_words"] is None


@patch("routers.raw_words.get_supabase")
@patch("routers.raw_words.get_connection")
def test_generate_raw_words_produces_words(mock_conn, mock_sb):
    _setup_db(mock_conn)
    mock_sb.return_value = _mock_supabase_with_pdf(_make_minimal_pdf())

    r = client.post("/raw-words/1/generate")
    assert r.status_code == 200
    data = r.json()
    assert data["word_count"] >= 2
    assert data["page_count"] == 1
    w0 = data["words"][0]
    for key in ["word_id", "text", "quad", "page", "block_no", "line_no", "word_no"]:
        assert key in w0
    assert len(w0["quad"]) == 4


@patch("routers.raw_words.get_supabase")
@patch("routers.raw_words.get_connection")
def test_generate_fails_when_no_pdf(mock_conn, mock_sb):
    _setup_db(mock_conn, doc=(None, None))
    mock_sb.return_value = MagicMock()

    r = client.post("/raw-words/1/generate")
    assert r.status_code == 400


@patch("routers.raw_words.upload_file")
@patch("routers.raw_words.get_supabase")
@patch("routers.raw_words.get_connection")
def test_commit_persists_latest_json(mock_conn, mock_sb, mock_upload):
    _setup_db(mock_conn)
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
    mock_upload.assert_called_once()
    path_arg = mock_upload.call_args.args[1]
    assert path_arg.endswith("derived/raw_words.json")


@patch("routers.raw_words.get_supabase")
@patch("routers.raw_words.get_connection")
def test_get_handles_corrupted_committed_json(mock_conn, mock_sb):
    _setup_db(mock_conn)
    supabase = MagicMock()
    storage = supabase.storage.from_.return_value
    storage.list.return_value = [{"name": "rules.pdf"}]
    storage.download.return_value = b"not-json{{{"
    mock_sb.return_value = supabase

    r = client.get("/raw-words/1")
    assert r.status_code == 200
    data = r.json()
    assert data["raw_words"] is None
    assert data["error"]


@patch("routers.raw_words.get_supabase")
@patch("routers.raw_words.get_connection")
def test_commit_fails_when_pdf_missing(mock_conn, mock_sb):
    _setup_db(mock_conn)
    supabase = MagicMock()
    supabase.storage.from_.return_value.list.return_value = []  # no PDF
    mock_sb.return_value = supabase

    payload = {
        "word_count": 0,
        "page_count": 0,
        "pages": [],
        "words": [],
    }
    r = client.post("/raw-words/1/commit", json={"payload": payload})
    assert r.status_code == 400
