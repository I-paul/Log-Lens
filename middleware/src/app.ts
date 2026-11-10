import express, { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { ingestBrowserSchema } from './schemas/ingest.schema';
import { createBundle } from './services/bundlerService';
import { analyzeBundle } from './services/fastApiClient';

const app = express();

app.use(express.json({ limit: '1mb' }));

// CORS — allow requests from the Chrome extension and localhost
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (_req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

app.post('/ingest/browser', async (req: Request, res: Response) => {
  const result = ingestBrowserSchema.safeParse(req.body);

  if (!result.success) {
    res.status(400).json({
      error: 'Validation failed',
      details: result.error.issues,
    });
    return;
  }

  const payload = result.data;
  const requestId = randomUUID();

  try {
    const bundle = await createBundle(payload);
    console.log(`[Ingest] [${requestId}] Bundle created with ${bundle.code_chunks.length} code chunks`);

    const analyzeResult = await analyzeBundle(bundle);
    console.log(`[Ingest] [${requestId}] Analysis: ${analyzeResult.error_summary}`);

    res.status(200).json(analyzeResult);
  } catch (err) {
    console.error(`[Ingest] [${requestId}] Error:`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default app;
