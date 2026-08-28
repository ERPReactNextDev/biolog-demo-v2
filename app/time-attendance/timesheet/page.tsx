"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import ExcelJS from "exceljs";
import FileSaver from "file-saver";
const { saveAs } = FileSaver;
import { UserProvider, useUser } from "@/contexts/UserContext";
import { FormatProvider } from "@/contexts/FormatContext";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import ProtectedPageWrapper from "@/components/protected-page-wrapper";
import { Search, DownloadCloud, Info, Clock, AlertCircle, ArrowDownLeft, ArrowUpRight, ArrowLeft, Calendar as CalendarIcon, WifiOff } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { cacheLogs, getCachedLogs } from "@/lib/offline-logs-cache";
import { getAllPendingLogs } from "@/lib/offline-store";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ActivityLog {
  ReferenceID: string;
  Email: string;
  Type: string;
  Status: string;
  Location: string;
  date_created: string;
  Remarks: string;
  _id?: string;
}

interface UserInfo {
  Firstname: string;
  Lastname: string;
  profilePicture?: string;
}

interface DailyLog {
  dateStr: string;
  label: string;
}

interface WeeklyLog extends Record<string, number> {
  late: number;
  undertime: number;
  overtime: number;
}

// ── Mobile Card Item ──────────────────────────────────────────────────────────

function MobileTimesheetCard({ 
  refId, 
  name, 
  week, 
  dayHeaders, 
  profilePicture, 
  onInfoClick 
}: { 
  refId: string; 
  name: string; 
  week: WeeklyLog & Record<string, number>; 
  dayHeaders: DailyLog[]; 
  profilePicture?: string; 
  onInfoClick: () => void; 
}) {
  const total = dayHeaders.reduce((s, { dateStr }) => s + (week[dateStr] ?? 0), 0);
  const initials = name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);

  return (
    <div className="clay-card p-4 mb-3">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          {profilePicture ? (
            <img src={profilePicture} alt="" className="w-10 h-10 rounded-full object-cover border border-gray-100" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-brand-light flex items-center justify-center text-[12px] font-bold text-brand-primary">
              {initials}
            </div>
          )}
          <div>
            <p className="text-[14px] font-bold text-gray-800 capitalize">{name}</p>
            <p className="text-[11px] text-gray-400">Total: {total.toFixed(2)} hrs</p>
          </div>
        </div>
        <button 
          onClick={onInfoClick}
          className="w-8 h-8 rounded-xl bg-gray-50 flex items-center justify-center text-gray-400 hover:bg-brand-light hover:text-brand-primary transition-colors"
        >
          <Info size={16} />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="bg-brand-light rounded-2xl px-3 py-2.5 text-center border border-red-50">
          <p className="text-[13px] font-bold text-brand-primary">{week.late.toFixed(1)}h</p>
          <p className="text-brand-primary/60 text-[9px] font-semibold uppercase tracking-wider mt-0.5">Late</p>
        </div>
        <div className="bg-[#FDF4E7] rounded-2xl px-3 py-2.5 text-center border border-amber-50">
          <p className="text-[13px] font-bold text-[#A0611A]">{week.undertime.toFixed(1)}h</p>
          <p className="text-[#A0611A]/60 text-[9px] font-semibold uppercase tracking-wider mt-0.5">Under</p>
        </div>
        <div className="bg-[#EEF7F2] rounded-2xl px-3 py-2.5 text-center border border-green-50">
          <p className="text-[13px] font-bold text-[#1A7A4A]">{week.overtime.toFixed(1)}h</p>
          <p className="text-[#1A7A4A]/60 text-[9px] font-semibold uppercase tracking-wider mt-0.5">Over</p>
        </div>
      </div>
    </div>
  );
}

// ── Inner Page (uses useUser hook) ────────────────────────────────────────────

function TimesheetPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { userId, setUserId } = useUser();
  const queryUserId = searchParams?.get("id") ?? "";

  const [userDetails, setUserDetails] = useState({
    UserId: "", Firstname: "", Lastname: "", Email: "",
    Role: "", Department: "", Company: "", ReferenceID: "",
  });

  const [posts, setPosts] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [usersMap, setUsersMap] = useState<Record<string, UserInfo>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [dateCreatedFilterRange, setDateCreatedFilterRange] = useState<DateRange | undefined>(undefined);
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [systemSettings, setSystemSettings] = useState({
    officeStartTime: "08:00",
    officeEndTime: "17:00",
    lunchStart: "12:00",
    lunchEnd: "13:00",
    gracePeriod: 15
  });

  const [isOnline, setIsOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);

  // Handle online/offline status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Fetch system settings
  useEffect(() => {
    fetch("/api/admin/settings")
      .then((r) => r.json())
      .then((data) => {
        if (data && data.type === "global") {
          setSystemSettings({
            officeStartTime: data.officeStartTime || "08:00",
            officeEndTime: data.officeEndTime || "17:00",
            lunchStart: data.lunchStart || "12:00",
            lunchEnd: data.lunchEnd || "13:00",
            gracePeriod: data.gracePeriod || 15
          });
        }
      })
      .catch(() => { /* silent */ });
  }, []);

  // Back navigation — go back to activity planner with same userId
  function handleBack() {
    const url = `/activity-planner${queryUserId ? `?id=${encodeURIComponent(queryUserId)}` : ""}`;
    router.push(url);
  }

  // Sync URL user id
  useEffect(() => {
    if (queryUserId && queryUserId !== userId) setUserId(queryUserId);
  }, [queryUserId, userId, setUserId]);

  // Fetch current user
  useEffect(() => {
    if (!queryUserId) return;
    setLoading(true);
    fetch(`/api/user?id=${encodeURIComponent(queryUserId)}`)
      .then((r) => r.json())
      .then((data) => setUserDetails({
        UserId: data._id ?? "", Firstname: data.Firstname ?? "",
        Lastname: data.Lastname ?? "", Email: data.Email ?? "",
        Role: data.Role ?? "", Department: data.Department ?? "",
        Company: data.Company ?? "", ReferenceID: data.ReferenceID ?? "",
      }))
      .catch(() => toast.error("Failed to load user data."))
      .finally(() => setLoading(false));
  }, [queryUserId]);

  // Fetch logs
  useEffect(() => {
    const fetchAllActivityLogs = async () => {
      if (!userDetails.ReferenceID && userDetails.Role === "") return;
      setLoading(true);
      try {
        let allLogs: ActivityLog[] = [];
        const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;

        if (isOnline) {
          let page = 1;
          const limit = 100;
          let totalPages = 1;
          do {
            const params = new URLSearchParams();
            params.append("page", page.toString());
            params.append("limit", limit.toString());
            params.append("role", userDetails.Role);
            if (userDetails.Role !== "SuperAdmin" && userDetails.Role !== "Human Resources") {
              params.append("referenceID", userDetails.ReferenceID);
            }
            if (dateCreatedFilterRange?.from) {
              params.append("startDate", dateCreatedFilterRange.from.toISOString());
              params.append("endDate", (dateCreatedFilterRange.to ?? dateCreatedFilterRange.from).toISOString());
            }
            const res = await fetch(`/api/ModuleSales/Activity/FetchLog?${params.toString()}`);
            if (!res.ok) throw new Error("Failed to fetch logs");
            const data = await res.json();
            allLogs = allLogs.concat(data.data ?? []);
            totalPages = data.pagination?.totalPages ?? 1;
            page++;
          } while (page <= totalPages);
          
          // Cache the online logs
          await cacheLogs(allLogs as unknown as Record<string, unknown>[]);
        } else {
          // Load from cache
          allLogs = (await getCachedLogs()) as unknown as ActivityLog[];
        }

        // Merge with pending (offline) logs
        try {
          const pendingLogs = await getAllPendingLogs();
          const pendingActivities = pendingLogs.map(p => ({
            ...(p.payload as any),
            _id: p.id,
          })) as ActivityLog[];
          // Combine, remove duplicates by _id/id
          const allIds = new Set();
          const combined: ActivityLog[] = [];
          for (const log of [...pendingActivities, ...allLogs]) {
            const id = (log as any)._id || (log as any).id;
            if (!allIds.has(id)) {
              allIds.add(id);
              combined.push(log);
            }
          }
          allLogs = combined;
        } catch {
          // Ignore pending logs if error
        }

        // Sort by date_created descending
        allLogs.sort((a, b) => new Date(b.date_created).getTime() - new Date(a.date_created).getTime());

        setPosts(allLogs);
      } catch {
        // If online fetch failed, try to load from cache
        try {
          const cachedLogs = (await getCachedLogs()) as unknown as ActivityLog[];
          setPosts(cachedLogs);
        } catch {
          toast.error("Error fetching activity logs.");
          setPosts([]);
        }
      } finally {
        setLoading(false);
      }
    };
    fetchAllActivityLogs();
  }, [userDetails, dateCreatedFilterRange]);

  // Fetch usersMap
  useEffect(() => {
    if (posts.length === 0) return;
    const uniqueRefs = Array.from(new Set(posts.map((p) => p.ReferenceID)));
    fetch(`/api/users?referenceIDs=${uniqueRefs.join(",")}`)
      .then((r) => r.json())
      .then((usersData) => {
        const map: Record<string, UserInfo> = {};
        usersData.forEach((u: any) => {
          map[u.ReferenceID] = {
            Firstname: u.Firstname ?? "Unknown",
            Lastname: u.Lastname ?? "",
            profilePicture: u.profilePicture ?? "",
          };
        });
        setUsersMap(map);
      })
      .catch(() => {
        const fallback: Record<string, UserInfo> = {};
        posts.forEach((p) => { fallback[p.ReferenceID] = { Firstname: "Unknown", Lastname: "" }; });
        setUsersMap(fallback);
      });
  }, [posts]);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function isDateInRange(dateStr: string, range?: DateRange) {
    if (!range) return true;
    const date = new Date(dateStr);
    const from = range.from ? new Date(range.from) : null;
    let to = range.to ? new Date(range.to) : null;
    if (to) to = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 999);
    if (from && to) return date >= from && date <= to;
    if (from) return date.toDateString() === from.toDateString();
    if (to) return date.toDateString() === to.toDateString();
    return true;
  }

  function formatDate(d: string | Date) {
    const date = new Date(d);
    const startH = parseInt(systemSettings.officeStartTime.split(":")[0]);
    // If before work day start, it belongs to the previous work day
    if (date.getHours() < startH) {
      date.setDate(date.getDate() - 1);
    }
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function formatDateLabel(date: Date) {
    return `${date.getDate()} | ${date.toLocaleDateString(undefined, { weekday: "long" })}`;
  }

  function formatShortDate(date: Date) {
    return date.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
  }

  function calculateTimes(logs: ActivityLog[]) {
    // Sort logs by time (earliest first)
    const sortedLogs = [...logs].sort((a, b) => new Date(a.date_created).getTime() - new Date(b.date_created).getTime());
    
    let totalMs = 0;
    let firstLogin: Date | null = null;
    let lastLogout: Date | null = null;
    
    // Group logs by Type to pair Login/Logout correctly
    const logsByType: Record<string, ActivityLog[]> = {};
    for (const l of sortedLogs) {
      if (!logsByType[l.Type]) logsByType[l.Type] = [];
      logsByType[l.Type].push(l);
    }

    for (const typeLogs of Object.values(logsByType)) {
      let currentLogin: Date | null = null;
      for (const log of typeLogs) {
        const logDate = new Date(log.date_created);
        if (log.Status.toLowerCase() === "login") {
          if (!firstLogin || logDate < firstLogin) firstLogin = logDate;
          currentLogin = logDate;
        } else if (log.Status.toLowerCase() === "logout") {
          if (currentLogin) {
            totalMs += logDate.getTime() - currentLogin.getTime();
            if (!lastLogout || logDate > lastLogout) lastLogout = logDate;
            currentLogin = null;
          }
        }
      }
    }

    if (!firstLogin) return { hours: 0, late: 0, undertime: 0, overtime: 0 };

    // Reference Shift: Dynamic from System Settings
    const workDay = new Date(firstLogin);
    const startH = parseInt(systemSettings.officeStartTime.split(":")[0]);
    if (workDay.getHours() < startH) workDay.setDate(workDay.getDate() - 1);
    
    const [sH, sM] = systemSettings.officeStartTime.split(":").map(Number);
    const [eH, eM] = systemSettings.officeEndTime.split(":").map(Number);
    const [lsH, lsM] = systemSettings.lunchStart.split(":").map(Number);
    const [leH, leM] = systemSettings.lunchEnd.split(":").map(Number);

    const shiftStart = new Date(workDay); shiftStart.setHours(sH, sM, 0, 0);
    const shiftEnd = new Date(workDay); shiftEnd.setHours(eH, eM, 0, 0);
    const graceThreshold = new Date(shiftStart);
    graceThreshold.setMinutes(shiftStart.getMinutes() + systemSettings.gracePeriod);
    
    // 1. Late Calculation: First Login vs Shift Start (including grace period)
    const late = firstLogin > graceThreshold ? (firstLogin.getTime() - shiftStart.getTime()) / 3600000 : 0;
    
    // 2. Total Worked Hours (with dynamic lunch deduction)
    const lunchStart = new Date(workDay); lunchStart.setHours(lsH, lsM, 0, 0);
    const lunchEnd = new Date(workDay); lunchEnd.setHours(leH, leM, 0, 0);
    const lunchDurationMs = lunchEnd.getTime() - lunchStart.getTime();
    const lunchDurationHrs = lunchDurationMs / 3600000;
    
    let actualHours = totalMs / 3600000;
    // Deduct lunch if the total duration covers the lunch period
    // Typically, if they worked more than 5 hours, we assume they took a lunch break
    if (actualHours > 5) actualHours = Math.max(0, actualHours - lunchDurationHrs);

    // 3. Overtime: Worked hours beyond standard work hours (e.g. 8 hours)
    const standardWorkMs = shiftEnd.getTime() - shiftStart.getTime() - lunchDurationMs;
    const expectedHours = standardWorkMs / 3600000;
    const overtime = actualHours > expectedHours ? actualHours - expectedHours : 0;
    
    // 4. Undertime: If they logged out before Shift End
    const undertime = (lastLogout && lastLogout < shiftEnd) ? (shiftEnd.getTime() - lastLogout.getTime()) / 3600000 : 0;

    return {
      hours: +(actualHours.toFixed(2)),
      late: +late.toFixed(2),
      undertime: +undertime.toFixed(2),
      overtime: +overtime.toFixed(2),
    };
  }

  // ── Derived Data ──────────────────────────────────────────────────────────────

  const filteredPosts = userDetails.Role === "SuperAdmin" || userDetails.Department === "Human Resources"
    ? posts
    : posts.filter((p) => p.ReferenceID === userDetails.ReferenceID);

  const searchedPosts = filteredPosts
    .filter((post) => {
      const q = searchQuery.toLowerCase().trim();
      if (!q) return true;
      const u = usersMap[post.ReferenceID];
      if (!u) return false;
      return u.Firstname.toLowerCase().includes(q) || u.Lastname.toLowerCase().includes(q);
    })
    .filter((post) => isDateInRange(post.date_created, dateCreatedFilterRange));

  const dayHeaders: DailyLog[] = [];
  if (dateCreatedFilterRange?.from) {
    const start = new Date(dateCreatedFilterRange.from);
    const end = dateCreatedFilterRange.to ? new Date(dateCreatedFilterRange.to) : new Date(start);
    
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      if (d.getDay() === 0) continue; // Skip Sundays if needed
      dayHeaders.push({ dateStr: formatDate(new Date(d)), label: formatDateLabel(new Date(d)) });
    }
  } else {
    const today = new Date();
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    for (let i = 0; i < 6; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      dayHeaders.push({ dateStr: formatDate(d), label: formatDateLabel(d) });
    }
  }

  const groupedByRefDate: Record<string, ActivityLog[]> = {};
  searchedPosts.forEach((log) => {
    const key = `${log.ReferenceID}|${formatDate(log.date_created)}`;
    if (!groupedByRefDate[key]) groupedByRefDate[key] = [];
    groupedByRefDate[key].push(log);
  });

  const weeklyData: Record<string, WeeklyLog & Record<string, number>> = {};
  Object.entries(groupedByRefDate).forEach(([key, logs]) => {
    const [ref, dateKey] = key.split("|");
    if (!weeklyData[ref]) {
      weeklyData[ref] = { late: 0, undertime: 0, overtime: 0 };
      dayHeaders.forEach(({ dateStr }) => { weeklyData[ref][dateStr] = 0; });
    }
    const result = calculateTimes(logs);
    weeklyData[ref][dateKey] = result.hours;
    weeklyData[ref].late += result.late;
    weeklyData[ref].undertime += result.undertime;
    weeklyData[ref].overtime += result.overtime;
  });

  const visibleRows = Object.entries(weeklyData).filter(([_, week]) => {
    const totalHours = dayHeaders.reduce((s, { dateStr }) => s + (week[dateStr] ?? 0), 0);
    return totalHours > 0 || week.late + week.undertime + week.overtime > 0;
  });

  function getComputationDetails(ref: string) {
    const week = weeklyData[ref];
    if (!week) return null;
    const u = usersMap[ref];
    const name = u ? `${u.Firstname} ${u.Lastname}` : ref;
    return { name, week, dayHeaders };
  }

  async function exportToExcel() {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Timesheet");
    sheet.addRow(["Name", ...dayHeaders.map((d) => d.label), "Total Hours", "Total Late", "Total Undertime", "Total Overtime"]);
    visibleRows.forEach(([ref, week]) => {
      const u = usersMap[ref];
      const name = u ? `${u.Firstname} ${u.Lastname}` : ref;
      const total = dayHeaders.reduce((s, { dateStr }) => s + (week[dateStr] ?? 0), 0);
      sheet.addRow([name, ...dayHeaders.map(({ dateStr }) => week[dateStr] ? week[dateStr].toFixed(2) : "-"), total.toFixed(2), week.late.toFixed(2), week.undertime.toFixed(2), week.overtime.toFixed(2)]);
    });
    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "timesheet.xlsx");
  }

  const summaryStats = visibleRows.reduce((acc, [_, week]) => {
    acc.totalHours += dayHeaders.reduce((s, { dateStr }) => s + (week[dateStr] ?? 0), 0);
    acc.totalLate += week.late;
    acc.totalUndertime += week.undertime;
    acc.totalOvertime += week.overtime;
    return acc;
  }, { totalHours: 0, totalLate: 0, totalUndertime: 0, totalOvertime: 0 });

  const details = selectedRef ? getComputationDetails(selectedRef) : null;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen clay-bg">

      {/* ── Header ── */}
      <header className="sticky top-0 z-30 clay-nav flex items-center justify-between px-4 h-14 gap-3">
        <div className="flex items-center gap-3">

          {/* Back button */}
          <button
            onClick={handleBack}
            className="clay-card w-8 h-8 rounded-xl flex items-center justify-center text-gray-500 transition-all active:scale-95"
            title="Back to Activity Planner"
          >
            <ArrowLeft size={14} />
          </button>

          <div className="h-4 w-px bg-gray-200" />

          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold text-brand-primary uppercase tracking-wider">Timesheet</p>
              {!isOnline && (
                <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 rounded-full px-2 py-0.5 flex items-center gap-1">
                  <WifiOff size={10} />
                  Offline
                </span>
              )}
            </div>
            <p className="text-[11px] text-gray-400">
              {dateCreatedFilterRange?.from
                ? `${formatShortDate(new Date(dateCreatedFilterRange.from))}${dateCreatedFilterRange.to ? ` – ${formatShortDate(new Date(dateCreatedFilterRange.to))}` : ""}`
                : "Current Week"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Date Range Picker */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant={"outline"}
                className={cn(
                  "h-9 px-3 rounded-2xl text-[12px] font-semibold border-gray-200 hover:bg-gray-50",
                  !dateCreatedFilterRange && "text-muted-foreground"
                )}
              >
                <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                {dateCreatedFilterRange?.from ? (
                  dateCreatedFilterRange.to ? (
                    <>
                      {format(dateCreatedFilterRange.from, "LLL dd")} -{" "}
                      {format(dateCreatedFilterRange.to, "LLL dd")}
                    </>
                  ) : (
                    format(dateCreatedFilterRange.from, "LLL dd")
                  )
                ) : (
                  <span>Select Date Range</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 rounded-2xl overflow-hidden" align="end">
              <Calendar
                initialFocus
                mode="range"
                defaultMonth={dateCreatedFilterRange?.from}
                selected={dateCreatedFilterRange}
                onSelect={setDateCreatedFilterRange}
                numberOfMonths={1}
                className="bg-white"
              />
            </PopoverContent>
          </Popover>

          <button
            onClick={exportToExcel}
            className="clay-btn flex items-center gap-2 bg-[var(--brand-primary)] text-white h-9 px-4 rounded-2xl text-[12px] font-semibold transition-all active:scale-[0.97]"
          >
            <DownloadCloud size={14} />
            <span className="hidden sm:inline">Export</span>
          </button>
        </div>
      </header>

      <main className="p-4">

        {/* ── Summary Cards ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {[
            { label: "Total Hours", value: summaryStats.totalHours.toFixed(1), icon: <Clock size={15} />, color: "#185FA5", bg: "#E6F1FB" },
            { label: "Total Late", value: summaryStats.totalLate.toFixed(1) + "h", icon: <AlertCircle size={15} />, color: "var(--brand-primary)", bg: "var(--brand-light)" },
            { label: "Undertime", value: summaryStats.totalUndertime.toFixed(1) + "h", icon: <ArrowDownLeft size={15} />, color: "#A0611A", bg: "#FDF4E7" },
            { label: "Overtime", value: summaryStats.totalOvertime.toFixed(1) + "h", icon: <ArrowUpRight size={15} />, color: "#1A7A4A", bg: "#EEF7F2" },
          ].map((s) => (
            <div key={s.label} className="clay-card p-4">
              <div className="clay-icon w-7 h-7 rounded-[9px] flex items-center justify-center mb-2.5 flex-shrink-0" style={{ background: s.bg, color: s.color }}>
                {s.icon}
              </div>
              <p className="text-[20px] font-semibold text-gray-900 leading-tight">{s.value}</p>
              <p className="text-[11px] text-gray-400 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* ── Search ── */}
        <div className="mb-4 relative max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
          <input
            type="text"
            placeholder="Search by name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full clay-card pl-9 pr-4 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/10 transition-all"
          />
          {loading && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-gray-200 border-t-brand-primary rounded-full animate-spin" />
          )}
        </div>

        {/* ── Mobile Card List (Visible on Mobile only) ── */}
        <div className="sm:hidden">
          {visibleRows.length === 0 ? (
            <div className="clay-card px-4 py-12 text-center">
              <div className="w-10 h-10 rounded-2xl bg-gray-50 flex items-center justify-center mx-auto mb-3">
                <Clock size={18} className="text-gray-300" />
              </div>
              <p className="text-[12px] text-gray-400">No records found.</p>
            </div>
          ) : (
            visibleRows.map(([ref, week]) => {
              const u = usersMap[ref];
              const name = u ? `${u.Firstname} ${u.Lastname}` : ref;
              return (
                <MobileTimesheetCard
                  key={ref}
                  refId={ref}
                  name={name}
                  week={week}
                  dayHeaders={dayHeaders}
                  profilePicture={u?.profilePicture}
                  onInfoClick={() => setSelectedRef(ref)}
                />
              );
            })
          )}
        </div>

        {/* ── Table (Hidden on Mobile) ── */}
        <div className="hidden sm:block clay-card overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div>
              <p className="text-[13px] font-semibold text-gray-800">Timesheet Summary</p>
              <p className="text-[11px] text-gray-400 mt-0.5">
                {visibleRows.length} employee{visibleRows.length !== 1 ? "s" : ""} · {dayHeaders.length} day{dayHeaders.length !== 1 ? "s" : ""}
              </p>
            </div>
            <span className="text-[11px] font-semibold text-brand-primary bg-brand-light rounded-full px-3 py-1">
              {dateCreatedFilterRange ? "Filtered" : "Current Week"}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-[12px]">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left px-5 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap sticky left-0 bg-white z-10 min-w-[160px]">
                    Employee
                  </th>
                  {dayHeaders.map(({ label, dateStr }) => (
                    <th key={dateStr} className="text-center px-3 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap min-w-[80px]">
                      {label}
                    </th>
                  ))}
                  <th className="text-right px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">Total Hrs</th>
                  <th className="text-right px-4 py-3 text-[10px] font-semibold text-brand-primary uppercase tracking-wider whitespace-nowrap">Late</th>
                  <th className="text-right px-4 py-3 text-[10px] font-semibold text-[#A0611A] uppercase tracking-wider whitespace-nowrap">Undertime</th>
                  <th className="text-right px-4 py-3 text-[10px] font-semibold text-[#1A7A4A] uppercase tracking-wider whitespace-nowrap">Overtime</th>
                </tr>
              </thead>

              <tbody>
                {visibleRows.length === 0 && (
                  <tr>
                    <td colSpan={7 + dayHeaders.length} className="text-center py-16 text-[12px] text-gray-400">
                      <div className="flex flex-col items-center gap-2">
                        <div className="w-10 h-10 rounded-2xl bg-gray-100 flex items-center justify-center">
                          <Clock size={18} className="text-gray-300" />
                        </div>
                        No timesheet records found.
                      </div>
                    </td>
                  </tr>
                )}

                {visibleRows.map(([ref, week], idx) => {
                  const u = usersMap[ref];
                  const name = u ? `${u.Firstname} ${u.Lastname}` : ref;
                  const total = dayHeaders.reduce((s, { dateStr }) => s + (week[dateStr] ?? 0), 0);
                  const initials = u ? `${u.Firstname[0]}${u.Lastname[0]}`.toUpperCase() : "?";

                  return (
                    <tr key={ref} className={`border-b border-gray-50 hover:bg-gray-50/60 transition-colors ${idx % 2 === 0 ? "" : "bg-gray-50/30"}`}>
                      {/* Name cell */}
                      <td className="px-5 py-3 whitespace-nowrap sticky left-0 bg-inherit z-10">
                        <div className="flex items-center gap-2.5">
                          {u?.profilePicture ? (
                            <img src={u.profilePicture} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-brand-light flex items-center justify-center text-[10px] font-bold text-brand-primary flex-shrink-0">
                              {initials}
                            </div>
                          )}
                          <span className="font-semibold text-gray-800 capitalize truncate max-w-[120px]">{name}</span>
                          <button
                            onClick={() => setSelectedRef(ref)}
                            className="flex-shrink-0 w-5 h-5 rounded-lg bg-gray-100 flex items-center justify-center text-gray-400 hover:bg-brand-light hover:text-brand-primary transition-colors"
                            title="View breakdown"
                          >
                            <Info size={11} />
                          </button>
                        </div>
                      </td>

                      {/* Daily hours */}
                      {dayHeaders.map(({ dateStr }) => {
                        const hrs = week[dateStr];
                        return (
                          <td key={dateStr} className="text-center px-3 py-3 font-mono whitespace-nowrap">
                            {hrs > 0 ? (
                              <span className="inline-flex items-center justify-center w-12 h-6 rounded-lg bg-[#E6F1FB] text-[#185FA5] text-[11px] font-semibold">
                                {hrs.toFixed(1)}
                              </span>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                        );
                      })}

                      {/* Total */}
                      <td className="text-right px-4 py-3 whitespace-nowrap">
                        <span className="font-bold text-gray-900 font-mono">{total.toFixed(2)}</span>
                      </td>

                      {/* Late */}
                      <td className="text-right px-4 py-3 whitespace-nowrap">
                        {week.late > 0 ? (
                          <span className="inline-flex items-center justify-center rounded-xl bg-brand-light text-brand-primary px-2.5 py-0.5 text-[11px] font-semibold">
                            {week.late.toFixed(2)}h
                          </span>
                        ) : <span className="text-gray-300">—</span>}
                      </td>

                      {/* Undertime */}
                      <td className="text-right px-4 py-3 whitespace-nowrap">
                        {week.undertime > 0 ? (
                          <span className="inline-flex items-center justify-center rounded-xl bg-[#FDF4E7] text-[#A0611A] px-2.5 py-0.5 text-[11px] font-semibold">
                            {week.undertime.toFixed(2)}h
                          </span>
                        ) : <span className="text-gray-300">—</span>}
                      </td>

                      {/* Overtime */}
                      <td className="text-right px-4 py-3 whitespace-nowrap">
                        {week.overtime > 0 ? (
                          <span className="inline-flex items-center justify-center rounded-xl bg-[#EEF7F2] text-[#1A7A4A] px-2.5 py-0.5 text-[11px] font-semibold">
                            {week.overtime.toFixed(2)}h
                          </span>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* ── Computation Details Dialog ── */}
      {selectedRef && details && (
        <Dialog open onOpenChange={() => setSelectedRef(null)}>
          <DialogContent className="p-0 rounded-[28px] max-w-sm w-full border-0 shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="clay-card-brand rounded-none px-6 pt-5 pb-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-white font-bold text-[14px]">
                  {details.name.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2)}
                </div>
                <div>
                  <DialogTitle className="text-white font-semibold text-[15px] leading-tight">{details.name}</DialogTitle>
                  <p className="text-white/65 text-[11px] mt-0.5">Computation Breakdown</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "Late", value: details.week.late.toFixed(2) + "h", color: "text-red-200" },
                  { label: "Undertime", value: details.week.undertime.toFixed(2) + "h", color: "text-amber-200" },
                  { label: "Overtime", value: details.week.overtime.toFixed(2) + "h", color: "text-green-200" },
                ].map((s) => (
                  <div key={s.label} className="bg-white/15 rounded-2xl px-3 py-2.5 text-center">
                    <p className={`text-[14px] font-bold ${s.color}`}>{s.value}</p>
                    <p className="text-white/60 text-[10px] mt-0.5">{s.label}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Daily breakdown */}
            <div className="clay-bg px-5 py-4 max-h-80 overflow-y-auto">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-3">Daily Hours</p>
              <div className="flex flex-col gap-2">
                {details.dayHeaders.map(({ dateStr, label }: DailyLog) => {
                  const hrs = details.week[dateStr] ?? 0;
                  return (
                    <div key={dateStr} className="clay-card flex items-center justify-between px-4 py-3">
                      <span className="text-[12px] text-gray-600 font-medium">{label}</span>
                      {hrs > 0 ? (
                        <span className="inline-flex items-center justify-center rounded-xl bg-[#E6F1FB] text-[#185FA5] px-3 py-1 text-[12px] font-bold">
                          {hrs.toFixed(2)}h
                        </span>
                      ) : (
                        <span className="text-[12px] text-gray-300 font-medium">No data</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Close */}
            <div className="bg-white px-5 py-4 border-t border-gray-100">
              <button
                onClick={() => setSelectedRef(null)}
                className="clay-btn w-full rounded-2xl py-3 bg-[var(--brand-primary)] text-white font-semibold text-[14px] transition-colors active:scale-[0.98]"
              >
                Close
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ── Root Export ───────────────────────────────────────────────────────────────

export default function Page() {
  return (
    <ProtectedPageWrapper>
      <UserProvider>
        <FormatProvider>
          <TimesheetPage />
        </FormatProvider>
      </UserProvider>
    </ProtectedPageWrapper>
  );
}