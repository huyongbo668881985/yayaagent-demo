'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────
type Condition = 'above' | 'below';
type TabType = 'single' | 'ratio';

interface SingleAlert {
  id: string;
  type: 'single';
  coin: string;
  coinId: string;
  condition: Condition;
  targetPrice: number;
  email: string;
  triggered: boolean;
}

interface RatioAlert {
  id: string;
  type: 'ratio';
  baseCoin: string;
  baseCoinId: string;
  quoteCoin: string;
  quoteCoinId: string;
  condition: Condition;
  targetRatio: number;
  email: string;
  triggered: boolean;
}

type Alert = SingleAlert | RatioAlert;

interface CoinOption {
  id: string;
  symbol: string;
  name: string;
}

interface PriceData {
  [coinId: string]: { usd: number };
}

// ── Constants ──────────────────────────────────────────────────────────────
const COINS: CoinOption[] = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' },
  { id: 'ethereum', symbol: 'ETH', name: 'Ethereum' },
  { id: 'solana', symbol: 'SOL', name: 'Solana' },
  { id: 'chainlink', symbol: 'LINK', name: 'Chainlink' },
  { id: 'binancecoin', symbol: 'BNB', name: 'BNB' },
  { id: 'ripple', symbol: 'XRP', name: 'XRP' },
];

const POLL_INTERVAL = 60_000;
const DAILY_EMAIL_LIMIT = 3;
const STORAGE_KEY = 'crypto_alert_sends';

// ── Helpers ────────────────────────────────────────────────────────────────
function getTodayKey(email: string) {
  const today = new Date().toISOString().slice(0, 10);
  return `${email}__${today}`;
}

function getSentCount(email: string): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const store = raw ? JSON.parse(raw) : {};
    const key = getTodayKey(email);
    const count = store[key] ?? 0;
    console.log('🔍 getSentCount:', email, 'key:', key, 'count:', count, 'store:', JSON.stringify(store));
    return count;
  } catch (e) {
    console.error('getSentCount error:', e);
    return 0;
  }
}

function incrementSentCount(email: string) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const store = raw ? JSON.parse(raw) : {};
    const key = getTodayKey(email);
    store[key] = (store[key] ?? 0) + 1;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    console.log('📝 incrementSentCount:', email, 'new count:', store[key]);
  } catch (e) {
    console.error('incrementSentCount error:', e);
  }
}

function formatPrice(n: number) {
  return n >= 1
    ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : n.toFixed(6);
}

function formatRatio(n: number) {
  return n.toFixed(4);
}

// ── StatusDot ──────────────────────────────────────────────────────────────
function StatusDot({ active }: { active: boolean }) {
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      {active && (
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-60" />
      )}
      <span className={`relative inline-flex rounded-full h-2 w-2 ${active ? 'bg-violet-500' : 'bg-gray-300'}`} />
    </span>
  );
}

// ── CoinSelector ───────────────────────────────────────────────────────────
function CoinSelector({
  value, onChange, prices, exclude,
}: {
  value: CoinOption;
  onChange: (c: CoinOption) => void;
  prices: PriceData;
  exclude?: string;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {COINS.filter((c) => c.id !== exclude).map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onChange(c)}
          className={`rounded-lg py-2 px-3 text-sm font-medium transition-all flex items-center justify-between border ${
            value.id === c.id
              ? 'bg-violet-600 text-white border-violet-600'
              : 'bg-white text-gray-600 border-gray-200 hover:border-violet-300 hover:text-violet-600'
          }`}
        >
          <span>{c.symbol}</span>
          {prices[c.id] && (
            <span className={`text-xs ${value.id === c.id ? 'opacity-75' : 'text-gray-400'}`}>
              ${formatPrice(prices[c.id].usd)}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────
export default function CryptoMonitor() {
  const [tab, setTab] = useState<TabType>('single');
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [prices, setPrices] = useState<PriceData>({});
  const [notifications, setNotifications] = useState<{ msg: string; time: string }[]>([]);
  const [isPolling, setIsPolling] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [sending, setSending] = useState<string | null>(null);

  // Single alert form
  const [selectedCoin, setSelectedCoin] = useState<CoinOption>(COINS[0]);
  const [singleCondition, setSingleCondition] = useState<Condition>('below');
  const [targetPrice, setTargetPrice] = useState('');
  const [singleEmail, setSingleEmail] = useState('');
  const [singleError, setSingleError] = useState('');

  // Ratio alert form
  const [baseCoin, setBaseCoin] = useState<CoinOption>(COINS[2]);
  const [quoteCoin, setQuoteCoin] = useState<CoinOption>(COINS[1]);
  const [ratioCondition, setRatioCondition] = useState<Condition>('below');
  const [targetRatio, setTargetRatio] = useState('');
  const [ratioEmail, setRatioEmail] = useState('');
  const [ratioError, setRatioError] = useState('');

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const alertsRef = useRef(alerts);
  alertsRef.current = alerts;

  function addNotification(msg: string) {
    const time = new Date().toLocaleTimeString();
    setNotifications((prev) => [{ msg, time }, ...prev].slice(0, 10));
  }

  // ── Price fetching ─────────────────────────────────────────────────────
  const fetchPrices = useCallback(async () => {
    const activeAlerts = alertsRef.current.filter((a) => !a.triggered);
    const coinIds = new Set<string>();
    activeAlerts.forEach((a) => {
      if (a.type === 'single') coinIds.add(a.coinId);
      if (a.type === 'ratio') { coinIds.add(a.baseCoinId); coinIds.add(a.quoteCoinId); }
    });
    if (coinIds.size === 0) return;

    try {
      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${[...coinIds].join(',')}&vs_currencies=usd`
      );
      if (!res.ok) return;
      const data: PriceData = await res.json();
      setPrices((prev) => ({ ...prev, ...data }));
      setLastUpdated(new Date());
      checkAlerts(data);
    } catch (e) {
      console.error('fetchPrices error:', e);
    }
  }, []); // eslint-disable-line

  // ── Send email helper ──────────────────────────────────────────────────
  const sendEmail = useCallback(async (alert: Alert, currentValue: number) => {
    const sentToday = getSentCount(alert.email);
    console.log('📨 sendEmail called, sentToday:', sentToday, 'limit:', DAILY_EMAIL_LIMIT);

    if (sentToday >= DAILY_EMAIL_LIMIT) {
      addNotification(`⚠️ Daily email limit reached for ${alert.email} — page alert only`);
      return;
    }

    setSending(alert.id);
    try {
      const body = alert.type === 'single'
        ? { to: alert.email, coin: alert.coin, condition: alert.condition, targetPrice: alert.targetPrice, currentPrice: currentValue }
        : { to: alert.email, coin: `${alert.baseCoin}/${alert.quoteCoin}`, condition: alert.condition, targetPrice: alert.targetRatio, currentPrice: currentValue, isRatio: true };

      console.log('📤 Calling /api/send with body:', JSON.stringify(body));

      const res = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const result = await res.json();
      console.log('📬 /api/send response:', res.status, JSON.stringify(result));

      if (res.ok) {
        incrementSentCount(alert.email);
        const remaining = DAILY_EMAIL_LIMIT - sentToday - 1;
        addNotification(`📧 Email sent to ${alert.email} (${remaining} left today)`);
      } else {
        addNotification(`⚠️ Email failed: ${result.error || 'unknown error'}`);
      }
    } catch (e) {
      console.error('sendEmail fetch error:', e);
      addNotification(`⚠️ Email failed — page notification only`);
    } finally {
      setSending(null);
    }
  }, []);

  // ── Alert checking ─────────────────────────────────────────────────────
  const checkAlerts = useCallback(async (data: PriceData) => {
    const updated = [...alertsRef.current];
    let changed = false;

    for (let i = 0; i < updated.length; i++) {
      const alert = updated[i];
      if (alert.triggered) continue;

      let currentValue: number | undefined;
      let label: string;

      if (alert.type === 'single') {
        currentValue = data[alert.coinId]?.usd;
        label = `${alert.coin} = $${currentValue !== undefined ? formatPrice(currentValue) : '?'}`;
      } else {
        const base = data[alert.baseCoinId]?.usd;
        const quote = data[alert.quoteCoinId]?.usd;
        currentValue = (base !== undefined && quote !== undefined && quote !== 0) ? base / quote : undefined;
        label = `${alert.baseCoin}/${alert.quoteCoin} = ${currentValue !== undefined ? formatRatio(currentValue) : '?'}`;
      }

      if (currentValue === undefined) continue;

      const target = alert.type === 'single' ? alert.targetPrice : alert.targetRatio;
      const hit =
        (alert.condition === 'above' && currentValue >= target) ||
        (alert.condition === 'below' && currentValue <= target);

      if (!hit) continue;

      updated[i] = { ...alert, triggered: true };
      changed = true;

      addNotification(`🔔 Alert triggered! ${label} (target: ${alert.condition} ${alert.type === 'single' ? '$' : ''}${alert.type === 'single' ? formatPrice(target) : formatRatio(target)})`);
      await sendEmail(alert, currentValue);
    }

    if (changed) setAlerts(updated);
  }, [sendEmail]);

  // ── Polling lifecycle ──────────────────────────────────────────────────
  useEffect(() => {
    const hasActive = alerts.some((a) => !a.triggered);
    if (hasActive && !timerRef.current) {
      setIsPolling(true);
      fetchPrices();
      timerRef.current = setInterval(fetchPrices, POLL_INTERVAL);
    }
    if (!hasActive && timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
      setIsPolling(false);
    }
    return () => {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    };
  }, [alerts, fetchPrices]);

  // ── Current ratio display ──────────────────────────────────────────────
  const currentRatio =
    prices[baseCoin.id]?.usd && prices[quoteCoin.id]?.usd && quoteCoin.id !== baseCoin.id
      ? prices[baseCoin.id].usd / prices[quoteCoin.id].usd
      : null;

  // ── Form: single alert ─────────────────────────────────────────────────
  function handleSingleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSingleError('');
    const price = parseFloat(targetPrice);
    if (isNaN(price) || price <= 0) { setSingleError('Please enter a valid price.'); return; }
    if (!singleEmail.includes('@')) { setSingleError('Please enter a valid email.'); return; }

    const a: SingleAlert = {
      id: crypto.randomUUID(), type: 'single',
      coin: selectedCoin.symbol, coinId: selectedCoin.id,
      condition: singleCondition, targetPrice: price,
      email: singleEmail, triggered: false,
    };
    setAlerts((prev) => [...prev, a]);
    setTargetPrice('');
    addNotification(`✅ Watching ${selectedCoin.symbol} ${singleCondition} $${formatPrice(price)}`);
  }

  // ── Form: ratio alert ──────────────────────────────────────────────────
  function handleRatioSubmit(e: React.FormEvent) {
    e.preventDefault();
    setRatioError('');
    if (baseCoin.id === quoteCoin.id) { setRatioError('Please select two different coins.'); return; }
    const ratio = parseFloat(targetRatio);
    if (isNaN(ratio) || ratio <= 0) { setRatioError('Please enter a valid ratio.'); return; }
    if (!ratioEmail.includes('@')) { setRatioError('Please enter a valid email.'); return; }

    const a: RatioAlert = {
      id: crypto.randomUUID(), type: 'ratio',
      baseCoin: baseCoin.symbol, baseCoinId: baseCoin.id,
      quoteCoin: quoteCoin.symbol, quoteCoinId: quoteCoin.id,
      condition: ratioCondition, targetRatio: ratio,
      email: ratioEmail, triggered: false,
    };
    setAlerts((prev) => [...prev, a]);
    setTargetRatio('');
    addNotification(`✅ Watching ${baseCoin.symbol}/${quoteCoin.symbol} ${ratioCondition} ${formatRatio(ratio)}`);
  }

  function removeAlert(id: string) {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }

  const activeCount = alerts.filter((a) => !a.triggered).length;

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans">

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <a
            href="https://yayaagent.com/playground/"
            className="text-gray-400 hover:text-violet-600 transition-colors text-sm flex items-center gap-1 mr-1"
            aria-label="Back"
          >
            ← Back
          </a>
          <span className="text-xl">📈</span>
          <div>
            <h1 className="text-sm font-semibold text-gray-900 tracking-wide">Crypto Price Monitor</h1>
            <p className="text-xs text-gray-400">Automation, no AI needed</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <StatusDot active={isPolling} />
          {isPolling ? (
            <span className="text-violet-600">
              Polling every 60s{lastUpdated && ` · ${lastUpdated.toLocaleTimeString()}`}
            </span>
          ) : (
            <span className="text-gray-400">Idle — add an alert to start</span>
          )}
        </div>
      </div>

      <div className="max-w-xl mx-auto px-4 py-8 space-y-5">

        {/* Tab switcher */}
        <div className="bg-white border border-gray-200 rounded-xl p-1 flex gap-1">
          <button
            onClick={() => setTab('single')}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
              tab === 'single' ? 'bg-violet-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Single Coin
          </button>
          <button
            onClick={() => setTab('ratio')}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
              tab === 'ratio' ? 'bg-violet-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Coin vs Coin
          </button>
        </div>

        {/* ── Single Coin Form ── */}
        {tab === 'single' && (
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Set a Price Alert</h2>
            <form onSubmit={handleSingleSubmit} className="space-y-4">
              <CoinSelector value={selectedCoin} onChange={setSelectedCoin} prices={prices} />
              <div className="flex gap-2">
                <select
                  value={singleCondition}
                  onChange={(e) => setSingleCondition(e.target.value as Condition)}
                  className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-violet-400"
                >
                  <option value="below">Drops below</option>
                  <option value="above">Rises above</option>
                </select>
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                  <input
                    type="number"
                    placeholder="0.00"
                    value={targetPrice}
                    onChange={(e) => setTargetPrice(e.target.value)}
                    className="w-full bg-white border border-gray-200 rounded-lg pl-7 pr-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-violet-400 placeholder-gray-300"
                  />
                </div>
              </div>
              <input
                type="email"
                placeholder="your@email.com"
                value={singleEmail}
                onChange={(e) => setSingleEmail(e.target.value)}
                className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-violet-400 placeholder-gray-300"
              />
              {singleError && <p className="text-red-500 text-xs">{singleError}</p>}
              <button
                type="submit"
                className="w-full bg-violet-600 hover:bg-violet-500 text-white font-semibold rounded-xl py-2.5 text-sm transition-colors"
              >
                Start Monitoring →
              </button>
            </form>
          </div>
        )}

        {/* ── Ratio Form ── */}
        {tab === 'ratio' && (
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-700 mb-1">Coin vs Coin Ratio</h2>
            {currentRatio && baseCoin.id !== quoteCoin.id && (
              <p className="text-xs text-gray-400 mb-4">
                Current {baseCoin.symbol}/{quoteCoin.symbol} = <span className="font-mono text-violet-600 font-semibold">{formatRatio(currentRatio)}</span>
              </p>
            )}
            <form onSubmit={handleRatioSubmit} className="space-y-4">
              <div>
                <p className="text-xs text-gray-500 mb-2 font-medium">Base coin (numerator)</p>
                <CoinSelector value={baseCoin} onChange={setBaseCoin} prices={prices} exclude={quoteCoin.id} />
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-2 font-medium">Quote coin (denominator)</p>
                <CoinSelector value={quoteCoin} onChange={setQuoteCoin} prices={prices} exclude={baseCoin.id} />
              </div>
              <div className="flex gap-2">
                <select
                  value={ratioCondition}
                  onChange={(e) => setRatioCondition(e.target.value as Condition)}
                  className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-violet-400"
                >
                  <option value="below">Ratio drops below</option>
                  <option value="above">Ratio rises above</option>
                </select>
                <input
                  type="number"
                  step="0.0001"
                  placeholder="0.0000"
                  value={targetRatio}
                  onChange={(e) => setTargetRatio(e.target.value)}
                  className="flex-1 bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-violet-400 placeholder-gray-300 font-mono"
                />
              </div>
              <input
                type="email"
                placeholder="your@email.com"
                value={ratioEmail}
                onChange={(e) => setRatioEmail(e.target.value)}
                className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-violet-400 placeholder-gray-300"
              />
              {ratioError && <p className="text-red-500 text-xs">{ratioError}</p>}
              <button
                type="submit"
                className="w-full bg-violet-600 hover:bg-violet-500 text-white font-semibold rounded-xl py-2.5 text-sm transition-colors"
              >
                Start Monitoring →
              </button>
            </form>
          </div>
        )}

        {/* Active Alerts */}
        {alerts.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-1">
              Active alerts ({activeCount} watching)
            </p>
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className={`bg-white border rounded-xl px-4 py-3 flex items-center justify-between gap-3 shadow-sm transition-all ${
                  alert.triggered ? 'border-green-200 opacity-60' : 'border-gray-200'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <StatusDot active={!alert.triggered} />
                  <div className="min-w-0">
                    {alert.type === 'single' ? (
                      <p className="text-sm text-gray-700 truncate">
                        <span className="font-semibold">{alert.coin}</span>
                        <span className="text-gray-400 mx-1">{alert.condition}</span>
                        <span className="font-mono text-violet-600">${formatPrice(alert.targetPrice)}</span>
                      </p>
                    ) : (
                      <p className="text-sm text-gray-700 truncate">
                        <span className="font-semibold">{alert.baseCoin}/{alert.quoteCoin}</span>
                        <span className="text-gray-400 mx-1">{alert.condition}</span>
                        <span className="font-mono text-violet-600">{formatRatio(alert.targetRatio)}</span>
                      </p>
                    )}
                    <p className="text-xs text-gray-400 truncate">{alert.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {alert.triggered ? (
                    <span className="text-xs text-green-600 font-medium">Triggered ✓</span>
                  ) : sending === alert.id ? (
                    <span className="text-xs text-amber-500">Sending…</span>
                  ) : null}
                  <button
                    onClick={() => removeAlert(alert.id)}
                    className="text-gray-300 hover:text-red-400 transition-colors text-xl leading-none"
                    aria-label="Remove"
                  >×</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Event Log */}
        {notifications.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Event Log</p>
            <div className="space-y-1.5">
              {notifications.map((n, i) => (
                <p key={i} className={`text-xs flex gap-2 ${i === 0 ? 'text-gray-700' : 'text-gray-400'}`}>
                  <span className="text-gray-300 shrink-0">{n.time}</span>
                  <span>{n.msg}</span>
                </p>
              ))}
            </div>
          </div>
        )}

        {/* Disclaimer + CTA */}
        <div className="border border-dashed border-gray-200 rounded-xl p-5 text-center">
          <p className="text-xs text-gray-400 leading-relaxed mb-3">
            ⚠️ Monitoring stops when you close this page. Max {DAILY_EMAIL_LIMIT} emails per address per day.<br />
            For 24/7 alerts, deploy your own automation.
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
