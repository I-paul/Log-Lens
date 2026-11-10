import json
import re
from typing import Optional
from datetime import datetime, timezone
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import chromadb
from sentence_transformers import SentenceTransformer
import httpx

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
EMBEDDING_MODEL = "all-MiniLM-L6-v2"
CHROMA_PATH = "./chroma_db"
COLLECTION_NAME = "loglens_code_index"
OLLAMA_URL = "http://localhost:11434/api/generate"
OLLAMA_MODEL = "llama3.2"

SEMANTIC_WEIGHT = 0.40
RECENCY_WEIGHT = 0.35
DEPTH_WEIGHT = 0.25
TOP_K_RETRIEVE = 20
TOP_K_RERANK = 5
LOG_CHUNK_SIZE = 20
LOG_CHUNK_OVERLAP = 5

# ---------------------------------------------------------------------------
# App bootstrap
# ---------------------------------------------------------------------------
app = FastAPI(title="Log Lens AI Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

embed_model = SentenceTransformer(EMBEDDING_MODEL)
chroma_client = chromadb.PersistentClient(path=CHROMA_PATH)

def get_collection():
    return chroma_client.get_or_create_collection(name=COLLECTION_NAME)

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class RawLog(BaseModel):
    message: str
    stackTrace: Optional[str] = ""
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
    stack_trace: str = ""
    code_chunks: list[CodeChunk] = []
    file_ref: Optional[str] = None
    line_ref: Optional[int] = None

class AnalyzeResponse(BaseModel):
    root_cause_file: str
    root_cause_line: int
    error_summary: str
    detailed_explanation: str
    confidence: float
    github_url: Optional[str] = None
    remediation_steps: list[str] = []

# ---------------------------------------------------------------------------
# Log Normalizer — Docker JSON, CloudWatch, GCP, plain text
# ---------------------------------------------------------------------------

class LogNormalizer:
    @staticmethod
    def normalize(raw_text: str, platform: str = "auto") -> list[dict]:
        lines = raw_text.strip().splitlines()
        if not lines:
            return []

        if platform == "auto":
            platform = LogNormalizer._detect_platform(lines[0])

        entries = []
        for line in lines:
            entry = LogNormalizer._parse_line(line, platform)
            if entry:
                entries.append(entry)
        return entries

    @staticmethod
    def _detect_platform(first_line: str) -> str:
        stripped = first_line.strip()
        if stripped.startswith("{"):
            try:
                obj = json.loads(stripped)
                if "log" in obj and "stream" in obj:
                    return "docker"
                if "message" in obj and "ingestionTime" in obj:
                    return "cloudwatch"
                if "jsonPayload" in obj or "textPayload" in obj:
                    return "gcp"
            except json.JSONDecodeError:
                pass
        return "plain"

    @staticmethod
    def _parse_line(line: str, platform: str) -> Optional[dict]:
        stripped = line.strip()
        if not stripped:
            return None

        if platform == "docker":
            try:
                obj = json.loads(stripped)
                return {
                    "text": obj.get("log", "").rstrip("\n"),
                    "timestamp": obj.get("time", ""),
                    "severity": LogNormalizer._detect_severity(obj.get("log", "")),
                }
            except json.JSONDecodeError:
                return {"text": stripped, "timestamp": "", "severity": "INFO"}

        if platform == "cloudwatch":
            try:
                obj = json.loads(stripped)
                msg = obj.get("message", stripped)
                return {
                    "text": msg,
                    "timestamp": str(obj.get("timestamp", "")),
                    "severity": LogNormalizer._detect_severity(msg),
                }
            except json.JSONDecodeError:
                return {"text": stripped, "timestamp": "", "severity": "INFO"}

        if platform == "gcp":
            try:
                obj = json.loads(stripped)
                msg = ""
                if "textPayload" in obj:
                    msg = obj["textPayload"]
                elif "jsonPayload" in obj:
                    msg = obj["jsonPayload"].get("message", json.dumps(obj["jsonPayload"]))
                return {
                    "text": msg,
                    "timestamp": obj.get("timestamp", ""),
                    "severity": obj.get("severity", LogNormalizer._detect_severity(msg)),
                }
            except json.JSONDecodeError:
                return {"text": stripped, "timestamp": "", "severity": "INFO"}

        return {"text": stripped, "timestamp": "", "severity": LogNormalizer._detect_severity(stripped)}

    @staticmethod
    def _detect_severity(text: str) -> str:
        upper = text.upper()
        for level in ("FATAL", "CRITICAL", "ERROR", "WARN", "WARNING"):
            if level in upper:
                return level
        if "Exception" in text or "Traceback" in text or "panic" in text:
            return "ERROR"
        return "INFO"


# ---------------------------------------------------------------------------
# Log Chunker — sliding window preserving stack traces as atomic units
# ---------------------------------------------------------------------------

class LogChunker:
    STACK_PATTERNS = [
        re.compile(r"^\s+at\s+"),               # Java / Node.js
        re.compile(r"^\s+File\s+\""),            # Python
        re.compile(r"^goroutine\s+\d+"),         # Go
        re.compile(r"^Traceback\s"),             # Python header
        re.compile(r"^\s+\.\.\.\s+\d+\s+more"), # Java truncated
    ]

    def __init__(self, size: int = LOG_CHUNK_SIZE, overlap: int = LOG_CHUNK_OVERLAP):
        self.size = size
        self.overlap = overlap

    def chunk(self, entries: list[dict]) -> list[dict]:
        lines = [e["text"] for e in entries]
        stack_blocks = self._find_stack_blocks(lines)
        chunks = []

        for block in stack_blocks:
            chunks.append({
                "text": "\n".join(block),
                "type": "stack_trace",
            })

        step = self.size - self.overlap
        for start in range(0, len(lines), step):
            piece = lines[start:start + self.size]
            if piece:
                chunks.append({
                    "text": "\n".join(piece),
                    "type": "log",
                    "start": start,
                })
            if start + self.size >= len(lines):
                break

        return chunks

    def _find_stack_blocks(self, lines: list[str]) -> list[list[str]]:
        blocks = []
        current_block: list[str] = []
        in_stack = False

        for line in lines:
            is_stack_line = any(p.search(line) for p in self.STACK_PATTERNS)
            if is_stack_line:
                if not in_stack:
                    in_stack = True
                current_block.append(line)
            else:
                if in_stack and current_block:
                    blocks.append(current_block)
                    current_block = []
                    in_stack = False

        if current_block:
            blocks.append(current_block)

        return blocks


# ---------------------------------------------------------------------------
# Stack Trace Parser — extracts file paths from various languages
# ---------------------------------------------------------------------------

class StackTraceParser:
    PATTERNS = [
        # Java:  at com.example.App.method(App.java:42)
        re.compile(r"at\s+[\w.$]+\((?P<file>[\w.]+):(?P<line>\d+)\)"),
        # Python: File "/path/to/file.py", line 42
        re.compile(r'File\s+"(?P<file>[^"]+)",\s+line\s+(?P<line>\d+)'),
        # Node.js: at functionName (/path/to/file.js:42:10)
        re.compile(r"at\s+.*?\((?P<file>[^:)]+):(?P<line>\d+):\d+\)"),
        # Node.js (no parens): at /path/to/file.js:42:10
        re.compile(r"at\s+(?P<file>[^\s:]+):(?P<line>\d+):\d+"),
        # Go: /path/to/file.go:42
        re.compile(r"(?P<file>[\w/.\\-]+\.go):(?P<line>\d+)"),
        # V8 CDP: functionName@url:line:col
        re.compile(r"@(?P<file>[^:]+):(?P<line>\d+):\d+"),
    ]

    @staticmethod
    def parse(stack_trace: str) -> list[dict]:
        frames = []
        seen = set()
        for line in stack_trace.splitlines():
            for pattern in StackTraceParser.PATTERNS:
                m = pattern.search(line)
                if m:
                    file_path = m.group("file")
                    line_num = int(m.group("line"))
                    key = (file_path, line_num)
                    if key not in seen:
                        seen.add(key)
                        frames.append({"file": file_path, "line": line_num})
                    break
        return frames


# ---------------------------------------------------------------------------
# Hybrid Retriever — ChromaDB semantic search + temporal re-ranking
# ---------------------------------------------------------------------------

class HybridRetriever:
    def __init__(self):
        self.model = embed_model
        self.collection = get_collection()

    def retrieve(self, error_text: str, k: int = TOP_K_RETRIEVE) -> list[dict]:
        vec = self.model.encode(error_text).tolist()
        results = self.collection.query(
            query_embeddings=[vec],
            n_results=k,
        )
        candidates = []
        if results and results["documents"] and results["documents"][0]:
            docs = results["documents"][0]
            metas = results["metadatas"][0]
            distances = results["distances"][0]
            for doc, meta, dist in zip(docs, metas, distances):
                candidates.append({
                    "code": doc,
                    "file": meta.get("filePath", "unknown"),
                    "start_line": meta.get("startLine", 1),
                    "end_line": meta.get("endLine", 1),
                    "commit_date": meta.get("commitDate", ""),
                    "commit_hash": meta.get("commitHash", ""),
                    "author": meta.get("author", ""),
                    "semantic_score": max(0.0, 1.0 - dist),
                })
        return candidates

    @staticmethod
    def recency_weight(commit_date_str: str) -> float:
        try:
            commit_date = datetime.fromisoformat(commit_date_str)
            if commit_date.tzinfo is None:
                commit_date = commit_date.replace(tzinfo=timezone.utc)
            days = (datetime.now(timezone.utc) - commit_date).days
            return 1.0 / (1.0 + max(0, days))
        except Exception:
            return 0.0

    @staticmethod
    def depth_score(file_path: str, stack_files: list[str]) -> float:
        normalized = file_path.replace("\\", "/")
        for i, sf in enumerate(stack_files):
            sf_norm = sf.replace("\\", "/")
            if normalized.endswith(sf_norm) or sf_norm.endswith(normalized) or normalized == sf_norm:
                return 1.0 / (1.0 + i)
        return 0.0

    def rerank(self, candidates: list[dict], stack_files: list[str]) -> list[dict]:
        for c in candidates:
            sem = c.get("semantic_score", 0.0)
            rec = self.recency_weight(c.get("commit_date", ""))
            dep = self.depth_score(c.get("file", ""), stack_files)
            c["recency_score"] = rec
            c["depth_score"] = dep
            c["composite_score"] = (
                SEMANTIC_WEIGHT * sem
                + RECENCY_WEIGHT * rec
                + DEPTH_WEIGHT * dep
            )
        candidates.sort(key=lambda c: c["composite_score"], reverse=True)
        return candidates[:TOP_K_RERANK]


# ---------------------------------------------------------------------------
# Prompt Builder — structured 4-section prompt for LLM
# ---------------------------------------------------------------------------

class PromptBuilder:
    SYSTEM = (
        "You are an expert software debugging assistant with access to "
        "log output from a running application and relevant source code "
        "from the associated repository. Your task is to identify the "
        "single most likely root cause of the observed error, specify "
        "the exact file path and line number, and produce a structured "
        "JSON response. Reply with JSON only, no other text."
    )

    @staticmethod
    def build(raw_log: str, stack_trace: str, top_chunks: list[dict]) -> str:
        parts = [
            f"SYSTEM INSTRUCTION:\n{PromptBuilder.SYSTEM}",
            f"\nERROR CONTEXT:\n{raw_log}",
        ]

        if stack_trace:
            parts.append(f"\nSTACK TRACE:\n{stack_trace}")

        parts.append("\nCODE CONTEXT:")
        for i, c in enumerate(top_chunks, 1):
            header = (
                f"  Chunk {i}: {c['file']} "
                f"(lines {c['start_line']}-{c['end_line']}) "
                f"[semantic={c.get('semantic_score', 0):.2f}, "
                f"recency={c.get('recency_score', 0):.2f}, "
                f"depth={c.get('depth_score', 0):.2f}]"
            )
            parts.append(header)
            parts.append(c["code"])

        parts.append(
            '\nOUTPUT SPECIFICATION:\n'
            'Return a JSON object with exactly these fields:\n'
            '{\n'
            '  "root_cause_file": "<full file path>",\n'
            '  "root_cause_line": <line number>,\n'
            '  "error_summary": "<one sentence>",\n'
            '  "detailed_explanation": "<2-4 sentences describing the causal chain>",\n'
            '  "remediation_steps": ["<step1>", "<step2>", "<step3>"]\n'
            '}'
        )

        return "\n".join(parts)


# ---------------------------------------------------------------------------
# LLM Caller — Ollama local inference with fallback
# ---------------------------------------------------------------------------

async def call_llm(prompt: str) -> dict:
    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "format": "json",
        "options": {
            "temperature": 0.1,
            "num_predict": 1024,
        },
    }
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(OLLAMA_URL, json=payload)
            resp.raise_for_status()
            data = resp.json()
            response_text = data.get("response", "")
            return json.loads(response_text)
    except (httpx.HTTPError, json.JSONDecodeError, KeyError) as exc:
        print(f"[LLM] Error calling Ollama: {exc}")
        return {}


def validate_llm_response(
    llm_result: dict,
    top_chunks: list[dict],
    fallback_file: str = "",
    fallback_line: int = 0,
) -> dict:
    root_file = llm_result.get("root_cause_file", "")
    root_line = llm_result.get("root_cause_line", 0)
    error_summary = llm_result.get("error_summary", "")
    explanation = llm_result.get("detailed_explanation", "")
    steps = llm_result.get("remediation_steps", [])

    if not root_file and top_chunks:
        root_file = top_chunks[0]["file"]
    if not root_file and fallback_file:
        root_file = fallback_file
    if not root_line and top_chunks:
        root_line = top_chunks[0]["start_line"]
    if not root_line and fallback_line:
        root_line = fallback_line

    if not error_summary:
        error_summary = "Root cause analysis completed — see detailed explanation."
    if not explanation:
        explanation = "The system identified the most likely source location based on semantic similarity and recent git activity."
    if not steps and root_file:
        steps = [
            f"Inspect {root_file} around line {root_line}.",
            "Review recent commits to this file for regression-introducing changes.",
            "Add defensive error handling at the identified location.",
        ]

    return {
        "root_cause_file": root_file or "unknown",
        "root_cause_line": int(root_line) if root_line else 0,
        "error_summary": error_summary,
        "detailed_explanation": explanation,
        "remediation_steps": steps or [],
    }


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    count = get_collection().count()
    return {"status": "ok", "indexed_chunks": count, "model": EMBEDDING_MODEL}


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze(bundle: BundleRequest):
    try:
        # 1. Build the primary error text for embedding
        error_text = bundle.raw_log.message
        if bundle.stack_trace:
            error_text += "\n" + bundle.stack_trace

        # 2. Parse stack trace for file references
        stack_frames = StackTraceParser.parse(bundle.stack_trace or "")
        stack_files = [f["file"] for f in stack_frames]

        # Also add files from middleware-resolved code chunks
        for chunk in bundle.code_chunks:
            normalized = chunk.filePath.replace("\\", "/")
            basename = normalized.split("/")[-1]
            if basename not in stack_files:
                stack_files.append(basename)

        # 3. Semantic retrieval from ChromaDB
        retriever = HybridRetriever()
        candidates = retriever.retrieve(error_text)

        # 4. Hybrid re-ranking
        top5 = retriever.rerank(candidates, stack_files)

        # 5. Compute confidence from top result
        confidence = top5[0]["composite_score"] if top5 else 0.0

        # 6. Build structured LLM prompt
        raw_log_text = f"{bundle.raw_log.message}\nURL: {bundle.raw_log.url}\nTime: {bundle.raw_log.timestamp}"
        prompt = PromptBuilder.build(raw_log_text, bundle.stack_trace or "", top5)

        # 7. Call LLM for explanation
        llm_result = await call_llm(prompt)

        # 8. Validate and fill defaults
        validated = validate_llm_response(
            llm_result,
            top5,
            fallback_file=bundle.file_ref or "",
            fallback_line=bundle.line_ref or 0,
        )

        return AnalyzeResponse(
            root_cause_file=validated["root_cause_file"],
            root_cause_line=validated["root_cause_line"],
            error_summary=validated["error_summary"],
            detailed_explanation=validated["detailed_explanation"],
            confidence=round(confidence, 3),
            remediation_steps=validated["remediation_steps"],
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/index")
async def index_repo(payload: dict):
    """Trigger re-indexing of a repository path."""
    from indexer import index_repository
    repo_path = payload.get("repo_path", "../")
    try:
        index_repository(repo_path)
        return {"status": "indexed", "repo_path": repo_path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
