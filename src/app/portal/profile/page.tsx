import { requireUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

export default async function ProfilePage() {
  await requireUser("/portal/profile");

  return (
    <div>
      <PageHeader
        title="Your profile"
        description="Bio, headshot, and social links — shown on the public speaker gallery."
      />
      <EmptyState
        title="Profile editing isn't ready yet"
        description="Editing your bio, headshot, and links lands in a later wave."
      />
    </div>
  );
}
