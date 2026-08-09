import type { Role } from "@/db/entities";

/** One row of the team table, flattened for the client island. */
export interface TeamMemberRow {
  id: string;
  name: string | null;
  email: string;
  role: Role;
  /** True for the signed-in admin, so the table can say "you". */
  isViewer: boolean;
  /**
   * Whether they've ever clicked a magic link. False for an address added
   * here that hasn't been used yet — the closest thing to "invitation
   * pending" without an invites table (see ./actions.ts).
   */
  hasSignedIn: boolean;
  /** This event's tracks the person reviews; empty for admins. */
  trackIds: string[];
  trackNames: string[];
}

export interface TrackOption {
  id: string;
  name: string;
}
