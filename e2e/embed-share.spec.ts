import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

const EVENT_SLUG = "ai-engineer-summit-2026";
const RETRIEVAL = "Retrieval that survives production traffic";
const HOSPITAL = "Shipping an agent into a hospital";

test("the organizer and public share surfaces expose every supported embed format", async ({
  page,
}) => {
  await signIn(page, "admin@greenroom.dev");
  await page.goto(`/admin/${EVENT_SLUG}`);

  const card = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "Embeds & feeds" });
  await expect(card).toContainText(`/embed/${EVENT_SLUG}/schedule`);
  await expect(card).toContainText(`/embed/${EVENT_SLUG}/speakers`);
  await expect(card).toContainText(`/p/${EVENT_SLUG}/feed.json`);
  await expect(card).toContainText(`/p/${EVENT_SLUG}/feed.xml`);
  await expect(card).toContainText(`/p/${EVENT_SLUG}/feed.ics`);

  await card.getByRole("link", { name: "embed builder" }).click();
  const widget = page.getByLabel("Widget type");
  await expect(widget.locator("option")).toHaveText([
    "List of Sessions",
    "List of Speakers",
    "Agenda",
    "Schedule Itinerary",
    "Speaker Gallery",
  ]);
  await expect(page.getByLabel("Output format").locator("option")).toHaveText([
    "Script / basic HTML",
    "iframe",
    "JSON",
    "XML",
    "iCal",
  ]);
  await widget.selectOption("sessions");
  await page
    .getByLabel("Track filter")
    .selectOption({ label: "AI Engineering" });
  await page.getByLabel("Description").uncheck();
  await page.getByLabel("Primary color").fill("#ff0000");
  await page.getByLabel("Custom CSS").fill("article { border-radius: 0; }");
  const output = page.getByTestId("embed-output");
  await expect(output).toContainText("widget=sessions");
  await expect(output).toContainText("track=AI+Engineering");
  await expect(output).toContainText("description=0");
  await expect(output).toContainText("primary=%23ff0000");

  await page.getByLabel("Output format").selectOption("xml");
  await expect(output).toContainText(`/p/${EVENT_SLUG}/feed.xml`);
  const xml = await page.request.get(
    `/p/${EVENT_SLUG}/feed.xml?track=AI%20Engineering&description=0`,
  );
  expect(xml.status()).toBe(200);
  expect(xml.headers()["content-type"]).toContain("application/xml");
  expect(await xml.text()).toContain("<program>");

  await page.goto(`/p/${EVENT_SLUG}/schedule`);
  await page.getByRole("button", { name: "</> Embed" }).click();
  const popover = page.getByText("Embed this page").locator("..");
  await expect(popover).toContainText(
    `<script src="${new URL(page.url()).origin}/embed.js" data-event="${EVENT_SLUG}" data-view="schedule" async></script>`,
  );
  await expect(popover).toContainText(
    `<iframe src="${new URL(page.url()).origin}/embed/${EVENT_SLUG}/schedule"`,
  );
  await expect(
    popover.getByRole("link", { name: /feed\.json/ }),
  ).toHaveAttribute(
    "href",
    `${new URL(page.url()).origin}/p/${EVENT_SLUG}/feed.json`,
  );
  await expect(
    popover.getByRole("link", { name: /feed\.ics/ }),
  ).toHaveAttribute(
    "href",
    `${new URL(page.url()).origin}/p/${EVENT_SLUG}/feed.ics`,
  );
});

test("a configured script applies widget, track, field, color, and CSS choices", async ({
  page,
  baseURL,
}) => {
  const path = `/embed/${EVENT_SLUG}/schedule?widget=sessions&track=AI%20Engineering&description=0&primary=%23ff0000&css=${encodeURIComponent("article { border-radius: 0; }")}`;
  await page.setContent(`
    <!doctype html><html><body>
      <script src="${baseURL}/embed.js" data-path="${path.replaceAll("&", "&amp;")}" async></script>
    </body></html>
  `);

  const iframe = page.locator('iframe[title="Event program"]');
  await expect(iframe).toHaveAttribute("src", `${baseURL}${path}`);
  const frame = page.frameLocator('iframe[title="Event program"]');
  await expect(frame.getByTestId("session-list-widget")).toBeVisible();
  await expect(frame.getByText(RETRIEVAL)).toBeVisible();
  await expect(frame.getByText(HOSPITAL)).toHaveCount(0);
  await expect(
    frame.getByText("Most RAG demos fall over", { exact: false }),
  ).toHaveCount(0);
  expect(
    await frame
      .locator('[data-widget="sessions"]')
      .evaluate((element) =>
        (element as HTMLElement).style.getPropertyValue("--primary"),
      ),
  ).toBe("#ff0000");
  await expect(frame.locator("article").first()).toHaveCSS(
    "border-radius",
    "0px",
  );
});

test("the one-line script renders a live interactive schedule on a third-party page", async ({
  page,
  baseURL,
}) => {
  await page.setContent(`
    <!doctype html>
    <html>
      <body>
        <h1>Host site</h1>
        <script src="${baseURL}/embed.js" data-event="${EVENT_SLUG}" data-view="schedule" async></script>
      </body>
    </html>
  `);

  const iframe = page.locator('iframe[title="Event program"]');
  await expect(iframe).toHaveAttribute(
    "src",
    `${baseURL}/embed/${EVENT_SLUG}/schedule`,
  );
  const widget = page.frameLocator('iframe[title="Event program"]');
  await expect(widget.getByText(RETRIEVAL)).toBeVisible();
  const search = widget.getByLabel("Search sessions");
  // The iframe can paint its server-rendered sessions just before React owns
  // the controlled search input. Retry the interaction so a hydration reset
  // cannot discard the query under full-suite load.
  await expect(async () => {
    await search.fill("hospital");
    await expect(search).toHaveValue("hospital");
    await expect(widget.getByText(HOSPITAL)).toBeVisible();
  }).toPass({ timeout: 10_000 });
  await expect(widget.getByText(RETRIEVAL)).toHaveCount(0);
  await expect
    .poll(() =>
      iframe.evaluate((element) => (element as HTMLIFrameElement).style.height),
    )
    .not.toBe("");
});
