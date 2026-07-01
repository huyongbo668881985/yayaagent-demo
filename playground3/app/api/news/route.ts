import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

function sse(event: string, data: object) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: object) {
        controller.enqueue(encoder.encode(sse(event, data)));
      }

      try {
        const { topic, email } = await req.json();

        if (!topic || !email) {
          send('error', { message: 'Missing topic or email.' });
          controller.close();
          return;
        }

        // ── Step: search ──────────────────────────────────────────────
        send('step', { id: 'search', status: 'running', detail: 'Searching Tavily for latest news…' });

        const tavilyRes = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: process.env.TAVILY_API_KEY,
            query: topic,
            search_depth: 'basic',
            include_answer: false,
            include_raw_content: false,
            max_results: 6,
            topic: 'news',
          }),
        });

        if (!tavilyRes.ok) {
          const errText = await tavilyRes.text();
          send('step', { id: 'search', status: 'error', detail: `Search failed: ${errText}` });
          send('error', { message: 'Tavily search failed. Check your API key.' });
          controller.close();
          return;
        }

        const tavilyData = await tavilyRes.json();
        const results = tavilyData.results ?? [];

        if (results.length === 0) {
          send('step', { id: 'search', status: 'error', detail: 'No results found.' });
          send('error', { message: 'No news found for this topic. Try a different one.' });
          controller.close();
          return;
        }

        send('step', { id: 'search', status: 'done', detail: `Found ${results.length} articles` });

        // ── Step: fetch ───────────────────────────────────────────────
        send('step', { id: 'fetch', status: 'running', detail: 'Extracting article content…' });

        const articles = results.map((r: { title: string; url: string; content: string; published_date?: string }) => ({
          title: r.title,
          url: r.url,
          content: r.content?.slice(0, 800) ?? '',
          date: r.published_date ?? '',
        }));

        send('step', { id: 'fetch', status: 'done', detail: `Processed ${articles.length} articles` });

        // ── Step: summarize ───────────────────────────────────────────
        send('step', { id: 'summarize', status: 'running', detail: 'AI model summarizing content…' });

        const articleText = articles.map((a: { title: string; url: string; content: string; date: string }, i: number) =>
          `[${i + 1}] ${a.title}\nURL: ${a.url}\nDate: ${a.date}\n${a.content}`
        ).join('\n\n---\n\n');

        const prompt = `You are a professional news analyst. Based on the following news articles about "${topic}", write a concise and well-structured news digest in English.

Format the digest as:
## ${topic} — Today's Digest

**Key Highlights** (3-5 bullet points of the most important developments)

**Summary**
A 2-3 paragraph narrative summary of what's happening and why it matters.

**Sources**
List each article title with its URL.

Articles:
${articleText}

Write clearly and objectively. Focus on facts, trends, and implications.`;

        const openrouterRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://yayaagent.com',
            'X-Title': 'YayaAgent News Digest',
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 1200,
          }),
        });

        if (!openrouterRes.ok) {
          const errText = await openrouterRes.text();
          send('step', { id: 'summarize', status: 'error', detail: `AI failed: ${errText}` });
          send('error', { message: 'AI summarization failed. Check OpenRouter API key.' });
          controller.close();
          return;
        }

        const aiData = await openrouterRes.json();
        const summary = aiData.choices?.[0]?.message?.content ?? '';

        if (!summary) {
          send('step', { id: 'summarize', status: 'error', detail: 'Empty response from AI.' });
          send('error', { message: 'AI returned empty response.' });
          controller.close();
          return;
        }

        send('step', { id: 'summarize', status: 'done', detail: 'Digest ready' });

        // ── Step: send email ──────────────────────────────────────────
        send('step', { id: 'send', status: 'running', detail: `Sending to ${email}…` });

        const htmlSummary = summary
          .replace(/^## (.+)$/gm, '<h2 style="font-size:18px;font-weight:700;color:#ffffff;margin:0 0 16px">$1</h2>')
          .replace(/^\*\*(.+)\*\*$/gm, '<p style="font-size:13px;font-weight:700;color:#a78bfa;margin:16px 0 8px;text-transform:uppercase;letter-spacing:0.05em">$1</p>')
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          .replace(/^- (.+)$/gm, '<li style="margin-bottom:6px;color:#d1d5db">$1</li>')
          .replace(/\n\n/g, '</p><p style="color:#d1d5db;font-size:14px;line-height:1.7;margin:0 0 12px">')
          .replace(/\n/g, '<br/>');

        const { error: emailError } = await resend.emails.send({
          from: 'YayaAgent Alerts <alerts@yayaagent.com>',
          to: email,
          subject: `📰 ${topic} — AI News Digest`,
          html: `
            <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#0f0f0f;color:#e5e5e5;border-radius:12px;">
              <div style="margin-bottom:20px">
                <span style="background:#7c3aed;color:white;font-size:11px;font-weight:600;padding:4px 10px;border-radius:20px;letter-spacing:0.05em;text-transform:uppercase">AI News Digest</span>
              </div>
              <div style="font-size:14px;line-height:1.7;color:#d1d5db">
                ${htmlSummary}
              </div>
              <hr style="border:none;border-top:1px solid #2a2a2a;margin:24px 0"/>
              <p style="color:#4b5563;font-size:12px;line-height:1.6;margin:0 0 12px">
                This digest was generated by YayaAgent's AI News tool.
                For scheduled daily digests, deploy your own automation.
              </p>
              <a href="https://yayaagent.com" style="color:#7c3aed;font-size:12px;font-weight:600;text-decoration:none">
                Learn how on YayaAgent.com →
              </a>
            </div>
          `,
        });

        if (emailError) {
          send('step', { id: 'send', status: 'error', detail: 'Email delivery failed.' });
          send('error', { message: 'Email sending failed.' });
          controller.close();
          return;
        }

        send('step', { id: 'send', status: 'done', detail: `Sent to ${email}` });
        send('result', { summary });

      } catch (err) {
        send('error', { message: err instanceof Error ? err.message : 'Unexpected error' });
      } finally {
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
