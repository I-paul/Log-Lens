import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { simpleGit } from 'simple-git';
import {
  parseStackFrame,
  resolveToRepoPath,
  getCodeChunk,
  getGitBlame
} from '../src/services/gitService';

// Load test environment variables
const envTestPath = path.resolve(__dirname, '../.env.test');
dotenv.config({ path: envTestPath });

const fixtureDir = path.resolve(__dirname, '../test-fixtures/git-test-repo');

describe('gitService Unit Tests', () => {
  beforeAll(async () => {
    // Ensure test-fixtures/test-repo exists and clean it up if necessary
    if (fs.existsSync(fixtureDir)) {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
    fs.mkdirSync(path.join(fixtureDir, 'src'), { recursive: true });

    // Create sample files
    const appJsContent = [
      '// Line 1: Header comment',
      'import React from "react";',
      '',
      'export function App() {',
      '  const handleClick = () => {',
      '    throw new Error("Sample error");',
      '  };',
      '',
      '  return <button onClick={handleClick}>Click me</button>;',
      '}'
    ].join('\n');

    const utilsJsContent = [
      'export function add(a, b) {',
      '  return a + b;',
      '}'
    ].join('\n');

    fs.writeFileSync(path.join(fixtureDir, 'src/App.js'), appJsContent, 'utf-8');
    fs.writeFileSync(path.join(fixtureDir, 'src/utils.js'), utilsJsContent, 'utf-8');

    // Initialize git repository and commit files
    const git = simpleGit({ baseDir: fixtureDir });
    await git.init();
    await git.addConfig('user.name', 'Test Author');
    await git.addConfig('user.email', 'test@example.com');
    await git.add('.');
    await git.commit('Initial commit for testing');
  });

  describe('parseStackFrame', () => {
    it('should parse a standard V8 CDP stack frame line', () => {
      const line = 'renderApp@http://localhost:3000/src/App.js:6:9';
      const frame = parseStackFrame(line);

      expect(frame).toEqual({
        functionName: 'renderApp',
        url: 'http://localhost:3000/src/App.js',
        lineNumber: 6,
        columnNumber: 9
      });
    });

    it('should parse an anonymous V8 stack frame line', () => {
      const line = '(anonymous)@http://localhost:3000/src/App.js:12:3';
      const frame = parseStackFrame(line);

      expect(frame).toEqual({
        functionName: '(anonymous)',
        url: 'http://localhost:3000/src/App.js',
        lineNumber: 12,
        columnNumber: 3
      });
    });

    it('should parse a frame line without function name', () => {
      const line = 'http://localhost:3000/src/App.js:6:9';
      const frame = parseStackFrame(line);

      expect(frame).toEqual({
        functionName: '(anonymous)',
        url: 'http://localhost:3000/src/App.js',
        lineNumber: 6,
        columnNumber: 9
      });
    });

    it('should return null for an unparseable line', () => {
      expect(parseStackFrame('invalid stack trace string')).toBeNull();
    });
  });

  describe('resolveToRepoPath', () => {
    it('should map a browser URL to absolute repo path using ORIGIN_PREFIX', () => {
      const originPrefix = 'http://localhost:3000/';
      const url = 'http://localhost:3000/src/App.js';
      const resolved = resolveToRepoPath(url, originPrefix, fixtureDir);

      const expectedPath = path.resolve(fixtureDir, 'src/App.js');
      expect(resolved).toBe(expectedPath);
    });
  });

  describe('getCodeChunk', () => {
    it('should return code snippet centered on line number with context', async () => {
      const appJsPath = path.join(fixtureDir, 'src/App.js');
      const snippet = await getCodeChunk(appJsPath, 6, 2);

      expect(snippet).toContain('throw new Error("Sample error");');
      // Should include context lines (line 4 to line 8)
      expect(snippet).toContain('export function App() {');
    });
  });

  describe('getGitBlame', () => {
    it('should retrieve commit hash, commit date, and author for a target line', async () => {
      const appJsPath = path.join(fixtureDir, 'src/App.js');
      const blame = await getGitBlame(appJsPath, 6, fixtureDir);

      expect(blame.author).toBe('Test Author');
      expect(blame.commitHash).toMatch(/^[0-9a-f]{40}$/i);
      expect(typeof blame.commitDate).toBe('string');
      expect(new Date(blame.commitDate).getTime()).not.toBeNaN();
    });
  });
});
