import { getRepos } from "@/lib/db";
import { requireEventAdmin } from "@/lib/session";
import { headers } from "next/headers";
import { PageHeader } from "@/components/page-header";
import { EmbedBuilder } from "./embed-builder";

export default async function EmbedsPage({
  params,
}: {
  params: Promise<{ eventSlug: string }>;
}) {
  const { eventSlug } = await params;
  const { event } = await requireEventAdmin(eventSlug);
  const tracks = await (await getRepos()).tracks.listByEvent(event.id);
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");

  return (
    <div>
      <PageHeader
        title="Embed builder"
        description="Choose a widget, output format, branding, filters, and fields for another site."
      />
      <EmbedBuilder
        eventSlug={eventSlug}
        tracks={tracks.map((track) => track.name)}
        origin={`${protocol}://${host}`}
      />
    </div>
  );
}
