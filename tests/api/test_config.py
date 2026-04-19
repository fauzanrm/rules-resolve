import io
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_minimal_pdf() -> bytes:
    """Return a minimal valid single-page PDF as bytes."""
    return (
        b"%PDF-1.4\n"
        b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\n"
        b"xref\n0 4\n"
        b"0000000000 65535 f \n"
        b"0000000009 00000 n \n"
        b"0000000058 00000 n \n"
        b"0000000115 00000 n \n"
        b"trailer<</Size 4/Root 1 0 R>>\n"
        b"startxref\n190\n%%EOF"
    )


def _mock_db_no_chatroom(mock_conn):
    cur = MagicMock()
    cur.fetchone.return_value = None
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur


def _mock_db_chatroom_no_doc(mock_conn, chatroom_name="Test Game"):
    cur = MagicMock()
    cur.fetchone.side_effect = [(1, chatroom_name), None]
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur


def _mock_db_chatroom_with_doc(mock_conn, chatroom_name="Test Game"):
    from datetime import datetime
    cur = MagicMock()
    doc_row = (1, "rules.pdf", 1024, 10, datetime(2026, 4, 17, 12, 0, 0))
    cur.fetchone.side_effect = [(1, chatroom_name), doc_row]
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur


# ---------------------------------------------------------------------------
# GET /config/{chatroom_id}
# ---------------------------------------------------------------------------

@patch("routers.config.get_supabase", return_value=None)
@patch("routers.config.get_connection")
def test_get_config_chatroom_not_found(mock_conn, _mock_supabase):
    _mock_db_no_chatroom(mock_conn)
    response = client.get("/config/missing")
    assert response.status_code == 404


@patch("routers.config.get_supabase", return_value=None)
@patch("routers.config.get_connection")
def test_get_config_no_document(mock_conn, _mock_supabase):
    _mock_db_chatroom_no_doc(mock_conn, "Catan")
    response = client.get("/config/catan")
    assert response.status_code == 200
    data = response.json()
    assert data["chatroom_name"] == "Catan"
    assert data["document"] is None


@patch("routers.config.get_supabase", return_value=None)
@patch("routers.config.get_connection")
def test_get_config_with_document(mock_conn, _mock_supabase):
    _mock_db_chatroom_with_doc(mock_conn, "Catan")
    response = client.get("/config/catan")
    assert response.status_code == 200
    data = response.json()
    assert data["document"]["file_name"] == "rules.pdf"
    assert data["document"]["page_count"] == 10
    assert data["document"]["pdf_url"] is None
    assert data["document"]["cover_url"] is None


# ---------------------------------------------------------------------------
# POST /config/{chatroom_id}/commit
# ---------------------------------------------------------------------------

@patch("routers.config.get_supabase", return_value=None)
@patch("routers.config.get_connection")
def test_commit_non_pdf_rejected(mock_conn, _mock_supabase):
    response = client.post(
        "/config/catan/commit",
        files={"file": ("notes.txt", b"hello", "text/plain")},
    )
    assert response.status_code == 400
    assert "PDF" in response.json()["detail"]


@patch("routers.config.get_supabase", return_value=None)
@patch("routers.config.get_connection")
def test_commit_oversized_file_rejected(mock_conn, _mock_supabase):
    big_data = b"%PDF-1.4 " + b"x" * (21 * 1024 * 1024)
    response = client.post(
        "/config/catan/commit",
        files={"file": ("big.pdf", big_data, "application/pdf")},
    )
    assert response.status_code == 400
    assert "20 MB" in response.json()["detail"]


@patch("routers.config.upload_file")
@patch("routers.config.get_supabase", return_value=None)
@patch("routers.config.get_connection")
def test_commit_valid_pdf_creates_document(mock_conn, _mock_supabase, _mock_upload):
    from datetime import datetime
    cur = MagicMock()
    new_doc_row = (1, "rules.pdf", len(_make_minimal_pdf()), 1, datetime(2026, 4, 17, 12, 0, 0))
    cur.fetchone.side_effect = [(1,), None, new_doc_row]
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    pdf_bytes = _make_minimal_pdf()
    response = client.post(
        "/config/catan/commit",
        files={"file": ("rules.pdf", pdf_bytes, "application/pdf")},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["file_name"] == "rules.pdf"
    assert data["page_count"] == 1


@patch("routers.config.upload_file")
@patch("routers.config.get_supabase", return_value=None)
@patch("routers.config.get_connection")
def test_commit_overwrites_existing_document(mock_conn, _mock_supabase, _mock_upload):
    from datetime import datetime
    cur = MagicMock()
    updated_row = (1, "new_rules.pdf", 2048, 5, datetime(2026, 4, 17, 13, 0, 0))
    cur.fetchone.side_effect = [(1,), (1, "old.pdf"), updated_row]
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    pdf_bytes = _make_minimal_pdf()
    response = client.post(
        "/config/catan/commit",
        files={"file": ("new_rules.pdf", pdf_bytes, "application/pdf")},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["file_name"] == "new_rules.pdf"
