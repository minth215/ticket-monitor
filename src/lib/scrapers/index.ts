import { TicketInfo } from "../types";
import { scrapeMelon } from "./melon";
import { scrapeYes24 } from "./yes24";
import { scrapeInterpark } from "./interpark";
import { scrapeNol } from "./nol";

export async function scrapeAll(): Promise<TicketInfo[]> {
  const results = await Promise.allSettled([
    scrapeMelon(),
    scrapeYes24(),
    scrapeInterpark(),
    scrapeNol(),
  ]);

  const tickets: TicketInfo[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      tickets.push(...result.value);
    }
  }

  return tickets;
}

export { scrapeMelon, scrapeYes24, scrapeInterpark, scrapeNol };
