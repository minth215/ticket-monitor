import * as cheerio from "cheerio";
import { TicketInfo } from "../types";

export async function scrapeYes24(): Promise<TicketInfo[]> {
  const tickets: TicketInfo[] = [];

  try {
    const res = await fetch(
      "https://ticket.yes24.com/New/Genre/GenreList.aspx?genretype=1&genre=15456",
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

    $(".list-grid li, .genre-list li, .content-list li").each((i, el) => {
      const $el = $(el);
      const title =
        $el.find(".list-title, .show-title, .tit").first().text().trim() ||
        $el.find("a").attr("title")?.trim();
      if (!title) return;

      const link = $el.find("a").attr("href") || "";
      const url = link.startsWith("http")
        ? link
        : `https://ticket.yes24.com${link}`;

      const dateText =
        $el.find(".list-date, .show-date, .date").first().text().trim() || "";
      const venue =
        $el.find(".list-place, .show-place, .place").first().text().trim() ||
        "";
      const imageUrl = $el.find("img").attr("src") || "";

      const parsed = parseDateRange(dateText);

      for (const date of parsed) {
        tickets.push({
          id: `yes24-${i}-${date}`,
          title,
          date,
          venue: venue || undefined,
          platform: "yes24",
          url,
          imageUrl: imageUrl
            ? imageUrl.startsWith("http")
              ? imageUrl
              : `https://ticket.yes24.com${imageUrl}`
            : undefined,
        });
      }
    });
  } catch (e) {
    console.error("Yes24 scraper error:", e);
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
