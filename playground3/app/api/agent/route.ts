import { NextRequest } from 'next/server';
import OpenAI from 'openai';

// Force dynamic rendering (SSE requires dynamic routes)
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Reuse OpenAI SDK to call the model API
const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY ?? '',
  baseURL: 'https://api.deepseek.com/v1',
});

const SYSTEM_PROMPT = `You are a concise and efficient Mini AI Agent.
Answer the user's questions or complete their tasks in a clear, structured way.
If a task requires multiple steps, explain them step by step.
Keep responses brief and to the point.`;

interface RequestBody {
  task?: string;
}

export async function POST(req: NextRequest) {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return new Response(JSON.stringify({ error: 'Request body is not valid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const task = body.task?.trim();
  if (!task) {
    return new Response(JSON.stringify({ error: 'task field is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!process.env.DEEPSEEK_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'Server API key is not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Create SSE stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      try {
        const completion = await client.chat.completions.create({
          model: 'deepseek-chat',
          stream: true,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: task },
          ],
        });

        for await (const chunk of completion) {
          const delta = chunk.choices?.[0]?.delta?.content ?? '';
          if (delta) {
            send('delta', { content: delta });
          }
        }

        send('done', { message: 'Complete' });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to generate response';
        send('error', { message });
      } finally {
        controller.close();
      }
    },
    cancel() {
      // Handled automatically when client disconnects
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
