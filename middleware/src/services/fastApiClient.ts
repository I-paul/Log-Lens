import { LogBundle } from './bundlerService';

export interface AnalyzeResponse {
  root_cause_file: string;
  root_cause_line: number;
  error_summary: string;
  detailed_explanation: string;
  confidence: number;
  github_url: string | null;
  remediation_steps: string[];
}

function buildGitHubUrl(
  filePath: string,
  lineNumber: number,
  owner?: string,
  repo?: string,
  commitSha?: string
): string | null {
  if (!owner || !repo) return null;
  const normalizedPath = filePath.replace(/\\/g, '/');
  const ref = commitSha || 'main';
  return `https://github.com/${owner}/${repo}/blob/${ref}/${normalizedPath}#L${lineNumber}`;
}

export async function analyzeBundle(
  bundle: LogBundle,
  backendUrl: string = process.env.BACKEND_URL || 'http://localhost:8000'
): Promise<AnalyzeResponse> {
  const fallback: AnalyzeResponse = {
    root_cause_file: bundle.file_ref ?? 'unknown',
    root_cause_line: bundle.line_ref ?? 0,
    error_summary: 'Analysis unavailable — backend error',
    detailed_explanation: '',
    confidence: 0,
    github_url: null,
    remediation_steps: [],
  };

  const endpoint = `${backendUrl.replace(/\/+$/, '')}/analyze`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bundle),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[FastAPI Client] Backend returned status: ${response.status}`);
      return fallback;
    }

    const data = (await response.json()) as AnalyzeResponse;

    // Augment with GitHub URL if config is available
    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;
    const commitSha = process.env.GITHUB_COMMIT_SHA;
    if (!data.github_url && data.root_cause_file && data.root_cause_file !== 'unknown') {
      data.github_url = buildGitHubUrl(
        data.root_cause_file,
        data.root_cause_line,
        owner,
        repo,
        commitSha
      );
    }

    return data;
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[FastAPI Client] Error contacting backend:', msg);
    return fallback;
  }
}
