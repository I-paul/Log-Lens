import os
import sys
from datetime import datetime
import chromadb
from sentence_transformers import SentenceTransformer
import git


EMBEDDING_MODEL = "all-MiniLM-L6-v2"
CHUNK_SIZE_LINES = 50
CHUNK_OVERLAP_LINES = 10
COLLECTION_NAME = "loglens_code_index"
CHROMA_PATH = "./chroma_db"

SOURCE_EXTENSIONS = {".js", ".jsx", ".ts", ".tsx", ".py", ".java", ".go", ".rb", ".rs"}
SKIP_DIRS = {"node_modules", ".git", "venv", ".venv", "dist", ".dist", "build", "__pycache__", ".next", ".cache"}


def line_chunk(lines: list[str], chunk_size: int = CHUNK_SIZE_LINES, overlap: int = CHUNK_OVERLAP_LINES) -> list[dict]:
    chunks = []
    step = chunk_size - overlap
    total = len(lines)
    for start in range(0, total, step):
        end = min(start + chunk_size, total)
        chunk_lines = lines[start:end]
        if not chunk_lines:
            break
        chunks.append({
            "text": "\n".join(chunk_lines),
            "start_line": start + 1,
            "end_line": start + len(chunk_lines),
        })
        if end >= total:
            break
    return chunks


def collect_source_files(repo_path: str) -> list[str]:
    file_paths = []
    for root, dirs, files in os.walk(repo_path):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for fname in files:
            ext = os.path.splitext(fname)[1].lower()
            if ext in SOURCE_EXTENSIONS:
                file_paths.append(os.path.join(root, fname))
    return file_paths


def get_file_commit_meta(repo: git.Repo, file_path: str) -> dict:
    try:
        commits = list(repo.iter_commits(paths=file_path, max_count=1))
        if commits:
            c = commits[0]
            return {
                "commitHash": c.hexsha,
                "commitDate": datetime.fromtimestamp(c.committed_date).isoformat(),
                "author": str(c.author),
            }
    except Exception:
        pass
    return {
        "commitHash": "unknown",
        "commitDate": datetime.now().isoformat(),
        "author": "unknown",
    }


def index_repository(repo_path: str):
    repo_path = os.path.abspath(repo_path)
    repo = git.Repo(repo_path, search_parent_directories=True)
    git_root = repo.working_dir

    print(f"[Indexer] Loading embedding model: {EMBEDDING_MODEL}")
    model = SentenceTransformer(EMBEDDING_MODEL)

    client = chromadb.PersistentClient(path=CHROMA_PATH)
    try:
        client.delete_collection(COLLECTION_NAME)
    except Exception:
        pass
    collection = client.create_collection(name=COLLECTION_NAME)

    file_paths = collect_source_files(repo_path)
    print(f"[Indexer] Found {len(file_paths)} source files to index")

    documents = []
    metadatas = []
    ids = []
    doc_counter = 0

    for file_path in file_paths:
        relative_path = os.path.relpath(file_path, git_root).replace("\\", "/")
        try:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
        except Exception:
            continue

        lines = content.split("\n")
        if not lines:
            continue

        commit_meta = get_file_commit_meta(repo, file_path)
        chunks = line_chunk(lines)

        for chunk in chunks:
            doc_id = f"doc_{doc_counter}"
            doc_counter += 1

            documents.append(chunk["text"])
            metadatas.append({
                "filePath": relative_path,
                "startLine": chunk["start_line"],
                "endLine": chunk["end_line"],
                "commitHash": commit_meta["commitHash"],
                "commitDate": commit_meta["commitDate"],
                "author": commit_meta["author"],
            })
            ids.append(doc_id)

    if not documents:
        print("[Indexer] No source code documents found to index.")
        return

    print(f"[Indexer] Encoding {len(documents)} code chunks into 384-dim vector space...")
    batch_size = 256
    for i in range(0, len(documents), batch_size):
        batch_end = min(i + batch_size, len(documents))
        batch_docs = documents[i:batch_end]
        batch_metas = metadatas[i:batch_end]
        batch_ids = ids[i:batch_end]

        embeddings = model.encode(batch_docs, show_progress_bar=True).tolist()
        collection.add(
            documents=batch_docs,
            embeddings=embeddings,
            metadatas=batch_metas,
            ids=batch_ids,
        )
        print(f"[Indexer] Indexed batch {i // batch_size + 1} ({batch_end}/{len(documents)} chunks)")

    print(f"[Indexer] Successfully indexed {len(documents)} chunks from {len(file_paths)} files into ChromaDB.")


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "../"
    index_repository(target)
