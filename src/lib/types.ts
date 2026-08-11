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

export type Platform = "melon" | "yes24" | "interpark" | "nol" | "ticketlink";

export const PLATFORM_LABELS: Record<Platform, string> = {
  melon: "멜론티켓",
  yes24: "Yes24",
  interpark: "인터파크",
  nol: "놀 티켓",
  ticketlink: "티켓링크",
};

export const PLATFORM_COLORS: Record<Platform, string> = {
  melon: "#00CD3C",
  yes24: "#FF4D4D",
  interpark: "#3264FF",
  nol: "#8B5CF6",
  ticketlink: "#E8590C",
};
