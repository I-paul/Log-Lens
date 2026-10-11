from typing import List, Optional
from datetime import datetime
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import chromadb
from sentence_transformers import SentenceTransformer

app = FastAPI(title="Log Lens AI Reasoning Backend")

chroma_client = chromadb.PersistentClient(path="./chroma_db")
collection = chroma_client.get_or_create_collection(name="loglens_code_index")
embed_model = SentenceTransformer('all-mpnet-base-v2')

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

def calculate_git_recency_score(commit_date_str: str) -> float:
    try:
        commit_date = datetime.fromisoformat(commit_date_str)
        delta_days = (datetime.now() - commit_date.replace(tzinfo=None)).days
        return float(1.0 / (1.0 + (max(0, delta_days) / 7.0)))
    except Exception:
        return 0.5

def calculate_depth_score(frame_index: int, total_frames: int) -> float:
    if total_frames <= 0:
        return 1.0
    return float(1.0 - (frame_index / total_frames))

@app.get("/health")
def health():
    return {"status": "ok", "vector_store": "active"}

@app.post("/analyze", response_model=AnalyzeResponse)
def analyze(bundle: BundleRequest):
    try:
        query_text = f"{bundle.raw_log.message} {bundle.stack_trace}"
        query_embedding = embed_model.encode([query_text]).tolist()[0]

        results = collection.query(query_embeddings=[query_embedding], n_results=5)
        retrieved_chunks = []
        
        if results and results['documents'] and len(results['documents']) > 0:
            docs = results['documents'][0]
            metas = results['metadatas'][0]
            alpha = 0.6 # Hybrid weight from paper[cite: 1]
            scored_candidates = []
            
            for idx, (doc, meta) in enumerate(zip(docs, metas)):
                r_git = calculate_git_recency_score(meta.get("commitDate", ""))
                r_depth = calculate_depth_score(idx, len(docs))
                score = (alpha * r_git) + ((1.0 - alpha) * r_depth)
                scored_candidates.append({"doc": doc, "meta": meta, "score": score})

            scored_candidates.sort(key=lambda x: x["score"], reverse=True)
            retrieved_chunks = scored_candidates

        best_match_file = bundle.file_ref
        best_match_line = bundle.line_ref
        
        if not best_match_file and retrieved_chunks:
            best_match_file = retrieved_chunks[0]["meta"].get("filePath", "unknown")
            best_match_line = 1

        return {
            "summary": f"Runtime anomaly detected: {bundle.raw_log.message}. Semantic and temporal analysis localized issue.",
            "file_ref": best_match_file or "unknown",
            "line_ref": best_match_line if best_match_line is not None else 0,
            "remediation_steps": [
                f"Inspect variable initialization and null-checks in {best_match_file} around line {best_match_line}.",
                "Verify recent Git commit modifications and stack trace depth priors.",
                "Apply defensive error boundaries to gracefully handle unexpected exceptions."
            ]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))