from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def _setup_db(mock_conn, chatroom_exists=True, doc_id=7, committed_rows=None, canonical_count=3):
    cur = MagicMock()
    fetchones = [(1,) if chatroom_exists else None]
    if chatroom_exists:
        fetchones.append((doc_id,))           # _resolve_doc
        fetchones.append((canonical_count,))  # _has_canonical_words
    cur.fetchone.side_effect = fetchones
    cur.fetchall.return_value = committed_rows or []
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur
    return cur


def _h1(label="Chapter One", start=10, end=12):
    return {"node_type": "h1", "label": label, "start_canonical_index": start, "end_canonical_index": end}


def _h2(label="Section", start=20, end=22):
    return {"node_type": "h2", "label": label, "start_canonical_index": start, "end_canonical_index": end}


def _h3(label="Sub", start=30, end=31):
    return {"node_type": "h3", "label": label, "start_canonical_index": start, "end_canonical_index": end}


def _inferred(level="h2", label="Foreword"):
    return {"node_type": level, "label": label, "start_canonical_index": 0, "end_canonical_index": 0}


# ── GET ────────────────────────────────────────────────────────────────────────

@patch("routers.nodes.get_connection")
def test_get_returns_empty_state_when_no_document(mock_conn):
    cur = MagicMock()
    cur.fetchone.side_effect = [(1,), None]
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    r = client.get("/nodes/1")
    assert r.status_code == 200
    data = r.json()
    assert data["chatroom_id"] == 1
    assert data["has_canonical_words"] is False
    assert data["committed_nodes"] is None


@patch("routers.nodes.get_connection")
def test_get_returns_committed_nodes(mock_conn):
    rows = [
        ("h1", "Chapter One", 10, 12),
        ("h2", "Foreword", 0, 0),
    ]
    cur = MagicMock()
    cur.fetchone.side_effect = [(1,), (7,), (3,)]
    cur.fetchall.return_value = rows
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    r = client.get("/nodes/1")
    assert r.status_code == 200
    data = r.json()
    assert data["has_canonical_words"] is True
    assert len(data["committed_nodes"]) == 2
    assert data["committed_nodes"][0]["node_type"] == "h1"
    assert data["committed_nodes"][0]["start_canonical_index"] == 10
    assert data["committed_nodes"][1]["node_type"] == "h2"
    assert data["committed_nodes"][1]["start_canonical_index"] == 0


@patch("routers.nodes.get_connection")
def test_get_chatroom_not_found(mock_conn):
    cur = MagicMock()
    cur.fetchone.return_value = None
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    r = client.get("/nodes/999")
    assert r.status_code == 404


# ── COMMIT — happy path ────────────────────────────────────────────────────────

@patch("routers.nodes.get_connection")
def test_commit_explicit_node(mock_conn):
    cur = MagicMock()
    cur.fetchone.side_effect = [(1,), (7,)]
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    r = client.post("/nodes/1/commit", json={"nodes": [_h1()]})
    assert r.status_code == 200
    data = r.json()
    assert data["committed_nodes"][0]["node_type"] == "h1"
    assert data["committed_nodes"][0]["start_canonical_index"] == 10


@patch("routers.nodes.get_connection")
def test_commit_inferred_node(mock_conn):
    cur = MagicMock()
    cur.fetchone.side_effect = [(1,), (7,)]
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    nodes = [_h1(), _inferred("h2", "Foreword")]
    r = client.post("/nodes/1/commit", json={"nodes": nodes})
    assert r.status_code == 200
    data = r.json()
    assert len(data["committed_nodes"]) == 2
    assert data["committed_nodes"][1]["start_canonical_index"] == 0


@patch("routers.nodes.get_connection")
def test_commit_derives_parent_node_correctly(mock_conn):
    cur = MagicMock()
    cur.fetchone.side_effect = [(1,), (7,)]
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    nodes = [_h1("Part", 0, 5), _h2("Chapter", 10, 15), _h3("Sub", 20, 25)]
    r = client.post("/nodes/1/commit", json={"nodes": nodes})
    assert r.status_code == 200

    insert_call = [c for c in cur.execute.call_args_list if "INSERT" in str(c)]
    assert len(insert_call) == 1
    flat = insert_call[0].args[1]
    # Each row: (document_id, node_index, parent_node, node_type, label, start, end)  — 7 fields
    parent_h1 = flat[2]   # row 0, index 2
    parent_h2 = flat[9]   # row 1, index 2
    parent_h3 = flat[16]  # row 2, index 2
    assert parent_h1 is None
    assert parent_h2 == 0   # index of h1
    assert parent_h3 == 1   # index of h2


@patch("routers.nodes.get_connection")
def test_commit_replaces_prior_nodes(mock_conn):
    cur = MagicMock()
    cur.fetchone.side_effect = [(1,), (7,)]
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    r = client.post("/nodes/1/commit", json={"nodes": [_h1()]})
    assert r.status_code == 200
    delete_call = [c for c in cur.execute.call_args_list if "DELETE" in str(c)]
    assert len(delete_call) == 1


# ── COMMIT — validation errors ─────────────────────────────────────────────────

@patch("routers.nodes.get_connection")
def test_commit_allows_non_sequential_explicit_order(mock_conn):
    cur = MagicMock()
    cur.fetchone.side_effect = [(1,), (7,)]
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    # Non-sequential canonical order is now allowed (user may reorder freely)
    nodes = [_h1("Later", 50, 55), _h1("Earlier", 10, 15)]
    r = client.post("/nodes/1/commit", json={"nodes": nodes})
    assert r.status_code == 200


@patch("routers.nodes.get_connection")
def test_commit_blocks_overlapping_explicit_nodes(mock_conn):
    cur = MagicMock()
    cur.fetchone.side_effect = [(1,), (7,)]
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    nodes = [_h1("A", 0, 10), _h1("B", 8, 20)]  # overlaps at 8-10
    r = client.post("/nodes/1/commit", json={"nodes": nodes})
    assert r.status_code == 400
    assert "overlap" in r.json()["detail"].lower()


@patch("routers.nodes.get_connection")
def test_commit_blocks_h2_without_preceding_h1(mock_conn):
    cur = MagicMock()
    cur.fetchone.side_effect = [(1,), (7,)]
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    r = client.post("/nodes/1/commit", json={"nodes": [_inferred("h2", "Section without h1")]})
    assert r.status_code == 400
    assert "h1" in r.json()["detail"]


@patch("routers.nodes.get_connection")
def test_commit_blocks_h3_without_preceding_h2(mock_conn):
    cur = MagicMock()
    cur.fetchone.side_effect = [(1,), (7,)]
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    nodes = [_h1(), _h3("Sub without h2", 30, 31)]
    r = client.post("/nodes/1/commit", json={"nodes": nodes})
    assert r.status_code == 400
    assert "h2" in r.json()["detail"]


@patch("routers.nodes.get_connection")
def test_commit_blocks_empty_label(mock_conn):
    cur = MagicMock()
    cur.fetchone.side_effect = [(1,), (7,)]
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    nodes = [{"node_type": "h1", "label": "   ", "start_canonical_index": 0, "end_canonical_index": 0}]
    r = client.post("/nodes/1/commit", json={"nodes": nodes})
    assert r.status_code == 400
    assert "empty label" in r.json()["detail"].lower()


# ── purge_nodes ────────────────────────────────────────────────────────────────

@patch("routers.nodes.get_connection")
def test_purge_nodes_issues_delete(mock_conn):
    from routers.nodes import purge_nodes

    cur = MagicMock()
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    purge_nodes(7)

    cur.execute.assert_called_once()
    sql, params = cur.execute.call_args.args
    assert "DELETE" in sql.upper()
    assert "document_nodes" in sql
    assert params == (7,)


# ── cascade purge wiring ───────────────────────────────────────────────────────

@patch("routers.nodes.purge_nodes")
@patch("routers.canonical_words.get_supabase")
@patch("routers.canonical_words.get_connection")
def test_canonical_commit_purges_nodes(mock_conn, mock_sb, mock_purge):
    cur = MagicMock()
    cur.fetchone.side_effect = [(1,), (7, "rules.pdf")]
    cur.fetchall.return_value = []
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    sample_raw = {
        "words": [
            {"word_id": "p1-b0-l0-w0", "text": "Hello", "quad": [0, 0, 10, 10],
             "page": 1, "block_no": 0, "line_no": 0, "word_no": 0}
        ]
    }

    def download(path):
        if "raw_words" in path:
            import json
            return json.dumps(sample_raw).encode()
        raise Exception("unknown")

    supabase = MagicMock()
    supabase.storage.from_.return_value.download.side_effect = download
    mock_sb.return_value = supabase

    r = client.post("/canonical-words/1/commit", json={"included_raw_word_indices": [0]})
    assert r.status_code == 200
    mock_purge.assert_called_once_with(7)


@patch("routers.nodes.purge_nodes")
@patch("routers.canonical_words.purge_canonical_words")
@patch("routers.raw_words.upload_file")
@patch("routers.raw_words.get_supabase")
@patch("routers.raw_words.get_connection")
def test_raw_words_commit_purges_nodes(mock_conn, mock_sb, mock_upload, mock_purge_cw, mock_purge_nodes):
    cur = MagicMock()
    cur.fetchone.side_effect = [(1,), (7, "rules.pdf")]
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    supabase = MagicMock()
    supabase.storage.from_.return_value.list.return_value = [{"name": "rules.pdf"}]
    mock_sb.return_value = supabase

    payload = {
        "word_count": 1, "page_count": 1,
        "pages": [{"page": 1, "width": 612.0, "height": 792.0}],
        "words": [{"word_id": "p1-b0-l0-w0", "text": "Hello", "quad": [10.0, 20.0, 30.0, 40.0],
                   "page": 1, "block_no": 0, "line_no": 0, "word_no": 0}],
    }
    r = client.post("/raw-words/1/commit", json={"payload": payload})
    assert r.status_code == 200
    mock_purge_nodes.assert_called_once_with(7)
