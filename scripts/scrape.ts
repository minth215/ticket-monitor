import { chromium, Browser, Page } from "playwright-core";
import * as fs from "fs";
import * as path from "path";

interface TicketInfo {
  id: string;
  title: string;
  date: string;
  time?: string;
  venue?: string;
  platform: "melon" | "yes24" | "interpark" | "ticketlink";
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
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
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
      await page.waitForTimeout(5000);

      const items = await page.evaluate(() => {
        const results: TicketInfo[] = [];

        const selectorGroups = [
          "#conts .list_thumb li",
          "#conts .thumb_list li",
          ".list_item li",
          ".festival_list li",
          "#commodityList li",
          ".wrap_list li",
          ".conts_section li",
        ];

        let elements: Element[] = [];
        for (const sel of selectorGroups) {
          const found = document.querySelectorAll(sel);
          if (found.length > 0) {
            elements = Array.from(found);
            break;
          }
        }

        if (elements.length === 0) {
          elements = Array.from(document.querySelectorAll("li")).filter(
            (el) => {
              const text = el.textContent || "";
              return (
                text.length > 10 &&
                text.length < 500 &&
                /\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}/.test(text)
              );
            }
          );
        }

        elements.forEach((el, i) => {
          const anchor = el.querySelector("a");
          const title =
            el
              .querySelector(
                "[class*=ellipsis], [class*=tit], [class*=name], .tit, .name, strong, h3, h4"
              )
              ?.textContent?.trim() ||
            anchor?.getAttribute("title")?.trim() ||
            anchor?.textContent?.trim() ||
            el.querySelector("img")?.getAttribute("alt")?.trim();
          if (!title || title.length < 2) return;

          const href = anchor?.getAttribute("href") || "";
          const url = href.startsWith("http")
            ? href
            : href
              ? `https://ticket.melon.com${href}`
              : "https://ticket.melon.com";

          const dateText = el.textContent || "";
          const venueEl = el.querySelector(
            "[class*=place], [class*=venue], [class*=hall], .place, .venue"
          );
          const venue = venueEl?.textContent?.trim() || "";
          const img = el.querySelector("img")?.getAttribute("src") || "";

          results.push({
            id: `melon-${i}`,
            title: title.replace(/\s+/g, " ").substring(0, 200),
            date: dateText,
            venue: venue || undefined,
            platform: "melon" as const,
            url,
            imageUrl: img || undefined,
          });
        });

        return results;
      });

      if (items.length === 0) {
        const debug = await page.evaluate(() => {
          const allLi = document.querySelectorAll("li");
          const bodyText = document.body?.innerText?.substring(0, 500) || "";
          return {
            liCount: allLi.length,
            bodySnippet: bodyText,
            title: document.title,
          };
        });
        console.log("  [Debug] Melon page:", JSON.stringify(debug));
      }

      return items;
    }
  );

  const result = postProcess(tickets, "melon");
  console.log(`[멜론티켓] ${tickets.length}개 추출 → ${result.length}개 (날짜 파싱 후)`);
  return result;
}

// ─── Yes24 ──────────────────────────────────────────────
async function scrapeYes24(browser: Browser): Promise<TicketInfo[]> {
  console.log("[Yes24] 스크래핑 시작...");
  const tickets = await withPage(
    browser,
    "https://ticket.yes24.com/New/Genre/GenreList.aspx?genretype=1&genre=15456",
    async (page) => {
      await page.waitForTimeout(5000);

      const items = await page.evaluate(() => {
        const results: TicketInfo[] = [];

        const selectorGroups = [
          ".genre-list li",
          ".gen-ticket-list li",
          ".content-area li",
          "#genreList li",
          ".board-list li",
        ];

        let elements: Element[] = [];
        for (const sel of selectorGroups) {
          const found = document.querySelectorAll(sel);
          if (found.length > 0) {
            elements = Array.from(found);
            break;
          }
        }

        if (elements.length === 0) {
          elements = Array.from(document.querySelectorAll("li")).filter(
            (el) => {
              const text = el.textContent || "";
              return (
                text.length > 10 &&
                text.length < 500 &&
                /\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}/.test(text)
              );
            }
          );
        }

        elements.forEach((el, i) => {
          const anchor = el.querySelector("a");
          const title =
            el
              .querySelector(
                "[class*=title], [class*=tit], [class*=name], .tit, .name, strong, h3, h4"
              )
              ?.textContent?.trim() ||
            anchor?.getAttribute("title")?.trim() ||
            anchor?.textContent?.trim() ||
            el.querySelector("img")?.getAttribute("alt")?.trim();
          if (!title || title.length < 2) return;

          const href = anchor?.getAttribute("href") || "";
          const url = href.startsWith("http")
            ? href
            : href
              ? `https://ticket.yes24.com${href}`
              : "https://ticket.yes24.com";

          const dateText = el.textContent || "";
          const venueEl = el.querySelector(
            "[class*=place], [class*=venue], [class*=hall], .place, .venue"
          );
          const venue = venueEl?.textContent?.trim() || "";
          const img = el.querySelector("img")?.getAttribute("src") || "";

          results.push({
            id: `yes24-${i}`,
            title: title.replace(/\s+/g, " ").substring(0, 200),
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

        return results;
      });

      if (items.length === 0) {
        const debug = await page.evaluate(() => {
          const allLi = document.querySelectorAll("li");
          const bodyText = document.body?.innerText?.substring(0, 500) || "";
          return {
            liCount: allLi.length,
            bodySnippet: bodyText,
            title: document.title,
          };
        });
        console.log("  [Debug] Yes24 page:", JSON.stringify(debug));
      }

      return items;
    }
  );

  const result = postProcess(tickets, "yes24");
  console.log(`[Yes24] ${tickets.length}개 추출 → ${result.length}개 (날짜 파싱 후)`);
  return result;
}

// ─── 인터파크 ───────────────────────────────────────────
async function scrapeInterpark(browser: Browser): Promise<TicketInfo[]> {
  console.log("[인터파크] 스크래핑 시작...");
  const tickets = await withPage(
    browser,
    "https://tickets.interpark.com/contents/genre/concert",
    async (page) => {
      await page.waitForTimeout(8000);

      // Scroll to trigger lazy loading
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight / 2);
      });
      await page.waitForTimeout(2000);

      const items = await page.evaluate(() => {
        const results: TicketInfo[] = [];

        const selectorGroups = [
          "[class*=RankingItem] a",
          "[class*=ProductItem] a",
          "[class*=prd-item] a",
          "[class*=card-item] a",
          "[class*=ranking] li a",
          "[class*=content] li a",
        ];

        let anchors: Element[] = [];
        for (const sel of selectorGroups) {
          const found = document.querySelectorAll(sel);
          if (found.length > 0) {
            anchors = Array.from(found);
            break;
          }
        }

        if (anchors.length === 0) {
          anchors = Array.from(document.querySelectorAll("a")).filter((a) => {
            const href = a.getAttribute("href") || "";
            return (
              href.includes("/product/") ||
              href.includes("/goods/") ||
              href.includes("GoodsCode=")
            );
          });
        }

        anchors.forEach((el, i) => {
          const parent = el.closest("li") || el.parentElement || el;
          const title =
            parent
              .querySelector(
                "[class*=name], [class*=title], [class*=tit], strong, h3, h4, span"
              )
              ?.textContent?.trim() ||
            (el as HTMLAnchorElement).title?.trim() ||
            el.querySelector("img")?.getAttribute("alt")?.trim();
          if (!title || title.length < 2) return;

          const href = (el as HTMLAnchorElement).href || el.getAttribute("href") || "";
          const url = href.startsWith("http")
            ? href
            : href
              ? `https://tickets.interpark.com${href}`
              : "https://tickets.interpark.com";

          const dateText = parent.textContent || "";
          const venueEl = parent.querySelector(
            "[class*=place], [class*=venue], [class*=hall], [class*=location]"
          );
          const venue = venueEl?.textContent?.trim() || "";
          const img = parent.querySelector("img")?.getAttribute("src") || "";

          results.push({
            id: `interpark-${i}`,
            title: title.replace(/\s+/g, " ").substring(0, 200),
            date: dateText,
            venue: venue || undefined,
            platform: "interpark" as const,
            url,
            imageUrl: img || undefined,
          });
        });

        return results;
      });

      if (items.length === 0) {
        const debug = await page.evaluate(() => {
          const allA = document.querySelectorAll("a");
          const productLinks = Array.from(allA)
            .filter((a) => {
              const href = a.href || "";
              return href.includes("interpark") && href.length > 40;
            })
            .slice(0, 5)
            .map((a) => ({ href: a.href, text: a.textContent?.trim()?.substring(0, 60) }));
          const bodyText = document.body?.innerText?.substring(0, 500) || "";
          return {
            aCount: allA.length,
            productLinks,
            bodySnippet: bodyText,
            title: document.title,
          };
        });
        console.log("  [Debug] Interpark page:", JSON.stringify(debug));
      }

      return items;
    }
  );

  const result = postProcess(tickets, "interpark");
  console.log(`[인터파크] ${tickets.length}개 추출 → ${result.length}개 (날짜 파싱 후)`);
  return result;
}

// ─── 티켓링크 ───────────────────────────────────────────
async function scrapeTicketlink(browser: Browser): Promise<TicketInfo[]> {
  console.log("[티켓링크] 스크래핑 시작...");
  const tickets = await withPage(
    browser,
    "https://www.ticketlink.co.kr/performance/concert",
    async (page) => {
      await page.waitForTimeout(8000);

      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight / 2);
      });
      await page.waitForTimeout(2000);

      const items = await page.evaluate(() => {
        const results: TicketInfo[] = [];

        const selectorGroups = [
          "[class*=product-list] li",
          "[class*=performance-list] li",
          "[class*=event-list] li",
          "[class*=ranking] li",
          ".list-wrap li",
          ".prd-list li",
        ];

        let elements: Element[] = [];
        for (const sel of selectorGroups) {
          const found = document.querySelectorAll(sel);
          if (found.length > 0) {
            elements = Array.from(found);
            break;
          }
        }

        if (elements.length === 0) {
          elements = Array.from(
            document.querySelectorAll("a")
          )
            .filter((a) => {
              const href = a.getAttribute("href") || "";
              return (
                href.includes("/product/") ||
                href.includes("/performance/") ||
                href.includes("/event/")
              );
            })
            .map((a) => a.closest("li") || a.parentElement || a)
            .filter(
              (el, i, arr) => arr.indexOf(el) === i
            ) as Element[];
        }

        elements.forEach((el, i) => {
          const anchor = el.querySelector("a") || (el.tagName === "A" ? el : null);
          const title =
            el
              .querySelector(
                "[class*=name], [class*=title], [class*=tit], strong, h3, h4"
              )
              ?.textContent?.trim() ||
            (anchor as HTMLAnchorElement)?.title?.trim() ||
            anchor?.textContent?.trim() ||
            el.querySelector("img")?.getAttribute("alt")?.trim();
          if (!title || title.length < 2) return;

          const href = anchor?.getAttribute("href") || (anchor as HTMLAnchorElement)?.href || "";
          const url = href.startsWith("http")
            ? href
            : href
              ? `https://www.ticketlink.co.kr${href}`
              : "https://www.ticketlink.co.kr";

          const dateText = el.textContent || "";
          const venueEl = el.querySelector(
            "[class*=place], [class*=venue], [class*=hall], [class*=location]"
          );
          const venue = venueEl?.textContent?.trim() || "";
          const img = el.querySelector("img")?.getAttribute("src") || "";

          results.push({
            id: `ticketlink-${i}`,
            title: title.replace(/\s+/g, " ").substring(0, 200),
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

        return results;
      });

      if (items.length === 0) {
        const debug = await page.evaluate(() => {
          const allA = document.querySelectorAll("a");
          const perfLinks = Array.from(allA)
            .filter((a) => {
              const href = a.href || "";
              return href.includes("ticketlink") && href.length > 40;
            })
            .slice(0, 5)
            .map((a) => ({ href: a.href, text: a.textContent?.trim()?.substring(0, 60) }));
          const bodyText = document.body?.innerText?.substring(0, 500) || "";
          return {
            aCount: allA.length,
            perfLinks,
            bodySnippet: bodyText,
            title: document.title,
          };
        });
        console.log("  [Debug] Ticketlink page:", JSON.stringify(debug));
      }

      return items;
    }
  );

  const result = postProcess(tickets, "ticketlink");
  console.log(`[티켓링크] ${tickets.length}개 추출 → ${result.length}개 (날짜 파싱 후)`);
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
      scrapeTicketlink(browser),
    ]);

    const allTickets: TicketInfo[] = [];
    const platformNames = ["멜론티켓", "Yes24", "인터파크", "티켓링크"];

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
