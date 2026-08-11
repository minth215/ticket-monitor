import * as cheerio from "cheerio";
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
  openDate?: string;
  openTime?: string;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function parseKoreanDate(text: string): string[] {
  const dates: string[] = [];

  const single = text.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/g);
  if (single) {
    for (const m of single) {
      const parts = m.split(/[.\-/]/);
      dates.push(
        `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`
      );
    }
  }

  if (dates.length >= 2) {
    return [dates[0]];
  }

  return dates;
}

async function fetchWithRetry(
  url: string,
  retries = 3
): Promise<string | null> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        console.warn(`  HTTP ${res.status} for ${url}`);
        return null;
      }
      return await res.text();
    } catch (e) {
      console.warn(`  Attempt ${i + 1} failed for ${url}:`, (e as Error).message);
      if (i < retries - 1) await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return null;
}

// ─── 멜론티켓 ───────────────────────────────────────────
async function scrapeMelon(): Promise<TicketInfo[]> {
  console.log("[멜론티켓] 스크래핑 시작...");
  const tickets: TicketInfo[] = [];

  const pages = [1, 2, 3];
  for (const page of pages) {
    const html = await fetchWithRetry(
      `https://ticket.melon.com/concert/index.htm?genreType=GENRE_CON&pageIndex=${page}`
    );
    if (!html) continue;

    const $ = cheerio.load(html);

    $(".list_thumb li, .thumb_list li, .list_ticket li").each((_i, el) => {
      const $el = $(el);
      const title =
        $el.find(".ellipsis a, .tit a, .show_name a").first().text().trim() ||
        $el.find("a").first().attr("title")?.trim() ||
        $el.find("a img").attr("alt")?.trim();
      if (!title) return;

      const href = $el.find("a").first().attr("href") || "";
      const url = href.startsWith("http")
        ? href
        : href
          ? `https://ticket.melon.com${href}`
          : "https://ticket.melon.com";

      const dateText =
        $el.find(".date, .period, .show_date").first().text().trim() || "";
      const venue =
        $el.find(".place, .show_place, .venue").first().text().trim() || "";
      const img = $el.find("img").first().attr("src") || "";

      const dates = parseKoreanDate(dateText);
      for (const date of dates) {
        tickets.push({
          id: `melon-${tickets.length}`,
          title: title.replace(/\s+/g, " "),
          date,
          venue: venue || undefined,
          platform: "melon",
          url,
          imageUrl: img || undefined,
        });
      }
    });
  }

  console.log(`[멜론티켓] ${tickets.length}개 수집`);
  return tickets;
}

// ─── Yes24 티켓 ─────────────────────────────────────────
async function scrapeYes24(): Promise<TicketInfo[]> {
  console.log("[Yes24] 스크래핑 시작...");
  const tickets: TicketInfo[] = [];

  const urls = [
    "https://ticket.yes24.com/New/Genre/GenreList.aspx?genretype=1&genre=15456",
    "https://ticket.yes24.com/New/Genre/GenreList.aspx?genretype=1&genre=15457",
  ];

  for (const pageUrl of urls) {
    const html = await fetchWithRetry(pageUrl);
    if (!html) continue;

    const $ = cheerio.load(html);

    $(
      ".genre-list li, .list-grid li, .content-area li, .rn-genre-list li"
    ).each((_i, el) => {
      const $el = $(el);
      const titleEl = $el.find(
        "a .gen-title, a .rn-tit, .tit-area a, .list-title a"
      );
      const title =
        titleEl.first().text().trim() ||
        $el.find("a").first().attr("title")?.trim() ||
        $el.find("a img").attr("alt")?.trim();
      if (!title) return;

      const href = $el.find("a").first().attr("href") || "";
      const url = href.startsWith("http")
        ? href
        : href
          ? `https://ticket.yes24.com${href}`
          : "https://ticket.yes24.com";

      const dateText =
        $el
          .find(".gen-date, .rn-date, .date-area, .list-date")
          .first()
          .text()
          .trim() || "";
      const venue =
        $el
          .find(".gen-place, .rn-place, .place-area, .list-place")
          .first()
          .text()
          .trim() || "";
      const img = $el.find("img").first().attr("src") || "";

      const dates = parseKoreanDate(dateText);
      for (const date of dates) {
        tickets.push({
          id: `yes24-${tickets.length}`,
          title: title.replace(/\s+/g, " "),
          date,
          venue: venue || undefined,
          platform: "yes24",
          url,
          imageUrl: img
            ? img.startsWith("http")
              ? img
              : `https://ticket.yes24.com${img}`
            : undefined,
        });
      }
    });
  }

  console.log(`[Yes24] ${tickets.length}개 수집`);
  return tickets;
}

// ─── 인터파크 티켓 ──────────────────────────────────────
async function scrapeInterpark(): Promise<TicketInfo[]> {
  console.log("[인터파크] 스크래핑 시작...");
  const tickets: TicketInfo[] = [];

  const apiUrls = [
    "https://tickets.interpark.com/contents/api/goods/genre?genre=concert&page=1&size=20&sort=popular",
    "https://tickets.interpark.com/contents/api/goods/genre?genre=concert&page=1&size=20&sort=recent",
  ];

  for (const apiUrl of apiUrls) {
    try {
      const res = await fetch(apiUrl, {
        headers: {
          "User-Agent": UA,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(15000),
      });

      if (res.ok) {
        const json = await res.json();
        const items = json?.data?.content || json?.data?.items || json?.items || json?.content || [];

        for (const item of items) {
          const title = item.goodsName || item.name || item.title;
          if (!title) continue;

          const goodsCode = item.goodsCode || item.code || item.id || "";
          const url = goodsCode
            ? `https://tickets.interpark.com/goods/${goodsCode}`
            : "https://tickets.interpark.com";

          const startDate = item.playStartDate || item.startDate || item.date || "";
          const dates = parseKoreanDate(startDate);
          if (dates.length === 0 && startDate) {
            const isoMatch = startDate.match(/^(\d{4}-\d{2}-\d{2})/);
            if (isoMatch) dates.push(isoMatch[1]);
          }

          const venue = item.placeName || item.venue || item.place || "";
          const img = item.posterUrl || item.imageUrl || item.poster || "";

          for (const date of dates) {
            tickets.push({
              id: `interpark-${tickets.length}`,
              title: title.replace(/\s+/g, " "),
              date,
              venue: venue || undefined,
              platform: "interpark",
              url,
              imageUrl: img || undefined,
            });
          }
        }
        continue;
      }
    } catch {
      // API 실패 시 HTML 파싱으로 폴백
    }

    const html = await fetchWithRetry(
      "https://tickets.interpark.com/contents/genre/concert"
    );
    if (!html) continue;

    const $ = cheerio.load(html);
    $(".prd-list li, .ranking-list li, .contents-list li").each((_i, el) => {
      const $el = $(el);
      const title =
        $el.find(".prd-name, .tit, .goods-name").first().text().trim() ||
        $el.find("a").first().attr("title")?.trim();
      if (!title) return;

      const href = $el.find("a").first().attr("href") || "";
      const url = href.startsWith("http")
        ? href
        : `https://tickets.interpark.com${href}`;

      const dateText =
        $el.find(".prd-date, .date, .period").first().text().trim() || "";
      const venue =
        $el.find(".prd-place, .place, .venue").first().text().trim() || "";

      const dates = parseKoreanDate(dateText);
      for (const date of dates) {
        tickets.push({
          id: `interpark-${tickets.length}`,
          title: title.replace(/\s+/g, " "),
          date,
          venue: venue || undefined,
          platform: "interpark",
          url,
        });
      }
    });
  }

  console.log(`[인터파크] ${tickets.length}개 수집`);
  return tickets;
}

// ─── 놀 티켓 ────────────────────────────────────────────
async function scrapeNol(): Promise<TicketInfo[]> {
  console.log("[놀 티켓] 스크래핑 시작...");
  const tickets: TicketInfo[] = [];

  const html = await fetchWithRetry(
    "https://ticket.nol.auction.co.kr/Category/ConcertList.aspx"
  );
  if (!html) {
    const html2 = await fetchWithRetry(
      "https://nol.auction.co.kr/concert/list.do"
    );
    if (html2) {
      const $ = cheerio.load(html2);
      $(".concert-list li, .list_item li, .thumb_list li").each((_i, el) => {
        const $el = $(el);
        const title =
          $el.find(".tit, .name, .show-title").first().text().trim() ||
          $el.find("a").first().attr("title")?.trim();
        if (!title) return;

        const href = $el.find("a").first().attr("href") || "";
        const url = href.startsWith("http")
          ? href
          : `https://nol.auction.co.kr${href}`;

        const dateText =
          $el.find(".date, .period, .show-date").first().text().trim() || "";
        const venue =
          $el.find(".place, .venue, .show-place").first().text().trim() || "";

        const dates = parseKoreanDate(dateText);
        for (const date of dates) {
          tickets.push({
            id: `nol-${tickets.length}`,
            title: title.replace(/\s+/g, " "),
            date,
            venue: venue || undefined,
            platform: "nol",
            url,
          });
        }
      });
    }
    console.log(`[놀 티켓] ${tickets.length}개 수집`);
    return tickets;
  }

  const $ = cheerio.load(html);
  $(".list_area li, .concert-list li, .thumb_list li").each((_i, el) => {
    const $el = $(el);
    const title =
      $el.find(".tit a, .name a, .ellipsis a").first().text().trim() ||
      $el.find("a").first().attr("title")?.trim() ||
      $el.find("a img").attr("alt")?.trim();
    if (!title) return;

    const href = $el.find("a").first().attr("href") || "";
    const url = href.startsWith("http")
      ? href
      : `https://ticket.nol.auction.co.kr${href}`;

    const dateText =
      $el.find(".date, .period, .show_date").first().text().trim() || "";
    const venue =
      $el.find(".place, .venue, .show_place").first().text().trim() || "";
    const img = $el.find("img").first().attr("src") || "";

    const dates = parseKoreanDate(dateText);
    for (const date of dates) {
      tickets.push({
        id: `nol-${tickets.length}`,
        title: title.replace(/\s+/g, " "),
        date,
        venue: venue || undefined,
        platform: "nol",
        url,
        imageUrl: img || undefined,
      });
    }
  });

  console.log(`[놀 티켓] ${tickets.length}개 수집`);
  return tickets;
}

// ─── 티켓링크 ───────────────────────────────────────────
async function scrapeTicketlink(): Promise<TicketInfo[]> {
  console.log("[티켓링크] 스크래핑 시작...");
  const tickets: TicketInfo[] = [];

  // 티켓링크 API 시도
  const apiUrls = [
    "https://www.ticketlink.co.kr/api/product/list?categoryId=1&subCategoryId=1&page=1&size=20&sort=popular",
    "https://www.ticketlink.co.kr/api/product/list?categoryId=1&subCategoryId=1&page=1&size=20&sort=recent",
  ];

  for (const apiUrl of apiUrls) {
    try {
      const res = await fetch(apiUrl, {
        headers: {
          "User-Agent": UA,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(15000),
      });

      if (res.ok) {
        const json = await res.json();
        const items =
          json?.data?.content ||
          json?.data?.list ||
          json?.result?.content ||
          json?.result?.list ||
          json?.items ||
          json?.list ||
          [];

        for (const item of items) {
          const title =
            item.productName || item.name || item.title || item.goodsName;
          if (!title) continue;

          const productId =
            item.productId || item.id || item.productNo || item.code || "";
          const url = productId
            ? `https://www.ticketlink.co.kr/product/${productId}`
            : "https://www.ticketlink.co.kr";

          const startDate =
            item.playStartDate ||
            item.startDate ||
            item.openDate ||
            item.date ||
            "";
          const dates = parseKoreanDate(startDate);
          if (dates.length === 0 && startDate) {
            const isoMatch = startDate.match(/^(\d{4}-\d{2}-\d{2})/);
            if (isoMatch) dates.push(isoMatch[1]);
          }

          const venue =
            item.placeName || item.venueName || item.venue || item.place || "";
          const img =
            item.posterUrl ||
            item.imageUrl ||
            item.posterImageUrl ||
            item.poster ||
            "";

          for (const date of dates) {
            tickets.push({
              id: `ticketlink-${tickets.length}`,
              title: title.replace(/\s+/g, " "),
              date,
              venue: venue || undefined,
              platform: "ticketlink",
              url,
              imageUrl: img || undefined,
            });
          }
        }

        if (tickets.length > 0) {
          console.log(`[티켓링크] ${tickets.length}개 수집 (API)`);
          return tickets;
        }
      }
    } catch {
      // API 실패 시 HTML 파싱으로 폴백
    }
  }

  // HTML 폴백 - 콘서트 카테고리 페이지
  const htmlUrls = [
    "https://www.ticketlink.co.kr/performance/concert",
    "https://www.ticketlink.co.kr/performance/concert?page=1",
  ];

  for (const pageUrl of htmlUrls) {
    const html = await fetchWithRetry(pageUrl);
    if (!html) continue;

    const $ = cheerio.load(html);

    $(
      ".product_list li, .performance_list li, .list_item li, .event_list li, .ranking_list li"
    ).each((_i, el) => {
      const $el = $(el);
      const title =
        $el.find(".prd_name, .tit, .product_name, .event_name, .name").first().text().trim() ||
        $el.find("a").first().attr("title")?.trim() ||
        $el.find("a img").attr("alt")?.trim();
      if (!title) return;

      const href = $el.find("a").first().attr("href") || "";
      const url = href.startsWith("http")
        ? href
        : href
          ? `https://www.ticketlink.co.kr${href}`
          : "https://www.ticketlink.co.kr";

      const dateText =
        $el
          .find(".prd_date, .date, .period, .show_date, .event_date")
          .first()
          .text()
          .trim() || "";
      const venue =
        $el
          .find(".prd_place, .place, .venue, .show_place, .event_place")
          .first()
          .text()
          .trim() || "";
      const img = $el.find("img").first().attr("src") || "";

      const dates = parseKoreanDate(dateText);
      for (const date of dates) {
        tickets.push({
          id: `ticketlink-${tickets.length}`,
          title: title.replace(/\s+/g, " "),
          date,
          venue: venue || undefined,
          platform: "ticketlink",
          url,
          imageUrl: img
            ? img.startsWith("http")
              ? img
              : `https://www.ticketlink.co.kr${img}`
            : undefined,
        });
      }
    });

    if (tickets.length > 0) break;
  }

  console.log(`[티켓링크] ${tickets.length}개 수집`);
  return tickets;
}

// ─── 메인 ───────────────────────────────────────────────
async function main() {
  console.log("=== 콘서트 티켓 스크래핑 시작 ===\n");

  const results = await Promise.allSettled([
    scrapeMelon(),
    scrapeYes24(),
    scrapeInterpark(),
    scrapeNol(),
    scrapeTicketlink(),
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
}

main().catch((e) => {
  console.error("스크래핑 실패:", e);
  process.exit(1);
});
