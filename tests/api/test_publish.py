from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def _setup_publish(mock_conn, chatroom_found=True):
    cur = MagicMock()
    if chatroom_found:
        from datetime import datetime, timezone
        published_ts = datetime(2025, 1, 15, 12, 0, 0, tzinfo=timezone.utc)
        cur.fetchone.side_effect = [
            (1, "Catan", published_ts),  # UPDATE RETURNING
            (7,),                         # MIN(document_id)
        ]
    else:
        cur.fetchone.return_value = None
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur
    return cur


@patch("routers.chatrooms.get_supabase", return_value=None)
@patch("routers.chatrooms.get_connection")
def test_publish_sets_published_at(mock_conn, mock_supabase):
    _setup_publish(mock_conn)
    resp = client.post("/chatrooms/1/publish")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == 1
    assert data["name"] == "Catan"
    assert data["published_at"] is not None


@patch("routers.chatrooms.get_supabase", return_value=None)
@patch("routers.chatrooms.get_connection")
def test_publish_chatroom_not_found(mock_conn, mock_supabase):
    _setup_publish(mock_conn, chatroom_found=False)
    resp = client.post("/chatrooms/999/publish")
    assert resp.status_code == 404
