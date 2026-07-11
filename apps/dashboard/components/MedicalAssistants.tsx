import type { MedicalAssistantRow } from "../lib/types";

/**
 * Medical assistants roster. Renders the `medical_assistants` table from
 * Supabase when it exists; otherwise falls back to the sample rows below so the
 * panel is never empty (mirrors supabase/seed_medical_assistants.sql).
 *
 * Columns: assistant, staff ID, specialization, location, availability.
 * Horizontally scrollable on narrow screens; semantic table for a11y.
 */

const PLACEHOLDER: MedicalAssistantRow[] = [
  { id: "MA-1042", code: "MA-1042", name: "Maria Alvarez", specialization: "Wound Care RN", location: "Springfield, NJ (07081)", status: "available", availability: "Until 6:00 PM" },
  { id: "MA-1067", code: "MA-1067", name: "David Chen", specialization: "Geriatric Care", location: "Summit, NJ (07901)", status: "available", availability: "Until 8:00 PM" },
  { id: "MA-1085", code: "MA-1085", name: "Priya Nair", specialization: "Physical Therapy", location: "Millburn, NJ (07041)", status: "busy", availability: "Free after 3:30 PM" },
  { id: "MA-1091", code: "MA-1091", name: "James Okafor", specialization: "Cardiac / CHF", location: "West Orange, NJ (07052)", status: "available", availability: "Until 5:00 PM" },
  { id: "MA-1103", code: "MA-1103", name: "Sarah Kim", specialization: "Speech Therapy", location: "Chelsea, NY (10001)", status: "off", availability: "Back tomorrow 9 AM" },
  { id: "MA-1118", code: "MA-1118", name: "Andre Thompson", specialization: "Home Health Aide", location: "Brooklyn Heights (11201)", status: "available", availability: "Until 7:30 PM" },
  { id: "MA-1124", code: "MA-1124", name: "Elena Rossi", specialization: "Diabetes Management", location: "Westfield, NJ (07090)", status: "busy", availability: "Free after 4:15 PM" },
  { id: "MA-1130", code: "MA-1130", name: "Marcus Lee", specialization: "Occupational Therapy", location: "Short Hills, NJ (07078)", status: "available", availability: "Until 6:45 PM" },
];

const STATUS_BADGE: Record<string, string> = {
  available: "border-signal/40 bg-signal/10 text-signal",
  busy: "border-amber/40 bg-amber/10 text-amber",
  off: "border-hairline bg-base/40 text-muted",
};
const STATUS_DOT: Record<string, string> = {
  available: "bg-signal",
  busy: "bg-amber",
  off: "bg-muted",
};
const STATUS_LABEL: Record<string, string> = {
  available: "Available",
  busy: "Busy",
  off: "Off",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider ${
        STATUS_BADGE[status] ?? STATUS_BADGE.off
      }`}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status] ?? STATUS_DOT.off}`}
      />
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function MedicalAssistants({
  assistants,
}: {
  assistants: MedicalAssistantRow[];
}) {
  const usingSample = assistants.length === 0;
  const rows = usingSample ? PLACEHOLDER : assistants;
  const availableCount = rows.filter((a) => a.status === "available").length;

  return (
    <section
      aria-label="Medical assistants roster"
      className="flex flex-col rounded-md border border-hairline bg-panel shadow-panel"
    >
      <header className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-2.5">
        <div className="flex items-baseline gap-3">
          <h2 className="font-display text-sm font-semibold tracking-tight">
            Medical Assistants
          </h2>
          <span className="font-mono text-[11px] text-muted">
            {availableCount}/{rows.length} available
          </span>
        </div>
        {usingSample && (
          <span className="shrink-0 rounded-full border border-hairline px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted">
            sample data
          </span>
        )}
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-left text-sm">
          <caption className="sr-only">
            Medical assistants with their staff ID, specialization, location, and
            current availability.
          </caption>
          <thead>
            <tr className="border-b border-hairline font-mono text-[11px] uppercase tracking-wider text-muted">
              <th scope="col" className="px-4 py-2 font-normal">Assistant</th>
              <th scope="col" className="px-4 py-2 font-normal">ID</th>
              <th scope="col" className="px-4 py-2 font-normal">Specialization</th>
              <th scope="col" className="px-4 py-2 font-normal">Location</th>
              <th scope="col" className="px-4 py-2 font-normal">Availability</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {rows.map((a) => (
              <tr key={a.id} className="transition-colors hover:bg-base/40">
                <th
                  scope="row"
                  className="whitespace-nowrap px-4 py-2.5 font-body text-sm font-medium text-ink"
                >
                  {a.name}
                </th>
                <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[13px] text-muted">
                  {a.code}
                </td>
                <td className="px-4 py-2.5 text-ink/90">{a.specialization}</td>
                <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[13px] text-muted">
                  {a.location}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={a.status} />
                    {a.availability && (
                      <span className="whitespace-nowrap font-mono text-[11px] text-muted">
                        {a.availability}
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
