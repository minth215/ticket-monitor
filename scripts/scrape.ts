import { chromium, Browser, Page } from "playwright-core";
import * as fs from "fs";
import * as path from "path";

interface TicketInfo {
  id: string;
  title: string;
  date: string;
  time?: string;
  venue?: string;
  platform: "melon" | "yes24" | "nol" | "ticketlink";
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

    // Scroll multiple times to trigger lazy loading
    for (let i = 0; i < 5; i++) {
      await page.evaluate((step) => {
        const h = document.body.scrollHeight;
        window.scrollTo(0, h * (step + 1) / 5);
      }, i);
      await page.waitForTimeout(2000);
    }

    const bodyText = await page.evaluate(() => document.body?.innerText || "");
    console.log(`  [Debug] Yes24: bodyLen=${bodyText.length}`);

    const tickets: TicketInfo[] = [];

    // Line-by-line: find date lines (YYYY.MM.DD ~ YYYY.MM.DD) and take surrounding context
    const lines = bodyText.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    const skipPattern = /^(로그인|마이페이지|고객센터|콘서트|뮤지컬|연극|랭킹|이벤트|MD#|GLOBAL|MY티켓|주간랭킹순|신상품순|종료임박순|상품명순|예매확인|최근 본|정보가|없습니다|읽을거리|이용안내|공지사항|지역별공연장|전시\/스포츠|가족\/어린이|클래식\/무용|콘서트전체보기)$/;

    for (let i = 0; i < lines.length - 1; i++) {
      const dateMatch = lines[i].match(/^(\d{4}\.\d{2}\.\d{2})\s*~\s*(\d{4}\.\d{2}\.\d{2})$/);
      if (dateMatch && i > 0) {
        const title = lines[i - 1];
        const venue = (i + 1 < lines.length) ? lines[i + 1] : "";
        if (title.length < 2 || title.length > 300) continue;
        if (skipPattern.test(title)) continue;
        if (/^\d+$/.test(title)) continue;
        if (/^현재 예매/.test(title)) continue;

        const parsedDate = dateMatch[1].replace(/\./g, "-");
        tickets.push({
          id: `yes24-${tickets.length}`,
          title: title.replace(/\s+/g, " "),
          date: parsedDate,
          venue: skipPattern.test(venue) ? undefined : venue,
          platform: "yes24",
          url: "https://ticket.yes24.com/New/Genre/GenreList.aspx?genretype=1&genre=15456",
        });
      }
    }

    if (tickets.length > 0) {
      console.log(`  [Debug] Yes24 sample:`, tickets.slice(0, 3).map(t => ({
        title: t.title.substring(0, 40),
        date: t.date,
        venue: t.venue?.substring(0, 30),
      })));
    } else {
      console.log(`  [Debug] Yes24 body snippet: ${bodyText.substring(0, 500).replace(/\n/g, "\\n")}`);
    }

    console.log(`[Yes24] ${tickets.length}개 추출`);
    return tickets;
  } catch (e) {
    console.warn("  [Yes24] error:", (e as Error).message);
    return [];
  } finally {
    await page.close();
  }
}

// ─── 놀티켓 ────────────────────────────────────────────
async function scrapeNol(browser: Browser): Promise<TicketInfo[]> {
  console.log("[놀티켓] 스크래핑 시작...");

  const candidateUrls = [
    "https://nolticket.com/contents/genre/concert",
    "https://tickets.interpark.com/contents/genre/concert",
  ];

  for (const targetUrl of candidateUrls) {
    const page = await browser.newPage();
    page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}));

    try {
      await page.setExtraHTTPHeaders({ "Accept-Language": "ko-KR,ko;q=0.9" });
      console.log(`  [Debug] Nol trying: ${targetUrl}`);

      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(8000);
      await page.evaluate(() => {
        const h = document.body?.scrollHeight || 0;
        if (h > 0) window.scrollTo(0, h / 2);
      });
      await page.waitForTimeout(2000);

      const bodyLen = await page.evaluate(() => document.body?.innerText?.length || 0);
      console.log(`  [Debug] Nol ${targetUrl} bodyLen=${bodyLen}`);
      if (bodyLen < 200) {
        console.log(`  [Debug] Nol skipping ${targetUrl} (too short)`);
        await page.close();
        continue;
      }

      const items = await page.evaluate(() => {
        const results: { title: string; date: string; url: string; img: string }[] = [];
        const baseUrl = location.origin;

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
          const container = a.closest("[class*=item], [class*=card], [class*=product], [class*=rank], [class*=content] > *, li")
                           || a.parentElement;
          const containerTextLen = container?.textContent?.length || 0;
          const useContainer = container && containerTextLen < 500;
          const imgEl = a.querySelector("img") || (useContainer ? container?.querySelector("img") : null);

          let title: string | null = null;
          const titleAttr = a.getAttribute("title")?.trim();
          if (titleAttr && titleAttr.length > 2 && titleAttr.length < 200) title = titleAttr;
          if (!title && imgEl) {
            const alt = imgEl.getAttribute("alt")?.trim();
            if (alt && alt.length > 2 && alt.length < 200) title = alt;
          }
          if (!title) {
            const linkText = a.textContent?.trim();
            if (linkText && linkText.length > 2 && linkText.length < 200) title = linkText;
          }
          if (!title && useContainer) {
            const titleEl = container?.querySelector("[class*=name], [class*=title], [class*=tit], strong, h3, h4");
            const elText = titleEl?.textContent?.trim();
            if (elText && elText.length > 2 && elText.length < 200) title = elText;
          }
          if (!title) return;

          const href = a.getAttribute("href") || "";
          const url = href.startsWith("http") ? href : `${baseUrl}${href}`;
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

      console.log(`  [Debug] Nol ${items.length} items from ${targetUrl}, sample:`, items.slice(0, 3).map(t => ({
        title: t.title.substring(0, 50),
        dateSnippet: t.date.replace(/\s+/g, " ").substring(0, 80),
      })));

      if (items.length === 0) {
        await page.close();
        continue;
      }

      const tickets: TicketInfo[] = items.map((item, i) => ({
        id: `nol-${i}`,
        title: item.title,
        date: item.date,
        platform: "nol" as const,
        url: item.url,
        imageUrl: item.img || undefined,
      }));

      const result = postProcess(tickets, "nol");
      console.log(`[놀티켓] ${tickets.length}개 추출 → ${result.length}개 (날짜 파싱 후)`);
      await page.close();
      return result;
    } catch (e) {
      console.warn(`  [놀티켓] ${targetUrl} error:`, (e as Error).message);
      await page.close();
    }
  }

  console.log(`[놀티켓] 0개 추출`);
  return [];
}

// ─── 티켓링크 ───────────────────────────────────────────
async function scrapeTicketlinkPage(browser: Browser, targetUrl: string): Promise<TicketInfo[]> {
  const page = await browser.newPage();
  page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}));

  try {
    await page.setExtraHTTPHeaders({ "Accept-Language": "ko-KR,ko;q=0.9" });
    console.log(`  [Debug] Ticketlink trying: ${targetUrl}`);

    // Intercept API responses — the SPA redirects before DOM is scrapeable,
    // so capture the raw JSON data from API calls instead
    const apiResponses: { url: string; data: unknown }[] = [];
    const allTraffic: { url: string; status: number; contentType: string }[] = [];
    page.on("response", async (response) => {
      const url = response.url();
      const contentType = response.headers()["content-type"] || "";
      allTraffic.push({ url, status: response.status(), contentType });
      if (contentType.includes("json") && response.status() === 200) {
        try {
          const data = await response.json();
          apiResponses.push({ url, data });
        } catch { /* ignore parse errors */ }
      }
    });

    try {
      await page.goto(targetUrl, { waitUntil: "commit", timeout: 30000 });
    } catch (e) {
      console.warn(`  [Debug] Ticketlink goto failed:`, (e as Error).message);
      await page.close();
      return [];
    }

    // This first load is only used to read the gnb menu (fired on every page load).
    // Wait for that specific response and read its body directly — waitForResponse
    // resolves once headers arrive, before the async page.on("response") listener
    // above has necessarily finished downloading+parsing the (large) body, so relying
    // on a fixed buffer after it resolved was racy. Fetch the body ourselves instead.
    try {
      const gnbResponse = await page.waitForResponse((r) => r.url().includes("/gnb"), { timeout: 15000 });
      const gnbData = await gnbResponse.json();
      if (!apiResponses.some((r) => r.url === gnbResponse.url())) {
        apiResponses.push({ url: gnbResponse.url(), data: gnbData });
      }
    } catch (e) {
      console.log(`  [Debug] Ticketlink gnb response did not arrive/parse:`, (e as Error).message);
    }
    await page.waitForTimeout(1000);

    console.log(`  [Debug] Ticketlink captured ${apiResponses.length} JSON API responses`);
    const seenUrls = new Set<string>();
    for (const resp of apiResponses) {
      if (seenUrls.has(resp.url)) continue;
      seenUrls.add(resp.url);
      const dataStr = JSON.stringify(resp.data).substring(0, 200);
      console.log(`  [Debug] Ticketlink API: ${resp.url.substring(0, 100)} → ${dataStr}`);
    }

    // The gnb response contains the real site menu tree (categoryId 16 turned out to be
    // "뮤지컬"/Musical, not Concert). Find the actual "콘서트" leaf category and read its
    // page URL from the link info, then navigate there directly instead of guessing IDs.
    const gnbResp = apiResponses.find((r) => r.url.includes("/gnb"));
    if (gnbResp) {
      const concertCategory = findCategoryByName(gnbResp.data, "콘서트");
      const linkInfo = concertCategory?.generalPageLinkInfo as Record<string, unknown> | undefined;
      const pcLink = linkInfo?.pcCategoryLinkInfo as Record<string, unknown> | undefined;
      const concertPath = pcLink?.url as string | undefined;
      console.log(`  [Debug] Ticketlink gnb concert category found: ${!!concertCategory}, path: ${concertPath}`);

      if (concertPath) {
        const concertUrl = concertPath.startsWith("http") ? concertPath : `https://www.ticketlink.co.kr${concertPath}`;
        if (concertUrl !== targetUrl) {
          console.log(`  [Debug] Ticketlink navigating to actual concert page: ${concertUrl}`);
          try {
            await page.goto(concertUrl, { waitUntil: "commit", timeout: 30000 });
            await page.waitForTimeout(3000);
            // The ranking/listing widget appears to lazy-load on scroll — nudge it into view
            for (let i = 0; i < 5; i++) {
              await page.mouse.wheel(0, 1000).catch(() => {});
              await page.waitForTimeout(1500);
            }
            console.log(`  [Debug] Ticketlink now captured ${apiResponses.length} total JSON API responses`);
            for (const resp of apiResponses) {
              if (seenUrls.has(resp.url)) continue;
              seenUrls.add(resp.url);
              const dataStr = JSON.stringify(resp.data).substring(0, 300);
              console.log(`  [Debug] Ticketlink API (post-nav): ${resp.url.substring(0, 100)} → ${dataStr}`);
            }
          } catch (e) {
            console.log(`  [Debug] Ticketlink concert page nav failed:`, (e as Error).message);
          }
        }
      } else {
        console.log(`  [Debug] Ticketlink gnb full dump: ${JSON.stringify(gnbResp.data).substring(0, 5000)}`);
      }
    }

    // Look for concert listing data in API responses
    const tickets: TicketInfo[] = [];

    for (const resp of apiResponses) {
      const data = resp.data as Record<string, unknown>;
      // Try to find arrays of items that look like concert listings
      const candidates = findArraysInObject(data);
      for (const arr of candidates) {
        for (const item of arr) {
          if (typeof item !== "object" || !item) continue;
          const obj = item as Record<string, unknown>;

          // Look for title-like and date-like fields
          const titleField = findField(obj, ["title", "name", "productName", "performanceName", "eventName", "prdctNm"]);
          const dateField = findField(obj, ["date", "startDate", "openDate", "fromDate", "playDate", "strtDt", "prdctFromDt"]);
          const endDateField = findField(obj, ["endDate", "toDate", "endDt", "prdctToDt"]);
          const idField = findField(obj, ["id", "productId", "performanceId", "prdctId"]);
          const venueField = findField(obj, ["venue", "placeName", "hallName", "venueNm", "placeNm"]);
          const imgField = findField(obj, ["imageUrl", "imgUrl", "posterUrl", "thumbnail", "imgPath"]);

          if (!titleField || String(titleField).length < 2) continue;

          let dateStr = "";
          if (dateField) {
            const d = String(dateField);
            const parsed = parseKoreanDate(d);
            dateStr = parsed.length > 0 ? parsed[0] : d;
          }
          if (!dateStr && endDateField) {
            const d = String(endDateField);
            const parsed = parseKoreanDate(d);
            dateStr = parsed.length > 0 ? parsed[0] : "";
          }

          let url = targetUrl;
          if (idField) {
            url = `https://www.ticketlink.co.kr/product/${idField}`;
          }

          let imgUrl: string | undefined;
          if (imgField) {
            const img = String(imgField);
            imgUrl = img.startsWith("http") ? img : img.startsWith("/") ? `https://www.ticketlink.co.kr${img}` : undefined;
          }

          tickets.push({
            id: `ticketlink-${tickets.length}`,
            title: String(titleField).replace(/\s+/g, " ").substring(0, 200),
            date: dateStr,
            venue: venueField ? String(venueField) : undefined,
            platform: "ticketlink",
            url,
            imageUrl: imgUrl,
          });
        }
      }
    }

    if (tickets.length > 0) {
      const result = postProcess(tickets, "ticketlink");
      console.log(`  [Debug] Ticketlink API extraction: ${tickets.length} raw → ${result.length} after postProcess`);
      if (result.length > 0) {
        console.log(`  [Debug] Ticketlink samples:`, result.slice(0, 3).map(t => ({
          title: t.title.substring(0, 50), date: t.date,
        })));
        console.log(`[티켓링크] ${result.length}개 추출 (API 인터셉트)`);
        await page.close();
        return result;
      }
    }

    // Fallback: try to extract from DOM if it's still alive
    try {
      const bodyText = await page.evaluate(() => document.body?.innerText || "");
      if (bodyText.length > 500) {
        console.log(`  [Debug] Ticketlink DOM fallback, bodyLen=${bodyText.length}`);
        const textTickets = parseTicketlinkText(bodyText, targetUrl);
        if (textTickets.length > 0) {
          console.log(`[티켓링크] ${textTickets.length}개 추출 (텍스트 파싱)`);
          await page.close();
          return textTickets;
        }
      }
    } catch { /* context destroyed — expected */ }

    // Dump the full network traffic map (any status/content-type) so we can spot
    // listing/ranking endpoints that our json+200 filter above might be missing
    const seenTraffic = new Set<string>();
    const trafficSummary: string[] = [];
    for (const t of allTraffic) {
      const key = `${t.status} ${t.url}`;
      if (seenTraffic.has(key)) continue;
      seenTraffic.add(key);
      if (t.url.includes("mapi.ticketlink") || t.url.includes("ticketlink.co.kr/")) {
        trafficSummary.push(`${t.status} [${t.contentType.split(";")[0]}] ${t.url.substring(0, 120)}`);
      }
    }
    console.log(`  [Debug] Ticketlink full traffic (${trafficSummary.length} unique ticketlink URLs):`);
    for (const line of trafficSummary) console.log(`    ${line}`);

    console.log(`  [Debug] Ticketlink ${targetUrl}: no tickets extracted`);
    await page.close();
    return [];
  } catch (e) {
    console.warn(`  [티켓링크] ${targetUrl} error:`, (e as Error).message);
    await page.close();
    return [];
  }
}

function findField(obj: Record<string, unknown>, candidates: string[]): unknown {
  for (const key of candidates) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== "") return obj[key];
  }
  for (const objKey of Object.keys(obj)) {
    const lower = objKey.toLowerCase();
    for (const candidate of candidates) {
      if (lower === candidate.toLowerCase()) return obj[objKey];
    }
  }
  return null;
}

function findArraysInObject(obj: unknown, depth = 0): unknown[][] {
  if (depth > 8) return [];
  const results: unknown[][] = [];
  if (Array.isArray(obj)) {
    if (obj.length > 0 && typeof obj[0] === "object") results.push(obj);
    for (const item of obj) {
      results.push(...findArraysInObject(item, depth + 1));
    }
    return results;
  }
  if (typeof obj === "object" && obj !== null) {
    for (const val of Object.values(obj as Record<string, unknown>)) {
      results.push(...findArraysInObject(val, depth + 1));
    }
  }
  return results;
}

// Recursively search nested category objects (gnb tree) for an exact Korean name match,
// returning the object itself so its link-info fields can be read.
function findCategoryByName(obj: unknown, name: string, depth = 0): Record<string, unknown> | null {
  if (depth > 8 || obj === null || typeof obj !== "object") return null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findCategoryByName(item, name, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const rec = obj as Record<string, unknown>;
  if (rec.categoryNameKor === name) return rec;
  for (const val of Object.values(rec)) {
    const found = findCategoryByName(val, name, depth + 1);
    if (found) return found;
  }
  return null;
}

function parseTicketlinkText(bodyText: string, targetUrl: string): TicketInfo[] {
  const tickets: TicketInfo[] = [];
  const lines = bodyText.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  const navSkip = /^(뮤지컬|콘서트|연극|클래식|무용|전시|스포츠|가족|어린이|아동|랭킹|이벤트|티켓링크|로그인|마이페이지|검색|배너|닫기|공연전시|예매|안내|홈|전체|카테고리|더보기|클래식·무용|아동·가족|한국어|English)$/;

  for (let i = 0; i < lines.length - 1; i++) {
    const dateMatch = lines[i].match(/(\d{4}[.\-/]\d{2}[.\-/]\d{2})\s*[~\-]\s*(\d{4}[.\-/]\d{2}[.\-/]\d{2})/);
    if (dateMatch && i > 0) {
      let titleIdx = i - 1;
      while (titleIdx >= 0 && (/^\d{1,3}$/.test(lines[titleIdx]) || navSkip.test(lines[titleIdx]) || lines[titleIdx].length < 2)) {
        titleIdx--;
      }
      if (titleIdx < 0) continue;
      const title = lines[titleIdx];
      if (title.length > 300 || navSkip.test(title)) continue;

      const venueIdx = i + 1;
      const venue = (venueIdx < lines.length && !navSkip.test(lines[venueIdx]) && !/^\d{1,3}$/.test(lines[venueIdx]))
        ? lines[venueIdx] : undefined;

      const parsedDate = dateMatch[1].replace(/[./]/g, "-");
      tickets.push({
        id: `ticketlink-${tickets.length}`,
        title: title.replace(/\s+/g, " "),
        date: parsedDate,
        venue,
        platform: "ticketlink",
        url: targetUrl,
      });
    }
  }
  return tickets;
}

async function scrapeTicketlink(browser: Browser): Promise<TicketInfo[]> {
  console.log("[티켓링크] 스크래핑 시작...");

  const candidateUrls = [
    "https://www.ticketlink.co.kr/performance/16",
    "https://www.ticketlink.co.kr/performance/14",
  ];

  for (const targetUrl of candidateUrls) {
    const result = await scrapeTicketlinkPage(browser, targetUrl);
    if (result.length > 0) return result;
  }

  console.log(`[티켓링크] 0개 추출`);
  return [];
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
      scrapeNol(browser),
      scrapeTicketlink(browser),
    ]);

    const allTickets: TicketInfo[] = [];
    const platformNames = ["멜론티켓", "Yes24", "놀티켓", "티켓링크"];

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
