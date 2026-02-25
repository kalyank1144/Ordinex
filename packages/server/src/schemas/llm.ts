import { z } from 'zod';

const toolInputSchema = z.object({
  type: z.string().optional(),
  properties: z.record(z.any()).optional(),
  required: z.array(z.string()).optional(),
}).passthrough();

const toolSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  input_schema: toolInputSchema,
  strict: z.boolean().optional(),
}).passthrough();

const toolChoiceSchema = z.union([
  z.object({ type: z.literal('auto') }),
  z.object({ type: z.literal('any') }),
  z.object({ type: z.literal('tool'), name: z.string() }),
]);

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
        id: z.string().optional(),
        name: z.string().optional(),
        input: z.any().optional(),
        tool_use_id: z.string().optional(),
        content: z.any().optional(),
      }).passthrough()),
    ]),
  })),
  system: z.string().optional(),
  max_tokens: z.number().int().min(1).max(64000).default(4096),
  temperature: z.number().min(0).max(1).optional(),
  stop_sequences: z.array(z.string()).optional(),
  tools: z.array(toolSchema).optional(),
  tool_choice: toolChoiceSchema.optional(),
});

export type LlmMessageInput = z.infer<typeof llmMessageSchema>;
