import { analyzeBundle } from '../src/services/fastApiClient';
import { LogBundle } from '../src/services/bundlerService';

describe('fastApiClient Unit Tests', () => {
  const sampleBundle: LogBundle = {
    raw_log: {
      message: 'TypeError: undefined error',
      stackTrace: 'at App.js:10:5',
      url: 'http://localhost:3000/src/App.js',
      timestamp: '2026-08-07T12:00:00.000Z'
    },
    stack_trace: 'at App.js:10:5',
    code_chunks: [
      {
        filePath: '/src/App.js',
        lineNumber: 10,
        code: 'const x = undefined.foo;',
        gitMeta: {
          commitHash: '1234567890123456789012345678901234567890',
          commitDate: '2026-08-07T10:00:00.000Z',
          author: 'Alice'
        }
      }
    ],
    file_ref: '/src/App.js',
    line_ref: 10
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('(a) should return parsed AnalyzeResponse on successful backend call (HTTP 200)', async () => {
    const mockSuccessResponse = {
      summary: 'Null pointer dereference on object',
      file_ref: '/src/App.js',
      line_ref: 10,
      remediation_steps: ['Check object initialization before property access']
    };

    jest.spyOn(global, 'fetch').mockImplementation(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => mockSuccessResponse
      } as Response;
    });

    const result = await analyzeBundle(sampleBundle, 'http://localhost:8000');
    expect(result).toEqual(mockSuccessResponse);
  });

  it('(b) should return degraded fallback shape on backend error (HTTP 500)', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async () => {
      return {
        ok: false,
        status: 500,
        json: async () => ({ detail: 'Internal Server Error' })
      } as Response;
    });

    const result = await analyzeBundle(sampleBundle, 'http://localhost:8000');
    expect(result).toEqual({
      summary: 'Analysis unavailable — backend error',
      file_ref: '/src/App.js',
      line_ref: 10,
      remediation_steps: []
    });
  });

  it('(c) should return degraded fallback shape on network timeout / failure', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async () => {
      throw new Error('Network timeout / Connection refused');
    });

    const result = await analyzeBundle(sampleBundle, 'http://localhost:8000');
    expect(result).toEqual({
      summary: 'Analysis unavailable — backend error',
      file_ref: '/src/App.js',
      line_ref: 10,
      remediation_steps: []
    });
  });
});
