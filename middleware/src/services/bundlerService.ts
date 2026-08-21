import fs from 'fs';
import { IngestBrowserPayload } from '../schemas/ingest.schema';
import {
  parseStackFrame,
  resolveToRepoPath,
  getCodeChunk,
  getGitBlame,
  GitBlameResult
} from './gitService';

export interface CodeChunk {
  filePath: string;
  lineNumber: number;
  code: string;
  gitMeta: GitBlameResult;
}

export interface LogBundle {
  raw_log: IngestBrowserPayload;
  stack_trace: string;
  code_chunks: CodeChunk[];
  file_ref: string | null;
  line_ref: number | null;
}

/**
 * Creates a structured log bundle combining raw ingested payload, stack trace,
 * resolved code chunks (up to 5), Git blame metadata, and reference file/line pointers.
 */
export async function createBundle(
  payload: IngestBrowserPayload,
  originPrefix?: string,
  repoPath?: string
): Promise<LogBundle> {
  const stackTraceStr = payload.stackTrace || '';
  const lines = stackTraceStr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const codeChunks: CodeChunk[] = [];

  for (const line of lines) {
    if (codeChunks.length >= 5) break;

    try {
      const frame = parseStackFrame(line);
      if (!frame) continue;

      const resolvedPath = resolveToRepoPath(frame.url, originPrefix, repoPath);

      if (!fs.existsSync(resolvedPath)) continue;

      const code = await getCodeChunk(resolvedPath, frame.lineNumber);
      const gitMeta = await getGitBlame(resolvedPath, frame.lineNumber, repoPath);

      codeChunks.push({
        filePath: resolvedPath,
        lineNumber: frame.lineNumber,
        code,
        gitMeta
      });
    } catch {
      // Gracefully skip frames that fail resolution
      continue;
    }
  }

  const firstChunk = codeChunks[0] || null;

  return {
    raw_log: payload,
    stack_trace: stackTraceStr,
    code_chunks: codeChunks,
    file_ref: firstChunk ? firstChunk.filePath : null,
    line_ref: firstChunk ? firstChunk.lineNumber : null
  };
}
