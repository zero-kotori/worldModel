export function PageSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line py-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/65">{title}</h2>
      </div>
      {children}
    </section>
  );
}

export function EmptyState({ label }: { label: string }) {
  return <div className="rounded-md border border-dashed border-line bg-white px-4 py-6 text-sm text-ink/55">{label}</div>;
}

export function DataWarning({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="mb-4 rounded-md border border-amber/30 bg-amber/10 px-4 py-3 text-sm text-amber">{message}</div>;
}

export function StatusNotice({ message, tone = "success" }: { message?: string; tone?: "success" | "error" }) {
  if (!message) return null;
  const classes =
    tone === "error"
      ? "border-berry/30 bg-berry/10 text-berry"
      : "border-moss/30 bg-moss/10 text-moss";
  return <div className={`mb-4 rounded-md border px-4 py-3 text-sm ${classes}`}>{message}</div>;
}
