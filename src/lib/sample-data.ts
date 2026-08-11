import { TicketInfo } from "./types";

export function generateSampleData(): TicketInfo[] {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();

  const sampleConcerts: Omit<TicketInfo, "id" | "date">[] = [
    {
      title: "아이유 콘서트 'The Winning'",
      venue: "잠실종합운동장 주경기장",
      platform: "melon",
      url: "https://ticket.melon.com",
      time: "18:00",
      openDate: formatDate(year, month, 5),
      openTime: "20:00",
    },
    {
      title: "BTS Yet To Come in BUSAN",
      venue: "부산 아시아드 주경기장",
      platform: "yes24",
      url: "https://ticket.yes24.com",
      time: "19:00",
    },
    {
      title: "BLACKPINK WORLD TOUR",
      venue: "고척스카이돔",
      platform: "interpark",
      url: "https://tickets.interpark.com",
      time: "18:00",
      openDate: formatDate(year, month, 10),
      openTime: "11:00",
    },
    {
      title: "뉴진스 팬미팅 'Bunnies Camp'",
      venue: "KSPO DOME",
      platform: "melon",
      url: "https://ticket.melon.com",
      time: "17:00",
    },
    {
      title: "세븐틴 FOLLOW TOUR",
      venue: "인천 돔",
      platform: "nol",
      url: "https://nol.auction.co.kr",
      time: "18:00",
      openDate: formatDate(year, month, 15),
      openTime: "14:00",
    },
    {
      title: "DAY6 콘서트 'FOREVER YOUNG'",
      venue: "올림픽공원 올림픽홀",
      platform: "yes24",
      url: "https://ticket.yes24.com",
      time: "19:00",
    },
    {
      title: "스트레이키즈 돔 투어",
      venue: "고척스카이돔",
      platform: "interpark",
      url: "https://tickets.interpark.com",
      time: "18:00",
    },
    {
      title: "에스파 SYNK : PARALLEL LINE",
      venue: "KSPO DOME",
      platform: "melon",
      url: "https://ticket.melon.com",
      time: "18:00",
      openDate: formatDate(year, month, 20),
      openTime: "20:00",
    },
    {
      title: "(여자)아이들 WORLD TOUR",
      venue: "잠실실내체육관",
      platform: "nol",
      url: "https://nol.auction.co.kr",
      time: "19:00",
    },
    {
      title: "NCT DREAM TOUR 'THE DREAM SHOW'",
      venue: "고척스카이돔",
      platform: "yes24",
      url: "https://ticket.yes24.com",
      time: "18:00",
    },
    {
      title: "ATEEZ WORLD TOUR",
      venue: "잠실종합운동장",
      platform: "interpark",
      url: "https://tickets.interpark.com",
      time: "17:00",
      openDate: formatDate(year, month, 8),
      openTime: "12:00",
    },
    {
      title: "르세라핌 팬미팅",
      venue: "올림픽공원 SK핸드볼경기장",
      platform: "melon",
      url: "https://ticket.melon.com",
      time: "16:00",
    },
    {
      title: "투모로우바이투게더 ACT:PROMISE",
      venue: "KSPO DOME",
      platform: "yes24",
      url: "https://ticket.yes24.com",
      time: "18:00",
    },
    {
      title: "ENHYPEN WORLD TOUR",
      venue: "고척스카이돔",
      platform: "nol",
      url: "https://nol.auction.co.kr",
      time: "19:00",
      openDate: formatDate(year, month, 22),
      openTime: "20:00",
    },
    {
      title: "ITZY 2nd WORLD TOUR",
      venue: "올림픽공원 올림픽홀",
      platform: "interpark",
      url: "https://tickets.interpark.com",
      time: "18:00",
    },
    {
      title: "볼빨간사춘기 콘서트",
      venue: "블루스퀘어 마스터카드홀",
      platform: "melon",
      url: "https://ticket.melon.com",
      time: "19:30",
    },
    {
      title: "IVE THE 1ST WORLD TOUR",
      venue: "KSPO DOME",
      platform: "yes24",
      url: "https://ticket.yes24.com",
      time: "18:00",
    },
    {
      title: "TREASURE RELAY TOUR",
      venue: "올림픽공원 올림픽홀",
      platform: "nol",
      url: "https://nol.auction.co.kr",
      time: "17:00",
    },
  ];

  const tickets: TicketInfo[] = [];
  sampleConcerts.forEach((concert, idx) => {
    const day = ((idx * 3 + 7) % 28) + 1;
    const date = formatDate(year, month, day);
    tickets.push({
      ...concert,
      id: `sample-${concert.platform}-${idx}`,
      date,
    });
  });

  // Add some concerts on the same dates for variety
  const extraDates = [10, 15, 20, 25];
  extraDates.forEach((day, idx) => {
    const concert = sampleConcerts[idx % sampleConcerts.length];
    const date = formatDate(year, month, day);
    tickets.push({
      ...concert,
      id: `sample-extra-${concert.platform}-${idx}`,
      date,
      title: concert.title + " (추가공연)",
    });
  });

  return tickets;
}

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
