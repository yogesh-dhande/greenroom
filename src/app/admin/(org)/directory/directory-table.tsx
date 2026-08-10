"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MailIcon } from "lucide-react";
import type { MergeData } from "@/domain/comms-templates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BulkEmailDialog } from "./bulk-email-dialog";
import type { DirectoryRow } from "./types";

/**
 * The directory table with row selection (spec.md "Org-level speaker CRM").
 *
 * Selection is the gateway to bulk outreach, so it lives here rather than in
 * the page: the checkbox column, the "N selected" counter and the "Email
 * selected" button are one control surface, and the button is disabled at
 * zero rather than hidden so the affordance is discoverable before anything
 * is ticked.
 *
 * Rows carry a `duplicate` flag computed against the *whole* directory, not
 * the filtered rows, so a same-name collision doesn't disappear just because
 * a filter hides the other record (decisions.md D-059; merge stays out of
 * scope per D-065 — the flag plus side-by-side links is the guard).
 */
export function DirectoryTable({
  rows,
  orgFields,
}: {
  rows: DirectoryRow[];
  /** organizerName/organizerEmail/portalUrl for the composer's preview. */
  orgFields: MergeData;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [composing, setComposing] = useState(false);

  const visibleIds = new Set(rows.map((row) => row.userId));
  // A filter change can hide a ticked row; only ever email who is on screen.
  const activeSelection = selected.filter((id) => visibleIds.has(id));
  const recipients = rows
    .filter((row) => activeSelection.includes(row.userId))
    .map((row) => ({
      userId: row.userId,
      name: row.name,
      email: row.email,
      displayName: row.displayName,
    }));

  function toggle(userId: string, checked: boolean) {
    setSelected((current) =>
      checked ? [...current, userId] : current.filter((id) => id !== userId),
    );
  }

  const allSelected = rows.length > 0 && activeSelection.length === rows.length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          disabled={activeSelection.length === 0}
          onClick={() => setComposing(true)}
        >
          <MailIcon />
          Email selected ({activeSelection.length})
        </Button>
        <span className="text-sm text-muted-foreground">
          {activeSelection.length} selected of {rows.length}
        </span>
        {activeSelection.length > 0 ? (
          <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
            Clear selection
          </Button>
        ) : null}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                aria-label="Select all contacts"
                checked={allSelected}
                onCheckedChange={(checked) =>
                  setSelected(checked ? rows.map((row) => row.userId) : [])
                }
              />
            </TableHead>
            <TableHead>Contact</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Title</TableHead>
            <TableHead>Company</TableHead>
            <TableHead>Tags</TableHead>
            <TableHead>Events</TableHead>
            <TableHead>Pipeline</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.userId} className="relative">
              <TableCell>
                {/* Above the row-wide link overlay, or the checkbox would be
                    unclickable — ticking a row must not also open it. */}
                <span className="relative z-10 flex">
                  <Checkbox
                    aria-label={`Select ${row.displayName}`}
                    checked={activeSelection.includes(row.userId)}
                    onCheckedChange={(checked) => toggle(row.userId, checked === true)}
                  />
                </span>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  {/* Whole-row click target: the name link's overlay
                      pseudo-element stretches across the positioned row (the
                      same pattern the event roster uses), so a pointer
                      anywhere on the row opens the profile while the
                      accessible name and the real href stay on the name. */}
                  <Link
                    href={`/admin/directory/${row.userId}`}
                    className="font-medium text-foreground underline-offset-4 outline-none after:absolute after:inset-0 after:content-[''] hover:underline"
                  >
                    {row.displayName}
                  </Link>
                  {row.duplicate ? (
                    <Badge
                      variant="outline"
                      className="border-warning bg-warning/10 text-warning"
                      title={row.duplicateWith}
                    >
                      Possible duplicate
                    </Badge>
                  ) : null}
                </div>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">{row.email}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{row.title ?? "—"}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{row.company ?? "—"}</TableCell>
              <TableCell>
                {row.tags.length === 0 ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {row.tags.map((tag) => (
                      <Badge key={tag} variant="outline">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
              </TableCell>
              <TableCell className="tabular-nums text-muted-foreground">
                {row.eventCount}
              </TableCell>
              <TableCell>
                {row.stageLabel ? (
                  <Badge variant="outline">{row.stageLabel}</Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <BulkEmailDialog
        open={composing}
        onOpenChange={setComposing}
        recipients={recipients}
        orgFields={orgFields}
        onSent={() => {
          setSelected([]);
          router.refresh();
        }}
      />
    </div>
  );
}
