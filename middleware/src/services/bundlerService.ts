import fs from 'fs';
import { IngestBrowserPayload } from '../schemas/ingest.schema';
import {
  parseStackFrames,
  resolveToRepoPath,
  getCodeChunk,
  getGitBlame,
  GitBlameResult,
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

export async function createBundle(
  payload: IngestBrowserPayload,
  originPrefix?: string,
  repoPath?: string
): Promise<LogBundle> {
  const stackTraceStr = payload.stackTrace || '';
  const frames = parseStackFrames(stackTraceStr);

  const codeChunks: CodeChunk[] = [];

  for (const frame of frames) {
    if (codeChunks.length >= 5) break;

    try {
      const resolvedPath = resolveToRepoPath(frame.file, originPrefix, repoPath);

      if (!fs.existsSync(resolvedPath)) continue;

      const code = await getCodeChunk(resolvedPath, frame.lineNumber);
      const gitMeta = await getGitBlame(resolvedPath, frame.lineNumber, repoPath);

      codeChunks.push({
        filePath: resolvedPath,
        lineNumber: frame.lineNumber,
        code,
        gitMeta,
      });
    } catch {
      continue;
    }
  }

  const firstChunk = codeChunks[0] || null;

  return {
    raw_log: payload,
    stack_trace: stackTraceStr,
    code_chunks: codeChunks,
    file_ref: firstChunk ? firstChunk.filePath : null,
    line_ref: firstChunk ? firstChunk.lineNumber : null,
  };
}
