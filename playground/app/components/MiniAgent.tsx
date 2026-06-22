'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type LineKind = 'user' | 'agent' | 'system' | 'error';

interface Line {
  id: number;
  kind: LineKind;
  text: string;
}

const EXAMPLE_PROMPTS = [
  'Research a Company',
  'Create a Marketing Plan',
  'Design an Automation Workflow',
  'Analyze a Startup Idea',
  'Compare AI Agent Frameworks',
];

const SIMULATED_REASONING: Record<string, { goal: string; thinking: string; plan: string[]; execution: string; response: string }> = {
  'Research a Company': {
    goal: 'Research a Company',
    thinking: 'I need to gather comprehensive information about the company including financials, market position, competitors, and recent developments.',
    plan: [
      'Identify key company metrics and financial data',
      'Analyze market position and competitive landscape',
      'Review recent news and strategic developments',
      'Compile findings into a structured summary',
    ],
    execution: 'Gathering data from financial reports, market analysis, and news sources...',
    response: 'Presenting a comprehensive company research report with key insights.',
  },
  'Create a Marketing Plan': {
    goal: 'Create a Marketing Plan',
    thinking: 'I need to define the target audience, select appropriate channels, and build a structured marketing strategy with measurable goals.',
    plan: [
      'Define target audience and buyer personas',
      'Select optimal marketing channels',
      'Set budget allocation and KPIs',
      'Create content strategy and timeline',
    ],
    execution: 'Analyzing market segments, channel effectiveness, and budget optimization...',
    response: 'Delivering a complete marketing plan with actionable strategies and timelines.',
  },
  'Design an Automation Workflow': {
    goal: 'Design an Automation Workflow',
    thinking: 'I need to identify repetitive tasks, map out the workflow logic, and design an efficient automation solution.',
    plan: [
      'Identify tasks suitable for automation',
      'Map current workflow and pain points',
      'Design automated workflow logic',
      'Outline implementation steps and tools',
    ],
    execution: 'Analyzing task patterns and designing optimal automation sequences...',
    response: 'Presenting a complete automation workflow design with implementation guide.',
  },
  'Analyze a Startup Idea': {
    goal: 'Analyze a Startup Idea',
    thinking: 'I need to evaluate market viability, competitive position, business model, and potential risks.',
    plan: [
      'Assess market size and growth potential',
      'Analyze competitive landscape',
      'Evaluate business model and revenue streams',
      'Identify key risks and mitigation strategies',
    ],
    execution: 'Running market analysis, competitive research, and risk assessment...',
    response: 'Providing a thorough startup idea analysis with actionable recommendations.',
  },
  'Compare AI Agent Frameworks': {
    goal: 'Compare AI Agent Frameworks',
    thinking: 'I need to identify major AI agent frameworks, compare their features, strengths, and use cases.',
    plan: [
      'Identify leading AI agent frameworks',
      'Compare core features and capabilities',
      'Evaluate ease of use and integration',
      'Summarize recommendations by use case',
    ],
    execution: 'Researching framework documentation, community feedback, and feature comparisons...',
    response: 'Delivering a structured comparison of AI agent frameworks with recommendations.',
  },
};

export default function MiniAgent() {
  const [task, setTask] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [loading, setLoading] = useState(false);
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [showEmptyState, setShowEmptyState] = useState(true);

  const idRef = useRef(1);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [lines]);

  const pushLine = useCallback((kind: LineKind, text: string) => {
    setLines((prev) => [...prev, { id: idRef.current++, kind, text }]);
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

  const getReasoningData = (text: string) => {
    const key = Object.keys(SIMULATED_REASONING).find(
      (k) => text.toLowerCase().includes(k.toLowerCase())
    );
    return key ? SIMULATED_REASONING[key as keyof typeof SIMULATED_REASONING] : null;
  };

  const send = useCallback(async () => {
    const text = task.trim();
    if (!text || loading) return;

    setShowEmptyState(false);
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
        const msg = await res.text().catch(() => 'Request failed');
        pushLine('error', `Error ${res.status}: ${msg}`);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          let event = 'message';
          let data = '';
          for (const line of part.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          if (!data) continue;

          try {
            const payload = JSON.parse(data) as {
              content?: string;
              message?: string;
            };
            if (event === 'delta' && payload.content) {
              appendToLast(payload.content);
            } else if (event === 'error') {
              pushLine('error', payload.message ?? 'An unexpected error occurred');
            } else if (event === 'done') {
              pushLine('system', '— Complete —');
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        pushLine('system', 'Cancelled');
      } else {
        pushLine(
          'error',
          err instanceof Error ? err.message : 'Network error'
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

  const handleExampleClick = (prompt: string) => {
    setTask(prompt);
    setThinkingOpen(true);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const currentReasoning = getReasoningData(task);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      {/* Navigation */}
      <nav className="mb-8">
        <a
          href="https://yayaagent.com"
          target="_self"
          className="inline-flex items-center gap-1.5 text-sm text-slate-400 transition hover:text-indigo-500"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          Explore More Tools
        </a>
      </nav>

      {/* Header Section */}
      <header className="mb-8 text-center">
        <div className="mb-4 inline-flex items-center justify-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg shadow-indigo-200">
            <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
            </svg>
          </div>
          <h1 className="bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-3xl font-bold tracking-tight text-transparent sm:text-4xl">
            Mini AI Agent
          </h1>
        </div>
        <p className="mx-auto max-w-lg text-base text-slate-500">
          Experience how AI agents think, plan, and respond to tasks.
        </p>
      </header>

      {/* Demo Notice */}
      <div className="mb-6 rounded-xl border border-indigo-100 bg-gradient-to-r from-indigo-50 to-purple-50 px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600">
            <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-indigo-900">Demo Notice</p>
            <p className="mt-0.5 text-sm leading-relaxed text-indigo-700">
              This is a lightweight demonstration of agent behavior.
              Real-world actions such as browser control, file operations, workflow execution, and tool usage require local deployment.
            </p>
          </div>
        </div>
      </div>

      {/* Main Chat Card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-lg shadow-slate-200/60 ring-1 ring-slate-100 sm:p-6">
        {/* Status Bar + Usage Limit */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-gradient-to-r from-indigo-400 to-purple-500" />
            <span className="text-sm font-medium text-slate-500">Ready</span>
          </div>
          <div className="flex items-center gap-4">
            {loading && (
              <span className="flex items-center gap-2 text-xs text-slate-500">
                <span className="h-2 w-2 animate-pulse rounded-full bg-gradient-to-r from-indigo-400 to-purple-500" />
                Generating...
              </span>
            )}
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5">
              <svg className="h-3.5 w-3.5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
              <div className="text-xs">
                <span className="font-medium text-slate-700">Demo Limit</span>
                <span className="ml-1.5 text-slate-400">3 requests per day</span>
              </div>
            </div>
          </div>
        </div>

        {/* Chat Area */}
        <div
          ref={scrollRef}
          className="h-80 overflow-auto rounded-xl border border-slate-200/80 bg-gradient-to-b from-slate-900 to-slate-800 p-4 text-sm leading-relaxed shadow-inner sm:h-96"
          style={{ boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.3), 0 0 0 1px rgba(99,102,241,0.1)' }}
        >
          {lines.length === 0 && showEmptyState ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-white/5 ring-1 ring-white/10">
                <svg
                  className="h-7 w-7 text-indigo-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z"
                  />
                </svg>
              </div>
              <p className="text-base font-medium text-white/80">
                Welcome to Mini AI Agent.
              </p>
              <p className="mt-1 text-sm text-slate-400">
                Enter a task and click Send to begin.
              </p>
            </div>
          ) : (
            lines.map((line) => (
              <div
                key={line.id}
                className={`mb-3 ${
                  line.kind === 'user'
                    ? 'text-right'
                    : line.kind === 'system'
                    ? 'text-center'
                    : ''
                }`}
              >
                {line.kind === 'user' ? (
                  <span className="inline-block rounded-2xl bg-gradient-to-r from-indigo-500 to-purple-600 px-4 py-2 text-sm text-white shadow-lg shadow-indigo-500/20">
                    {line.text}
                  </span>
                ) : line.kind === 'system' ? (
                  <span className="text-xs text-slate-500">{line.text}</span>
                ) : line.kind === 'error' ? (
                  <div className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-300 ring-1 ring-red-500/20">
                    {line.text}
                  </div>
                ) : (
                  <div className="prose prose-sm max-w-none text-slate-200">
                    {line.text}
                  </div>
                )}
              </div>
            ))
          )}
          {loading && (
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 animate-bounce rounded-full bg-indigo-400" style={{ animationDelay: '0ms' }} />
              <span className="h-2 w-2 animate-bounce rounded-full bg-purple-400" style={{ animationDelay: '150ms' }} />
              <span className="h-2 w-2 animate-bounce rounded-full bg-indigo-400" style={{ animationDelay: '300ms' }} />
            </div>
          )}
        </div>

        {/* Agent Reasoning Panel */}
        {currentReasoning && (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setThinkingOpen(!thinkingOpen)}
              className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-left text-sm font-medium text-slate-700 transition-all hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
            >
              <div className="flex items-center gap-2">
                <svg className={`h-4 w-4 text-indigo-400 transition-transform ${thinkingOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25z" />
                </svg>
                <span>Show Agent Reasoning</span>
              </div>
              <svg
                className={`h-4 w-4 transition-transform ${
                  thinkingOpen ? 'rotate-180' : ''
                }`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {thinkingOpen && (
              <div className="mt-2 space-y-4 rounded-xl border border-indigo-100 bg-gradient-to-b from-indigo-50/50 to-white p-4 text-sm">
                <div>
                  <div className="mb-1 flex items-center gap-1.5">
                    <span className="flex h-5 w-5 items-center justify-center rounded-md bg-indigo-100 text-[10px] font-bold text-indigo-600">G</span>
                    <span className="text-xs font-semibold uppercase tracking-wider text-indigo-600">Goal</span>
                  </div>
                  <p className="ml-7 text-slate-700">{currentReasoning.goal}</p>
                </div>
                <div>
                  <div className="mb-1 flex items-center gap-1.5">
                    <span className="flex h-5 w-5 items-center justify-center rounded-md bg-purple-100 text-[10px] font-bold text-purple-600">T</span>
                    <span className="text-xs font-semibold uppercase tracking-wider text-purple-600">Thinking</span>
                  </div>
                  <p className="ml-7 text-slate-700">{currentReasoning.thinking}</p>
                </div>
                <div>
                  <div className="mb-1 flex items-center gap-1.5">
                    <span className="flex h-5 w-5 items-center justify-center rounded-md bg-blue-100 text-[10px] font-bold text-blue-600">P</span>
                    <span className="text-xs font-semibold uppercase tracking-wider text-blue-600">Planning</span>
                  </div>
                  <ol className="ml-7 list-inside list-decimal space-y-1 text-slate-700">
                    {currentReasoning.plan.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ol>
                </div>
                <div>
                  <div className="mb-1 flex items-center gap-1.5">
                    <span className="flex h-5 w-5 items-center justify-center rounded-md bg-amber-100 text-[10px] font-bold text-amber-600">E</span>
                    <span className="text-xs font-semibold uppercase tracking-wider text-amber-600">Execution</span>
                  </div>
                  <p className="ml-7 text-slate-700">{currentReasoning.execution}</p>
                </div>
                <div>
                  <div className="mb-1 flex items-center gap-1.5">
                    <span className="flex h-5 w-5 items-center justify-center rounded-md bg-emerald-100 text-[10px] font-bold text-emerald-600">R</span>
                    <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600">Response</span>
                  </div>
                  <p className="ml-7 text-slate-700">{currentReasoning.response}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Example Tasks Section */}
        <div className="mt-6">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Example Tasks
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {EXAMPLE_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => handleExampleClick(prompt)}
                className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm text-slate-600 shadow-sm transition-all hover:border-indigo-200 hover:bg-indigo-50/50 hover:text-indigo-700 hover:shadow-md"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-50 to-purple-50 group-hover:from-indigo-100 group-hover:to-purple-100">
                  <svg className="h-4 w-4 text-indigo-400 group-hover:text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                  </svg>
                </div>
                <span className="font-medium">{prompt}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Input Area */}
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <textarea
            value={task}
            onChange={(e) => setTask(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            placeholder="Describe a task for the agent..."
            className="flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none transition-all focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100"
          />
          <div className="flex gap-2 sm:flex-col">
            <button
              type="button"
              onClick={() => void send()}
              disabled={loading || !task.trim()}
              className="flex-1 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 px-5 py-3 text-sm font-medium text-white shadow-lg shadow-indigo-500/20 transition-all hover:from-indigo-600 hover:to-purple-700 hover:shadow-xl hover:shadow-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none sm:flex-none"
            >
              Send
            </button>
            {loading && (
              <button
                type="button"
                onClick={stop}
                className="flex-1 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-medium text-slate-700 shadow-sm transition-all hover:border-slate-400 hover:bg-slate-50 sm:flex-none"
              >
                Stop
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Deploy Your Own AI Agent - CTA Section */}
      <div className="mt-10 overflow-hidden rounded-2xl border border-indigo-100 bg-gradient-to-br from-white to-indigo-50/50 px-6 py-8 shadow-lg shadow-indigo-100/50 sm:px-8">
        <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex-1">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-indigo-100 to-purple-100 px-3 py-1 text-xs font-semibold text-indigo-700">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
              Production Ready
            </div>
            <h3 className="text-xl font-bold text-slate-900 sm:text-2xl">
              Deploy Your Own AI Agent
            </h3>
            <p className="mt-2 max-w-lg text-sm leading-relaxed text-slate-500">
              Run AI agents on your own computer or server with advanced capabilities including browser automation, file operations, workflow execution, and tool integration.
            </p>
          </div>
          <a
            href="/guide/deploy-agent"
            className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 px-6 py-3 text-sm font-medium text-white shadow-lg shadow-indigo-500/20 transition-all hover:from-indigo-600 hover:to-purple-700 hover:shadow-xl hover:shadow-indigo-500/30"
          >
            Installation Guide
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </a>
        </div>
      </div>

      {/* Footer Note */}
      <footer className="mt-10 text-center">
        <p className="text-xs text-slate-400">
          Mini AI Agent is part of the YayaAgent learning ecosystem.
        </p>
      </footer>
    </div>
  );
}
