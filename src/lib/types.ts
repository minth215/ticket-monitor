export interface TicketInfo {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  time?: string;
  venue?: string;
  platform: Platform;
  url: string;
  imageUrl?: string;
  openDate?: string; // ticket open date YYYY-MM-DD
  openTime?: string;
}

export type Platform = "melon" | "yes24" | "nol" | "ticketlink";

export const PLATFORM_LABELS: Record<Platform, string> = {
  melon: "멜론티켓",
  yes24: "Yes24",
  nol: "놀티켓",
  ticketlink: "티켓링크",
};

export const PLATFORM_COLORS: Record<Platform, string> = {
  melon: "#00CD3C",
  yes24: "#FF4D4D",
  nol: "#6E2FF0",
  ticketlink: "#E8590C",
};
