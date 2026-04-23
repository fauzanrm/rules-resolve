from unittest.mock import MagicMock, patch, call

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def _setup_db(mock_conn, chatroom_exists=True, doc_id=7, has_nodes_count=3,
              committed_rows=None, node_indices=None):
    cur = MagicMock()
    fetchones = [(1,) if chatroom_exists else None]
    if chatroom_exists:
        fetchones.append((doc_id,))              # _resolve_doc
        fetchones.append((has_nodes_count,))     # _has_nodes
    cur.fetchone.side_effect = fetchones
    cur.fetchall.return_value = committed_rows or []
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur
    return cur


def _chunk(chunk_index=0, assigned_node_id=None, start=0, end=5, text="hello world"):
    return {
        "chunk_index": chunk_index,
        "assigned_node_id": assigned_node_id,
        "start_canonical_index": start,
        "end_canonical_index": end,
        "text": text,
    }


# ── GET ────────────────────────────────────────────────────────────────────────

@patch("routers.chunks.get_connection")
def test_get_no_document(mock_conn):
    cur = MagicMock()
    cur.fetchone.side_effect = [(1,), None]
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    r = client.get("/chunks/1")
    assert r.status_code == 200
    data = r.json()
    assert data["has_nodes"] is False
    assert data["committed_chunks"] is None


@patch("routers.chunks.get_connection")
def test_get_doc_no_nodes_no_chunks(mock_conn):
    cur = MagicMock()
    cur.fetchone.side_effect = [(1,), (7,), (0,)]  # chatroom, doc, node count=0
    cur.fetchall.return_value = []
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    r = client.get("/chunks/1")
    assert r.status_code == 200
    data = r.json()
    assert data["has_nodes"] is False
    assert data["committed_chunks"] is None


@patch("routers.chunks.get_connection")
def test_get_doc_with_nodes_and_chunks(mock_conn):
    rows = [
        (0, None, 0, 5, "hello world"),
        (1, 0, 10, 15, "foo bar"),
    ]
    cur = MagicMock()
    cur.fetchone.side_effect = [(1,), (7,), (3,)]
    cur.fetchall.return_value = rows
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    r = client.get("/chunks/1")
    assert r.status_code == 200
    data = r.json()
    assert data["has_nodes"] is True
    assert len(data["committed_chunks"]) == 2
    assert data["committed_chunks"][0]["chunk_index"] == 0
    assert data["committed_chunks"][1]["assigned_node_id"] == 0


@patch("routers.chunks.get_connection")
def test_get_chatroom_not_found(mock_conn):
    cur = MagicMock()
    cur.fetchone.return_value = None
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    r = client.get("/chunks/999")
    assert r.status_code == 404


# ── COMMIT — happy path ────────────────────────────────────────────────────────

@patch("routers.chunks.get_connection")
def test_commit_happy_path_assigned(mock_conn):
    cur = MagicMock()
    cur.fetchone.side_effect = [(1,), (7,)]
    cur.fetchall.return_value = [(0,)]  # valid node_index = 0
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    r = client.post("/chunks/1/commit", json={"chunks": [_chunk(assigned_node_id=0)]})
    assert r.status_code == 200
    data = r.json()
    assert data["committed_chunks"][0]["assigned_node_id"] == 0


@patch("routers.chunks.get_connection")
def test_commit_happy_path_unassigned(mock_conn):
    cur = MagicMock()
    cur.fetchone.side_effect = [(1,), (7,)]
    cur.fetchall.return_value = []  # no node_index lookup needed
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    r = client.post("/chunks/1/commit", json={"chunks": [_chunk(assigned_node_id=None)]})
    assert r.status_code == 200
    data = r.json()
    assert data["committed_chunks"][0]["assigned_node_id"] is None


# ── COMMIT — validation errors ─────────────────────────────────────────────────

@patch("routers.chunks.get_connection")
def test_commit_overlapping_ranges(mock_conn):
    cur = MagicMock()
    cur.fetchone.side_effect = [(1,), (7,)]
    cur.fetchall.return_value = []
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    chunks = [
        _chunk(chunk_index=0, start=0, end=10, text="a"),
        _chunk(chunk_index=1, start=8, end=20, text="b"),
    ]
    r = client.post("/chunks/1/commit", json={"chunks": chunks})
    assert r.status_code == 400
    assert "overlap" in r.json()["detail"].lower()


@patch("routers.chunks.get_connection")
def test_commit_empty_text(mock_conn):
    cur = MagicMock()
    cur.fetchone.side_effect = [(1,), (7,)]
    cur.fetchall.return_value = []
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    r = client.post("/chunks/1/commit", json={"chunks": [_chunk(text="   ")]})
    assert r.status_code == 400
    assert "empty" in r.json()["detail"].lower()


@patch("routers.chunks.get_connection")
def test_commit_start_greater_than_end(mock_conn):
    cur = MagicMock()
    cur.fetchone.side_effect = [(1,), (7,)]
    cur.fetchall.return_value = []
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    r = client.post("/chunks/1/commit", json={"chunks": [_chunk(start=10, end=5)]})
    assert r.status_code == 400


@patch("routers.chunks.get_connection")
def test_commit_invalid_assigned_node_id(mock_conn):
    cur = MagicMock()
    cur.fetchone.side_effect = [(1,), (7,)]
    cur.fetchall.return_value = [(0,), (1,)]  # valid node indices are 0 and 1
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    r = client.post("/chunks/1/commit", json={"chunks": [_chunk(assigned_node_id=99)]})
    assert r.status_code == 400


# ── purge helpers ─────────────────────────────────────────────────────────────

@patch("routers.chunks.get_connection")
def test_purge_chunks_issues_delete(mock_conn):
    from routers.chunks import purge_chunks

    cur = MagicMock()
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    purge_chunks(7)

    cur.execute.assert_called_once()
    sql, params = cur.execute.call_args.args
    assert "DELETE" in sql.upper()
    assert "document_chunks" in sql
    assert params == (7,)


@patch("routers.chunks.get_connection")
def test_purge_chunk_assignments_issues_update(mock_conn):
    from routers.chunks import purge_chunk_assignments

    cur = MagicMock()
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    purge_chunk_assignments(7)

    cur.execute.assert_called_once()
    sql, params = cur.execute.call_args.args
    assert "UPDATE" in sql.upper()
    assert "assigned_node_id" in sql
    assert "NULL" in sql.upper()
    assert params == (7,)


# ── cascade purge wiring ───────────────────────────────────────────────────────

@patch("routers.chunks.purge_chunk_assignments")
@patch("routers.nodes.get_connection")
def test_nodes_commit_calls_purge_chunk_assignments(mock_conn, mock_purge):
    cur = MagicMock()
    cur.fetchone.side_effect = [(1,), (7,)]
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    node = {"node_type": "h1", "label": "Chapter", "start_canonical_index": 10, "end_canonical_index": 15}
    r = client.post("/nodes/1/commit", json={"nodes": [node]})
    assert r.status_code == 200
    mock_purge.assert_called_once_with(7)
