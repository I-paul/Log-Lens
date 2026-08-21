import { z } from 'zod';

export const ingestBrowserSchema = z.object({
  message: z.string({ required_error: 'message is required' }).min(1, 'message cannot be empty'),
  stackTrace: z.string().optional(),
  url: z.string({ required_error: 'url is required' }).min(1, 'url cannot be empty'),
  timestamp: z.union([z.string(), z.number()], {
    required_error: 'timestamp is required'
  })
});

export type IngestBrowserPayload = z.infer<typeof ingestBrowserSchema>;
