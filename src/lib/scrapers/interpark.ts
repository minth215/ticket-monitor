import * as cheerio from "cheerio";
import { TicketInfo } from "../types";

export async function scrapeInterpark(): Promise<TicketInfo[]> {
  const tickets: TicketInfo[] = [];

  try {
    const res = await fetch(
      "https://tickets.interpark.com/contents/genre/concert",
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        next: { revalidate: 3600 },
      }
    );

    if (!res.ok) return tickets;

    const html = await res.text();
    const $ = cheerio.load(html);

    $(
      ".list_item li, .ranking-list li, .contents-list li, .prd-list li"
    ).each((i, el) => {
      const $el = $(el);
      const title =
        $el.find(".prd-name, .show-title, .tit").first().text().trim() ||
        $el.find("a").attr("title")?.trim();
      if (!title) return;

      const link = $el.find("a").attr("href") || "";
      const url = link.startsWith("http")
        ? link
        : `https://tickets.interpark.com${link}`;

      const dateText =
        $el.find(".prd-date, .show-date, .date").first().text().trim() || "";
      const venue =
        $el.find(".prd-place, .show-place, .place").first().text().trim() || "";
      const imageUrl = $el.find("img").attr("src") || "";

      const parsed = parseDateRange(dateText);

      for (const date of parsed) {
        tickets.push({
          id: `interpark-${i}-${date}`,
          title,
          date,
          venue: venue || undefined,
          platform: "interpark",
          url,
          imageUrl: imageUrl || undefined,
        });
      }
    });
  } catch (e) {
    console.error("Interpark scraper error:", e);
  }

  return tickets;
}

function parseDateRange(text: string): string[] {
  const dates: string[] = [];
  const match = text.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (match) {
    const [, y, m, d] = match;
    dates.push(`${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`);
  }
  return dates.length > 0 ? dates : [new Date().toISOString().slice(0, 10)];
}
