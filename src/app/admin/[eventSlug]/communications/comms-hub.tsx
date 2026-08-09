"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellRingIcon } from "lucide-react";
import { toast } from "sonner";
import type { MergeData } from "@/domain/comms-templates";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { sendRemindersNow } from "./actions";
import { ComposeForm } from "./compose-form";
import { EmailLogTable } from "./email-log-table";
import { InvitesPanel } from "./invites-panel";
import { TemplateEditor } from "./template-editor";
import type { InviteRow, LogRow, SpeakerOption, TemplateRow } from "./types";

/**
 * Shell for the four things an organizer does with communications: read what
 * has been sent, write something new, edit the standard wording, and get
 * sessions into speakers' calendars.
 *
 * The tabs share one client boundary so that sending a message can drop the
 * user back on the log with the new row visible (`router.refresh()` re-runs
 * the server component, and the tab state survives because it lives here).
 */
export function CommsHub({
  eventSlug,
  eventMergeData,
  logRows,
  speakers,
  templates,
  invites,
}: {
  eventSlug: string;
  /** This event's real merge data (dates, URLs, organizer name) — see
   * ComposeForm for how it overlays `templatePreviewData`. */
  eventMergeData: MergeData;
  logRows: LogRow[];
  speakers: SpeakerOption[];
  templates: TemplateRow[];
  invites: InviteRow[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState("log");
  const [running, startRun] = useTransition();

  function sendDigestsNow() {
    startRun(async () => {
      const result = await sendRemindersNow(eventSlug);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const { sent, failed, skipped, skipSummary } = result.data;
      if (sent === 0) {
        // A quiet run is the normal outcome, not a failure — say *why* it was
        // quiet so the button doesn't look broken (D-039).
        toast.success("Nothing to send", {
          description:
            skipped > 0
              ? `No digest was due: ${skipSummary}.`
              : "Every speaker's checklist is already clear.",
        });
        return;
      }
      toast.success(`Sent ${sent} email${sent === 1 ? "" : "s"}`, {
        description: [
          failed > 0 ? `${failed} failed to send.` : null,
          skipped > 0 ? `Skipped ${skipped}: ${skipSummary}.` : null,
        ]
          .filter(Boolean)
          .join(" "),
      });
      router.refresh();
    });
  }

  return (
    <Tabs value={tab} onValueChange={setTab} className="gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList>
          <TabsTrigger value="log">Log</TabsTrigger>
          <TabsTrigger value="compose">Compose</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="invites">Calendar invites</TabsTrigger>
        </TabsList>

        <Button variant="outline" onClick={sendDigestsNow} disabled={running}>
          <BellRingIcon />
          {running ? "Sending…" : "Send task digest now"}
        </Button>
      </div>

      <TabsContent value="log">
        <EmailLogTable rows={logRows} speakers={speakers} />
      </TabsContent>

      <TabsContent value="compose">
        <ComposeForm
          eventSlug={eventSlug}
          eventMergeData={eventMergeData}
          speakers={speakers}
          onSent={() => {
            setTab("log");
            router.refresh();
          }}
        />
      </TabsContent>

      <TabsContent value="templates">
        <TemplateEditor eventSlug={eventSlug} templates={templates} />
      </TabsContent>

      <TabsContent value="invites">
        <InvitesPanel eventSlug={eventSlug} invites={invites} />
      </TabsContent>
    </Tabs>
  );
}
