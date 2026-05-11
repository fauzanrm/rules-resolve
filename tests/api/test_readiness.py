from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)

T1 = datetime(2025, 1, 1, 10, 0, tzinfo=timezone.utc)
T2 = datetime(2025, 1, 1, 11, 0, tzinfo=timezone.utc)
T3 = datetime(2025, 1, 1, 12, 0, tzinfo=timezone.utc)
T4 = datetime(2025, 1, 1, 13, 0, tzinfo=timezone.utc)
T5 = datetime(2025, 1, 1, 14, 0, tzinfo=timezone.utc)
T6 = datetime(2025, 1, 1, 15, 0, tzinfo=timezone.utc)
T_PUB = datetime(2025, 1, 2, 9, 0, tzinfo=timezone.utc)


def _setup(mock_conn, chatroom_found=True, row=None, chunk_count=0, embedding_count=0):
    cur = MagicMock()
    if not chatroom_found:
        cur.fetchone.return_value = None
        mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur
        return cur

    fetchones = [(1,), row]
    if row is not None and row[7] is not None:
        fetchones.extend([(chunk_count,), (embedding_count,)])
    cur.fetchone.side_effect = fetchones
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur
    return cur


@patch("routers.readiness.get_connection")
def test_readiness_chatroom_not_found(mock_conn):
    _setup(mock_conn, chatroom_found=False)
    resp = client.get("/readiness/999")
    assert resp.status_code == 404


@patch("routers.readiness.get_connection")
def test_readiness_no_document(mock_conn):
    # chatroom found, but no document joined
    _setup(mock_conn, row=None)
    resp = client.get("/readiness/1")
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_ask_ready"] is False
    for key in ["pdf", "raw_words", "canonical_words", "nodes", "chunks", "embeddings"]:
        assert data["stages"][key]["complete"] is False
        assert data["stages"][key]["stale"] is False


@patch("routers.readiness.get_connection")
def test_readiness_all_complete_published(mock_conn):
    # published_at, pdf_ts, rw_ts, cw_ts, nodes_ts, chunks_ts, emb_ts, doc_id
    row = (T_PUB, T1, T2, T3, T4, T5, T6, 7)
    _setup(mock_conn, row=row, chunk_count=3, embedding_count=3)
    resp = client.get("/readiness/1")
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_ask_ready"] is True
    assert data["published_at"] is not None
    for key in ["pdf", "raw_words", "canonical_words", "nodes", "chunks", "embeddings"]:
        assert data["stages"][key]["complete"] is True
        assert data["stages"][key]["stale"] is False


@patch("routers.readiness.get_connection")
def test_readiness_stale_stage_blocks_ask_ready(mock_conn):
    # raw_words older than pdf_ts → raw_words is stale
    stale_rw = datetime(2024, 12, 31, 0, 0, tzinfo=timezone.utc)
    row = (T_PUB, T1, stale_rw, T3, T4, T5, T6, 7)
    _setup(mock_conn, row=row, chunk_count=3, embedding_count=3)
    resp = client.get("/readiness/1")
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_ask_ready"] is False
    assert data["stages"]["raw_words"]["complete"] is False
    assert data["stages"]["raw_words"]["stale"] is True


@patch("routers.readiness.get_connection")
def test_readiness_not_published_is_not_ask_ready(mock_conn):
    row = (None, T1, T2, T3, T4, T5, T6, 7)
    _setup(mock_conn, row=row, chunk_count=3, embedding_count=3)
    resp = client.get("/readiness/1")
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_ask_ready"] is False
    assert data["published_at"] is None
    # all stages can still be green
    assert data["stages"]["pdf"]["complete"] is True


@patch("routers.readiness.get_connection")
def test_readiness_missing_embeddings_not_complete(mock_conn):
    row = (T_PUB, T1, T2, T3, T4, T5, T6, 7)
    _setup(mock_conn, row=row, chunk_count=3, embedding_count=1)  # 2 missing
    resp = client.get("/readiness/1")
    assert resp.status_code == 200
    data = resp.json()
    assert data["stages"]["embeddings"]["complete"] is False
    assert data["is_ask_ready"] is False
