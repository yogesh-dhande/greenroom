"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { ReviewRecommendation } from "@/db/entities";
import type { ReviewTally } from "@/domain/review";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { saveMyReview } from "../actions";

/**
 * A reviewer's own recommendation, plus where the room currently stands
 * (spec.md §4: "unreviewed → approve / maybe / deny", with a comment).
 *
 * One review per person per submission — saving replaces the reviewer's
 * previous vote rather than stacking another one, so changing your mind is a
 * normal thing to do rather than a data problem.
 */

const OPTIONS: Array<{ value: ReviewRecommendation; label: string }> = [
  { value: "approve", label: "Approve" },
  { value: "maybe", label: "Maybe" },
  { value: "deny", label: "Deny" },
];

export function ReviewPanel({
  eventSlug,
  submissionId,
  tally,
  myReview,
}: {
  eventSlug: string;
  submissionId: string;
  tally: ReviewTally;
  myReview: { recommendation: ReviewRecommendation | null; comment: string | null } | null;
}) {
  const [recommendation, setRecommendation] = useState<ReviewRecommendation | "">(
    myReview?.recommendation ?? "",
  );
  const [comment, setComment] = useState(myReview?.comment ?? "");
  const [isPending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const result = await saveMyReview(eventSlug, submissionId, { recommendation, comment });
      if (!result.ok) toast.error(result.error);
      else toast.success(myReview ? "Review updated" : "Review saved");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your review</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label>Recommendation</Label>
          <div className="flex gap-2">
            {OPTIONS.map((option) => {
              const selected = recommendation === option.value;
              return (
                <Button
                  key={option.value}
                  type="button"
                  size="sm"
                  variant={selected ? "default" : "outline"}
                  aria-pressed={selected}
                  className="flex-1"
                  // Clicking the current choice clears it, leaving a
                  // comment-only review — a reviewer is allowed to say
                  // "here's context" without casting a vote.
                  onClick={() => setRecommendation(selected ? "" : option.value)}
                >
                  {option.label}
                </Button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="review-comment">Comment</Label>
          <Textarea
            id="review-comment"
            rows={4}
            placeholder="What would make this talk land — or not?"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
        </div>

        <Button onClick={save} disabled={isPending} className="self-start">
          {isPending ? "Saving…" : myReview ? "Update review" : "Save review"}
        </Button>

        <p className="text-sm text-muted-foreground" data-testid="review-tally">
          {tallyLine(tally)}
        </p>
      </CardContent>
    </Card>
  );
}

/** The room's current position in one line: counts first, then the leaning. */
function tallyLine(tally: ReviewTally): string {
  if (tally.total === 0) return "No reviews yet.";
  const counts = [
    tally.approve > 0 ? `${tally.approve} approve` : null,
    tally.maybe > 0 ? `${tally.maybe} maybe` : null,
    tally.deny > 0 ? `${tally.deny} deny` : null,
  ].filter(Boolean);
  const reviews = `${tally.total} review${tally.total === 1 ? "" : "s"}`;
  return counts.length === 0 ? `${reviews}, no votes yet.` : `${reviews}: ${counts.join(", ")}.`;
}
