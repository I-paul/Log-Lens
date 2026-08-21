import express, { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { ingestBrowserSchema } from './schemas/ingest.schema';
import { createBundle } from './services/bundlerService';
import { analyzeBundle } from './services/fastApiClient';

const app = express();

app.use(express.json());

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

app.post('/ingest/browser', async (req: Request, res: Response) => {
  const result = ingestBrowserSchema.safeParse(req.body);

  if (!result.success) {
    res.status(400).json({
      error: 'Validation failed',
      details: result.error.issues
    });
    return;
  }

  const payload = result.data;
  const requestId = randomUUID();

  try {
    const bundle = await createBundle(payload);
    console.log(`[Ingest Browser] [${requestId}] Log bundle created:`, JSON.stringify(bundle));

    const analyzeResult = await analyzeBundle(bundle);
    console.log(`[Ingest Browser] [${requestId}] Analysis result:`, JSON.stringify(analyzeResult));

    res.status(200).json(analyzeResult);
  } catch (err) {
    console.error(`[Ingest Browser] [${requestId}] Error processing ingestion:`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default app;
