import { Dot } from "../App";

interface Props {
  state: string;
  label?: string;
}

export function StatusIndicator({ state, label }: Props) {
  const stateColor =
    state === "Connected"
      ? "var(--green)"
      : state === "Connecting"
        ? "var(--yellow)"
        : state === "Error"
          ? "var(--red)"
          : "var(--muted)";

  return (
    <div className="card-state">
      <Dot state={state} />
      <span style={{ color: stateColor }}>{label || state}</span>
    </div>
  );
}
