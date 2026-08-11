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

  // MM.DD or MM/DD (no year - assume current year)
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

  const unique = [...new Set(dates)];
  return unique.length > 0 ? [unique[0]] : [];
}

// ─── 멜론티켓 ───────────────────────────────────────────
async function scrapeMelon(browser: Browser): Promise<TicketInfo[]> {
  console.log("[멜론티켓] 스크래핑 시작...");

  const page = await browser.newPage();
  page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}));

  try {
    await page.setExtraHTTPHeaders({ "Accept-Language": "ko-KR,ko;q=0.9" });

    await page.goto(
      "https://ticket.melon.com/concert/index.htm?genreType=GENRE_CON",
      { waitUntil: "domcontentloaded", timeout: 30000 }
    );
    await page.waitForTimeout(5000);

    const debug = await page.evaluate(() => ({
      liCount: document.querySelectorAll("li").length,
      aCount: document.querySelectorAll("a").length,
      bodyLen: document.body?.innerText?.length || 0,
      bodySnippet: (document.body?.innerText || "").substring(0, 300),
      title: document.title,
    }));
    console.log("  [Debug] Melon:", JSON.stringify(debug));
    console.log(`[멜론티켓] 0개 (페이지가 비어있음 - headless 차단 추정)`);
    return [];
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
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(3000);

    const items = await page.evaluate(() => {
      const results: { title: string; date: string; url: string; img: string }[] = [];

      // Strategy: find the list items directly by structure
      // Yes24 genre list typically has items in a grid/list with links to /Perf/ pages
      const allLinks = Array.from(document.querySelectorAll("a"));

      // Debug: collect all unique href patterns
      const hrefPatterns = new Set<string>();
      allLinks.forEach((a) => {
        const href = a.getAttribute("href") || "";
        // Normalize to pattern
        const pattern = href.replace(/\d+/g, "N");
        if (pattern.length > 5 && pattern.length < 100) hrefPatterns.add(pattern);
      });

      // Find performance links
      const perfLinks = allLinks.filter((a) => {
        const href = a.getAttribute("href") || "";
        return /\/Perf\/\d+/.test(href) || /PerfCode=\d+/.test(href);
      });

      // Deduplicate
      const seen = new Set<string>();
      const uniqueLinks = perfLinks.filter((a) => {
        const href = a.getAttribute("href") || "";
        if (seen.has(href)) return false;
        seen.add(href);
        return true;
      });

      uniqueLinks.forEach((a) => {
        // Use the link's own content for title
        const imgEl = a.querySelector("img");
        const titleFromText = a.textContent?.trim();
        const titleFromAttr = a.getAttribute("title")?.trim();
        const titleFromAlt = imgEl?.getAttribute("alt")?.trim();

        const title = (titleFromAttr && titleFromAttr.length > 2 ? titleFromAttr : null) ||
                      (titleFromText && titleFromText.length > 2 && titleFromText.length < 200 ? titleFromText : null) ||
                      (titleFromAlt && titleFromAlt.length > 2 ? titleFromAlt : null);
        if (!title) return;

        // Get the closest container for date info (but keep it small)
        const parent = a.closest("li, dl, .item, [class*=gen-]") || a.parentElement;
        const dateText = parent?.textContent?.substring(0, 300) || "";

        const href = a.getAttribute("href") || "";
        const url = href.startsWith("http") ? href : `https://ticket.yes24.com${href}`;
        const img = imgEl?.getAttribute("src") || "";

        results.push({
          title: title.replace(/\s+/g, " ").substring(0, 200),
          date: dateText,
          url,
          img: img ? (img.startsWith("http") ? img : `https://ticket.yes24.com${img}`) : "",
        });
      });

      return { results, hrefPatterns: Array.from(hrefPatterns).slice(0, 20) };
    });

    if (items.results.length === 0) {
      console.log(`  [Debug] Yes24 href patterns: ${JSON.stringify(items.hrefPatterns)}`);
      const bodyInfo = await page.evaluate(() => ({
        bodyLen: document.body?.innerText?.length || 0,
        bodySnippet: (document.body?.innerText || "").substring(0, 600),
        title: document.title,
      }));
      console.log(`  [Debug] Yes24 page: ${JSON.stringify(bodyInfo)}`);
    } else {
      console.log(`  [Debug] Yes24 ${items.results.length} items, sample:`, items.results.slice(0, 3).map(t => ({
        title: t.title.substring(0, 40),
        dateSnippet: t.date.replace(/\s+/g, " ").substring(0, 80),
      })));
    }

    const tickets: TicketInfo[] = items.results.map((item, i) => ({
      id: `yes24-${i}`,
      title: item.title,
      date: item.date,
      platform: "yes24" as const,
      url: item.url,
      imageUrl: item.img || undefined,
    }));

    const result = postProcess(tickets, "yes24");
    console.log(`[Yes24] ${tickets.length}개 추출 → ${result.length}개 (날짜 파싱 후)`);
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

  const page = await browser.newPage();
  page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}));

  try {
    await page.setExtraHTTPHeaders({ "Accept-Language": "ko-KR,ko;q=0.9" });
    await page.goto(
      "https://tickets.interpark.com/contents/genre/concert",
      { waitUntil: "domcontentloaded", timeout: 30000 }
    );
    await page.waitForTimeout(8000);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await page.waitForTimeout(2000);

    const items = await page.evaluate(() => {
      const results: { title: string; date: string; url: string; img: string }[] = [];

      // Find product links - /goods/NNNNN or /product/NNNNN
      const productLinks = Array.from(document.querySelectorAll("a")).filter((a) => {
        const href = a.getAttribute("href") || "";
        return /\/(goods|product)\/\d+/.test(href);
      });

      const seen = new Set<string>();
      const uniqueLinks = productLinks.filter((a) => {
        const href = a.getAttribute("href") || "";
        if (seen.has(href)) return false;
        seen.add(href);
        return true;
      });

      uniqueLinks.forEach((a) => {
        // CRITICAL: Use CSS closest() with tight selectors to find the RIGHT container
        // Stop at elements with class containing 'item', 'card', 'product', or LI tags
        // But NOT huge wrapper divs
        const container = a.closest("[class*=item], [class*=card], [class*=product], [class*=rank], [class*=content] > *, li")
                         || a.parentElement;

        // Verify container is not too large (shared by multiple items)
        const containerTextLen = container?.textContent?.length || 0;
        const useContainer = container && containerTextLen < 500;

        // Title: prefer link's own content, then small container, then image alt
        const imgEl = a.querySelector("img") || (useContainer ? container?.querySelector("img") : null);

        let title: string | null = null;

        // 1) Link's title attribute
        const titleAttr = a.getAttribute("title")?.trim();
        if (titleAttr && titleAttr.length > 2 && titleAttr.length < 200) title = titleAttr;

        // 2) Image alt text (often has the concert name)
        if (!title && imgEl) {
          const alt = imgEl.getAttribute("alt")?.trim();
          if (alt && alt.length > 2 && alt.length < 200) title = alt;
        }

        // 3) Link text (if not too long/short)
        if (!title) {
          const linkText = a.textContent?.trim();
          if (linkText && linkText.length > 2 && linkText.length < 200) title = linkText;
        }

        // 4) Container title elements (only if container is small)
        if (!title && useContainer) {
          const titleEl = container?.querySelector("[class*=name], [class*=title], [class*=tit], strong, h3, h4");
          const elText = titleEl?.textContent?.trim();
          if (elText && elText.length > 2 && elText.length < 200) title = elText;
        }

        if (!title) return;

        const href = a.getAttribute("href") || "";
        const url = href.startsWith("http") ? href : `https://tickets.interpark.com${href}`;

        // Date: from the container text (only if container is small enough)
        const dateText = useContainer ? (container?.textContent || "").substring(0, 300) : "";
        const img = imgEl?.getAttribute("src") || "";

        results.push({
          title: title.replace(/\s+/g, " ").substring(0, 200),
          date: dateText,
          url,
          img: img || "",
        });
      });

      return results;
    });

    console.log(`  [Debug] Interpark ${items.length} items, sample:`, items.slice(0, 5).map(t => ({
      title: t.title.substring(0, 50),
      dateSnippet: t.date.replace(/\s+/g, " ").substring(0, 80),
      url: t.url,
    })));

    const tickets: TicketInfo[] = items.map((item, i) => ({
      id: `interpark-${i}`,
      title: item.title,
      date: item.date,
      platform: "interpark" as const,
      url: item.url,
      imageUrl: item.img || undefined,
    }));

    const result = postProcess(tickets, "interpark");
    console.log(`[인터파크] ${tickets.length}개 추출 → ${result.length}개 (날짜 파싱 후)`);
    return result;
  } catch (e) {
    console.warn("  [인터파크] error:", (e as Error).message);
    return [];
  } finally {
    await page.close();
  }
}

// ─── 티켓링크 ───────────────────────────────────────────
async function scrapeTicketlink(browser: Browser): Promise<TicketInfo[]> {
  console.log("[티켓링크] 스크래핑 시작...");

  const page = await browser.newPage();
  page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}));

  try {
    await page.setExtraHTTPHeaders({ "Accept-Language": "ko-KR,ko;q=0.9" });

    await page.goto(
      "https://www.ticketlink.co.kr/ranking/concert",
      { waitUntil: "domcontentloaded", timeout: 20000 }
    );
    await page.waitForTimeout(10000);

    const currentUrl = page.url();
    console.log(`  [Debug] Ticketlink URL: ${currentUrl}`);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(3000);

    const data = await page.evaluate(() => {
      const results: { title: string; date: string; url: string; img: string }[] = [];

      // Strategy 1: Find links to specific performances (with numeric ID)
      const allLinks = Array.from(document.querySelectorAll("a"));
      const perfLinks = allLinks.filter((a) => {
        const href = a.getAttribute("href") || "";
        // Must match /product/NUMBER or /performance/NUMBER (NOT /performance/concert etc)
        return /\/(product|performance)\/\d+/.test(href);
      });

      const seen = new Set<string>();
      const uniqueLinks = perfLinks.filter((a) => {
        const href = a.getAttribute("href") || "";
        if (seen.has(href)) return false;
        seen.add(href);
        return true;
      });

      uniqueLinks.forEach((a) => {
        const container = a.closest("[class*=item], [class*=rank], [class*=card], [class*=product], li")
                         || a.parentElement;

        const containerTextLen = container?.textContent?.length || 0;
        const useContainer = container && containerTextLen < 500;

        const imgEl = a.querySelector("img") || (useContainer ? container?.querySelector("img") : null);

        let title: string | null = null;
        const titleAttr = a.getAttribute("title")?.trim();
        if (titleAttr && titleAttr.length > 2) title = titleAttr;
        if (!title && imgEl) {
          const alt = imgEl.getAttribute("alt")?.trim();
          if (alt && alt.length > 2) title = alt;
        }
        if (!title) {
          const linkText = a.textContent?.trim();
          if (linkText && linkText.length > 2 && linkText.length < 200) title = linkText;
        }
        if (!title && useContainer) {
          const el = container?.querySelector("[class*=name], [class*=title], strong, h3");
          const t = el?.textContent?.trim();
          if (t && t.length > 2) title = t;
        }
        if (!title) return;

        const href = a.getAttribute("href") || "";
        const url = href.startsWith("http") ? href : `https://www.ticketlink.co.kr${href}`;
        const dateText = useContainer ? (container?.textContent || "").substring(0, 300) : "";
        const img = imgEl?.getAttribute("src") || "";

        results.push({
          title: title.replace(/\s+/g, " ").substring(0, 200),
          date: dateText,
          url,
          img: img ? (img.startsWith("http") ? img : `https://www.ticketlink.co.kr${img}`) : "",
        });
      });

      // Strategy 2: Try looking for non-link items (divs/spans with onclick or data attributes)
      if (results.length === 0) {
        const clickables = document.querySelectorAll("[onclick*=product], [onclick*=performance], [data-id], [data-product]");
        clickables.forEach((el, i) => {
          const onclick = el.getAttribute("onclick") || "";
          const dataId = el.getAttribute("data-id") || el.getAttribute("data-product") || "";
          const idMatch = (onclick + dataId).match(/\d{5,}/);
          if (!idMatch) return;

          const title = el.querySelector("[class*=name], [class*=title], strong")?.textContent?.trim()
                     || el.textContent?.trim()?.substring(0, 100);
          if (!title || title.length < 2) return;

          results.push({
            title: title.replace(/\s+/g, " ").substring(0, 200),
            date: el.textContent?.substring(0, 300) || "",
            url: `https://www.ticketlink.co.kr/product/${idMatch[0]}`,
            img: el.querySelector("img")?.getAttribute("src") || "",
          });
        });
      }

      // Collect debug info about the page structure
      const hrefSamples = Array.from(new Set(
        allLinks.map(a => a.getAttribute("href") || "").filter(h => h.length > 5)
      )).slice(0, 15);

      return { results, hrefSamples };
    });

    if (data.results.length === 0) {
      console.log(`  [Debug] Ticketlink href samples: ${JSON.stringify(data.hrefSamples)}`);
      const bodyInfo = await page.evaluate(() => ({
        bodyLen: document.body?.innerText?.length || 0,
        bodySnippet: (document.body?.innerText || "").replace(/\s+/g, " ").substring(0, 600),
      }));
      console.log(`  [Debug] Ticketlink body: ${JSON.stringify(bodyInfo)}`);
    } else {
      console.log(`  [Debug] Ticketlink ${data.results.length} items, sample:`, data.results.slice(0, 3).map(t => ({
        title: t.title.substring(0, 50),
        dateSnippet: t.date.replace(/\s+/g, " ").substring(0, 80),
      })));
    }

    const tickets: TicketInfo[] = data.results.map((item, i) => ({
      id: `ticketlink-${i}`,
      title: item.title,
      date: item.date,
      platform: "ticketlink" as const,
      url: item.url,
      imageUrl: item.img || undefined,
    }));

    const result = postProcess(tickets, "ticketlink");
    console.log(`[티켓링크] ${tickets.length}개 추출 → ${result.length}개 (날짜 파싱 후)`);
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
      if (raw.length <= 30) {
        console.log(`  [Debug] No date for "${item.title.substring(0, 40)}" from: "${item.date.replace(/\s+/g, " ").substring(0, 80)}"`);
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

    // Deduplicate
    const seen = new Set<string>();
    const unique = allTickets.filter((t) => {
      const key = `${t.platform}-${t.title}-${t.date}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (allTickets.length !== unique.length) {
      console.log(`\n  [Dedup] ${allTickets.length}개 → ${unique.length}개 (중복 제거)`);
    }

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
