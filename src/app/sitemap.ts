import type { MetadataRoute } from "next";
import { formWindowState } from "@/domain/forms";
import { programVisible } from "@/domain/program-visibility";
import { getRepos } from "@/lib/db";
import { publicBaseUrl } from "@/lib/public-url";

export const dynamic = "force-dynamic";

/**
 * `/sitemap.xml` over the public program surfaces.
 *
 * An event earns a listing only once its organizer has announced it somehow —
 * either the program is published (D-056) or a call for speakers is published
 * and currently open. `/p/<slug>` stays *reachable* before that, showing a
 * coming-soon note, but reachable and advertised are different things: the
 * page names the event, its dates, its location, and its description, so
 * listing every slug here would hand a crawler an enumerable directory of
 * unannounced events. Guessing a slug is one thing; being given the list is
 * another.
 *
 * Deliberately *not* a public event directory even for announced events: this
 * is a crawler artifact, and run 8 recorded a browsable directory as outside
 * current product scope. If that changes it should change as a decision, not
 * as a side effect here.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = await publicBaseUrl();
  const repos = await getRepos();
  const events = await repos.events.listAll();

  const entries: MetadataRoute.Sitemap = [{ url: `${base}/`, changeFrequency: "monthly" }];

  for (const event of events) {
    const published = programVisible(event);
    // A published, currently-open CFP is the organizer announcing the event
    // themselves — the `/submit/<form>` link is public and lands people on
    // `/p/<slug>`, so the landing page is fair game for a crawler too.
    const openCfp = published
      ? false
      : (await repos.forms.listPublishedByEvent(event.id)).some(
          (form) => formWindowState(form) === "open",
        );
    if (!published && !openCfp) continue;

    const lastModified = event.updatedAt ?? undefined;
    entries.push({ url: `${base}/p/${event.slug}`, lastModified, changeFrequency: "weekly" });
    if (!published) continue;
    entries.push({
      url: `${base}/p/${event.slug}/schedule`,
      lastModified,
      changeFrequency: "weekly",
    });
    entries.push({
      url: `${base}/p/${event.slug}/speakers`,
      lastModified,
      changeFrequency: "weekly",
    });
    entries.push({
      url: `${base}/p/${event.slug}/gallery`,
      lastModified,
      changeFrequency: "weekly",
    });
  }

  return entries;
}
