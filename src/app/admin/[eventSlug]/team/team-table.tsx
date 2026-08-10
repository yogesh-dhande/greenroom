"use client";

import { useState, useTransition } from "react";
import { TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import type { Role } from "@/db/entities";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/domain/team";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/empty-state";
import { changeTeamRole } from "./actions";
import { EditNameDialog } from "./edit-name-dialog";
import { ReviewerTracksDialog } from "./reviewer-tracks-dialog";
import type { TeamMemberRow, TrackOption } from "./types";

const ROLE_CHOICES: Role[] = ["admin", "reviewer", "speaker"];

/**
 * The roster. Each row's role is a select rather than a set of buttons —
 * "make reviewer" and "remove from team" are the same operation on the same
 * column, and a select says so.
 *
 * The last-admin rule is enforced on the server (src/domain/team.ts); here it
 * only removes the trap door in advance, so an organizer isn't offered a
 * choice that will bounce.
 */
export function TeamTable({
  eventSlug,
  members,
  tracks,
  adminCount,
}: {
  eventSlug: string;
  members: TeamMemberRow[];
  tracks: TrackOption[];
  adminCount: number;
}) {
  const [pendingDemotion, setPendingDemotion] = useState<TeamMemberRow | null>(null);
  const [isPending, startTransition] = useTransition();

  function apply(member: TeamMemberRow, role: Role) {
    startTransition(async () => {
      const result = await changeTeamRole(eventSlug, { userId: member.id, role });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.data.message);
      setPendingDemotion(null);
    });
  }

  function onRoleSelected(member: TeamMemberRow, next: string) {
    const role = next as Role;
    if (role === member.role) return;
    // Losing admin-area access entirely is worth one confirmation; moving
    // between admin and reviewer isn't.
    if (role === "speaker") {
      setPendingDemotion(member);
      return;
    }
    apply(member, role);
  }

  if (members.length === 0) {
    return (
      <EmptyState
        title="No admins or reviewers yet"
        description="Add someone below to give them access to this event."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Tracks</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((member) => {
            const isLastAdmin = member.role === "admin" && adminCount <= 1;
            return (
              <TableRow key={member.id}>
                <TableCell className="font-medium text-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    {/* An invite's name is optional (D-062) — someone added
                      * by address alone has none until they sign in and fill
                      * in a profile. */}
                    {member.name ?? <span className="text-muted-foreground">—</span>}
                    {member.isViewer && (
                      <Badge variant="outline">You</Badge>
                    )}
                    {!member.hasSignedIn && (
                      <Badge variant="secondary">Not signed in yet</Badge>
                    )}
                    <EditNameDialog
                      eventSlug={eventSlug}
                      member={member}
                      trigger={
                        <Button size="xs" variant="ghost">
                          Edit name
                        </Button>
                      }
                    />
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">{member.email}</TableCell>
                <TableCell>
                  <Select
                    value={member.role}
                    onValueChange={(next) => onRoleSelected(member, next)}
                    disabled={isPending || isLastAdmin}
                  >
                    <SelectTrigger size="sm" aria-label={`Role for ${member.name ?? member.email}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLE_CHOICES.map((role) => (
                        <SelectItem key={role} value={role}>
                          {role === "speaker" ? "Remove from team" : ROLE_LABELS[role]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {isLastAdmin && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      The only admin — promote someone else first.
                    </p>
                  )}
                </TableCell>
                <TableCell>
                  {member.role !== "reviewer" ? (
                    <span className="text-sm text-muted-foreground">
                      All tracks
                    </span>
                  ) : (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {member.trackNames.length === 0 ? (
                        <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                          <TriangleAlertIcon className="size-3.5" aria-hidden />
                          No tracks — empty queue
                        </span>
                      ) : (
                        member.trackNames.map((name) => (
                          <Badge key={name} variant="secondary">
                            {name}
                          </Badge>
                        ))
                      )}
                      <ReviewerTracksDialog
                        eventSlug={eventSlug}
                        member={member}
                        tracks={tracks}
                        trigger={
                          <Button size="xs" variant="ghost">
                            Edit tracks
                          </Button>
                        }
                      />
                    </div>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <p className="text-xs text-muted-foreground">
        {ROLE_LABELS.admin}: {ROLE_DESCRIPTIONS.admin} {ROLE_LABELS.reviewer}:{" "}
        {ROLE_DESCRIPTIONS.reviewer}
      </p>

      <AlertDialog
        open={pendingDemotion !== null}
        onOpenChange={(open) => !open && setPendingDemotion(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {pendingDemotion?.name ?? pendingDemotion?.email} from the team?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They keep their account and anything they&apos;ve submitted as a speaker, but lose
              access to the admin area and to any review queues. You can add them back at any
              time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isPending}
              onClick={() => pendingDemotion && apply(pendingDemotion, "speaker")}
            >
              {isPending ? "Removing…" : "Remove access"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
