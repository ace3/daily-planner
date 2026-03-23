import React, { useEffect, useState, useCallback } from 'react';
import { Wifi, Copy, Check, QrCode, RefreshCw, ExternalLink } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { getLocalIp, getHttpServerPort, getSetting, setSetting } from '../lib/tauri';
import { toast } from '../components/ui/Toast';

// Minimal QR code generator using canvas — no external dependency required.
// Uses the `qrcode` package if available, else shows the URL as text.
let QRCodeLib: { toCanvas: (el: HTMLCanvasElement, text: string, opts: object) => Promise<void> } | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  QRCodeLib = require('qrcode');
} catch {
  QRCodeLib = null;
}

const QRCodeCanvas: React.FC<{ value: string; size?: number }> = ({ value, size = 180 }) => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!QRCodeLib || !canvasRef.current) { setError(true); return; }
    QRCodeLib.toCanvas(canvasRef.current, value, {
      width: size,
      margin: 2,
      color: { dark: '#E6EDF3', light: '#161B22' },
    }).catch(() => setError(true));
  }, [value, size]);

  if (error || !QRCodeLib) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-dashed border-gray-600 bg-[#0F1117] text-xs text-gray-500"
        style={{ width: size, height: size }}
      >
        <div className="text-center p-3">
          <QrCode size={24} className="mx-auto mb-1 opacity-40" />
          <div>Install <code>qrcode</code></div>
          <div>for QR display</div>
        </div>
      </div>
    );
  }

  return <canvas ref={canvasRef} className="rounded-lg" />;
};

export const RemoteAccessPage: React.FC = () => {
  const [localIp, setLocalIp] = useState<string>('loading...');
  const [port, setPort] = useState<number>(7734);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const [token, setToken] = useState<string>('');
  const [regenerating, setRegenerating] = useState(false);

  const localUrl = token
    ? `http://${localIp}:${port}/?token=${token}`
    : `http://${localIp}:${port}`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ip, p, t] = await Promise.all([getLocalIp(), getHttpServerPort(), getSetting('http_auth_token')]);
      setLocalIp(ip);
      setPort(p);
      setToken(t ?? '');
    } catch (e) {
      toast.error(`Failed to load remote access info: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRegenerateToken = useCallback(async () => {
    setRegenerating(true);
    try {
      // Generate a random 32-char hex token
      const array = new Uint8Array(16);
      crypto.getRandomValues(array);
      const newToken = Array.from(array).map((b) => b.toString(16).padStart(2, '0')).join('');
      await setSetting('http_auth_token', newToken);
      setToken(newToken);
      toast.success('Auth token regenerated');
    } catch (e) {
      toast.error(`Failed to regenerate token: ${String(e)}`);
    } finally {
      setRegenerating(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCopy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Wifi size={16} className="text-gray-500 dark:text-[#8B949E]" />
        <h1 className="text-base font-semibold text-gray-900 dark:text-[#E6EDF3]">Remote Access</h1>
        <Button
          variant="ghost"
          size="sm"
          icon={<RefreshCw size={13} className={loading ? 'animate-spin' : ''} />}
          onClick={load}
        >
          Refresh
        </Button>
      </div>

      {/* Info banner */}
      <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 text-xs text-blue-300 leading-relaxed">
        The embedded HTTP server runs on port <strong>{port}</strong>. Open the URL below from any
        device on the <strong>same WiFi network</strong> to access Daily Planner from your phone or
        tablet. The Tauri desktop app must be running on this Mac.
      </div>

      {/* Auth token warning */}
      {!loading && !token && (
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-300 leading-relaxed">
          No auth token set — API is unprotected. Generate a token below to secure access.
        </div>
      )}

      {/* Auth token card */}
      <div className="rounded-xl border border-gray-200 bg-white dark:border-[#30363D] dark:bg-[#161B22] p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-[#8B949E]">
            Auth Token
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw size={13} className={regenerating ? 'animate-spin' : ''} />}
            onClick={handleRegenerateToken}
            disabled={regenerating}
          >
            Regenerate Token
          </Button>
        </div>
        {token ? (
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-lg border border-[#30363D] bg-[#0F1117] px-3 py-2 text-xs text-[#8B949E] font-mono break-all">
              {token}
            </code>
            <Button
              variant="ghost"
              size="sm"
              icon={copied === 'token' ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
              onClick={() => handleCopy(token, 'token')}
              className={copied === 'token' ? 'text-green-400' : ''}
            >
              {copied === 'token' ? 'Copied!' : 'Copy'}
            </Button>
          </div>
        ) : (
          <div className="text-xs text-gray-500 dark:text-[#484F58]">
            No token configured. Click "Regenerate Token" to create one.
          </div>
        )}
      </div>

      {/* Local URL card */}
      <div className="rounded-xl border border-gray-200 bg-white dark:border-[#30363D] dark:bg-[#161B22] p-4 flex flex-col gap-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-[#8B949E]">
          Local Network URL
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <code className="flex-1 rounded-lg border border-[#30363D] bg-[#0F1117] px-3 py-2 text-sm text-[#E6EDF3] font-mono break-all">
            {localUrl}
          </code>
          <Button
            variant="ghost"
            size="sm"
            icon={copied === 'url' ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
            onClick={() => handleCopy(localUrl, 'url')}
            className={copied === 'url' ? 'text-green-400' : ''}
          >
            {copied === 'url' ? 'Copied!' : 'Copy'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<ExternalLink size={13} />}
            onClick={() => window.open(localUrl, '_blank')}
          >
            Open
          </Button>
        </div>

        {/* QR Code */}
        <div className="flex flex-col items-center gap-2 pt-2">
          <div className="text-xs text-gray-500 dark:text-[#8B949E]">Scan to open on mobile</div>
          {!loading && <QRCodeCanvas value={localUrl} size={190} />}
          {loading && (
            <div className="flex items-center justify-center w-[190px] h-[190px] rounded-lg border border-dashed border-gray-600">
              <RefreshCw size={20} className="animate-spin text-gray-600" />
            </div>
          )}
        </div>
      </div>

      {/* Setup guide */}
      <div className="rounded-xl border border-gray-200 bg-white dark:border-[#30363D] dark:bg-[#161B22] p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-[#8B949E] mb-3">
          Quick Setup
        </div>
        <ol className="text-xs text-gray-600 dark:text-[#8B949E] space-y-2 list-decimal list-inside leading-relaxed">
          <li>Make sure your Mac and phone are on the same WiFi network.</li>
          <li>Scan the QR code above <em>or</em> type the URL into your phone's browser.</li>
          <li>
            For access outside your home network, use a tunnel:
            <div className="mt-1.5 ml-4 space-y-1">
              <div className="flex items-center gap-2">
                <code className="rounded bg-[#0F1117] border border-[#30363D] px-2 py-0.5 text-[11px] text-gray-400">
                  cloudflared tunnel --url http://localhost:{port}
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={copied === 'cloudflared' ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
                  onClick={() => handleCopy(`cloudflared tunnel --url http://localhost:${port}`, 'cloudflared')}
                  className="shrink-0 text-[10px]"
                >
                  Copy
                </Button>
              </div>
              <div className="text-[11px] text-gray-600 dark:text-[#484F58]">or</div>
              <div className="flex items-center gap-2">
                <code className="rounded bg-[#0F1117] border border-[#30363D] px-2 py-0.5 text-[11px] text-gray-400">
                  bore local {port} --to bore.pub
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={copied === 'bore' ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
                  onClick={() => handleCopy(`bore local ${port} --to bore.pub`, 'bore')}
                  className="shrink-0 text-[10px]"
                >
                  Copy
                </Button>
              </div>
            </div>
          </li>
          <li>
            The HTTP server port can be changed in <strong>Settings → Remote Access</strong>.
          </li>
        </ol>
      </div>

      {/* API reference */}
      <div className="rounded-xl border border-gray-200 bg-white dark:border-[#30363D] dark:bg-[#161B22] p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-[#8B949E] mb-2">
          API Endpoints
        </div>
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs font-mono">
          {[
            ['GET', '/api/health'],
            ['GET', '/api/tasks?date=YYYY-MM-DD'],
            ['POST', '/api/tasks'],
            ['PATCH', '/api/tasks/:id'],
            ['DELETE', '/api/tasks/:id'],
            ['GET', '/api/session'],
            ['GET', '/api/settings'],
            ['GET', '/api/reports'],
            ['POST', '/api/prompt/improve (SSE)'],
            ['POST', '/api/prompt/run (SSE)'],
          ].map(([method, path]) => (
            <React.Fragment key={path}>
              <span className={`font-semibold ${
                method === 'GET' ? 'text-green-400' :
                method === 'POST' ? 'text-blue-400' :
                method === 'PATCH' ? 'text-yellow-400' :
                'text-red-400'
              }`}>{method}</span>
              <span className="text-gray-400">{path}</span>
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
};
