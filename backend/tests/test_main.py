from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "indexed_chunks" in data
    assert data["model"] == "all-MiniLM-L6-v2"


def test_analyze_with_file_ref():
    bundle = {
        "raw_log": {
            "message": "TypeError: Cannot read properties of undefined",
            "stackTrace": "renderApp@http://localhost:3000/src/App.js:42:12",
            "url": "http://localhost:3000/src/App.js",
            "timestamp": "2026-08-07T12:00:00.000Z",
        },
        "stack_trace": "renderApp@http://localhost:3000/src/App.js:42:12",
        "code_chunks": [
            {
                "filePath": "src/App.js",
                "lineNumber": 42,
                "code": "const value = obj.prop;",
                "gitMeta": {
                    "commitHash": "a1b2c3d4",
                    "commitDate": "2026-08-07T10:00:00",
                    "author": "Dev",
                },
            }
        ],
        "file_ref": "src/App.js",
        "line_ref": 42,
    }
    response = client.post("/analyze", json=bundle)
    assert response.status_code == 200
    data = response.json()
    assert "root_cause_file" in data
    assert "root_cause_line" in data
    assert "error_summary" in data
    assert "detailed_explanation" in data
    assert "confidence" in data
    assert "remediation_steps" in data


def test_analyze_with_null_refs():
    bundle = {
        "raw_log": {
            "message": "Network Error",
            "stackTrace": "",
            "url": "http://localhost:3000/api/missing",
            "timestamp": "2026-08-07T12:00:00.000Z",
        },
        "stack_trace": "",
        "code_chunks": [],
        "file_ref": None,
        "line_ref": None,
    }
    response = client.post("/analyze", json=bundle)
    assert response.status_code == 200
    data = response.json()
    assert data["root_cause_file"] is not None
    assert isinstance(data["remediation_steps"], list)
