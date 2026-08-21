from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}

def test_analyze_with_file_and_line_ref():
    sample_bundle = {
        "raw_log": {
            "message": "TypeError: Cannot read properties of undefined",
            "stackTrace": "renderApp@http://localhost:3000/src/App.js:42:12",
            "url": "http://localhost:3000/src/App.js",
            "timestamp": "2026-08-07T12:00:00.000Z"
        },
        "stack_trace": "renderApp@http://localhost:3000/src/App.js:42:12",
        "code_chunks": [
            {
                "filePath": "d:/LogLens/middleware/src/App.js",
                "lineNumber": 42,
                "code": "const value = obj.prop;",
                "gitMeta": {
                    "commitHash": "a1b2c3d4e5f67890123456789012345678901234",
                    "commitDate": "2026-08-07T10:00:00.000Z",
                    "author": "Dev Author"
                }
            }
        ],
        "file_ref": "d:/LogLens/middleware/src/App.js",
        "line_ref": 42
    }

    response = client.post("/analyze", json=sample_bundle)
    assert response.status_code == 200
    data = response.json()
    assert data["summary"] == "Mock explanation"
    assert data["file_ref"] == "d:/LogLens/middleware/src/App.js"
    assert data["line_ref"] == 42
    assert data["remediation_steps"] == ["This is a mock response"]

def test_analyze_with_null_file_and_line_ref():
    sample_bundle_null = {
        "raw_log": {
            "message": "Network Error",
            "stackTrace": "HTTP 404: GET http://localhost:3000/api/missing",
            "url": "http://localhost:3000/api/missing",
            "timestamp": "2026-08-07T12:00:00.000Z"
        },
        "stack_trace": "HTTP 404: GET http://localhost:3000/api/missing",
        "code_chunks": [],
        "file_ref": None,
        "line_ref": None
    }

    response = client.post("/analyze", json=sample_bundle_null)
    assert response.status_code == 200
    data = response.json()
    assert data["summary"] == "Mock explanation"
    assert data["file_ref"] == "unknown"
    assert data["line_ref"] == 0
    assert data["remediation_steps"] == ["This is a mock response"]
