import { analyzeBundle } from '../src/services/fastApiClient';
import { LogBundle } from '../src/services/bundlerService';

describe('fastApiClient Unit Tests', () => {
  const sampleBundle: LogBundle = {
    raw_log: {
      message: 'TypeError: undefined error',
      stackTrace: 'at App.js:10:5',
      url: 'http://localhost:3000/src/App.js',
      timestamp: '2026-08-07T12:00:00.000Z',
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
          author: 'Alice',
        },
      },
    ],
    file_ref: '/src/App.js',
    line_ref: 10,
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should return parsed AnalyzeResponse on successful backend call', async () => {
    const mockResponse = {
      root_cause_file: '/src/App.js',
      root_cause_line: 10,
      error_summary: 'Null pointer dereference',
      detailed_explanation: 'Accessing property on undefined object.',
      confidence: 0.85,
      github_url: null,
      remediation_steps: ['Check object initialization'],
    };

    jest.spyOn(global, 'fetch').mockImplementation(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => mockResponse,
      } as Response;
    });

    const result = await analyzeBundle(sampleBundle, 'http://localhost:8000');
    expect(result.root_cause_file).toBe('/src/App.js');
    expect(result.root_cause_line).toBe(10);
    expect(result.error_summary).toBe('Null pointer dereference');
    expect(result.remediation_steps).toHaveLength(1);
  });

  it('should return fallback on backend error (HTTP 500)', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async () => {
      return {
        ok: false,
        status: 500,
        json: async () => ({ detail: 'Internal Server Error' }),
      } as Response;
    });

    const result = await analyzeBundle(sampleBundle, 'http://localhost:8000');
    expect(result.error_summary).toBe('Analysis unavailable — backend error');
    expect(result.root_cause_file).toBe('/src/App.js');
    expect(result.root_cause_line).toBe(10);
  });

  it('should return fallback on network failure', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async () => {
      throw new Error('Connection refused');
    });

    const result = await analyzeBundle(sampleBundle, 'http://localhost:8000');
    expect(result.error_summary).toBe('Analysis unavailable — backend error');
    expect(result.remediation_steps).toEqual([]);
  });
});
