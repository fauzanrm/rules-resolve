from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def _setup_cursor(mock_conn):
    cur = MagicMock()
    mock_conn.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value = cur
    return cur


@patch("routers.chatrooms.get_supabase", return_value=None)
@patch("routers.chatrooms.get_connection")
def test_rename_chatroom_success(mock_conn, _supabase):
    cur = _setup_cursor(mock_conn)
    # 1: load current chatroom; 2: duplicate check; 3: cover lookup
    cur.fetchone.side_effect = [(1, "Catan"), None, (None,)]

    response = client.patch("/chatrooms/1", json={"name": "Settlers of Catan"})
    assert response.status_code == 200
    assert response.json()["name"] == "Settlers of Catan"
    # Ensure UPDATE ran
    executed = [c.args[0] for c in cur.execute.call_args_list]
    assert any("UPDATE chatrooms" in q for q in executed)


@patch("routers.chatrooms.get_supabase", return_value=None)
@patch("routers.chatrooms.get_connection")
def test_rename_chatroom_duplicate_rejected(mock_conn, _supabase):
    cur = _setup_cursor(mock_conn)
    cur.fetchone.side_effect = [(1, "Catan"), (2,)]

    response = client.patch("/chatrooms/1", json={"name": "Pandemic"})
    assert response.status_code == 409
    assert "already exists" in response.json()["detail"]


@patch("routers.chatrooms.get_supabase", return_value=None)
@patch("routers.chatrooms.get_connection")
def test_rename_chatroom_empty_rejected(mock_conn, _supabase):
    cur = _setup_cursor(mock_conn)
    cur.fetchone.side_effect = [(1, "Catan")]

    response = client.patch("/chatrooms/1", json={"name": "   "})
    assert response.status_code == 400
    assert "empty" in response.json()["detail"].lower()


@patch("routers.chatrooms.get_supabase", return_value=None)
@patch("routers.chatrooms.get_connection")
def test_rename_chatroom_too_long_rejected(mock_conn, _supabase):
    cur = _setup_cursor(mock_conn)
    cur.fetchone.side_effect = [(1, "Catan"), None]

    response = client.patch("/chatrooms/1", json={"name": "x" * 51})
    assert response.status_code == 400
    assert "50" in response.json()["detail"]


@patch("routers.chatrooms.get_supabase", return_value=None)
@patch("routers.chatrooms.get_connection")
def test_rename_chatroom_missing(mock_conn, _supabase):
    cur = _setup_cursor(mock_conn)
    cur.fetchone.return_value = None

    response = client.patch("/chatrooms/999", json={"name": "Anything"})
    assert response.status_code == 404


@patch("routers.chatrooms.get_supabase", return_value=None)
@patch("routers.chatrooms.get_connection")
def test_rename_chatroom_same_name_is_noop(mock_conn, _supabase):
    cur = _setup_cursor(mock_conn)
    cur.fetchone.side_effect = [(1, "Catan"), (None,)]

    response = client.patch("/chatrooms/1", json={"name": "  Catan  "})
    assert response.status_code == 200
    assert response.json()["name"] == "Catan"
    executed = [c.args[0] for c in cur.execute.call_args_list]
    assert not any("UPDATE chatrooms" in q for q in executed)
