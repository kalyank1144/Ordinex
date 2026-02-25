import { z } from 'zod';

export const llmMessageSchema = z.object({
  model: z.string().default('claude-sonnet-4-20250514'),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.union([
      z.string(),
      z.array(z.object({
        type: z.string(),
        text: z.string().optional(),
        source: z.any().optional(),
      })),
    ]),
  })),
  system: z.string().optional(),
  max_tokens: z.number().int().min(1).max(64000).default(4096),
  temperature: z.number().min(0).max(1).optional(),
  stop_sequences: z.array(z.string()).optional(),
});

export type LlmMessageInput = z.infer<typeof llmMessageSchema>;
