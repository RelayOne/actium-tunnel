interface CrashReport {
  crash_type: string;
  message: string;
  location: string;
  app_version: string;
  os: string;
  arch: string;
  timestamp: string;
}

interface Props {
  crash: CrashReport;
  onDismiss: () => void;
  onReport: () => void;
}

export function CrashRecoveryScreen({ crash, onDismiss, onReport }: Props) {
  return (
    <div className="crash-screen">
      <div className="crash-screen-inner">
        <div className="crash-icon">
          <svg
            width={32}
            height={32}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>

        <h1>Actium Tunnel closed unexpectedly</h1>
        <p className="crash-subtitle">
          The app crashed last session
          {crash.location && crash.location !== "unknown location"
            ? ` at ${crash.location}`
            : ""}
          . Your accounts and settings are intact.
        </p>

        <div className="crash-detail">
          <code>{crash.message}</code>
        </div>

        <div className="crash-meta">
          <span>v{crash.app_version}</span>
          <span>
            {crash.os} ({crash.arch})
          </span>
        </div>

        <div className="crash-actions">
          <button className="btn btn-ghost" onClick={onDismiss}>
            Continue without reporting
          </button>
          <button className="btn btn-primary" onClick={onReport}>
            Send crash report
          </button>
        </div>

        <p className="crash-note">
          Crash reports include app version, OS, and the error location. No API
          keys or network data.
        </p>
      </div>
    </div>
  );
}

export type { CrashReport };
