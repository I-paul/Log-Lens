import fs from 'fs';
import path from 'path';
import { simpleGit } from 'simple-git';

export interface StackFrame {
  functionName: string;
  url: string;
  lineNumber: number;
  columnNumber: number;
}

export interface GitBlameResult {
  commitHash: string;
  commitDate: string;
  author: string;
}

/**
 * Parses Chrome V8 CDP stack frame format `functionName@url:line:col`
 */
export function parseStackFrame(stackTraceLine: string): StackFrame | null {
  if (!stackTraceLine) return null;
  const trimmed = stackTraceLine.trim();

  const atIndex = trimmed.lastIndexOf('@');
  let functionName = '(anonymous)';
  let urlAndPos = trimmed;

  if (atIndex !== -1) {
    functionName = trimmed.slice(0, atIndex) || '(anonymous)';
    urlAndPos = trimmed.slice(atIndex + 1);
  }

  const match = urlAndPos.match(/^(.+):(\d+):(\d+)$/);
  if (!match) return null;

  return {
    functionName,
    url: match[1],
    lineNumber: parseInt(match[2], 10),
    columnNumber: parseInt(match[3], 10)
  };
}

/**
 * Maps a captured browser URL to a REPO_PATH-relative (or absolute) file path by prefix-stripping ORIGIN_PREFIX.
 */
export function resolveToRepoPath(
  url: string,
  originPrefix: string = process.env.ORIGIN_PREFIX || 'http://localhost:3000/',
  repoPath: string = process.env.REPO_PATH || process.cwd()
): string {
  let relativePath = url;

  if (originPrefix && url.startsWith(originPrefix)) {
    relativePath = url.slice(originPrefix.length);
  }

  relativePath = relativePath.replace(/^[/\\]+/, '');

  return path.resolve(repoPath, relativePath);
}

/**
 * Reads a file and returns a code snippet centered on lineNumber +/- contextLines.
 */
export async function getCodeChunk(
  filePath: string,
  lineNumber: number,
  contextLines: number = 20
): Promise<string> {
  const fileContent = await fs.promises.readFile(filePath, 'utf-8');
  const lines = fileContent.split(/\r?\n/);

  const start = Math.max(0, lineNumber - 1 - contextLines);
  const end = Math.min(lines.length, lineNumber - 1 + contextLines + 1);

  return lines.slice(start, end).join('\n');
}

/**
 * Runs `git blame -L line,line --porcelain` on a file in repoPath and returns commit metadata.
 */
export async function getGitBlame(
  filePath: string,
  lineNumber: number,
  repoPath: string = process.env.REPO_PATH || process.cwd()
): Promise<GitBlameResult> {
  const git = simpleGit({ baseDir: repoPath });

  const relativePath = path.isAbsolute(filePath)
    ? path.relative(repoPath, filePath)
    : filePath;

  const rawOutput = await git.raw([
    'blame',
    '-L',
    `${lineNumber},${lineNumber}`,
    '--porcelain',
    relativePath
  ]);

  const lines = rawOutput.split(/\r?\n/);
  const firstLine = lines[0] || '';
  const commitHash = firstLine.split(' ')[0] || '';

  let author = 'Unknown';
  let authorTime = 0;

  for (const line of lines) {
    if (line.startsWith('author ')) {
      author = line.slice('author '.length).trim();
    } else if (line.startsWith('author-time ')) {
      authorTime = parseInt(line.slice('author-time '.length).trim(), 10);
    }
  }

  const commitDate = authorTime
    ? new Date(authorTime * 1000).toISOString()
    : new Date().toISOString();

  return {
    commitHash,
    commitDate,
    author
  };
}
