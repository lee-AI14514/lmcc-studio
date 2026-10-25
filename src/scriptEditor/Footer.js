import React, { useEffect, useState } from 'react';
import './Footer.css';

const POLL_INTERVAL = 1000;

const formatPercent = (value) =>
  Number.isFinite(value) ? `${Math.round(value)}%` : '—';

const formatGB = (bytes) =>
  Number.isFinite(bytes) ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : '—';

const toGB = (bytes) => (bytes / 1024 ** 3).toFixed(1);

const formatGpuMemory = (gpu) => {
  if (Number.isFinite(gpu?.memUsed) && gpu?.memTotal > 0) {
    return `${toGB(gpu.memUsed)}/${toGB(gpu.memTotal)} GB`;
  }

  if (Number.isFinite(gpu?.memUsed)) return `${toGB(gpu.memUsed)} GB`;

  return '—';
};

const describeGpu = (gpu) => {
  const util = Number.isFinite(gpu.util)
    ? `${Math.round(gpu.util)}%`
    : 'unknown';
  const memory = Number.isFinite(gpu.memUsed)
    ? gpu.memTotal > 0
      ? `${formatGB(gpu.memUsed)} / ${formatGB(gpu.memTotal)}`
      : `${formatGB(gpu.memUsed)} used`
    : 'unknown';

  return `${gpu.name || 'GPU'} — utilisation ${util}, VRAM ${memory}`;
};

const Footer = () => {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    let alive = true;
    let timer = null;

    const poll = async () => {
      if (!window.system?.getStats) return;

      try {
        const next = await window.system.getStats();
        if (alive) setStats(next);
      } catch (error) {
        // keep the previous reading when a sample fails
      }
    };

    poll();
    timer = setInterval(poll, POLL_INTERVAL);

    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const cpu = stats?.cpu;
  const memory = stats?.memory;
  const gpus = stats?.gpus ?? [];

  return (
    <footer className="editor-footer">
      <div className="footer-content">
        <div className="footer-item footer-brand">
          <span className="brand-dot" />
          LMCC Studio
        </div>
        <div className="footer-item">Script Editor</div>
        <div className="footer-pill">v1.0.0</div>

        <div className="footer-item-spacer"></div>

        <div className="footer-metrics">
          <div className="footer-metric" title="CPU usage">
            <span className="footer-metric-label">CPU</span>
            <span className="footer-metric-value">{formatPercent(cpu)}</span>
          </div>

          <div
            className="footer-metric"
            title={`System memory — ${formatGB(
              memory?.used
            )} of ${formatGB(memory?.total)} used`}
          >
            <span className="footer-metric-label">MEM</span>
            <span className="footer-metric-strong">
              {formatGB(memory?.used)}
            </span>
          </div>

          {gpus.length > 0 ? (
            gpus.map((gpu, index) => (
              <div
                className="footer-metric"
                key={gpu.id}
                title={describeGpu(gpu)}
              >
                <span className="footer-metric-label">
                  {gpus.length > 1 ? `GPU${index}` : 'GPU'}
                </span>
                <span className="footer-metric-value">
                  {formatPercent(gpu.util)}
                </span>
                <span className="footer-metric-detail">
                  <span className="footer-metric-detail-label">VRAM </span>
                  <span className="footer-metric-strong">
                    {formatGpuMemory(gpu)}
                  </span>
                </span>
              </div>
            ))
          ) : (
            <div className="footer-metric" title="No GPU telemetry available">
              <span className="footer-metric-label">GPU</span>
              <span className="footer-metric-value">—</span>
            </div>
          )}
        </div>

        <div className="footer-item">UTF-8</div>
        <div className="footer-item">Script</div>
        <div className="footer-item footer-mono">.gs</div>
      </div>
    </footer>
  );
};

export default Footer;
