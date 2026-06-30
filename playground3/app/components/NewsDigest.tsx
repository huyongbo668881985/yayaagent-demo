'use client';

import { useState } from 'react';

const DAILY_LIMIT = 5;
const STORAGE_KEY = 'news_digest_sends';

function getTodayKey(email: string) {
  const today = new Date().toISOString().slice(0, 10);
  return `${email}__${today}`;
}

function getUsedCount(email: string): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const store = raw ? JSON.parse(raw) : {};
    return store[getTodayKey(email)] ?? 0;
  } catch { return 0; }
}

function incrementUsed(email: string) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const store = raw ? JSON.parse(raw) : {};
    const key = getTodayKey(email);
    store[key] = (store[key] ?? 0) + 1;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {}
}

type StepStatus = 'idle' | 'running' | 'done' | 'error';

interface Step {
  id: string;
  label: string;
  detail: string;
  status: StepStatus;
}

const INITIAL_STEPS: Step[] = [
  { id: 'receive',  label: 'Receive topic',        detail: 'Parsing your request…',              status: 'idle' },
  { id: 'search',   label: 'Search news',           detail: 'Querying Tavily for top stories…',   status: 'idle' },
  { id: 'fetch',    label: 'Fetch article content', detail: 'Extracting full article text…',      status: 'idle' },
  { id: 'summarize',label: 'AI summarization',      detail: 'Gemini 2.5 Flash analyzing content…',status: 'idle' },
  { id: 'send',     label: 'Send to email',         detail: 'Delivering digest via Resend…',      status: 'idle' },
];

function StepNode({ step, index }: { step: Step; index: number }) {
  const colors = {
    idle:    { ring: 'border-gray-200',   bg: 'bg-gray-50',     num: 'text-gray-400',   label: 'text-gray-400', detail: 'text-gray-300' },
    running: { ring: 'border-violet-300', bg: 'bg-violet-50',   num: 'text-violet-600', label: 'text-violet-700', detail: 'text-violet-400' },
    done:    { ring: 'border-emerald-200',bg: 'bg-emerald-50',  num: 'text-emerald-600',label: 'text-gray-700', detail: 'text-emerald-500' },
    error:   { ring: 'border-red-200',    bg: 'bg-red-50',      num: 'text-red-500',    label: 'text-red-600',  detail: 'text-red-400' },
  };
  const c = colors[step.status];

  return (
    <div className={`flex items-start gap-3 rounded-xl border ${c.ring} ${c.bg} px-4 py-3 transition-all duration-300`}>
      <div className={`shrink-0 w-6 h-6 rounded-full border-2 ${c.ring} flex items-center justify-center`}>
        {step.status === 'done' ? (
          <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : step.status === 'running' ? (
          <span className="w-2 h-2 rounded-full bg-violet-500 animate-pulse" />
        ) : step.status === 'error' ? (
          <span className={`text-xs font-bold ${c.num}`}>!</span>
        ) : (
          <span className={`text-xs font-semibold ${c.num}`}>{index + 1}</span>
        )}
      </div>
      <div className="min-w-0">
        <p className={`text-sm font-semibold ${c.label}`}>{step.label}</p>
        <p className={`text-xs mt-0.5 ${c.detail}`}>{step.detail}</p>
      </div>
    </div>
  );
}

export default function NewsDigest() {
  const [topic, setTopic] = useState('');
  const [email, setEmail] = useState('');
  const [steps, setSteps] = useState<Step[]>(INITIAL_STEPS);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [done, setDone] = useState(false);

  function updateStep(id: string, status: StepStatus, detail?: string) {
    setSteps(prev => prev.map(s =>
      s.id === id ? { ...s, status, ...(detail ? { detail } : {}) } : s
    ));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    setError('');
    setResult(null);
    setDone(false);

    if (!topic.trim()) { setFormError('Please enter a topic.'); return; }
    if (!email.includes('@')) { setFormError('Please enter a valid email.'); return; }

    const used = getUsedCount(email);
    if (used >= DAILY_LIMIT) {
      setFormError(`Daily limit reached (${DAILY_LIMIT}/day). Try again tomorrow.`);
      return;
    }

    setRunning(true);
    setSteps(INITIAL_STEPS);

    // Step 1: receive
    updateStep('receive', 'running');
    await new Promise(r => setTimeout(r, 400));
    updateStep('receive', 'done', `Topic: "${topic.trim()}"`);

    // Step 2: search
    updateStep('search', 'running');

    try {
      const res = await fetch('/api/news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: topic.trim(), email }),
      });

      // Step 3 & 4 & 5 are handled server-side; we stream step updates via SSE
      if (!res.ok || !res.body) {
        const msg = await res.text().catch(() => 'Request failed');
        updateStep('search', 'error', msg);
        setError(msg);
        setRunning(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          let event = '';
          let data = '';
          for (const line of part.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) data = line.slice(5).trim();
          }
          if (!data) continue;

          try {
            const payload = JSON.parse(data);

            if (event === 'step') {
              updateStep(payload.id, payload.status, payload.detail);
            } else if (event === 'result') {
              setResult(payload.summary);
              incrementUsed(email);
              const remaining = DAILY_LIMIT - used - 1;
              updateStep('send', 'done', `Sent to ${email} (${remaining} left today)`);
              setDone(true);
            } else if (event === 'error') {
              setError(payload.message);
              // mark current running step as error
              setSteps(prev => prev.map(s => s.status === 'running' ? { ...s, status: 'error' } : s));
            }
          } catch {}
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
      setSteps(prev => prev.map(s => s.status === 'running' ? { ...s, status: 'error' } : s));
    } finally {
      setRunning(false);
    }
  }

  function handleReset() {
    setTopic('');
    setSteps(INITIAL_STEPS);
    setResult(null);
    setError('');
    setDone(false);
  }

  const EXAMPLE_TOPICS = ['AI Agents', 'Bitcoin', 'OpenAI', 'n8n automation', 'Solana DeFi'];

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
          <span className="text-xl">📰</span>
          <div>
            <h1 className="text-sm font-semibold text-gray-900 tracking-wide">AI News Digest</h1>
            <p className="text-xs text-gray-400">Search · Summarize · Deliver</p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5">
          <span className="text-xs font-medium text-gray-700">Demo</span>
          <span className="text-xs text-gray-400">{DAILY_LIMIT} req/day</span>
        </div>
      </div>

      <div className="max-w-xl mx-auto px-4 py-8 space-y-5">

        {/* Form */}
        {!running && !done && (
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Get a News Digest</h2>
            <form onSubmit={handleSubmit} className="space-y-4">

              {/* Topic input */}
              <div>
                <input
                  type="text"
                  placeholder="Enter a topic, e.g. AI Agents"
                  value={topic}
                  onChange={e => setTopic(e.target.value)}
                  disabled={running}
                  className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:border-violet-400 placeholder-gray-300"
                />
                {/* Example topics */}
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {EXAMPLE_TOPICS.map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTopic(t)}
                      className="text-xs px-2.5 py-1 rounded-full border border-gray-200 text-gray-500 hover:border-violet-300 hover:text-violet-600 transition-colors"
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* Email */}
              <input
                type="email"
                placeholder="your@email.com — digest will be sent here"
                value={email}
                onChange={e => setEmail(e.target.value)}
                disabled={running}
                className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:border-violet-400 placeholder-gray-300"
              />

              {formError && <p className="text-red-500 text-xs">{formError}</p>}

              <button
                type="submit"
                disabled={running}
                className="w-full bg-violet-600 hover:bg-violet-500 text-white font-semibold rounded-xl py-2.5 text-sm transition-colors disabled:opacity-50"
              >
                Generate & Send Digest →
              </button>
            </form>

            <p className="mt-3 text-xs text-gray-400 leading-relaxed">
              The agent will search today's news, summarize with AI, and email you a briefing. Up to {DAILY_LIMIT} digests per address per day.
            </p>
          </div>
        )}

        {/* Step nodes — shown while running or after done */}
        {(running || done || error) && (
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-2">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Agent Steps
            </h2>
            {steps.map((step, i) => (
              <StepNode key={step.id} step={step} index={i} />
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-600">
            {error}
          </div>
        )}

        {/* Result preview */}
        {result && (
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Digest Preview
            </h2>
            <div className="prose prose-sm max-w-none text-gray-700 whitespace-pre-wrap text-sm leading-relaxed">
              {result}
            </div>
          </div>
        )}

        {/* Done state */}
        {done && (
          <div className="space-y-3">
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm text-emerald-700 text-center">
              ✅ Digest sent to <span className="font-semibold">{email}</span>
            </div>
            <button
              onClick={handleReset}
              className="w-full border border-gray-200 rounded-xl py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Run another digest →
            </button>
          </div>
        )}

        {/* CTA */}
        <div className="border border-dashed border-gray-200 rounded-xl p-5 text-center">
          <p className="text-xs text-gray-400 leading-relaxed mb-3">
            Want scheduled digests every morning? Deploy your own with n8n + Tavily + Gmail.
          </p>
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
