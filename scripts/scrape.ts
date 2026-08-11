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
  page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}));
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

  const page = await browser.newPage();
  page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}));

  try {
    await page.setExtraHTTPHeaders({
      "Accept-Language": "ko-KR,ko;q=0.9",
    });

    await page.goto(
      "https://ticket.melon.com/concert/index.htm?genreType=GENRE_CON",
      { waitUntil: "domcontentloaded", timeout: 30000 }
    );

    try {
      await page.waitForSelector("li, .list_item, .thumb_list", { timeout: 10000 });
    } catch {
      // page might not have any matching selectors
    }
    await page.waitForTimeout(3000);

    const items = await page.evaluate(() => {
      const results: TicketInfo[] = [];
      const allText = document.body?.innerText || "";

      // Try to find concert items by looking for links to detail pages
      const links = Array.from(document.querySelectorAll("a")).filter((a) => {
        const href = a.getAttribute("href") || "";
        return (
          href.includes("prodId=") ||
          href.includes("performance") ||
          href.includes("detail") ||
          href.includes("product")
        );
      });

      if (links.length > 0) {
        links.forEach((a, i) => {
          const container = a.closest("li, div, [class*=item]") || a.parentElement || a;
          const title =
            container.querySelector("[class*=tit], [class*=name], strong, h3, h4")?.textContent?.trim() ||
            a.getAttribute("title")?.trim() ||
            a.textContent?.trim() ||
            container.querySelector("img")?.getAttribute("alt")?.trim();
          if (!title || title.length < 2 || title.length > 200) return;

          const href = a.getAttribute("href") || "";
          const url = href.startsWith("http")
            ? href
            : `https://ticket.melon.com${href}`;

          const dateText = container.textContent || "";
          const img = container.querySelector("img")?.getAttribute("src") || "";

          results.push({
            id: `melon-${i}`,
            title: title.replace(/\s+/g, " "),
            date: dateText,
            platform: "melon" as const,
            url,
            imageUrl: img || undefined,
          });
        });
      }

      return results;
    });

    if (items.length === 0) {
      const debug = await page.evaluate(() => ({
        liCount: document.querySelectorAll("li").length,
        aCount: document.querySelectorAll("a").length,
        bodyLen: document.body?.innerText?.length || 0,
        bodySnippet: document.body?.innerText?.substring(0, 300) || "",
        title: document.title,
      }));
      console.log("  [Debug] Melon:", JSON.stringify(debug));
    }

    const result = postProcess(items, "melon");
    console.log(`[멜론티켓] ${items.length}개 추출 → ${result.length}개 (날짜 파싱 후)`);
    return result;
  } catch (e) {
    console.warn("  [멜론티켓] error:", (e as Error).message);
    return [];
  } finally {
    await page.close();
  }
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

        // Yes24 concert listing: look for links pointing to detail pages
        const detailLinks = Array.from(document.querySelectorAll("a")).filter((a) => {
          const href = a.getAttribute("href") || a.href || "";
          return (
            href.includes("/Perf/") ||
            href.includes("PerfCode=") ||
            href.includes("/New/Perf/") ||
            (href.includes("yes24") && /\d{5,}/.test(href))
          );
        });

        // Deduplicate by href
        const seen = new Set<string>();
        const uniqueLinks = detailLinks.filter((a) => {
          const href = a.getAttribute("href") || a.href || "";
          if (seen.has(href)) return false;
          seen.add(href);
          return true;
        });

        uniqueLinks.forEach((a, i) => {
          // Walk up to find the item container
          let container: Element = a;
          for (let p = a.parentElement; p && p !== document.body; p = p.parentElement) {
            if (
              p.tagName === "LI" ||
              p.tagName === "TR" ||
              p.className?.includes("item") ||
              p.className?.includes("content") ||
              p.className?.includes("gen-")
            ) {
              container = p;
              break;
            }
            // Stop at reasonable boundary
            if ((p.textContent?.length || 0) > 1000) break;
            container = p;
          }

          const title =
            a.querySelector("strong, [class*=tit], [class*=name]")?.textContent?.trim() ||
            a.getAttribute("title")?.trim() ||
            a.textContent?.trim() ||
            container.querySelector("img")?.getAttribute("alt")?.trim();
          if (!title || title.length < 2 || title.length > 300) return;

          const href = a.getAttribute("href") || a.href || "";
          const url = href.startsWith("http")
            ? href
            : `https://ticket.yes24.com${href}`;

          const containerText = container.textContent || "";
          const img = container.querySelector("img")?.getAttribute("src") || "";

          results.push({
            id: `yes24-${i}`,
            title: title.replace(/\s+/g, " ").substring(0, 200),
            date: containerText,
            platform: "yes24" as const,
            url,
            imageUrl: img
              ? img.startsWith("http") ? img : `https://ticket.yes24.com${img}`
              : undefined,
          });
        });

        return results;
      });

      if (items.length === 0) {
        const debug = await page.evaluate(() => {
          const allA = document.querySelectorAll("a");
          const perfLinks = Array.from(allA)
            .filter((a) => (a.href || "").length > 30)
            .slice(0, 10)
            .map((a) => ({
              href: a.getAttribute("href") || a.href,
              text: a.textContent?.trim()?.substring(0, 50),
            }));
          return {
            aCount: allA.length,
            perfLinks,
            bodySnippet: document.body?.innerText?.substring(0, 500) || "",
            title: document.title,
          };
        });
        console.log("  [Debug] Yes24:", JSON.stringify(debug));
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

      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
      await page.waitForTimeout(2000);

      const items = await page.evaluate(() => {
        const results: TicketInfo[] = [];

        // Find links to product/goods pages
        const productLinks = Array.from(document.querySelectorAll("a")).filter((a) => {
          const href = a.getAttribute("href") || a.href || "";
          return (
            href.includes("/product/") ||
            href.includes("/goods/") ||
            href.includes("GoodsCode=")
          );
        });

        const seen = new Set<string>();
        const uniqueLinks = productLinks.filter((a) => {
          const href = a.getAttribute("href") || a.href || "";
          if (seen.has(href)) return false;
          seen.add(href);
          return true;
        });

        uniqueLinks.forEach((a, i) => {
          let container: Element = a;
          for (let p = a.parentElement; p && p !== document.body; p = p.parentElement) {
            if (
              p.tagName === "LI" ||
              p.className?.includes("item") ||
              p.className?.includes("card") ||
              p.className?.includes("prd")
            ) {
              container = p;
              break;
            }
            if ((p.textContent?.length || 0) > 1000) break;
            container = p;
          }

          const title =
            container.querySelector("[class*=name], [class*=title], [class*=tit], strong, h3, h4, span")?.textContent?.trim() ||
            a.getAttribute("title")?.trim() ||
            a.textContent?.trim() ||
            container.querySelector("img")?.getAttribute("alt")?.trim();
          if (!title || title.length < 2 || title.length > 300) return;

          const href = a.getAttribute("href") || a.href || "";
          const url = href.startsWith("http")
            ? href
            : `https://tickets.interpark.com${href}`;

          const containerText = container.textContent || "";
          const img = container.querySelector("img")?.getAttribute("src") || "";

          results.push({
            id: `interpark-${i}`,
            title: title.replace(/\s+/g, " ").substring(0, 200),
            date: containerText,
            platform: "interpark" as const,
            url,
            imageUrl: img || undefined,
          });
        });

        return results;
      });

      if (items.length > 0 && items.length <= 10) {
        // Log date texts for debugging
        console.log("  [Debug] Interpark extracted dates:", items.map(t => ({
          title: t.title.substring(0, 30),
          dateSnippet: t.date.substring(0, 100),
        })));
      }

      if (items.length === 0) {
        const debug = await page.evaluate(() => {
          const allA = document.querySelectorAll("a");
          const links = Array.from(allA)
            .filter((a) => (a.href || "").length > 40)
            .slice(0, 10)
            .map((a) => ({
              href: a.getAttribute("href"),
              text: a.textContent?.trim()?.substring(0, 60),
            }));
          return {
            aCount: allA.length,
            links,
            bodySnippet: document.body?.innerText?.substring(0, 500) || "",
            title: document.title,
          };
        });
        console.log("  [Debug] Interpark:", JSON.stringify(debug));
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

  const page = await browser.newPage();
  page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}));

  try {
    const response = await page.goto(
      "https://www.ticketlink.co.kr/performance/concert",
      { waitUntil: "domcontentloaded", timeout: 30000 }
    );

    // Wait for any redirects to settle
    await page.waitForTimeout(3000);
    try {
      await page.waitForLoadState("networkidle", { timeout: 10000 });
    } catch {
      // networkidle may not be reached
    }
    await page.waitForTimeout(5000);

    const currentUrl = page.url();
    console.log(`  [Debug] Ticketlink final URL: ${currentUrl}`);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await page.waitForTimeout(2000);

    const items = await page.evaluate(() => {
      const results: TicketInfo[] = [];

      // Find product/performance detail links
      const perfLinks = Array.from(document.querySelectorAll("a")).filter((a) => {
        const href = a.getAttribute("href") || a.href || "";
        return (
          href.includes("/product/") ||
          href.includes("/performance/") ||
          href.includes("/event/") ||
          (href.includes("ticketlink") && /\d{5,}/.test(href))
        );
      });

      const seen = new Set<string>();
      const uniqueLinks = perfLinks.filter((a) => {
        const href = a.getAttribute("href") || a.href || "";
        // Filter out category links
        if (href.endsWith("/concert") || href.endsWith("/musical") || href.endsWith("/classic")) return false;
        if (seen.has(href)) return false;
        seen.add(href);
        return true;
      });

      uniqueLinks.forEach((a, i) => {
        let container: Element = a;
        for (let p = a.parentElement; p && p !== document.body; p = p.parentElement) {
          if (
            p.tagName === "LI" ||
            p.className?.includes("item") ||
            p.className?.includes("card") ||
            p.className?.includes("product")
          ) {
            container = p;
            break;
          }
          if ((p.textContent?.length || 0) > 1000) break;
          container = p;
        }

        const title =
          container.querySelector("[class*=name], [class*=title], [class*=tit], strong, h3, h4")?.textContent?.trim() ||
          a.getAttribute("title")?.trim() ||
          a.textContent?.trim() ||
          container.querySelector("img")?.getAttribute("alt")?.trim();
        if (!title || title.length < 2 || title.length > 300) return;

        const href = a.getAttribute("href") || a.href || "";
        const url = href.startsWith("http")
          ? href
          : `https://www.ticketlink.co.kr${href}`;

        const containerText = container.textContent || "";
        const img = container.querySelector("img")?.getAttribute("src") || "";

        results.push({
          id: `ticketlink-${i}`,
          title: title.replace(/\s+/g, " ").substring(0, 200),
          date: containerText,
          platform: "ticketlink" as const,
          url,
          imageUrl: img
            ? img.startsWith("http") ? img : `https://www.ticketlink.co.kr${img}`
            : undefined,
        });
      });

      return results;
    });

    if (items.length === 0) {
      const debug = await page.evaluate(() => {
        const allA = document.querySelectorAll("a");
        const links = Array.from(allA)
          .filter((a) => (a.href || "").length > 40)
          .slice(0, 10)
          .map((a) => ({
            href: a.getAttribute("href"),
            text: a.textContent?.trim()?.substring(0, 60),
          }));
        return {
          aCount: allA.length,
          links,
          bodySnippet: document.body?.innerText?.substring(0, 500) || "",
          title: document.title,
        };
      });
      console.log("  [Debug] Ticketlink:", JSON.stringify(debug));
    }

    const result = postProcess(items, "ticketlink");
    console.log(`[티켓링크] ${items.length}개 추출 → ${result.length}개 (날짜 파싱 후)`);
    return result;
  } catch (e) {
    console.warn("  [티켓링크] error:", (e as Error).message);
    return [];
  } finally {
    await page.close();
  }
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

process.on("unhandledRejection", (reason) => {
  console.warn("Unhandled rejection (suppressed):", reason);
});

main().catch((e) => {
  console.error("스크래핑 실패:", e);
  process.exit(1);
});
