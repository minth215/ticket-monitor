"use client";

import { useEffect, useRef } from "react";
import { TicketInfo, PLATFORM_LABELS, PLATFORM_COLORS } from "@/lib/types";

interface TicketModalProps {
  date: string;
  tickets: TicketInfo[];
  onClose: () => void;
}

export function TicketModal({ date, tickets, onClose }: TicketModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const [year, month, day] = date.split("-");
  const dateObj = new Date(Number(year), Number(month) - 1, Number(day));
  const formattedDate = `${year}년 ${Number(month)}월 ${Number(day)}일 (${["일", "월", "화", "수", "목", "금", "토"][dateObj.getDay()]})`;

  const groupedByPlatform = tickets.reduce(
    (acc, ticket) => {
      if (!acc[ticket.platform]) acc[ticket.platform] = [];
      acc[ticket.platform].push(ticket);
      return acc;
    },
    {} as Record<string, TicketInfo[]>
  );

  return (
    <div
      ref={overlayRef}
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
    >
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-gray-700">
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">
              {formattedDate}
            </h3>
            <p className="text-sm text-gray-500 mt-0.5">
              {tickets.length}개의 콘서트
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto p-5 space-y-5">
          {Object.entries(groupedByPlatform).map(([platform, platformTickets]) => (
            <div key={platform}>
              <div className="flex items-center gap-2 mb-3">
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: PLATFORM_COLORS[platform as keyof typeof PLATFORM_COLORS] }}
                />
                <span
                  className="text-sm font-semibold"
                  style={{ color: PLATFORM_COLORS[platform as keyof typeof PLATFORM_COLORS] }}
                >
                  {PLATFORM_LABELS[platform as keyof typeof PLATFORM_LABELS]}
                </span>
              </div>

              <div className="space-y-2">
                {platformTickets.map((ticket) => (
                  <a
                    key={ticket.id}
                    href={ticket.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block p-3 rounded-xl border border-gray-100 dark:border-gray-700 hover:border-gray-200 dark:hover:border-gray-600 hover:shadow-sm transition-all group"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h4 className="font-medium text-gray-900 dark:text-white truncate group-hover:text-blue-500 transition-colors">
                          {ticket.title}
                        </h4>
                        {ticket.venue && (
                          <p className="text-sm text-gray-500 mt-1 flex items-center gap-1">
                            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            {ticket.venue}
                          </p>
                        )}
                        <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-gray-400">
                          {ticket.time && (
                            <span className="flex items-center gap-1">
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              공연 {ticket.time}
                            </span>
                          )}
                          {ticket.openDate && (
                            <span className="flex items-center gap-1 text-orange-500 font-medium">
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 0V5m0 2h2M13 7h2m-2 0H9m4 0V5M9 7V5m0 2H7m2 0v2" />
                              </svg>
                              예매 {ticket.openDate} {ticket.openTime}
                            </span>
                          )}
                        </div>
                      </div>
                      <svg className="w-4 h-4 text-gray-300 group-hover:text-blue-500 flex-shrink-0 mt-1 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
