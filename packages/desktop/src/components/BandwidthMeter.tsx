import { formatBytes } from "../App";

interface Props {
  bytesUsed: number;
  capBytes: number;
}

export function BandwidthMeter({ bytesUsed, capBytes }: Props) {
  const pct = capBytes > 0 ? Math.min((bytesUsed / capBytes) * 100, 100) : 0;
  const barColor =
    pct > 90 ? "var(--red)" : pct > 70 ? "var(--yellow)" : "var(--accent)";

  return (
    <div className="card-bar-row">
      <div className="bar-track">
        <div
          className="bar-fill"
          style={{ width: `${pct}%`, background: barColor }}
        />
      </div>
      <span className="bar-label">
        {formatBytes(Math.max(0, capBytes - bytesUsed))} remaining
      </span>
    </div>
  );
}
