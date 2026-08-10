"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SPEAKER_CSV_HEADER, type SpeakerImportOutcome } from "@/domain/speaker-import";
import {
  ActionTimeoutError,
  withActionTimeout,
} from "@/app/admin/[eventSlug]/speakers/action-timeout";
import { importContacts, type ImportContactsResult } from "./actions";

const OUTCOME_BADGE_CLASS: Record<SpeakerImportOutcome, string> = {
  created: "border-border text-foreground",
  merged: "border-border text-muted-foreground",
  skipped: "border-warning bg-warning/10 text-warning",
};

const OUTCOME_LABEL: Record<SpeakerImportOutcome, string> = {
  created: "Created",
  merged: "Merged",
  skipped: "Skipped",
};

/**
 * Org-level CSV import (spec.md "Org-level speaker CRM": same column rules as
 * the event roster import, deduplicating by email).
 *
 * Paste or pick a file — both paths end up as the same text, parsed by the
 * same pure function as the roster's import and written through the same
 * create-or-reuse call as "Add contact". The only difference is where people
 * land: the org registry, not an event roster.
 *
 * The dialog stays open on success to show the per-row result. An import that
 * merged half its rows into existing accounts is the normal outcome for an
 * org that already runs events, not a failure, and the organizer has to be
 * able to see which half.
 */
export function ImportContactsDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<ImportContactsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function reset() {
    setCsv("");
    setResult(null);
    setError(null);
  }

  async function onPickFile(file: File | undefined) {
    if (!file) return;
    setCsv(await file.text());
    setResult(null);
    setError(null);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      let response;
      try {
        response = await withActionTimeout(importContacts(csv));
      } catch (error) {
        if (error instanceof ActionTimeoutError) {
          setError(
            "The server didn't respond. Check the directory before trying again — some contacts may have been imported.",
          );
          return;
        }
        throw error;
      }
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setResult(response.data);
      const { created, merged, skipped } = response.data.summary;
      if (created + merged === 0 && response.data.problems.length > 0) {
        toast.error("Nothing could be imported — see the problems listed.");
      } else {
        toast.success(
          `${created} created, ${merged} merged${skipped > 0 ? `, ${skipped} skipped` : ""}`,
        );
      }
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Import CSV
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import contacts</DialogTitle>
          <DialogDescription>
            One row per contact, with the header <code>{SPEAKER_CSV_HEADER}</code>. Name and email
            are required; column order doesn&apos;t matter. Addresses that already have an account
            are merged, never duplicated — so re-importing the same file is safe.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="contact-csv">Paste CSV</Label>
            <Textarea
              id="contact-csv"
              rows={8}
              className="font-mono text-xs"
              placeholder={`${SPEAKER_CSV_HEADER}\nAda Lovelace,ada@example.com,Analyst,Analytical Engines,`}
              value={csv}
              onChange={(event) => setCsv(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="contact-csv-file">…or choose a file</Label>
            <input
              id="contact-csv-file"
              type="file"
              accept=".csv,text/csv,text/plain"
              className="text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-input file:bg-transparent file:px-3 file:py-1.5 file:text-sm file:text-foreground"
              onChange={(event) => onPickFile(event.target.files?.[0])}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          {result && (
            <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
              <p className="text-sm font-medium text-foreground">
                {result.summary.created} created · {result.summary.merged} merged ·{" "}
                {result.summary.skipped} skipped
              </p>

              {result.summary.rows.length > 0 && (
                <ul className="flex flex-col gap-1.5">
                  {result.summary.rows.map((row) => (
                    <li key={row.email} className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge variant="outline" className={OUTCOME_BADGE_CLASS[row.outcome]}>
                        {OUTCOME_LABEL[row.outcome]}
                      </Badge>
                      <span className="text-foreground">{row.name}</span>
                      <span className="text-muted-foreground">{row.email}</span>
                      {row.detail && (
                        <span className="text-xs text-muted-foreground">— {row.detail}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {result.problems.length > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-medium text-foreground">Rows we couldn&apos;t use</p>
                  <ul className="flex flex-col gap-0.5">
                    {result.problems.map((problem) => (
                      <li
                        key={`${problem.line}-${problem.message}`}
                        className="text-sm text-muted-foreground"
                      >
                        Line {problem.line}: {problem.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          {result ? (
            <Button type="button" variant="outline" onClick={reset}>
              Import another
            </Button>
          ) : null}
          <Button type="button" disabled={isPending || csv.trim() === ""} onClick={submit}>
            {isPending ? "Importing…" : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
