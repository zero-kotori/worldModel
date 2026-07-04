"use client";

import { useFormStatus } from "react-dom";
import { Play } from "lucide-react";

export function PendingSubmitButton({
  idleLabel,
  pendingLabel,
  className
}: {
  idleLabel: string;
  pendingLabel: string;
  className: string;
}) {
  const { pending } = useFormStatus();
  const label = pending ? pendingLabel : idleLabel;

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      data-pending-label={pendingLabel}
      className={`${className} disabled:cursor-wait disabled:opacity-70`}
    >
      <Play size={16} />
      <span>{label}</span>
    </button>
  );
}
