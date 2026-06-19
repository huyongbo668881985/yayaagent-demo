import MiniAgent from './components/MiniAgent';

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 px-4 py-10 sm:py-16">
      <header className="mx-auto mb-8 max-w-3xl text-center">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Mini AI Agent
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          基于 Next.js + DeepSeek + SSE 流式输出的轻量 Agent
        </p>
      </header>
      <MiniAgent />
    </main>
  );
}
