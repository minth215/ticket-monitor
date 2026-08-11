import { chromium, Browser, Page } from "playwright-core";
import * as fs from "fs";
import * as path from "path";

interface TicketInfo {
  id: string;
  title: string;
  date: string;
  time?: string;
  venue?: string;
  platform: "melon" | "yes24" | "interpark" | "nol" | "ticketlink";
  url: string;
  imageUrl?: string;
}

function parseKoreanDate(text: string): string[] {
  const dates: string[] = [];
  const matches = text.match(/(\d{4})[.\-/\s](\d{1,2})[.\-/\s](\d{1,2})/g);
  if (matches) {
    for (const m of matches) {
      const parts = m.split(/[.\-/\s]+/);
      if (parts.length >= 3) {
        dates.push(
          `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`
        );
      }
    }
  }
  // range → start date only
  if (dates.length >= 2) return [dates[0]];
  return dates;
}

async function withPage(
  browser: Browser,
  url: string,
  fn: (page: Page) => Promise<TicketInfo[]>
): Promise<TicketInfo[]> {
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    return await fn(page);
  } catch (e) {
    console.warn(`  Page error for ${url}:`, (e as Error).message);
    return [];
  } finally {
    await page.close();
  }
}

// ─── 멜론티켓 ───────────────────────────────────────────
async function scrapeMelon(browser: Browser): Promise<TicketInfo[]> {
  console.log("[멜론티켓] 스크래핑 시작...");
  const tickets = await withPage(
    browser,
    "https://ticket.melon.com/concert/index.htm?genreType=GENRE_CON",
    async (page) => {
      await page.waitForTimeout(3000);
      return page.evaluate(() => {
        const items: TicketInfo[] = [];
        document
          .querySelectorAll(
            "#conts .list_thumb li, #conts .thumb_list li, .list_item li, .festival_list li, [class*=list] li"
          )
          .forEach((el, i) => {
            const anchor = el.querySelector("a");
            const titleEl =
              el.querySelector("[class*=ellipsis], [class*=tit], [class*=name]") ||
              anchor;
            const title =
              titleEl?.textContent?.trim() ||
              anchor?.getAttribute("title")?.trim() ||
              el.querySelector("img")?.getAttribute("alt")?.trim();
            if (!title || title.length < 2) return;

            const href = anchor?.getAttribute("href") || "";
            const url = href.startsWith("http")
              ? href
              : href
                ? `https://ticket.melon.com${href}`
                : "https://ticket.melon.com";

            const dateEl = el.querySelector(
              "[class*=date], [class*=period], [class*=day]"
            );
            const dateText = dateEl?.textContent?.trim() || "";

            const placeEl = el.querySelector(
              "[class*=place], [class*=venue], [class*=hall]"
            );
            const venue = placeEl?.textContent?.trim() || "";

            const img = el.querySelector("img")?.getAttribute("src") || "";

            items.push({
              id: `melon-${i}`,
              title: title.replace(/\s+/g, " "),
              date: dateText,
              venue: venue || undefined,
              platform: "melon" as const,
              url,
              imageUrl: img || undefined,
            });
          });
        return items;
      });
    }
  );

  const result = postProcess(tickets, "melon");
  console.log(`[멜론티켓] ${result.length}개 수집`);
  return result;
}

// ─── Yes24 ──────────────────────────────────────────────
async function scrapeYes24(browser: Browser): Promise<TicketInfo[]> {
  console.log("[Yes24] 스크래핑 시작...");
  const tickets = await withPage(
    browser,
    "https://ticket.yes24.com/New/Genre/GenreList.aspx?genretype=1&genre=15456",
    async (page) => {
      await page.waitForTimeout(3000);
      return page.evaluate(() => {
        const items: TicketInfo[] = [];
        document
          .querySelectorAll(
            "[class*=genre] li, [class*=list] li, [class*=item], .content-area li"
          )
          .forEach((el, i) => {
            const anchor = el.querySelector("a");
            const titleEl =
              el.querySelector(
                "[class*=title], [class*=tit], [class*=name], [class*=gen-]"
              ) || anchor;
            const title =
              titleEl?.textContent?.trim() ||
              anchor?.getAttribute("title")?.trim() ||
              el.querySelector("img")?.getAttribute("alt")?.trim();
            if (!title || title.length < 2) return;

            const href = anchor?.getAttribute("href") || "";
            const url = href.startsWith("http")
              ? href
              : href
                ? `https://ticket.yes24.com${href}`
                : "https://ticket.yes24.com";

            const dateEl = el.querySelector(
              "[class*=date], [class*=period], [class*=day]"
            );
            const dateText = dateEl?.textContent?.trim() || "";

            const placeEl = el.querySelector(
              "[class*=place], [class*=venue], [class*=hall]"
            );
            const venue = placeEl?.textContent?.trim() || "";

            const img = el.querySelector("img")?.getAttribute("src") || "";

            items.push({
              id: `yes24-${i}`,
              title: title.replace(/\s+/g, " "),
              date: dateText,
              venue: venue || undefined,
              platform: "yes24" as const,
              url,
              imageUrl: img
                ? img.startsWith("http")
                  ? img
                  : `https://ticket.yes24.com${img}`
                : undefined,
            });
          });
        return items;
      });
    }
  );

  const result = postProcess(tickets, "yes24");
  console.log(`[Yes24] ${result.length}개 수집`);
  return result;
}

// ─── 인터파크 ───────────────────────────────────────────
async function scrapeInterpark(browser: Browser): Promise<TicketInfo[]> {
  console.log("[인터파크] 스크래핑 시작...");
  const tickets = await withPage(
    browser,
    "https://tickets.interpark.com/contents/genre/concert",
    async (page) => {
      await page.waitForTimeout(5000);
      return page.evaluate(() => {
        const items: TicketInfo[] = [];
        document
          .querySelectorAll(
            "[class*=prd] li, [class*=list] li, [class*=item], [class*=ranking] li, [class*=card]"
          )
          .forEach((el, i) => {
            const anchor = el.querySelector("a");
            const titleEl =
              el.querySelector(
                "[class*=name], [class*=title], [class*=tit], [class*=prd-name]"
              ) || anchor;
            const title =
              titleEl?.textContent?.trim() ||
              anchor?.getAttribute("title")?.trim() ||
              el.querySelector("img")?.getAttribute("alt")?.trim();
            if (!title || title.length < 2) return;

            const href = anchor?.getAttribute("href") || "";
            const url = href.startsWith("http")
              ? href
              : href
                ? `https://tickets.interpark.com${href}`
                : "https://tickets.interpark.com";

            const dateEl = el.querySelector(
              "[class*=date], [class*=period], [class*=day]"
            );
            const dateText = dateEl?.textContent?.trim() || "";

            const placeEl = el.querySelector(
              "[class*=place], [class*=venue], [class*=hall]"
            );
            const venue = placeEl?.textContent?.trim() || "";

            const img = el.querySelector("img")?.getAttribute("src") || "";

            items.push({
              id: `interpark-${i}`,
              title: title.replace(/\s+/g, " "),
              date: dateText,
              venue: venue || undefined,
              platform: "interpark" as const,
              url,
              imageUrl: img || undefined,
            });
          });
        return items;
      });
    }
  );

  const result = postProcess(tickets, "interpark");
  console.log(`[인터파크] ${result.length}개 수집`);
  return result;
}

// ─── 놀 티켓 ────────────────────────────────────────────
async function scrapeNol(browser: Browser): Promise<TicketInfo[]> {
  console.log("[놀 티켓] 스크래핑 시작...");

  const urls = [
    "https://ticket.nol.auction.co.kr/Category/ConcertList.aspx",
    "https://nol.auction.co.kr/concert/list.do",
  ];

  for (const url of urls) {
    const tickets = await withPage(browser, url, async (page) => {
      await page.waitForTimeout(3000);
      return page.evaluate(() => {
        const items: TicketInfo[] = [];
        document
          .querySelectorAll(
            "[class*=list] li, [class*=item], [class*=concert] li, [class*=thumb] li"
          )
          .forEach((el, i) => {
            const anchor = el.querySelector("a");
            const titleEl =
              el.querySelector(
                "[class*=tit], [class*=name], [class*=title]"
              ) || anchor;
            const title =
              titleEl?.textContent?.trim() ||
              anchor?.getAttribute("title")?.trim() ||
              el.querySelector("img")?.getAttribute("alt")?.trim();
            if (!title || title.length < 2) return;

            const href = anchor?.getAttribute("href") || "";
            const pageUrl = href.startsWith("http")
              ? href
              : href
                ? `https://nol.auction.co.kr${href}`
                : "https://nol.auction.co.kr";

            const dateEl = el.querySelector(
              "[class*=date], [class*=period], [class*=day]"
            );
            const dateText = dateEl?.textContent?.trim() || "";

            const placeEl = el.querySelector(
              "[class*=place], [class*=venue], [class*=hall]"
            );
            const venue = placeEl?.textContent?.trim() || "";

            items.push({
              id: `nol-${i}`,
              title: title.replace(/\s+/g, " "),
              date: dateText,
              venue: venue || undefined,
              platform: "nol" as const,
              url: pageUrl,
            });
          });
        return items;
      });
    });

    const result = postProcess(tickets, "nol");
    if (result.length > 0) {
      console.log(`[놀 티켓] ${result.length}개 수집`);
      return result;
    }
  }

  console.log("[놀 티켓] 0개 수집");
  return [];
}

// ─── 티켓링크 ───────────────────────────────────────────
async function scrapeTicketlink(browser: Browser): Promise<TicketInfo[]> {
  console.log("[티켓링크] 스크래핑 시작...");
  const tickets = await withPage(
    browser,
    "https://www.ticketlink.co.kr/performance/concert",
    async (page) => {
      await page.waitForTimeout(5000);
      return page.evaluate(() => {
        const items: TicketInfo[] = [];
        document
          .querySelectorAll(
            "[class*=product] li, [class*=list] li, [class*=item], [class*=performance] li, [class*=card], [class*=event] li, [class*=ranking] li"
          )
          .forEach((el, i) => {
            const anchor = el.querySelector("a");
            const titleEl =
              el.querySelector(
                "[class*=name], [class*=title], [class*=tit], [class*=prd]"
              ) || anchor;
            const title =
              titleEl?.textContent?.trim() ||
              anchor?.getAttribute("title")?.trim() ||
              el.querySelector("img")?.getAttribute("alt")?.trim();
            if (!title || title.length < 2) return;

            const href = anchor?.getAttribute("href") || "";
            const url = href.startsWith("http")
              ? href
              : href
                ? `https://www.ticketlink.co.kr${href}`
                : "https://www.ticketlink.co.kr";

            const dateEl = el.querySelector(
              "[class*=date], [class*=period], [class*=day]"
            );
            const dateText = dateEl?.textContent?.trim() || "";

            const placeEl = el.querySelector(
              "[class*=place], [class*=venue], [class*=hall]"
            );
            const venue = placeEl?.textContent?.trim() || "";

            const img = el.querySelector("img")?.getAttribute("src") || "";

            items.push({
              id: `ticketlink-${i}`,
              title: title.replace(/\s+/g, " "),
              date: dateText,
              venue: venue || undefined,
              platform: "ticketlink" as const,
              url,
              imageUrl: img
                ? img.startsWith("http")
                  ? img
                  : `https://www.ticketlink.co.kr${img}`
                : undefined,
            });
          });
        return items;
      });
    }
  );

  const result = postProcess(tickets, "ticketlink");
  console.log(`[티켓링크] ${result.length}개 수집`);
  return result;
}

// ─── 후처리: 날짜 파싱 + 필터링 ────────────────────────
function postProcess(
  raw: TicketInfo[],
  platform: TicketInfo["platform"]
): TicketInfo[] {
  const result: TicketInfo[] = [];

  for (const item of raw) {
    const dates = parseKoreanDate(item.date);
    if (dates.length === 0) continue;

    for (const date of dates) {
      result.push({
        ...item,
        id: `${platform}-${result.length}`,
        date,
      });
    }
  }

  return result;
}

// ─── 메인 ───────────────────────────────────────────────
async function main() {
  console.log("=== 콘서트 티켓 스크래핑 시작 ===\n");

  const executablePath =
    process.env.PLAYWRIGHT_CHROMIUM_PATH ||
    process.env.CHROME_PATH ||
    undefined;

  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  try {
    const results = await Promise.allSettled([
      scrapeMelon(browser),
      scrapeYes24(browser),
      scrapeInterpark(browser),
      scrapeNol(browser),
      scrapeTicketlink(browser),
    ]);

    const allTickets: TicketInfo[] = [];
    const platformNames = ["멜론티켓", "Yes24", "인터파크", "놀 티켓", "티켓링크"];

    results.forEach((result, i) => {
      if (result.status === "fulfilled") {
        allTickets.push(...result.value);
      } else {
        console.error(`${platformNames[i]} 실패:`, result.reason);
      }
    });

    const seen = new Set<string>();
    const unique = allTickets.filter((t) => {
      const key = `${t.platform}-${t.title}-${t.date}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    unique.sort((a, b) => a.date.localeCompare(b.date));

    const outDir = path.join(process.cwd(), "public");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const outPath = path.join(outDir, "tickets.json");
    fs.writeFileSync(
      outPath,
      JSON.stringify(
        {
          lastUpdated: new Date().toISOString(),
          count: unique.length,
          tickets: unique,
        },
        null,
        2
      )
    );

    console.log(`\n=== 완료: ${unique.length}개 티켓 → ${outPath} ===`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error("스크래핑 실패:", e);
  process.exit(1);
});
