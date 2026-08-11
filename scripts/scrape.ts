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
  const now = new Date();
  const currentYear = now.getFullYear();

  // YYYY.MM.DD or YYYY-MM-DD or YYYY/MM/DD
  const fullMatches = text.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/g);
  if (fullMatches) {
    for (const m of fullMatches) {
      const parts = m.split(/[.\-/]+/);
      if (parts.length >= 3) {
        const y = parseInt(parts[0]);
        const mo = parseInt(parts[1]);
        const d = parseInt(parts[2]);
        if (y >= 2024 && y <= 2030 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
          dates.push(
            `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`
          );
        }
      }
    }
  }

  // YYYY년 MM월 DD일
  const koreanMatches = text.matchAll(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/g);
  for (const m of koreanMatches) {
    const y = parseInt(m[1]);
    const mo = parseInt(m[2]);
    const d = parseInt(m[3]);
    if (y >= 2024 && y <= 2030 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      dates.push(`${m[1]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    }
  }

  // MM.DD or MM/DD (no year - assume current year; if date already passed, next year)
  if (dates.length === 0) {
    const shortMatches = text.matchAll(/(?<!\d)(\d{1,2})[./](\d{1,2})(?!\d)/g);
    for (const m of shortMatches) {
      const mo = parseInt(m[1]);
      const d = parseInt(m[2]);
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
        let y = currentYear;
        const candidate = new Date(y, mo - 1, d);
        if (candidate < new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30)) {
          y++;
        }
        dates.push(`${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
      }
    }
  }

  // Deduplicate and return first date only (most likely the start date)
  const unique = [...new Set(dates)];
  return unique.length > 0 ? [unique[0]] : [];
}

async function withPage(
  browser: Browser,
  url: string,
  fn: (page: Page) => Promise<TicketInfo[]>
): Promise<TicketInfo[]> {
  const page = await browser.newPage();
  page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}));
  try {
    await page.setExtraHTTPHeaders({ "Accept-Language": "ko-KR,ko;q=0.9" });
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
    await page.setExtraHTTPHeaders({ "Accept-Language": "ko-KR,ko;q=0.9" });
    await page.setViewportSize({ width: 1280, height: 800 });

    // Try the main concert page first
    await page.goto(
      "https://ticket.melon.com/concert/index.htm?genreType=GENRE_CON",
      { waitUntil: "domcontentloaded", timeout: 30000 }
    );

    try {
      await page.waitForSelector("li, .list_item, .thumb_list, a", { timeout: 10000 });
    } catch {}
    await page.waitForTimeout(5000);

    const items = await page.evaluate(() => {
      const results: TicketInfo[] = [];

      const links = Array.from(document.querySelectorAll("a")).filter((a) => {
        const href = a.getAttribute("href") || "";
        const onclick = a.getAttribute("onclick") || "";
        return (
          href.includes("prodId=") ||
          href.includes("performance") ||
          href.includes("detail") ||
          onclick.includes("prodId") ||
          onclick.includes("product")
        );
      });

      if (links.length > 0) {
        links.forEach((a, i) => {
          const container = a.closest("li, [class*=item], [class*=wrap]") || a.parentElement || a;
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
        bodySnippet: (document.body?.innerText || "").substring(0, 500),
        title: document.title,
        onclickSample: Array.from(document.querySelectorAll("[onclick]")).slice(0, 5)
          .map(el => ({ tag: el.tagName, onclick: el.getAttribute("onclick")?.substring(0, 100) })),
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

  const page = await browser.newPage();
  page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}));

  try {
    await page.setExtraHTTPHeaders({ "Accept-Language": "ko-KR,ko;q=0.9" });
    await page.goto(
      "https://ticket.yes24.com/New/Genre/GenreList.aspx?genretype=1&genre=15456",
      { waitUntil: "domcontentloaded", timeout: 30000 }
    );
    await page.waitForTimeout(5000);

    // Try scrolling to trigger lazy loading
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2000);

    const items = await page.evaluate(() => {
      const results: TicketInfo[] = [];

      // Strategy 1: Find links to detail/performance pages
      const detailLinks = Array.from(document.querySelectorAll("a")).filter((a) => {
        const href = a.getAttribute("href") || a.href || "";
        return (
          href.includes("/Perf/") ||
          href.includes("PerfCode=") ||
          href.includes("/New/Perf/") ||
          (href.includes("yes24") && /\d{5,}/.test(href))
        );
      });

      const seen = new Set<string>();
      const uniqueLinks = detailLinks.filter((a) => {
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
            p.tagName === "TR" ||
            p.tagName === "DL" ||
            p.className?.includes("item") ||
            p.className?.includes("content") ||
            p.className?.includes("gen-")
          ) {
            container = p;
            break;
          }
          if ((p.textContent?.length || 0) > 1500) break;
          container = p;
        }

        // Get title: prefer the anchor's own text content or title attr, avoid picking up date/venue text
        const titleEl = a.querySelector("strong, b, [class*=tit], [class*=name]");
        const title =
          titleEl?.textContent?.trim() ||
          a.getAttribute("title")?.trim() ||
          (a.textContent?.trim().length && a.textContent.trim().length < 200 ? a.textContent.trim() : null) ||
          container.querySelector("img")?.getAttribute("alt")?.trim();
        if (!title || title.length < 2 || title.length > 300) return;

        const href = a.getAttribute("href") || a.href || "";
        const url = href.startsWith("http")
          ? href
          : `https://ticket.yes24.com${href}`;

        const containerText = container.textContent || "";
        const img = container.querySelector("img")?.getAttribute("src") ||
                    a.querySelector("img")?.getAttribute("src") || "";

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

      // Strategy 2: If no links found, try finding items by structure
      if (results.length === 0) {
        const listItems = document.querySelectorAll(".genre-list li, .perf-product, [class*=gen-] li, .lst_item");
        listItems.forEach((li, i) => {
          const aTag = li.querySelector("a");
          if (!aTag) return;
          const title = li.querySelector("[class*=tit], strong, h3")?.textContent?.trim() ||
                        aTag.getAttribute("title")?.trim() ||
                        aTag.textContent?.trim();
          if (!title || title.length < 2) return;

          const href = aTag.getAttribute("href") || aTag.href || "";
          const url = href.startsWith("http") ? href : `https://ticket.yes24.com${href}`;
          const containerText = li.textContent || "";
          const img = li.querySelector("img")?.getAttribute("src") || "";

          results.push({
            id: `yes24-s2-${i}`,
            title: title.replace(/\s+/g, " ").substring(0, 200),
            date: containerText,
            platform: "yes24" as const,
            url,
            imageUrl: img
              ? img.startsWith("http") ? img : `https://ticket.yes24.com${img}`
              : undefined,
          });
        });
      }

      return results;
    });

    if (items.length === 0) {
      const debug = await page.evaluate(() => {
        const allA = document.querySelectorAll("a");
        const hrefSamples = Array.from(allA)
          .map((a) => a.getAttribute("href") || a.href || "")
          .filter((h) => h.length > 20)
          .slice(0, 15);
        return {
          aCount: allA.length,
          hrefSamples,
          bodyLen: document.body?.innerText?.length || 0,
          bodySnippet: (document.body?.innerText || "").substring(0, 800),
          title: document.title,
        };
      });
      console.log("  [Debug] Yes24:", JSON.stringify(debug));
    } else {
      console.log(`  [Debug] Yes24 items sample:`, items.slice(0, 3).map(t => ({
        title: t.title.substring(0, 40),
        dateSnippet: t.date.substring(0, 80),
      })));
    }

    const result = postProcess(items, "yes24");
    console.log(`[Yes24] ${items.length}개 추출 → ${result.length}개 (날짜 파싱 후)`);
    return result;
  } catch (e) {
    console.warn("  [Yes24] error:", (e as Error).message);
    return [];
  } finally {
    await page.close();
  }
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

          // Get title - avoid overly generic selectors like bare 'span'
          const titleEl = container.querySelector("[class*=name], [class*=title], [class*=tit], strong, h3, h4");
          let title = titleEl?.textContent?.trim();
          if (!title || title.length < 2) {
            title = a.getAttribute("title")?.trim();
          }
          if (!title || title.length < 2) {
            // Use link text, but only if it's meaningful (not just an image)
            const linkText = a.textContent?.trim();
            if (linkText && linkText.length >= 2 && linkText.length < 200) {
              title = linkText;
            }
          }
          if (!title || title.length < 2) {
            title = container.querySelector("img")?.getAttribute("alt")?.trim();
          }
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

      // Debug: always log a few items to see what we're extracting
      if (items.length > 0) {
        console.log(`  [Debug] Interpark ${items.length} items, sample:`, items.slice(0, 3).map(t => ({
          title: t.title.substring(0, 50),
          dateSnippet: t.date.substring(0, 100),
          url: t.url,
        })));
      } else {
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
            bodySnippet: (document.body?.innerText || "").substring(0, 500),
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
    await page.setExtraHTTPHeaders({ "Accept-Language": "ko-KR,ko;q=0.9" });

    // Try the ranking page instead (less likely to redirect)
    const urls = [
      "https://www.ticketlink.co.kr/ranking/concert",
      "https://www.ticketlink.co.kr/help/concert",
    ];

    let items: TicketInfo[] = [];

    for (const url of urls) {
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(8000);

        const currentUrl = page.url();
        console.log(`  [Debug] Ticketlink navigated to: ${currentUrl}`);

        // If we got redirected to a specific performance page, skip
        if (/\/performance\/\d+$/.test(currentUrl)) {
          console.log("  [Debug] Ticketlink redirected to specific performance, trying next URL...");
          continue;
        }

        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
        await page.waitForTimeout(2000);

        items = await page.evaluate(() => {
          const results: TicketInfo[] = [];

          const perfLinks = Array.from(document.querySelectorAll("a")).filter((a) => {
            const href = a.getAttribute("href") || a.href || "";
            return (
              (href.includes("/product/") ||
               href.includes("/performance/") ||
               href.includes("/event/") ||
               (href.includes("ticketlink") && /\d{5,}/.test(href))) &&
              !href.endsWith("/concert") &&
              !href.endsWith("/musical") &&
              !href.endsWith("/classic") &&
              !href.endsWith("/ranking/concert")
            );
          });

          const seen = new Set<string>();
          const uniqueLinks = perfLinks.filter((a) => {
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
                p.className?.includes("product") ||
                p.className?.includes("rank")
              ) {
                container = p;
                break;
              }
              if ((p.textContent?.length || 0) > 1000) break;
              container = p;
            }

            const titleEl = container.querySelector("[class*=name], [class*=title], [class*=tit], strong, h3, h4");
            let title = titleEl?.textContent?.trim();
            if (!title || title.length < 2) {
              title = a.getAttribute("title")?.trim();
            }
            if (!title || title.length < 2) {
              const linkText = a.textContent?.trim();
              if (linkText && linkText.length >= 2 && linkText.length < 200) {
                title = linkText;
              }
            }
            if (!title || title.length < 2) {
              title = container.querySelector("img")?.getAttribute("alt")?.trim();
            }
            if (!title || title.length < 2 || title.length > 300) return;

            const href = a.getAttribute("href") || a.href || "";
            const resolvedUrl = href.startsWith("http")
              ? href
              : `https://www.ticketlink.co.kr${href}`;

            const containerText = container.textContent || "";
            const img = container.querySelector("img")?.getAttribute("src") || "";

            results.push({
              id: `ticketlink-${i}`,
              title: title.replace(/\s+/g, " ").substring(0, 200),
              date: containerText,
              platform: "ticketlink" as const,
              url: resolvedUrl,
              imageUrl: img
                ? img.startsWith("http") ? img : `https://www.ticketlink.co.kr${img}`
                : undefined,
            });
          });

          return results;
        });

        if (items.length > 0) {
          console.log(`  [Debug] Ticketlink ${items.length} items from ${currentUrl}`);
          break;
        }
      } catch (e) {
        console.warn(`  [Ticketlink] error on ${url}:`, (e as Error).message);
        continue;
      }
    }

    if (items.length === 0) {
      try {
        const debug = await page.evaluate(() => {
          const allA = document.querySelectorAll("a");
          const links = Array.from(allA)
            .filter((a) => (a.href || "").length > 30)
            .slice(0, 10)
            .map((a) => ({
              href: a.getAttribute("href"),
              text: a.textContent?.trim()?.substring(0, 60),
            }));
          return {
            url: location.href,
            aCount: allA.length,
            links,
            bodySnippet: (document.body?.innerText || "").substring(0, 500),
            title: document.title,
          };
        });
        console.log("  [Debug] Ticketlink:", JSON.stringify(debug));
      } catch {}
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
    if (dates.length === 0) {
      // Debug: log items that fail date parsing
      if (raw.length <= 20) {
        console.log(`  [Debug] No date parsed for "${item.title.substring(0, 40)}" from: "${item.date.substring(0, 80).replace(/\s+/g, ' ')}"`);
      }
      continue;
    }

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

    // Deduplicate by platform + title + date
    const seen = new Set<string>();
    const unique = allTickets.filter((t) => {
      const key = `${t.platform}-${t.title}-${t.date}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    console.log(`\n  [Dedup] ${allTickets.length}개 → ${unique.length}개 (중복 제거 후)`);

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

const TIMEOUT_MS = 120_000;
setTimeout(() => {
  console.error(`스크래핑 타임아웃 (${TIMEOUT_MS / 1000}초)`);
  process.exit(1);
}, TIMEOUT_MS).unref();

main().catch((e) => {
  console.error("스크래핑 실패:", e);
  process.exit(1);
});
