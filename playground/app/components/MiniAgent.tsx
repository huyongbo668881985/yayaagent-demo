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
  const [examplesOpen, setExamplesOpen] = useState(false);

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
    setExamplesOpen(false);

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
    setExamplesOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const currentReasoning = getReasoningData(task);

  return (
    <div className="min-h-screen bg-gray-50 font-sans">

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <a
            href="https://yayaagent.com/playground/"
            className="text-gray-400 hover:text-violet-600 transition-colors text-sm flex items-center gap-1 mr-1"
          >
            ← Back
          </a>
          <span className="text-xl">🤖</span>
          <div>
            <h1 className="text-sm font-semibold text-gray-900 tracking-wide">Mini AI Agent</h1>
            <p className="text-xs text-gray-400">Think · Plan · Execute</p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5">
          <svg className="h-3.5 w-3.5 text-violet-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
          </svg>
          <span className="text-xs font-medium text-gray-700">Demo</span>
          <span className="text-xs text-gray-400">3 req/day</span>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">

        {/* Demo Notice */}
        <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3">
          <p className="text-xs leading-relaxed text-indigo-700">
            <span className="font-semibold">Demo Notice —</span> This is a lightweight demonstration. Real-world actions (browser control, file ops, workflow execution) require local deployment.
          </p>
        </div>

        {/* Main Chat Card */}
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">

          {/* Status bar */}
          <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between bg-gray-50">
            <div className="flex items-center gap-2">
              <span className={`inline-block h-2 w-2 rounded-full ${loading ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`} />
              <span className="text-xs text-gray-500">{loading ? 'Generating…' : 'Ready'}</span>
            </div>
          </div>

          {/* Chat Area */}
          <div
            ref={scrollRef}
            className="h-72 sm:h-96 overflow-auto bg-gradient-to-b from-slate-900 to-slate-800 p-4 text-sm leading-relaxed"
            style={{ boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.3)' }}
          >
            {lines.length === 0 && showEmptyState ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 ring-1 ring-white/10">
                  <svg className="h-6 w-6 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-white/80">Welcome to Mini AI Agent</p>
                <p className="mt-1 text-xs text-slate-400">Enter a task below or pick an example to begin.</p>
              </div>
            ) : (
              lines.map((line) => (
                <div
                  key={line.id}
                  className={`mb-3 ${
                    line.kind === 'user' ? 'text-right' : line.kind === 'system' ? 'text-center' : ''
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
                    <div className="prose prose-sm max-w-none text-slate-200">{line.text}</div>
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
            <div className="border-t border-gray-100 px-4 py-3">
              <button
                type="button"
                onClick={() => setThinkingOpen(!thinkingOpen)}
                className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs font-medium text-slate-700 transition-all hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
              >
                <div className="flex items-center gap-2">
                  <svg className={`h-3.5 w-3.5 text-indigo-400 transition-transform ${thinkingOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25z" />
                  </svg>
                  <span>Show Agent Reasoning</span>
                </div>
                <svg className={`h-3.5 w-3.5 transition-transform ${thinkingOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {thinkingOpen && (
                <div className="mt-2 space-y-3 rounded-lg border border-indigo-100 bg-indigo-50/50 p-3 text-xs">
                  {[
                    { label: 'Goal', color: 'indigo', content: currentReasoning.goal },
                    { label: 'Thinking', color: 'purple', content: currentReasoning.thinking },
                    { label: 'Execution', color: 'amber', content: currentReasoning.execution },
                    { label: 'Response', color: 'emerald', content: currentReasoning.response },
                  ].map(({ label, color, content }) => (
                    <div key={label}>
                      <span className={`text-[10px] font-bold uppercase tracking-wider text-${color}-600`}>{label}</span>
                      <p className="mt-0.5 text-slate-600">{content}</p>
                    </div>
                  ))}
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600">Plan</span>
                    <ol className="mt-0.5 list-inside list-decimal space-y-0.5 text-slate-600">
                      {currentReasoning.plan.map((step, i) => <li key={i}>{step}</li>)}
                    </ol>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Input Area */}
          <div className="border-t border-gray-100 p-4 space-y-3">

            {/* Example Tasks — collapsible */}
            <div>
              <button
                type="button"
                onClick={() => setExamplesOpen(!examplesOpen)}
                className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-violet-600 transition-colors"
              >
                <svg className={`h-3 w-3 transition-transform ${examplesOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
                Example tasks
              </button>
              {examplesOpen && (
                <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {EXAMPLE_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => handleExampleClick(prompt)}
                      className="group flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-left text-xs text-gray-600 transition-all hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700"
                    >
                      <svg className="h-3.5 w-3.5 shrink-0 text-gray-400 group-hover:text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                      </svg>
                      <span className="font-medium">{prompt}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Textarea + buttons */}
            <div className="flex gap-2">
              <textarea
                value={task}
                onChange={(e) => setTask(e.target.value)}
                onKeyDown={onKeyDown}
                rows={2}
                placeholder="Describe a task for the agent…"
                className="flex-1 resize-none rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-800 outline-none transition-all focus:border-violet-300 focus:bg-white focus:ring-2 focus:ring-violet-100"
              />
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={loading || !task.trim()}
                  className="rounded-xl bg-violet-600 hover:bg-violet-500 px-4 py-2 text-sm font-semibold text-white transition-all disabled:cursor-not-allowed disabled:opacity-40 flex-1"
                >
                  Send
                </button>
                {loading && (
                  <button
                    type="button"
                    onClick={stop}
                    className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-all"
                  >
                    Stop
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Deploy CTA */}
        <div className="border border-dashed border-gray-200 rounded-xl p-5 text-center">
          <p className="text-sm text-gray-500 font-semibold mb-1">Deploy Your Own AI Agent</p>
          <p className="text-xs text-gray-400 mb-3">Run agents with browser control, file ops, and tool integration on your own server.</p>
          <a
            href="https://yayaagent.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-semibold text-violet-600 hover:text-violet-500 transition-colors"
          >
            Learn how on YayaAgent.com →
          </a>
        </div>

      </div>
    </div>
  );
}
