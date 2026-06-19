import { NextRequest } from 'next/server';
import OpenAI from 'openai';

// 禁用静态渲染，确保该路由始终以动态方式运行（SSE 必须为动态）
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// 复用 OpenAI SDK 调用 DeepSeek（兼容 OpenAI 接口）
const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY ?? '',
  baseURL: 'https://api.deepseek.com/v1',
});

const SYSTEM_PROMPT = `你是一个简洁高效的 Mini AI Agent。
请用清晰、结构化的方式回答用户的问题或完成用户交给你的任务。
如果任务涉及多步骤，请分步骤说明。回答尽量精炼，避免冗长。`;

interface RequestBody {
  task?: string;
}

export async function POST(req: NextRequest) {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return new Response(JSON.stringify({ error: '请求体不是合法的 JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const task = body.task?.trim();
  if (!task) {
    return new Response(JSON.stringify({ error: 'task 字段不能为空' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!process.env.DEEPSEEK_API_KEY) {
    return new Response(
      JSON.stringify({ error: '服务端未配置 DEEPSEEK_API_KEY' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // 创建 SSE 流
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

        send('done', { message: '完成' });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : '调用 DeepSeek 失败';
        send('error', { message });
      } finally {
        controller.close();
      }
    },
    cancel() {
      // 客户端断开连接时由底层自动处理
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
