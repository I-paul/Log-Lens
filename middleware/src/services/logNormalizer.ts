export interface NormalizedLogEntry {
  text: string;
  timestamp: string;
  severity: string;
}

type Platform = 'docker' | 'cloudwatch' | 'gcp' | 'plain';

const SEVERITY_KEYWORDS = ['FATAL', 'CRITICAL', 'ERROR', 'WARN', 'WARNING'];

function detectSeverity(text: string): string {
  const upper = text.toUpperCase();
  for (const level of SEVERITY_KEYWORDS) {
    if (upper.includes(level)) return level;
  }
  if (text.includes('Exception') || text.includes('Traceback') || text.includes('panic')) {
    return 'ERROR';
  }
  return 'INFO';
}

function detectPlatform(firstLine: string): Platform {
  const trimmed = firstLine.trim();
  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed);
      if ('log' in obj && 'stream' in obj) return 'docker';
      if ('message' in obj && 'ingestionTime' in obj) return 'cloudwatch';
      if ('jsonPayload' in obj || 'textPayload' in obj) return 'gcp';
    } catch {
      // not JSON
    }
  }
  return 'plain';
}

function parseLine(line: string, platform: Platform): NormalizedLogEntry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  if (platform === 'docker') {
    try {
      const obj = JSON.parse(trimmed);
      const text = (obj.log || '').replace(/\n$/, '');
      return { text, timestamp: obj.time || '', severity: detectSeverity(text) };
    } catch {
      return { text: trimmed, timestamp: '', severity: 'INFO' };
    }
  }

  if (platform === 'cloudwatch') {
    try {
      const obj = JSON.parse(trimmed);
      const msg = obj.message || trimmed;
      return { text: msg, timestamp: String(obj.timestamp || ''), severity: detectSeverity(msg) };
    } catch {
      return { text: trimmed, timestamp: '', severity: 'INFO' };
    }
  }

  if (platform === 'gcp') {
    try {
      const obj = JSON.parse(trimmed);
      let msg = '';
      if (obj.textPayload) {
        msg = obj.textPayload;
      } else if (obj.jsonPayload) {
        msg = obj.jsonPayload.message || JSON.stringify(obj.jsonPayload);
      }
      return { text: msg, timestamp: obj.timestamp || '', severity: obj.severity || detectSeverity(msg) };
    } catch {
      return { text: trimmed, timestamp: '', severity: 'INFO' };
    }
  }

  return { text: trimmed, timestamp: '', severity: detectSeverity(trimmed) };
}

export function normalizeLogs(rawText: string, platform?: Platform): NormalizedLogEntry[] {
  const lines = rawText.split(/\r?\n/);
  if (lines.length === 0) return [];

  const detectedPlatform = platform || detectPlatform(lines[0]);
  const entries: NormalizedLogEntry[] = [];

  for (const line of lines) {
    const entry = parseLine(line, detectedPlatform);
    if (entry) entries.push(entry);
  }

  return entries;
}
