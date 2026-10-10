from fastapi.testclient import TestClient

from app.main import app


def test_health_without_models_or_credentials():
    with TestClient(app) as client:
        response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_inference_routes_are_not_advertised():
    assert set(app.openapi()["paths"]) == {"/health"}
