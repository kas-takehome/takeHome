import { AlertCircle, Clock3, Check, ChevronDown } from "lucide-react";
import type { SelectHTMLAttributes } from "react";
import { HOUR, statusLabels, urgency, type Status } from "../shared/domain";
import { fullDate } from "./format";

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`status-badge status-${status}`}>
      <span className="status-dot" />
      {statusLabels[status]}
    </span>
  );
}
export function UrgencyBadge({ deadline }: { deadline: string }) {
  const level = urgency(deadline);
  const hours = (new Date(deadline).getTime() - Date.now()) / HOUR;
  const label =
    level === "overdue"
      ? `${Math.max(1, Math.ceil(-hours / 24))}d overdue`
      : hours < 24
        ? `${Math.max(1, Math.ceil(hours))}h left`
        : `${Math.floor(hours / 24)}d left`;
  const Icon =
    level === "overdue" ? AlertCircle : level === "on_track" ? Check : Clock3;
  return (
    <span
      className={`urgency-badge urgency-${level}`}
      title={fullDate(deadline)}
    >
      <Icon size={12} />
      {label}
    </span>
  );
}
export function Select({
  children,
  className = "",
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={`select-wrap ${className}`}>
      <select {...props}>{children}</select>
      <ChevronDown size={13} />
    </span>
  );
}
