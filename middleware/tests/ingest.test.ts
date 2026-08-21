import request from 'supertest';
import app from '../src/app';

describe('Middleware Integration Tests', () => {
  describe('GET /health', () => {
    it('should return status 200 and { status: "ok" }', async () => {
      const response = await request(app).get('/health');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'ok' });
    });
  });

  describe('POST /ingest/browser', () => {
    it('should return 200 and AnalyzeResponse shape when payload is valid', async () => {
      const validPayload = {
        message: 'Uncaught TypeError: Cannot read properties of undefined',
        stackTrace: 'TypeError: Cannot read properties of undefined\n    at main.js:42:12',
        url: 'https://example.com/app',
        timestamp: '2026-07-29T10:25:00.000Z'
      };

      const response = await request(app)
        .post('/ingest/browser')
        .send(validPayload);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('summary');
      expect(response.body).toHaveProperty('file_ref');
      expect(response.body).toHaveProperty('line_ref');
      expect(response.body).toHaveProperty('remediation_steps');
    });

    it('should return 400 when payload is invalid (missing message)', async () => {
      const invalidPayload = {
        stackTrace: 'TypeError: null is not an object',
        url: 'https://example.com/app',
        timestamp: '2026-07-29T10:25:00.000Z'
      };

      const response = await request(app)
        .post('/ingest/browser')
        .send(invalidPayload);

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Validation failed');
      expect(response.body).toHaveProperty('details');
      expect(Array.isArray(response.body.details)).toBe(true);
    });
  });
});
