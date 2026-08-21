import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { simpleGit } from 'simple-git';
import { createBundle } from '../src/services/bundlerService';
import { IngestBrowserPayload } from '../src/schemas/ingest.schema';

const envTestPath = path.resolve(__dirname, '../.env.test');
dotenv.config({ path: envTestPath });

const fixtureDir = path.resolve(__dirname, '../test-fixtures/bundler-test-repo');

describe('bundlerService Unit Tests', () => {
  beforeAll(async () => {
    if (fs.existsSync(fixtureDir)) {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
    fs.mkdirSync(path.join(fixtureDir, 'src'), { recursive: true });

    // Create 6 files to test top 5 capping and frame resolution
    for (let i = 1; i <= 6; i++) {
      const content = [
        `// File ${i}`,
        `export function fn${i}() {`,
        `  console.log("In function ${i}");`,
        `  throw new Error("Error in fn${i}");`,
        `}`
      ].join('\n');
      fs.writeFileSync(path.join(fixtureDir, `src/file${i}.js`), content, 'utf-8');
    }

    const git = simpleGit({ baseDir: fixtureDir });
    await git.init();
    await git.addConfig('user.name', 'Bundle Author');
    await git.addConfig('user.email', 'bundle@example.com');
    await git.add('.');
    await git.commit('Add test files for bundlerService');
  });

  it('should create a valid bundle, resolving frames and capping code_chunks at 5', async () => {
    const originPrefix = 'http://localhost:3000/';

    // Construct a stack trace with:
    // 1. Unresolvable third-party frame (should be skipped)
    // 2. 6 resolvable frames (only first 5 resolved frames should be kept)
    const stackLines = [
      'thirdPartyFn@https://cdn.example.com/vendor.js:100:5',
      `fn1@http://localhost:3000/src/file1.js:4:3`,
      `fn2@http://localhost:3000/src/file2.js:4:3`,
      `fn3@http://localhost:3000/src/file3.js:4:3`,
      `fn4@http://localhost:3000/src/file4.js:4:3`,
      `fn5@http://localhost:3000/src/file5.js:4:3`,
      `fn6@http://localhost:3000/src/file6.js:4:3`
    ];

    const payload: IngestBrowserPayload = {
      message: 'Uncaught Error in fn1',
      stackTrace: stackLines.join('\n'),
      url: 'http://localhost:3000/src/file1.js',
      timestamp: '2026-08-07T11:00:00.000Z'
    };

    const bundle = await createBundle(payload, originPrefix, fixtureDir);

    expect(bundle.raw_log).toEqual(payload);
    expect(bundle.stack_trace).toBe(payload.stackTrace);

    // Assert top 5 capping and third-party skipping
    expect(bundle.code_chunks.length).toBe(5);

    const firstChunk = bundle.code_chunks[0];
    const expectedFirstPath = path.resolve(fixtureDir, 'src/file1.js');

    expect(firstChunk.filePath).toBe(expectedFirstPath);
    expect(firstChunk.lineNumber).toBe(4);
    expect(firstChunk.code).toContain('throw new Error("Error in fn1");');
    expect(firstChunk.gitMeta.author).toBe('Bundle Author');
    expect(firstChunk.gitMeta.commitHash).toMatch(/^[0-9a-f]{40}$/i);

    // Assert file_ref and line_ref match the top of code_chunks (first resolved frame)
    expect(bundle.file_ref).toBe(expectedFirstPath);
    expect(bundle.line_ref).toBe(4);
  });

  it('should return null for file_ref/line_ref and empty code_chunks when no frames resolve', async () => {
    const payload: IngestBrowserPayload = {
      message: 'Network Error',
      stackTrace: 'unresolvableFn@https://external.domain.com/lib.js:10:1',
      url: 'https://external.domain.com/app',
      timestamp: '2026-08-07T11:00:00.000Z'
    };

    const bundle = await createBundle(payload, 'http://localhost:3000/', fixtureDir);

    expect(bundle.code_chunks).toEqual([]);
    expect(bundle.file_ref).toBeNull();
    expect(bundle.line_ref).toBeNull();
  });
});
