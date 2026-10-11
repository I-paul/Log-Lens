import os
import glob
from datetime import datetime
import chromadb
from sentence_transformers import SentenceTransformer
import git

chroma_client = chromadb.PersistentClient(path="./chroma_db")
# Clear previous large collection if it exists
try:
    chroma_client.delete_collection("loglens_code_index")
except Exception:
    pass

collection = chroma_client.create_collection(name="loglens_code_index")
model = SentenceTransformer('all-mpnet-base-v2')

def chunk_text(text, chunk_size=512, overlap=64):
    words = text.split()
    if not words:
        return []
    chunks = []
    for i in range(0, len(words), chunk_size - overlap):
        chunk = " ".join(words[i:i + chunk_size])
        chunks.append(chunk)
        if i + chunk_size >= len(words):
            break
    return chunks

def index_repository(repo_path: str):
    repo = git.Repo(repo_path, search_parent_directories=True)
    git_root = repo.working_dir
    
    extensions = ["*.js", "*.jsx", "*.ts", "*.tsx", "*.py"]
    file_paths = []
    
    # Walk through directory, strictly ignoring node_modules, .git, venv, and dist
    for root, dirs, files in os.walk(repo_path):
        dirs[:] = [d for d in dirs if d not in ['node_modules', '.git', 'venv', '.dist', 'dist', 'build', '__pycache__']]
        for file in files:
            if any(file.endswith(ext.replace("*", "")) for ext in extensions):
                file_paths.append(os.path.join(root, file))

    documents = []
    metadatas = []
    ids = []
    doc_id_counter = 0

    for file_path in file_paths:
        relative_path = os.path.relpath(file_path, git_root)
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                content = f.read()
        except Exception:
            continue

        chunks = chunk_text(content)
        for idx, chunk in enumerate(chunks):
            try:
                commit_hash = repo.head.commit.hexsha
                commit_date = datetime.fromtimestamp(repo.head.commit.committed_date).isoformat()
            except Exception:
                commit_hash = "unknown"
                commit_date = datetime.now().isoformat()

            doc_id = f"doc_{doc_id_counter}"
            doc_id_counter += 1

            documents.append(chunk)
            metadatas.append({
                "filePath": relative_path,
                "chunkIndex": idx,
                "commitHash": commit_hash,
                "commitDate": commit_date
            })
            ids.append(doc_id)

    if documents:
        print(f"[Indexer] Encoding {len(documents)} clean source code chunks into 768-dim vector space...")
        embeddings = model.encode(documents, show_progress_bar=True).tolist()
        collection.add(documents=documents, embeddings=embeddings, metadatas=metadatas, ids=ids)
        print("[Indexer] Repository successfully indexed into ChromaDB.")
    else:
        print("[Indexer] No source code documents found to index.")

if __name__ == "__main__":
    target_repo = "../"
    index_repository(target_repo)