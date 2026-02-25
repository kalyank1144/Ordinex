import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import Anthropic from '@anthropic-ai/sdk';
import { llmMessageSchema } from '../schemas/llm.js';
import { logUsage, reserveCredits, settleCredits } from '../services/usageTracker.js';

export async function llmRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  function getClient(): Anthropic {
    if (!app.config.anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }
    return new Anthropic({ apiKey: app.config.anthropicApiKey });
  }

  function estimateReservation(body: { messages: unknown; system?: string; max_tokens: number }): number {
    const inputChars = JSON.stringify(body.messages).length + (body.system?.length || 0);
    const estimatedInputTokens = Math.ceil(inputChars / 4);
    return estimatedInputTokens + body.max_tokens;
  }

  server.post('/api/llm/messages', {
    preHandler: [app.authenticate],
    schema: { body: llmMessageSchema },
  }, async (request, reply) => {
    const userId = request.userId!;
    const { model, messages, system, max_tokens, temperature, stop_sequences, tools, tool_choice } = request.body;
    const reserved = estimateReservation({ messages, system, max_tokens });

    const remaining = await reserveCredits(app.db, userId, reserved);
    if (remaining < 0) {
      return reply.code(402).send({
        error: 'Insufficient credits',
        message: 'Please purchase additional credits to continue.',
      });
    }

    const client = getClient();
    const startTime = Date.now();

    try {
      const response = await client.messages.create({
        model,
        messages: messages as Anthropic.MessageCreateParams['messages'],
        ...(system && { system }),
        max_tokens,
        ...(temperature !== undefined && { temperature }),
        ...(stop_sequences && { stop_sequences }),
        ...(tools?.length && { tools: tools as Anthropic.Tool[] }),
        ...(tool_choice && { tool_choice: tool_choice as Anthropic.MessageCreateParams['tool_choice'] }),
      });

      const durationMs = Date.now() - startTime;
      const actualTokens = response.usage.input_tokens + response.usage.output_tokens;

      await settleCredits(app.db, userId, reserved, actualTokens);
      await logUsage(app.db, {
        userId,
        model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        endpoint: '/api/llm/messages',
        durationMs,
      });

      return reply.send(response);
    } catch (err: any) {
      await settleCredits(app.db, userId, reserved, 0);
      if (err?.status) {
        return reply.code(err.status).send({
          error: err.message || 'Anthropic API error',
        });
      }
      throw err;
    }
  });

  server.post('/api/llm/messages/stream', {
    preHandler: [app.authenticate],
    schema: { body: llmMessageSchema },
  }, async (request, reply) => {
    const userId = request.userId!;
    const { model, messages, system, max_tokens, temperature, stop_sequences, tools, tool_choice } = request.body;
    const reserved = estimateReservation({ messages, system, max_tokens });

    const remaining = await reserveCredits(app.db, userId, reserved);
    if (remaining < 0) {
      return reply.code(402).send({
        error: 'Insufficient credits',
        message: 'Please purchase additional credits to continue.',
      });
    }

    const client = getClient();
    const startTime = Date.now();

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    let inputTokens = 0;
    let outputTokens = 0;

    try {
      const stream = client.messages.stream({
        model,
        messages: messages as Anthropic.MessageCreateParams['messages'],
        ...(system && { system }),
        max_tokens,
        ...(temperature !== undefined && { temperature }),
        ...(stop_sequences && { stop_sequences }),
        ...(tools?.length && { tools: tools as Anthropic.Tool[] }),
        ...(tool_choice && { tool_choice: tool_choice as Anthropic.MessageCreateParams['tool_choice'] }),
      });

      stream.on('message', (message) => {
        inputTokens = message.usage.input_tokens;
        outputTokens = message.usage.output_tokens;
      });

      for await (const event of stream) {
        reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      }

      const durationMs = Date.now() - startTime;
      const actualTokens = inputTokens + outputTokens;

      await settleCredits(app.db, userId, reserved, actualTokens);
      await logUsage(app.db, {
        userId,
        model,
        inputTokens,
        outputTokens,
        endpoint: '/api/llm/messages/stream',
        durationMs,
      });

      reply.raw.write('event: done\ndata: {"type":"done"}\n\n');
      reply.raw.end();
    } catch (err: any) {
      await settleCredits(app.db, userId, reserved, 0);
      const errorEvent = {
        type: 'error',
        error: { message: err.message || 'Stream error' },
      };
      reply.raw.write(`event: error\ndata: ${JSON.stringify(errorEvent)}\n\n`);
      reply.raw.end();
    }
  });
}
