import io
from datetime import datetime
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
from PIL import Image

from main import app

client = TestClient(app)


def _make_png_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (10, 10), color="red").save(buf, format="PNG")
    return buf.getvalue()


@patch("routers.chatrooms.get_signed_url", return_value="https://example.com/signed")
@patch("routers.chatrooms.upload_file")
@patch("routers.chatrooms.get_supabase")
@patch("routers.chatrooms.get_connection")
def test_upload_thumbnail_success(mock_conn, mock_supabase, mock_upload, _mock_signed):
    cur = MagicMock()
    cur.fetchone.return_value = (1, "Catan", None, 99)
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur
    mock_supabase.return_value = MagicMock()

    response = client.post(
        "/chatrooms/1/thumbnail",
        files={"file": ("thumb.png", _make_png_bytes(), "image/png")},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["id"] == 1
    assert data["cover_image_url"] == "https://example.com/signed"
    assert data["has_custom_thumbnail"] is True
    mock_upload.assert_called_once()
    assert mock_upload.call_args[0][1] == "1/thumbnail.webp"


@patch("routers.chatrooms.get_supabase", return_value=None)
@patch("routers.chatrooms.get_connection")
def test_upload_thumbnail_chatroom_not_found(mock_conn, _mock_supabase):
    cur = MagicMock()
    cur.fetchone.return_value = None
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    response = client.post(
        "/chatrooms/404/thumbnail",
        files={"file": ("thumb.png", _make_png_bytes(), "image/png")},
    )
    assert response.status_code == 404


def test_upload_thumbnail_oversized_rejected():
    big_data = b"x" * (11 * 1024 * 1024)
    response = client.post(
        "/chatrooms/1/thumbnail",
        files={"file": ("thumb.png", big_data, "image/png")},
    )
    assert response.status_code == 400
    assert "10 MB" in response.json()["detail"]


def test_upload_thumbnail_invalid_image_rejected():
    response = client.post(
        "/chatrooms/1/thumbnail",
        files={"file": ("notes.txt", b"hello", "text/plain")},
    )
    assert response.status_code == 400
    assert "image" in response.json()["detail"].lower()


@patch("routers.chatrooms.delete_file")
@patch("routers.chatrooms.get_supabase", return_value=None)
@patch("routers.chatrooms.get_connection")
def test_revert_thumbnail_success(mock_conn, _mock_supabase, mock_delete):
    cur = MagicMock()
    cur.fetchone.return_value = (1, "Catan", None, 99)
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    response = client.delete("/chatrooms/1/thumbnail")

    assert response.status_code == 200
    data = response.json()
    assert data["has_custom_thumbnail"] is False
    mock_delete.assert_not_called()  # supabase unavailable, so no storage call attempted


@patch("routers.chatrooms.get_supabase", return_value=None)
@patch("routers.chatrooms.get_connection")
def test_revert_thumbnail_chatroom_not_found(mock_conn, _mock_supabase):
    cur = MagicMock()
    cur.fetchone.return_value = None
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur

    response = client.delete("/chatrooms/404/thumbnail")
    assert response.status_code == 404
