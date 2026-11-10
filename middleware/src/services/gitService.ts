import fs from 'fs';
import path from 'path';
import { simpleGit } from 'simple-git';

export interface StackFrame {
  functionName: string;
  file: string;
  lineNumber: number;
  columnNumber: number;
  language: string;
}

export interface GitBlameResult {
  commitHash: string;
  commitDate: string;
  author: string;
}

// V8 CDP: functionName@url:line:col
const V8_PATTERN = /^(.+?)@(.+):(\d+):(\d+)$/;
// Node.js / V8: at functionName (/path/file.js:line:col) or at /path/file.js:line:col
const NODE_PAREN_PATTERN = /^\s*at\s+(?:(.+?)\s+)?\((.+):(\d+):(\d+)\)$/;
const NODE_BARE_PATTERN = /^\s*at\s+(.+):(\d+):(\d+)$/;
// Java: at com.example.Class.method(File.java:42)
const JAVA_PATTERN = /^\s*at\s+([\w.$]+)\(([\w.]+):(\d+)\)$/;
// Python: File "/path/to/file.py", line 42, in function_name
const PYTHON_PATTERN = /^\s*File\s+"([^"]+)",\s+line\s+(\d+)(?:,\s+in\s+(.+))?$/;
// Go: /path/to/file.go:42 +0x1a2
const GO_PATTERN = /^\s*([\w/.\\-]+\.go):(\d+)/;

export function parseStackFrames(stackTrace: string): StackFrame[] {
  if (!stackTrace) return [];
  const lines = stackTrace.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const frames: StackFrame[] = [];

  for (const line of lines) {
    const frame = parseOneLine(line);
    if (frame) frames.push(frame);
  }

  return frames;
}

function parseOneLine(line: string): StackFrame | null {
  let m: RegExpMatchArray | null;

  // Python
  m = line.match(PYTHON_PATTERN);
  if (m) {
    return {
      functionName: m[3] || '(anonymous)',
      file: m[1],
      lineNumber: parseInt(m[2], 10),
      columnNumber: 0,
      language: 'python',
    };
  }

  // Java
  m = line.match(JAVA_PATTERN);
  if (m) {
    return {
      functionName: m[1],
      file: m[2],
      lineNumber: parseInt(m[3], 10),
      columnNumber: 0,
      language: 'java',
    };
  }

  // Node.js with parens
  m = line.match(NODE_PAREN_PATTERN);
  if (m) {
    return {
      functionName: m[1] || '(anonymous)',
      file: m[2],
      lineNumber: parseInt(m[3], 10),
      columnNumber: parseInt(m[4], 10),
      language: 'node',
    };
  }

  // Node.js bare
  m = line.match(NODE_BARE_PATTERN);
  if (m) {
    return {
      functionName: '(anonymous)',
      file: m[1],
      lineNumber: parseInt(m[2], 10),
      columnNumber: parseInt(m[3], 10),
      language: 'node',
    };
  }

  // V8 CDP
  m = line.match(V8_PATTERN);
  if (m) {
    return {
      functionName: m[1] || '(anonymous)',
      file: m[2],
      lineNumber: parseInt(m[3], 10),
      columnNumber: parseInt(m[4], 10),
      language: 'v8',
    };
  }

  // Go
  m = line.match(GO_PATTERN);
  if (m) {
    return {
      functionName: '(anonymous)',
      file: m[1],
      lineNumber: parseInt(m[2], 10),
      columnNumber: 0,
      language: 'go',
    };
  }

  return null;
}

export function resolveToRepoPath(
  fileRef: string,
  originPrefix: string = process.env.ORIGIN_PREFIX || 'http://localhost:3000/',
  repoPath: string = process.env.REPO_PATH || process.cwd()
): string {
  let relativePath = fileRef;

  if (originPrefix && fileRef.startsWith(originPrefix)) {
    relativePath = fileRef.slice(originPrefix.length);
  }

  relativePath = relativePath.replace(/^[/\\]+/, '');
  return path.resolve(repoPath, relativePath);
}

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
    relativePath,
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

  return { commitHash, commitDate, author };
}
