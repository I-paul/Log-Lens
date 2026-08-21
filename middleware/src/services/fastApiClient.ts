import { LogBundle } from './bundlerService';

export interface AnalyzeResponse {
  summary: string;
  file_ref: string;
  line_ref: number;
  remediation_steps: string[];
}

/**
 * Sends a LogBundle to the Python FastAPI backend (/analyze endpoint) with a 5s timeout.
 * Returns a degraded fallback object on network failures, timeouts, or backend error codes.
 */
export async function analyzeBundle(
  bundle: LogBundle,
  backendUrl: string = process.env.BACKEND_URL || 'http://localhost:8000'
): Promise<AnalyzeResponse> {
  const fallbackResponse: AnalyzeResponse = {
    summary: 'Analysis unavailable — backend error',
    file_ref: bundle.file_ref ?? 'unknown',
    line_ref: bundle.line_ref ?? 0,
    remediation_steps: []
  };

  const endpoint = `${backendUrl.replace(/\/+$/, '')}/analyze`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(bundle),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[FastAPI Client] Backend returned non-200 status code: ${response.status}`);
      return fallbackResponse;
    }

    const data = (await response.json()) as AnalyzeResponse;
    return data;
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('[FastAPI Client] Error contacting backend:', errorMessage);
    return fallbackResponse;
  }
}
