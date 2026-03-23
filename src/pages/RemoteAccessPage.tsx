import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Wifi, Copy, Check, QrCode, RefreshCw, ExternalLink, Trash2, Globe, CircleDot, Smartphone } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { getLocalIp, getHttpServerPort, getSetting, setSetting, listDevices, deleteDevice, startTunnel, stopTunnel, getTunnelStatus } from '../lib/tauri';
import type { Device, TunnelStatus } from '../lib/tauri';
import { toast } from '../components/ui/Toast';
import { isWebBrowser } from '../lib/http';

// Minimal QR code generator using canvas — no external dependency required.
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

function formatLastSeen(ts: string | null): string {
  if (!ts) return 'Never';
  try {
    const d = new Date(ts + 'Z'); // SQLite datetime is UTC, no Z suffix
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) return 'Just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
  } catch {
    return ts;
  }
}

export const RemoteAccessPage: React.FC = () => {
  const [localIp, setLocalIp] = useState<string>('loading...');
  const [port, setPort] = useState<number>(7734);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const [token, setToken] = useState<string>('');
  const [regenerating, setRegenerating] = useState(false);

  // Devices state
  const [devices, setDevices] = useState<Device[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  // Tunnel state
  const [tunnel, setTunnel] = useState<TunnelStatus>({ running: false, url: null, error: null });
  const [tunnelLoading, setTunnelLoading] = useState(false);
  const tunnelPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const loadDevices = useCallback(async () => {
    setDevicesLoading(true);
    try {
      const list = await listDevices();
      setDevices(list);
    } catch {
      // silently ignore — devices table may not exist on older schema
    } finally {
      setDevicesLoading(false);
    }
  }, []);

  const loadTunnelStatus = useCallback(async () => {
    try {
      const status = await getTunnelStatus();
      setTunnel(status);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    load();
    loadDevices();
    if (!isWebBrowser()) {
      loadTunnelStatus();
    }
  }, [load, loadDevices, loadTunnelStatus]);

  // Poll tunnel status every 3s while running
  useEffect(() => {
    if (isWebBrowser()) return;
    if (tunnel.running) {
      tunnelPollRef.current = setInterval(loadTunnelStatus, 3000);
    } else {
      if (tunnelPollRef.current) clearInterval(tunnelPollRef.current);
    }
    return () => { if (tunnelPollRef.current) clearInterval(tunnelPollRef.current); };
  }, [tunnel.running, loadTunnelStatus]);

  const handleRegenerateToken = useCallback(async () => {
    setRegenerating(true);
    try {
      const array = new Uint8Array(16);
      crypto.getRandomValues(array);
      const newToken = Array.from(array).map((b) => b.toString(16).padStart(2, '0')).join('');
      await setSetting('http_auth_token', newToken);
      setToken(newToken);
      toast.success('Auth token regenerated — all existing sessions will need to re-scan the QR code.');
    } catch (e) {
      toast.error(`Failed to regenerate token: ${String(e)}`);
    } finally {
      setRegenerating(false);
    }
  }, []);

  const handleRevokeDevice = useCallback(async (id: string) => {
    setRevokingId(id);
    try {
      await deleteDevice(id);
      setDevices((prev) => prev.filter((d) => d.id !== id));
      toast.success('Device revoked');
    } catch (e) {
      toast.error(`Failed to revoke device: ${String(e)}`);
    } finally {
      setRevokingId(null);
    }
  }, []);

  const handleTunnelToggle = useCallback(async () => {
    setTunnelLoading(true);
    try {
      if (tunnel.running) {
        const status = await stopTunnel();
        setTunnel(status);
        toast.success('Cloudflare tunnel stopped');
      } else {
        toast.info('Starting Cloudflare tunnel…');
        const status = await startTunnel(port);
        setTunnel(status);
        if (status.error) {
          toast.error(status.error);
        } else {
          toast.success('Cloudflare tunnel started');
        }
      }
    } catch (e) {
      toast.error(`Tunnel error: ${String(e)}`);
    } finally {
      setTunnelLoading(false);
    }
  }, [tunnel.running, port]);

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
          onClick={() => { load(); loadDevices(); loadTunnelStatus(); }}
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

      {/* Connected Devices card */}
      <div className="rounded-xl border border-gray-200 bg-white dark:border-[#30363D] dark:bg-[#161B22] p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Smartphone size={14} className="text-gray-500 dark:text-[#8B949E]" />
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-[#8B949E]">
              Connected Devices
            </div>
            {devices.length > 0 && (
              <span className="rounded-full bg-blue-500/20 text-blue-400 text-[10px] px-1.5 py-0.5 font-mono">
                {devices.length}
              </span>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw size={13} className={devicesLoading ? 'animate-spin' : ''} />}
            onClick={loadDevices}
            disabled={devicesLoading}
          >
            Refresh
          </Button>
        </div>
        {devices.length === 0 ? (
          <div className="text-xs text-gray-500 dark:text-[#484F58] text-center py-3">
            No devices registered yet. Scan the QR code on your phone to connect.
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {devices.map((device) => (
              <div
                key={device.id}
                className="flex items-center justify-between rounded-lg border border-[#30363D] bg-[#0F1117] px-3 py-2"
              >
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-xs font-medium text-[#E6EDF3] truncate">{device.name}</span>
                  <span className="text-[10px] text-[#484F58]">
                    Last seen: {formatLastSeen(device.last_seen)} · ID: {device.id.slice(0, 8)}…
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={revokingId === device.id
                    ? <RefreshCw size={12} className="animate-spin" />
                    : <Trash2 size={12} className="text-red-400" />}
                  onClick={() => handleRevokeDevice(device.id)}
                  disabled={revokingId === device.id}
                  className="shrink-0 text-red-400 hover:text-red-300"
                >
                  Revoke
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Cloudflare Tunnel card — desktop only */}
      {!isWebBrowser() && (
        <div className="rounded-xl border border-gray-200 bg-white dark:border-[#30363D] dark:bg-[#161B22] p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Globe size={14} className="text-gray-500 dark:text-[#8B949E]" />
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-[#8B949E]">
                Cloudflare Tunnel
              </div>
              <div className="flex items-center gap-1">
                <CircleDot
                  size={10}
                  className={tunnel.running ? 'text-green-400' : 'text-gray-600'}
                />
                <span className={`text-[10px] ${tunnel.running ? 'text-green-400' : 'text-gray-500'}`}>
                  {tunnel.running ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
            <Button
              variant={tunnel.running ? 'ghost' : 'primary'}
              size="sm"
              icon={tunnelLoading ? <RefreshCw size={13} className="animate-spin" /> : undefined}
              onClick={handleTunnelToggle}
              disabled={tunnelLoading}
              className={tunnel.running ? 'text-red-400 hover:text-red-300' : ''}
            >
              {tunnel.running ? 'Stop Tunnel' : 'Start Tunnel'}
            </Button>
          </div>

          {tunnel.error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {tunnel.error}
            </div>
          )}

          {tunnel.running && tunnel.url && (
            <div className="flex flex-col gap-2">
              <div className="text-[10px] text-gray-500 dark:text-[#8B949E]">Public URL (accessible from any network):</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-lg border border-[#30363D] bg-[#0F1117] px-3 py-2 text-xs text-green-400 font-mono break-all">
                  {tunnel.url}/?token={token}
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={copied === 'tunnel' ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
                  onClick={() => handleCopy(`${tunnel.url}/?token=${token}`, 'tunnel')}
                  className={copied === 'tunnel' ? 'text-green-400' : ''}
                >
                  {copied === 'tunnel' ? 'Copied!' : 'Copy'}
                </Button>
              </div>
            </div>
          )}

          {tunnel.running && !tunnel.url && (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <RefreshCw size={12} className="animate-spin" />
              Waiting for tunnel URL…
            </div>
          )}

          <div className="text-[11px] text-gray-600 dark:text-[#484F58] leading-relaxed">
            Uses <code className="text-gray-500">cloudflared tunnel --url</code> (quick tunnel, no config needed).
            Install with: <code className="text-gray-500">brew install cloudflared</code>.
            Auto-reconnects if the connection drops.
          </div>
        </div>
      )}

      {/* Setup guide */}
      <div className="rounded-xl border border-gray-200 bg-white dark:border-[#30363D] dark:bg-[#161B22] p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-[#8B949E] mb-3">
          Quick Setup
        </div>
        <ol className="text-xs text-gray-600 dark:text-[#8B949E] space-y-2 list-decimal list-inside leading-relaxed">
          <li>Make sure your Mac and phone are on the same WiFi network.</li>
          <li>Scan the QR code above <em>or</em> type the URL into your phone's browser.</li>
          <li>For access outside your home network, use the Cloudflare Tunnel toggle above.</li>
          <li>
            The HTTP server port can be changed in <strong>Settings → Remote Access</strong>.
          </li>
        </ol>
      </div>
    </div>
  );
};
