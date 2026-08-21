from typing import List, Optional
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

class RawLog(BaseModel):
    message: str
    stackTrace: str
    url: str
    timestamp: str

class GitMeta(BaseModel):
    commitHash: str
    commitDate: str
    author: str

class CodeChunk(BaseModel):
    filePath: str
    lineNumber: int
    code: str
    gitMeta: GitMeta

class BundleRequest(BaseModel):
    raw_log: RawLog
    stack_trace: str
    code_chunks: List[CodeChunk] = []
    file_ref: Optional[str] = None
    line_ref: Optional[int] = None

class AnalyzeResponse(BaseModel):
    summary: str
    file_ref: str
    line_ref: int
    remediation_steps: List[str]

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/analyze", response_model=AnalyzeResponse)
def analyze(bundle: BundleRequest):
    return {
        "summary": "Mock explanation",
        "file_ref": bundle.file_ref or "unknown",
        "line_ref": bundle.line_ref if bundle.line_ref is not None else 0,
        "remediation_steps": ["This is a mock response"],
    }
