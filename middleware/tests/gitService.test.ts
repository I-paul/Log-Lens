import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { simpleGit } from 'simple-git';
import {
  parseStackFrames,
  resolveToRepoPath,
  getCodeChunk,
  getGitBlame,
} from '../src/services/gitService';

const envTestPath = path.resolve(__dirname, '../.env.test');
dotenv.config({ path: envTestPath });

const fixtureDir = path.resolve(__dirname, '../test-fixtures/git-test-repo');

describe('gitService Unit Tests', () => {
  beforeAll(async () => {
    if (fs.existsSync(fixtureDir)) {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
    fs.mkdirSync(path.join(fixtureDir, 'src'), { recursive: true });

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
      '}',
    ].join('\n');

    const utilsJsContent = [
      'export function add(a, b) {',
      '  return a + b;',
      '}',
    ].join('\n');

    fs.writeFileSync(path.join(fixtureDir, 'src/App.js'), appJsContent, 'utf-8');
    fs.writeFileSync(path.join(fixtureDir, 'src/utils.js'), utilsJsContent, 'utf-8');

    const git = simpleGit({ baseDir: fixtureDir });
    await git.init();
    await git.addConfig('user.name', 'Test Author');
    await git.addConfig('user.email', 'test@example.com');
    await git.add('.');
    await git.commit('Initial commit for testing');
  });

  describe('parseStackFrames', () => {
    it('should parse V8 CDP stack frame lines', () => {
      const stack = 'renderApp@http://localhost:3000/src/App.js:6:9\ninit@http://localhost:3000/src/utils.js:1:5';
      const frames = parseStackFrames(stack);

      expect(frames).toHaveLength(2);
      expect(frames[0]).toMatchObject({
        functionName: 'renderApp',
        file: 'http://localhost:3000/src/App.js',
        lineNumber: 6,
        language: 'v8',
      });
    });

    it('should parse Node.js stack frames with parens', () => {
      const stack = '    at Object.<anonymous> (/home/user/app/index.js:42:10)';
      const frames = parseStackFrames(stack);

      expect(frames).toHaveLength(1);
      expect(frames[0]).toMatchObject({
        file: '/home/user/app/index.js',
        lineNumber: 42,
        language: 'node',
      });
    });

    it('should parse Python stack frames', () => {
      const stack = '  File "/app/server.py", line 55, in handle_request';
      const frames = parseStackFrames(stack);

      expect(frames).toHaveLength(1);
      expect(frames[0]).toMatchObject({
        file: '/app/server.py',
        lineNumber: 55,
        language: 'python',
      });
    });

    it('should parse Java stack frames', () => {
      const stack = '    at com.example.App.main(App.java:10)';
      const frames = parseStackFrames(stack);

      expect(frames).toHaveLength(1);
      expect(frames[0]).toMatchObject({
        file: 'App.java',
        lineNumber: 10,
        language: 'java',
      });
    });

    it('should return empty array for unparseable text', () => {
      expect(parseStackFrames('just some random text')).toEqual([]);
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
