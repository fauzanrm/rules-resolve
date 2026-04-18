from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_list_chatrooms_returns_200():
    response = client.get("/chatrooms/")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_chatroom_items_have_expected_fields():
    response = client.get("/chatrooms/")
    items = response.json()
    for item in items:
        assert "id" in item
        assert "name" in item
        assert "cover_image_url" in item
