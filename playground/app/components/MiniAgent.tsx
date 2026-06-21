'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type LineKind = 'user' | 'agent' | 'system' | 'error';

interface Line {
  id: number;
  kind: LineKind;
  text: string;
}

const KIND_STYLE: Record<LineKind, string> = {
  user: 'text-cyan-300',
  agent: 'text-green-300',
  system: 'text-slate-400',
  error: 'text-red-400',
};

const KIND_PREFIX: Record<LineKind, string> = {
  user: '$ ',
  agent: '',
  system: '// ',
  error: '! ',
};

export default function MiniAgent() {
  const [task, setTask] = useState('');
  const [lines, setLines] = useState<Line[]>([
    {
      id: 0,
      kind: 'system',
      text: 'Mini AI Agent 已就绪。输入任务后按回车或点击发送。',
    },
  ]);
  const [loading, setLoading] = useState(false);

  const idRef = useRef(1);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [lines]);

  const pushLine = useCallback((kind: LineKind, text: string) => {
    setLines((prev) => [
      ...prev,
      { id: idRef.current++, kind, text },
    ]);
  }, []);

  const appendToLast = useCallback((delta: string) => {
    setLines((prev) => {
      if (prev.length === 0) {
        return [{ id: idRef.current++, kind: 'agent', text: delta }];
      }
      const last = prev[prev.length - 1];
      if (last.kind !== 'agent') {
        return [...prev, { id: idRef.current++, kind: 'agent', text: delta }];
      }
      const updated = { ...last, text: last.text + delta };
      return [...prev.slice(0, -1), updated];
    });
  }, []);

  const send = useCallback(async () => {
    const text = task.trim();
    if (!text || loading) return;

    pushLine('user', text);
    setTask('');
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: text }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const msg = await res.text().catch(() => '请求失败');
        pushLine('error', `HTTP ${res.status}: ${msg}`);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // 解析 SSE 流
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // 按空行分割事件
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          let event = 'message';
          let data = '';
          for (const line of part.split('\n')) {
            if (line.startsWith('event:')) {
              event = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              data += line.slice(5).trim();
            }
          }
          if (!data) continue;

          try {
            const payload = JSON.parse(data) as { content?: string; message?: string };
            if (event === 'delta' && payload.content) {
              appendToLast(payload.content);
            } else if (event === 'error') {
              pushLine('error', payload.message ?? '未知错误');
            } else if (event === 'done') {
              pushLine('system', '—— 完成 ——');
            }
          } catch {
            // 忽略解析错误
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        pushLine('system', '已中断');
      } else {
        pushLine(
          'error',
          err instanceof Error ? err.message : '网络错误'
        );
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [task, loading, pushLine, appendToLast]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-4 shadow-xl shadow-slate-200/50 sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-full bg-red-400" />
          <span className="inline-block h-3 w-3 rounded-full bg-yellow-400" />
          <span className="inline-block h-3 w-3 rounded-full bg-green-400" />
          <span className="ml-2 text-sm font-medium text-slate-600">
            mini-agent — deepseek-chat
          </span>
        </div>
        {loading && (
          <span className="flex items-center gap-2 text-xs text-slate-500">
            <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
            生成中…
          </span>
        )}
      </div>

      {/* 终端输出区 */}
      <div
        ref={scrollRef}
        className="h-80 overflow-auto rounded-xl bg-[#0b0f14] p-4 font-mono text-sm leading-relaxed sm:h-96"
      >
        {lines.map((line) => (
          <pre
            key={line.id}
            className={`whitespace-pre-wrap break-words ${KIND_STYLE[line.kind]}`}
          >
            {KIND_PREFIX[line.kind]}
            {line.text}
          </pre>
        ))}
        {loading && (
          <span className="inline-block h-4 w-2 animate-pulse bg-green-400 align-middle" />
        )}
      </div>

      {/* 输入区 */}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <textarea
          value={task}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder="输入你的任务…（Enter 发送，Shift+Enter 换行）"
          className="flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-sm text-slate-800 outline-none transition focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200"
        />
        <div className="flex gap-2 sm:flex-col">
          <button
            type="button"
            onClick={() => void send()}
            disabled={loading || !task.trim()}
            className="flex-1 rounded-xl bg-slate-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none"
          >
            发送
          </button>
          {loading && (
            <button
              type="button"
              onClick={stop}
              className="flex-1 rounded-xl border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100 sm:flex-none"
            >
              停止
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
