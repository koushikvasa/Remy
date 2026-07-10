"use client";

import { useEffect, useRef, useState } from "react";
import type { ReferralDraft } from "../lib/types";
import { DRAFT_FIELDS } from "../lib/runState";
import { disciplineLabel } from "../lib/format";

const LABELS: Record<(typeof DRAFT_FIELDS)[number], string> = {
  patient_first_initial: "Initial",
  patient_age: "Age",
  diagnosis_summary: "Diagnosis",
  discipline_needed: "Discipline",
  payer_raw: "Payer",
  zip: "ZIP",
  requested_start: "Start",
};

function display(field: (typeof DRAFT_FIELDS)[number], value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (field === "discipline_needed") return disciplineLabel(String(value));
  return String(value);
}

function FieldSlot({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  const [flash, setFlash] = useState(false);
  const prev = useRef<string>("");

  useEffect(() => {
    const wasEmpty = prev.current === "";
    const nowFilled = value !== "";
    if (wasEmpty && nowFilled) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 320);
      prev.current = value;
      return () => clearTimeout(t);
    }
    prev.current = value;
  }, [value]);

  const filled = value !== "";

  return (
    <div
      className={`rounded border border-hairline bg-base/40 px-3 py-2 ${
        flash ? "fill-flash" : ""
      }`}
    >
      <div className="font-mono text-[9px] uppercase tracking-widest text-muted">
        {label}
      </div>
      <div
        className={`mt-1 truncate text-sm ${
          filled ? "text-ink" : "text-muted/50"
        } ${mono ? "font-mono" : "font-body"}`}
        title={filled ? value : undefined}
      >
        {filled ? value : "–––"}
      </div>
    </div>
  );
}

export function DraftGrid({ draft }: { draft: ReferralDraft }) {
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      {DRAFT_FIELDS.map((field) => (
        <FieldSlot
          key={field}
          label={LABELS[field]}
          value={display(field, draft[field])}
          mono={
            field === "zip" ||
            field === "patient_age" ||
            field === "patient_first_initial"
          }
        />
      ))}
    </div>
  );
}
