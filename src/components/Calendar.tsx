"use client";

import { useState, useEffect, useRef } from "react";
import { TicketInfo, Platform, PLATFORM_LABELS, PLATFORM_COLORS } from "@/lib/types";
import { generateSampleData } from "@/lib/sample-data";
import { TicketModal } from "./TicketModal";

const DAYS_OF_WEEK = ["일", "월", "화", "수", "목", "금", "토"];

export function Calendar() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [tickets, setTickets] = useState<TicketInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<"live" | "sample">("sample");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<Platform>>(
    new Set(["melon", "yes24", "interpark", "nol"])
  );

  const allTicketsRef = useRef<TicketInfo[]>([]);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  useEffect(() => {
    let cancelled = false;
    async function loadTickets() {
      setLoading(true);
      try {
        const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
        const res = await fetch(`${basePath}/tickets.json`);
        if (!res.ok) throw new Error("No scraped data");
        const data = await res.json();
        if (!cancelled && data.tickets?.length > 0) {
          allTicketsRef.current = data.tickets;
          setLastUpdated(data.lastUpdated || null);
          setDataSource("live");
        } else {
          throw new Error("Empty data");
        }
      } catch {
        if (!cancelled) {
          allTicketsRef.current = generateSampleData();
          setDataSource("sample");
        }
      }
      if (!cancelled) {
        const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
        setTickets(allTicketsRef.current.filter((t) => t.date.startsWith(prefix)));
        setLoading(false);
      }
    }
    loadTickets();
    return () => { cancelled = true; };
  }, [year, month]);

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();

  const calendarDays: { day: number; isCurrentMonth: boolean; date: string }[] =
    [];

  for (let i = firstDay - 1; i >= 0; i--) {
    const d = prevMonthDays - i;
    const m = month === 0 ? 12 : month;
    const y = month === 0 ? year - 1 : year;
    calendarDays.push({
      day: d,
      isCurrentMonth: false,
      date: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    });
  }

  for (let d = 1; d <= daysInMonth; d++) {
    calendarDays.push({
      day: d,
      isCurrentMonth: true,
      date: `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    });
  }

  const remaining = 7 - (calendarDays.length % 7);
  if (remaining < 7) {
    for (let d = 1; d <= remaining; d++) {
      const m = month + 2 > 12 ? 1 : month + 2;
      const y = month + 2 > 12 ? year + 1 : year;
      calendarDays.push({
        day: d,
        isCurrentMonth: false,
        date: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      });
    }
  }

  const ticketsByDate = tickets
    .filter((t) => selectedPlatforms.has(t.platform))
    .reduce(
      (acc, ticket) => {
        if (!acc[ticket.date]) acc[ticket.date] = [];
        acc[ticket.date].push(ticket);
        return acc;
      },
      {} as Record<string, TicketInfo[]>
    );

  const today = new Date().toISOString().slice(0, 10);

  const togglePlatform = (platform: Platform) => {
    setSelectedPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(platform)) {
        next.delete(platform);
      } else {
        next.add(platform);
      }
      return next;
    });
  };

  const goToPrevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const goToNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            콘서트 티켓 캘린더
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            각 플랫폼의 콘서트 예매 정보를 한눈에
          </p>
        </div>

        {/* Platform Filters */}
        <div className="flex flex-wrap gap-2">
          {(Object.keys(PLATFORM_LABELS) as Platform[]).map((platform) => (
            <button
              key={platform}
              onClick={() => togglePlatform(platform)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all"
              style={{
                backgroundColor: selectedPlatforms.has(platform)
                  ? PLATFORM_COLORS[platform]
                  : "transparent",
                color: selectedPlatforms.has(platform) ? "white" : PLATFORM_COLORS[platform],
                border: `2px solid ${PLATFORM_COLORS[platform]}`,
                opacity: selectedPlatforms.has(platform) ? 1 : 0.6,
              }}
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{
                  backgroundColor: selectedPlatforms.has(platform)
                    ? "white"
                    : PLATFORM_COLORS[platform],
                }}
              />
              {PLATFORM_LABELS[platform]}
            </button>
          ))}
        </div>
      </div>

      {/* Month Navigation */}
      <div className="flex items-center justify-between mb-4 bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm">
        <button
          onClick={goToPrevMonth}
          className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold">
            {year}년 {month + 1}월
          </h2>
          <button
            onClick={goToToday}
            className="text-xs px-2.5 py-1 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-md transition"
          >
            오늘
          </button>
        </div>
        <button
          onClick={goToNextMonth}
          className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Calendar Grid */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden">
        {/* Day Headers */}
        <div className="grid grid-cols-7 border-b border-gray-200 dark:border-gray-700">
          {DAYS_OF_WEEK.map((day, i) => (
            <div
              key={day}
              className={`py-3 text-center text-sm font-semibold ${
                i === 0
                  ? "text-red-500"
                  : i === 6
                    ? "text-blue-500"
                    : "text-gray-600 dark:text-gray-400"
              }`}
            >
              {day}
            </div>
          ))}
        </div>

        {/* Calendar Body */}
        {loading ? (
          <div className="flex items-center justify-center h-96">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-3 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
              <p className="text-sm text-gray-500">티켓 정보를 불러오는 중...</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-7">
            {calendarDays.map(({ day, isCurrentMonth, date }, idx) => {
              const dayTickets = ticketsByDate[date] || [];
              const isToday = date === today;
              const dayOfWeek = idx % 7;

              return (
                <div
                  key={`${date}-${idx}`}
                  onClick={() => dayTickets.length > 0 && setSelectedDate(date)}
                  className={`
                    min-h-[100px] sm:min-h-[120px] p-1.5 border-b border-r
                    border-gray-100 dark:border-gray-700
                    ${!isCurrentMonth ? "bg-gray-50 dark:bg-gray-900/50" : ""}
                    ${dayTickets.length > 0 ? "cursor-pointer hover:bg-blue-50/50 dark:hover:bg-blue-900/10" : ""}
                    transition-colors
                  `}
                >
                  <div className="flex items-start justify-between">
                    <span
                      className={`
                        text-sm font-medium inline-flex items-center justify-center
                        w-7 h-7 rounded-full
                        ${!isCurrentMonth ? "text-gray-400 dark:text-gray-600" : ""}
                        ${isToday ? "bg-blue-500 text-white" : ""}
                        ${
                          !isToday && isCurrentMonth && dayOfWeek === 0
                            ? "text-red-500"
                            : ""
                        }
                        ${
                          !isToday && isCurrentMonth && dayOfWeek === 6
                            ? "text-blue-500"
                            : ""
                        }
                      `}
                    >
                      {day}
                    </span>
                    {dayTickets.length > 0 && (
                      <span className="text-xs text-gray-400 mt-1">
                        {dayTickets.length}
                      </span>
                    )}
                  </div>

                  <div className="mt-1 space-y-0.5 overflow-hidden">
                    {dayTickets.slice(0, 3).map((ticket) => (
                      <div
                        key={ticket.id}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs truncate"
                        style={{
                          backgroundColor: `${PLATFORM_COLORS[ticket.platform]}15`,
                          color: PLATFORM_COLORS[ticket.platform],
                        }}
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                          style={{
                            backgroundColor: PLATFORM_COLORS[ticket.platform],
                          }}
                        />
                        <span className="truncate">{ticket.title}</span>
                      </div>
                    ))}
                    {dayTickets.length > 3 && (
                      <p className="text-xs text-gray-400 pl-1">
                        +{dayTickets.length - 3}개 더보기
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-4 text-xs text-gray-500 dark:text-gray-400">
        {dataSource === "sample" ? (
          <span>* 샘플 데이터가 표시됩니다. 스크래핑 데이터가 준비되면 자동으로 전환됩니다.</span>
        ) : (
          <span>* 멜론티켓, Yes24, 인터파크, 놀 티켓에서 수집된 실제 데이터입니다.</span>
        )}
        {lastUpdated && (
          <span>
            마지막 업데이트: {new Date(lastUpdated).toLocaleString("ko-KR")}
          </span>
        )}
      </div>

      {/* Modal */}
      {selectedDate && (
        <TicketModal
          date={selectedDate}
          tickets={ticketsByDate[selectedDate] || []}
          onClose={() => setSelectedDate(null)}
        />
      )}
    </div>
  );
}
