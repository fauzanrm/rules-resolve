from unittest.mock import MagicMock, call, patch

import pytest
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def _setup_db(mock_conn, chatroom_exists=True, doc_id=5, chunk_count=3, embedding_count=0):
    cur = MagicMock()
    fetchones = [(1,) if chatroom_exists else None]
    if chatroom_exists:
        fetchones.append((doc_id,))          # _resolve_doc
        fetchones.append((chunk_count,))     # _count_chunks
        fetchones.append((embedding_count,)) # _count_embeddings
    cur.fetchone.side_effect = fetchones
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur
    return cur


# ── GET ────────────────────────────────────────────────────────────────────────

@patch("routers.embeddings.get_connection")
def test_get_no_document(mock_conn):
    cur = MagicMock()
    cur.fetchone.side_effect = [(1,), None]
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur
    resp = client.get("/embeddings/1")
    assert resp.status_code == 200
    data = resp.json()
    assert data["has_committed_chunks"] is False
    assert data["committed_chunk_count"] == 0
    assert data["stored_embedding_count"] == 0
    assert data["missing_count"] == 0


@patch("routers.embeddings.get_connection")
def test_get_no_chunks(mock_conn):
    _setup_db(mock_conn, chunk_count=0, embedding_count=0)
    resp = client.get("/embeddings/1")
    assert resp.status_code == 200
    data = resp.json()
    assert data["has_committed_chunks"] is False
    assert data["committed_chunk_count"] == 0
    assert data["missing_count"] == 0


@patch("routers.embeddings.get_connection")
def test_get_chunks_no_embeddings(mock_conn):
    _setup_db(mock_conn, chunk_count=4, embedding_count=0)
    resp = client.get("/embeddings/1")
    assert resp.status_code == 200
    data = resp.json()
    assert data["has_committed_chunks"] is True
    assert data["committed_chunk_count"] == 4
    assert data["stored_embedding_count"] == 0
    assert data["missing_count"] == 4


@patch("routers.embeddings.get_connection")
def test_get_all_embeddings_stored(mock_conn):
    _setup_db(mock_conn, chunk_count=3, embedding_count=3)
    resp = client.get("/embeddings/1")
    assert resp.status_code == 200
    data = resp.json()
    assert data["committed_chunk_count"] == 3
    assert data["stored_embedding_count"] == 3
    assert data["missing_count"] == 0


@patch("routers.embeddings.get_connection")
def test_get_chatroom_not_found(mock_conn):
    cur = MagicMock()
    cur.fetchone.return_value = None
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur
    resp = client.get("/embeddings/999")
    assert resp.status_code == 404


# ── POST generate ──────────────────────────────────────────────────────────────

@patch("routers.embeddings.get_connection")
def test_generate_no_chunks(mock_conn):
    cur = MagicMock()
    cur.fetchone.side_effect = [(1,), (5,)]  # chatroom exists, doc_id
    cur.fetchall.return_value = []
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur
    resp = client.post("/embeddings/1/generate")
    assert resp.status_code == 400
    assert "No committed chunks" in resp.json()["detail"]


@patch("routers.embeddings.get_connection")
def test_generate_empty_chunk_text(mock_conn):
    cur = MagicMock()
    cur.fetchone.side_effect = [(1,), (5,)]
    # fetchall: first=nodes (empty), second=chunks (chunk_index, assigned_node_id, text)
    cur.fetchall.side_effect = [[], [(0, None, "   ")]]
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur
    resp = client.post("/embeddings/1/generate")
    assert resp.status_code == 400
    assert "empty text" in resp.json()["detail"]


@patch("routers.embeddings._generate_embeddings")
@patch("routers.embeddings.get_connection")
def test_generate_happy_path(mock_conn, mock_embed):
    doc_id = 5
    chunks = [(0, None, "hello world"), (1, None, "foo bar"), (2, None, "baz qux")]
    mock_embed.return_value = [[0.1] * 1536, [0.2] * 1536, [0.3] * 1536]

    cur = MagicMock()
    cur.fetchone.side_effect = [(1,), (doc_id,)]
    cur.fetchall.side_effect = [[], chunks]  # nodes, then chunks
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    resp = client.post("/embeddings/1/generate")
    assert resp.status_code == 200
    data = resp.json()
    assert data["committed_chunk_count"] == 3
    assert data["stored_embedding_count"] == 3
    assert data["missing_count"] == 0


@patch("routers.embeddings._generate_embeddings")
@patch("routers.embeddings.get_connection")
def test_generate_writes_correct_document_id_and_chunk_index(mock_conn, mock_embed):
    doc_id = 7
    chunks = [(0, None, "alpha"), (1, None, "beta")]
    mock_embed.return_value = [[0.1] * 1536, [0.2] * 1536]

    cur = MagicMock()
    cur.fetchone.side_effect = [(1,), (doc_id,)]
    cur.fetchall.side_effect = [[], chunks]
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    client.post("/embeddings/1/generate")

    execute_calls = [str(c) for c in cur.execute.call_args_list]
    insert_call = next((c for c in execute_calls if "INSERT" in c), None)
    assert insert_call is not None
    assert str(doc_id) in insert_call


@patch("routers.embeddings._generate_embeddings")
@patch("routers.embeddings.get_connection")
def test_generate_reruns_replace_not_duplicate(mock_conn, mock_embed):
    chunks = [(0, None, "text one"), (1, None, "text two")]
    mock_embed.return_value = [[0.1] * 1536, [0.2] * 1536]

    cur = MagicMock()
    cur.fetchone.side_effect = [(1,), (5,)]
    cur.fetchall.side_effect = [[], chunks]
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    client.post("/embeddings/1/generate")

    execute_calls = [str(c) for c in cur.execute.call_args_list]
    delete_indices = [i for i, c in enumerate(execute_calls) if "DELETE" in c]
    insert_indices = [i for i, c in enumerate(execute_calls) if "INSERT" in c]
    assert len(delete_indices) == 1
    assert len(insert_indices) == 1
    assert delete_indices[0] < insert_indices[0]


@patch("routers.embeddings.get_connection")
def test_generate_embedding_api_failure_leaves_db_untouched(mock_conn):
    cur = MagicMock()
    cur.fetchone.side_effect = [(1,), (5,)]
    cur.fetchall.side_effect = [[], [(0, None, "some text")]]
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    with patch("routers.embeddings._generate_embeddings", side_effect=Exception("API error")):
        resp = client.post("/embeddings/1/generate")

    assert resp.status_code == 500
    execute_calls = [str(c) for c in cur.execute.call_args_list]
    assert not any("DELETE" in c or "INSERT" in c for c in execute_calls)


@patch("routers.embeddings._generate_embeddings")
@patch("routers.embeddings.get_connection")
def test_generate_duplicate_concurrent_returns_409(mock_conn, mock_embed):
    import routers.embeddings as emb_mod
    emb_mod._active_jobs.add(5)  # simulate in-progress job for doc_id=5
    try:
        cur = MagicMock()
        cur.fetchone.side_effect = [(1,), (5,)]
        mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur
        resp = client.post("/embeddings/1/generate")
        assert resp.status_code == 409
    finally:
        emb_mod._active_jobs.discard(5)


@patch("routers.embeddings._generate_embeddings")
@patch("routers.embeddings.get_connection")
def test_generate_includes_node_breadcrumb_in_embed_text(mock_conn, mock_embed):
    mock_embed.return_value = [[0.1] * 1536]
    # node_index=0, parent=None, label="Setup"  (h1)
    # chunk assigned to node 0, text="place tokens"
    nodes = [(0, None, "Setup")]
    chunks = [(0, 0, "place tokens")]

    cur = MagicMock()
    cur.fetchone.side_effect = [(1,), (5,)]
    cur.fetchall.side_effect = [nodes, chunks]
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    client.post("/embeddings/1/generate")

    texts_sent = mock_embed.call_args[0][0]
    assert texts_sent[0] == "Setup\n\nplace tokens"


@patch("routers.embeddings._generate_embeddings")
@patch("routers.embeddings.get_connection")
def test_generate_breadcrumb_walks_full_hierarchy(mock_conn, mock_embed):
    mock_embed.return_value = [[0.1] * 1536]
    # h1 (index 0, parent None), h2 (index 1, parent 0), h3 (index 2, parent 1)
    nodes = [(0, None, "Rules"), (1, 0, "Setup"), (2, 1, "Initial Placement")]
    chunks = [(0, 2, "place 2 settlements")]  # chunk assigned to h3

    cur = MagicMock()
    cur.fetchone.side_effect = [(1,), (5,)]
    cur.fetchall.side_effect = [nodes, chunks]
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    client.post("/embeddings/1/generate")

    texts_sent = mock_embed.call_args[0][0]
    assert texts_sent[0] == "Rules > Setup > Initial Placement\n\nplace 2 settlements"


# ── purge_embeddings ───────────────────────────────────────────────────────────

@patch("routers.embeddings.get_connection")
def test_purge_embeddings_issues_delete(mock_conn):
    cur = MagicMock()
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur
    from routers.embeddings import purge_embeddings
    purge_embeddings(3)
    cur.execute.assert_called_once_with(
        "DELETE FROM document_embeddings WHERE document_id = %s", (3,)
    )


# ── cascade wiring ─────────────────────────────────────────────────────────────

@patch("routers.embeddings.get_connection")
@patch("routers.chunks.get_connection")
def test_commit_chunks_purges_embeddings(mock_chunks_conn, mock_emb_conn):
    chunks_cur = MagicMock()
    chunks_cur.fetchone.side_effect = [(1,), (7,), (3,)]
    chunks_cur.fetchall.return_value = []
    mock_chunks_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = chunks_cur

    emb_cur = MagicMock()
    mock_emb_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = emb_cur

    with patch("routers.embeddings.purge_embeddings") as mock_purge:
        client.post("/chunks/1/commit", json={"chunks": [
            {"chunk_index": 0, "assigned_node_id": None,
             "start_canonical_index": 0, "end_canonical_index": 3, "text": "hello"}
        ]})
        mock_purge.assert_called_once()


@patch("routers.embeddings.get_connection")
@patch("routers.chunks.get_connection")
def test_purge_chunks_also_purges_embeddings(mock_chunks_conn, mock_emb_conn):
    chunks_cur = MagicMock()
    mock_chunks_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = chunks_cur

    emb_cur = MagicMock()
    mock_emb_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = emb_cur

    with patch("routers.embeddings.purge_embeddings") as mock_purge:
        from routers.chunks import purge_chunks
        purge_chunks(9)
        mock_purge.assert_called_once_with(9)
