import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';

export async function POST(req: NextRequest) {
  console.log('📨 send route hit');
  console.log('🔑 API key exists:', !!process.env.RESEND_API_KEY);
  console.log('🔑 API key prefix:', process.env.RESEND_API_KEY?.slice(0, 8));

  const resend = new Resend(process.env.RESEND_API_KEY);

  try {
    const { to, coin, condition, targetPrice, currentPrice } = await req.json();

    console.log('📬 Sending to:', to, 'coin:', coin);

    if (!to || !coin || !condition || !targetPrice || !currentPrice) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }

    const conditionText = condition === 'above' ? 'risen above' : 'dropped below';
    const fmt = (n: number) =>
      n >= 1
        ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : n.toFixed(6);

    const { data, error } = await resend.emails.send({
      from: 'YayaAgent Alerts <alerts@yayaagent.com>',
      to,
      subject: `🔔 ${coin} Alert Triggered — $${fmt(currentPrice)}`,
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; background: #0f0f0f; color: #e5e5e5; border-radius: 12px;">
          <div style="margin-bottom: 24px;">
            <span style="background: #7c3aed; color: white; font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 20px; letter-spacing: 0.05em; text-transform: uppercase;">Price Alert</span>
          </div>
          <h1 style="font-size: 22px; font-weight: 700; margin: 0 0 8px; color: #ffffff;">
            ${coin} has ${conditionText} your target
          </h1>
          <p style="color: #9ca3af; font-size: 14px; margin: 0 0 24px;">
            Your alert was triggered. Here's the update:
          </p>
          <div style="background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
              <span style="color: #6b7280; font-size: 13px;">Current price</span>
              <span style="color: #34d399; font-family: monospace; font-weight: 600; font-size: 15px;">$${fmt(currentPrice)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
              <span style="color: #6b7280; font-size: 13px;">Your target</span>
              <span style="color: #a78bfa; font-family: monospace; font-size: 15px;">${condition === 'above' ? '▲' : '▼'} $${fmt(targetPrice)}</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span style="color: #6b7280; font-size: 13px;">Asset</span>
              <span style="color: #ffffff; font-weight: 600; font-size: 13px;">${coin}</span>
            </div>
          </div>
          <p style="color: #4b5563; font-size: 12px; line-height: 1.6; margin: 0 0 16px;">
            This alert was set up via the YayaAgent Crypto Monitor demo.
            Monitoring runs only while the page is open — for 24/7 alerts,
            deploy your own automation.
          </p>
          <a href="https://yayaagent.com" style="color: #7c3aed; font-size: 12px; text-decoration: none; font-weight: 600;">
            Learn how to build your own monitor →
          </a>
        </div>
      `,
    });

    console.log('📤 Resend response - data:', JSON.stringify(data), 'error:', JSON.stringify(error));

    if (error) {
      console.error('Resend error:', error);
      return NextResponse.json({ error: 'Email send failed', detail: error }, { status: 500 });
    }

    return NextResponse.json({ success: true, id: data?.id });
  } catch (err) {
    console.error('Send route error:', err);
    return NextResponse.json({ error: 'Internal server error', detail: String(err) }, { status: 500 });
  }
}
