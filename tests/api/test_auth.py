from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def _mock_conn(row):
    cur = MagicMock()
    cur.fetchone.return_value = row
    cur.__enter__ = lambda s: s
    cur.__exit__ = MagicMock(return_value=False)

    conn = MagicMock()
    conn.cursor.return_value = cur
    conn.__enter__ = lambda s: s
    conn.__exit__ = MagicMock(return_value=False)
    return conn


@patch("routers.auth.get_connection")
def test_login_valid_admin(mock_conn):
    mock_conn.return_value = _mock_conn(("admin",))
    res = client.post("/auth/login", json={"username": "adminuser", "password": "pass"})
    assert res.status_code == 200
    assert res.json() == {"role": "admin", "username": "adminuser"}


@patch("routers.auth.get_connection")
def test_login_valid_user(mock_conn):
    mock_conn.return_value = _mock_conn(("user",))
    res = client.post("/auth/login", json={"username": "regularuser", "password": "pass"})
    assert res.status_code == 200
    assert res.json() == {"role": "user", "username": "regularuser"}


@patch("routers.auth.get_connection")
def test_login_invalid_password(mock_conn):
    mock_conn.return_value = _mock_conn(None)
    res = client.post("/auth/login", json={"username": "adminuser", "password": "wrong"})
    assert res.status_code == 401


@patch("routers.auth.get_connection")
def test_login_unknown_username(mock_conn):
    mock_conn.return_value = _mock_conn(None)
    res = client.post("/auth/login", json={"username": "nobody", "password": "pass"})
    assert res.status_code == 401


def test_login_missing_fields():
    res = client.post("/auth/login", json={})
    assert res.status_code == 422
