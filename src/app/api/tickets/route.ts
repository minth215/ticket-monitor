import { NextResponse } from "next/server";
import { scrapeAll } from "@/lib/scrapers";
import { generateSampleData } from "@/lib/sample-data";
import { TicketInfo } from "@/lib/types";

let cachedTickets: TicketInfo[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const useSample = searchParams.get("sample") === "true";
  const year = searchParams.get("year");
  const month = searchParams.get("month");

  let tickets: TicketInfo[];

  if (useSample) {
    tickets = generateSampleData();
  } else {
    const now = Date.now();
    if (cachedTickets && now - cacheTimestamp < CACHE_TTL) {
      tickets = cachedTickets;
    } else {
      tickets = await scrapeAll();
      if (tickets.length === 0) {
        tickets = generateSampleData();
      }
      cachedTickets = tickets;
      cacheTimestamp = now;
    }
  }

  if (year && month) {
    const prefix = `${year}-${month.padStart(2, "0")}`;
    tickets = tickets.filter((t) => t.date.startsWith(prefix));
  }

  return NextResponse.json({ tickets });
}
