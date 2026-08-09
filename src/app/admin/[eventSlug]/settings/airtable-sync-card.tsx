"use client";

import { useTransition } from "react";
import { RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { syncToAirtableNow } from "./actions";

/**
 * "Sync to Airtable now" — the on-demand twin of the cron job
 * (docs/airtable-sync.md, decisions.md D-036).
 *
 * The result is reported as a toast rather than persisted state because the
 * sync writes nothing back into Greenroom: there is no row on this page for a
 * successful run to change. An unconfigured base is reported as information,
 * not an error — the owner may simply not have set the token yet.
 */
export function AirtableSyncCard({ eventSlug }: { eventSlug: string }) {
  const [running, startRun] = useTransition();

  function run() {
    startRun(async () => {
      const result = await syncToAirtableNow(eventSlug);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      const { skipped, skippedReason, created, updated, failed, tablesCreated, error } =
        result.data;

      if (skipped) {
        toast.info("Airtable isn't configured", {
          description: `Nothing was sent — ${skippedReason}.`,
        });
        return;
      }

      if (created + updated === 0 && failed > 0) {
        toast.error("Airtable sync failed", { description: error ?? "No records were written." });
        return;
      }

      toast.success(
        `Synced ${created + updated} record${created + updated === 1 ? "" : "s"} to Airtable`,
        {
          description: [
            `${created} created, ${updated} updated.`,
            tablesCreated.length > 0 ? `Created tables: ${tablesCreated.join(", ")}.` : null,
            failed > 0 ? `${failed} failed — ${error ?? "see the logs"}.` : null,
          ]
            .filter(Boolean)
            .join(" "),
        },
      );
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <p className="text-muted-foreground max-w-md text-sm">
        Pushes this event&apos;s speakers, submissions, sessions, and tasks into the connected
        Airtable base so your existing automations pick them up. Runs automatically every 15
        minutes; Greenroom stays the source of truth, so nothing is read back.
      </p>
      <Button variant="outline" onClick={run} disabled={running}>
        <RefreshCwIcon />
        {running ? "Syncing…" : "Sync to Airtable now"}
      </Button>
    </div>
  );
}
