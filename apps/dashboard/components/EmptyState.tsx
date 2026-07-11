const TWILIO_NUMBER = process.env.NEXT_PUBLIC_TWILIO_NUMBER ?? "+1 662 547 8393";

/** Hero when no active/recent run — intentional on the projector before a call. */
export function EmptyState() {
  return (
    <section className="flex h-full flex-col items-center justify-center gap-4 rounded-md border border-hairline bg-panel p-5">
      <div className="flex items-center gap-2">
        <span className="live-pulse h-2 w-2 rounded-full bg-signal" />
        <span className="font-mono text-xs uppercase tracking-[0.3em] text-signal">
          Line Open
        </span>
      </div>
      <h2 className="text-center font-display text-3xl font-semibold tracking-tight text-muted">
        WAITING FOR CALLS
      </h2>
      <div className="font-mono text-sm text-muted/70">{TWILIO_NUMBER}</div>
    </section>
  );
}
