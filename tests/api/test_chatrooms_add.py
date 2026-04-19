from datetime import datetime
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def _make_minimal_pdf() -> bytes:
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


@patch("routers.chatrooms.get_supabase", return_value=None)
@patch("routers.chatrooms.get_connection")
def test_create_chatroom_success(mock_conn, _mock_supabase):
    cur = MagicMock()
    cur.fetchone.side_effect = [None, (1,), (99,)]
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    pdf_bytes = _make_minimal_pdf()
    response = client.post(
        "/chatrooms/",
        data={"name": "Catan"},
        files={"file": ("catan.pdf", pdf_bytes, "application/pdf")},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == 1
    assert data["name"] == "Catan"
    assert data["cover_image_url"] is None


@patch("routers.chatrooms.get_supabase", return_value=None)
@patch("routers.chatrooms.get_connection")
def test_create_chatroom_non_pdf_rejected(mock_conn, _mock_supabase):
    response = client.post(
        "/chatrooms/",
        data={"name": "Catan"},
        files={"file": ("notes.txt", b"hello", "text/plain")},
    )
    assert response.status_code == 400
    assert "PDF" in response.json()["detail"]


@patch("routers.chatrooms.get_supabase", return_value=None)
@patch("routers.chatrooms.get_connection")
def test_create_chatroom_oversized_rejected(mock_conn, _mock_supabase):
    big_data = b"%PDF-1.4 " + b"x" * (26 * 1024 * 1024)
    response = client.post(
        "/chatrooms/",
        data={"name": "Catan"},
        files={"file": ("big.pdf", big_data, "application/pdf")},
    )
    assert response.status_code == 400
    assert "25 MB" in response.json()["detail"]


@patch("routers.chatrooms.get_supabase", return_value=None)
@patch("routers.chatrooms.get_connection")
def test_create_chatroom_duplicate_name(mock_conn, _mock_supabase):
    cur = MagicMock()
    cur.fetchone.return_value = (1,)  # duplicate found
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    pdf_bytes = _make_minimal_pdf()
    response = client.post(
        "/chatrooms/",
        data={"name": "Catan"},
        files={"file": ("catan.pdf", pdf_bytes, "application/pdf")},
    )
    assert response.status_code == 409
    assert "already exists" in response.json()["detail"]


@patch("routers.chatrooms.upload_file", side_effect=Exception("storage error"))
@patch("routers.chatrooms.get_supabase")
@patch("routers.chatrooms.get_connection")
def test_create_chatroom_storage_failure_rolls_back(mock_conn, mock_supabase, _mock_upload):
    mock_supabase.return_value = MagicMock()

    insert_cur = MagicMock()
    insert_cur.fetchone.side_effect = [None, (1,), (99,)]

    cleanup_cur = MagicMock()

    call_count = 0
    original_enter = MagicMock()

    def conn_side_effect():
        nonlocal call_count
        call_count += 1
        conn = MagicMock()
        cur = insert_cur if call_count == 1 else cleanup_cur
        conn.__enter__ = lambda s: s
        conn.__exit__ = MagicMock(return_value=False)
        conn.cursor.return_value.__enter__ = lambda s: cur
        conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
        return conn

    mock_conn.side_effect = conn_side_effect

    pdf_bytes = _make_minimal_pdf()
    response = client.post(
        "/chatrooms/",
        data={"name": "Catan"},
        files={"file": ("catan.pdf", pdf_bytes, "application/pdf")},
    )
    assert response.status_code == 500
    assert "storage" in response.json()["detail"].lower()
    assert cleanup_cur.execute.called
