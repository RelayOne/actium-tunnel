import { Component, ErrorInfo, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Props {
  children: ReactNode;
  onError?: (message: string) => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    invoke("log_frontend_error", {
      message: error.message,
      stack: error.stack ?? "",
      componentStack: info.componentStack ?? "",
    }).catch(() => {});
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-boundary">
          <div className="error-boundary-icon">
            <svg
              width={24}
              height={24}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h2>Something went wrong</h2>
          <p>
            The app encountered an unexpected error. Your tunnels are still
            running in the background.
          </p>
          <code className="error-detail">{this.state.error.message}</code>
          <div className="error-boundary-actions">
            <button
              className="btn btn-ghost"
              onClick={() => this.setState({ error: null })}
            >
              Try again
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                const msg = this.state.error?.message ?? "";
                this.props.onError?.(msg);
                window.dispatchEvent(
                  new CustomEvent("actium:open-bug-report", {
                    detail: { error: msg },
                  })
                );
                this.setState({ error: null });
              }}
            >
              Report problem
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
