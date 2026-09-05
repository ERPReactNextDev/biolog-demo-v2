"use client";

import dynamic from "next/dynamic";
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import Camera from "./camera";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { MapPin, ArrowLeft, CheckCircle2, LogIn, LogOut, FileText, UserPlus, Users, AlertCircle, FileText as FileTextIcon } from "lucide-react";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import Select from "react-select";

const ManualLocationPicker = dynamic(() => import("./manual-location-picker"), { ssr: false });
import { enqueuePendingLog } from "@/lib/offline-store";
import { uploadToCloudinary } from "@/lib/cloudinary";
import { compressImage } from "@/lib/image-compress";
import { fetchGeofenceConfig, isWithinGeofence } from "@/lib/geofence";
/* ── Types ─────────────────────────────────────────────────────────────────── */

interface FormData {
  ReferenceID: string;
  TSM: string;
  Email: string;
  Type: string;
  Status: string;
  PhotoURL: string;
  Remarks: string;
  SiteVisitAccount?: string;
  manager?: string; // Add manager field
  // New Client Fields
  company_name?: string;
  contact_person?: string;
  contact_number?: string;
  email_address?: string;
  address?: string;
}

interface UserDetails {
  ReferenceID: string;
  TSM: string;
  Manager?: string; // Add Manager to UserDetails
  Email: string;
  Role: string;
  faceDescriptors?: number[][];
  faceVerificationEnabled?: boolean;
}

interface CreateAttendanceProps {
  open: boolean;
  onOpenChangeAction: (open: boolean) => void;
  formData: FormData;
  onChangeAction: (field: keyof FormData, value: any) => void;
  userDetails: UserDetails;
  fetchAccountAction: () => void;
  setFormAction: React.Dispatch<React.SetStateAction<FormData>>;
}

/* ── Component ─────────────────────────────────────────────────────────────── */

export default function CreateSalesAttendance({
  open,
  onOpenChangeAction,
  formData,
  onChangeAction,
  userDetails,
  fetchAccountAction,
  setFormAction,
}: CreateAttendanceProps) {
  const [locationAddress, setLocationAddress] = useState("Fetching location...");
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [manualLat, setManualLat] = useState<number | null>(null);
  const [manualLng, setManualLng] = useState<number | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [faceData, setFaceData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [showMap, setShowMap] = useState(false);

  const [siteVisitAccounts, setSiteVisitAccounts] = useState<{ company_name: string }[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [siteVisitAccountsCount, setSiteVisitAccountsCount] = useState(0);

  const [lastStatus, setLastStatus] = useState<string | null>(null);
  const [loginCountToday, setLoginCountToday] = useState<number>(0);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [clientType, setClientType] = useState<"New Client" | "Existing Client" | "">("");

  const [selectMenuOpen, setSelectMenuOpen] = useState(false);

  /* ── Reset on open ── */
  useEffect(() => {
    if (!open) return;
    setManualLat(null);
    setManualLng(null);
    setCapturedImage(null);
    setClientType("");
    setShowMap(false);
  }, [open]);

  /* ── Geolocation ── */
  const getLocation = () => {
    setLocationAddress("Fetching location...");

    const options = {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0
    };

    const success = (position: GeolocationPosition) => {
      const { latitude: lat, longitude: lng } = position.coords;
      setLatitude(lat);
      setLongitude(lng);
      const coordString = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

      fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`)
        .then((r) => r.json())
        .then((d) => {
          const addr = d.display_name || coordString;
          setLocationAddress(addr);
          // Auto-populate address field for New Client
          if (clientType === "New Client") {
            onChangeAction("address", addr);
          }
        })
        .catch(() => {
          setLocationAddress(coordString);
          if (clientType === "New Client") {
            onChangeAction("address", coordString);
          }
        });
    };

    const error = (err: GeolocationPositionError) => {
      // Retry with lower accuracy if high accuracy fails
      if (err.code === err.TIMEOUT || err.code === err.POSITION_UNAVAILABLE) {
        navigator.geolocation.getCurrentPosition(success,
          () => setLocationAddress("Location unavailable. Please check GPS."),
          { ...options, enableHighAccuracy: false, timeout: 10000 }
        );
      } else {
        setLocationAddress("Location permission denied or unavailable.");
      }
    };

    if (!navigator.geolocation) {
      setLocationAddress("Geolocation not supported by browser.");
      return;
    }

    navigator.geolocation.getCurrentPosition(success, error, options);
  };

  useEffect(() => {
    if (!open) return;
    getLocation();
  }, [open]);

  /* ── Helper functions for last status cache ── */
  const getLastStatusCacheKey = () => {
    // Create key with today's date in YYYY-MM-DD format
    const today = new Date().toISOString().split('T')[0];
    return `last-status-${userDetails.ReferenceID}-${today}`;
  };

  const saveLastStatusToCache = (status: string | null) => {
    try {
      const cacheData = {
        status,
        timestamp: Date.now()
      };
      localStorage.setItem(getLastStatusCacheKey(), JSON.stringify(cacheData));
    } catch (e) {
      console.error("Failed to save last status to cache", e);
    }
  };

  const loadLastStatusFromCache = () => {
    try {
      const cached = localStorage.getItem(getLastStatusCacheKey());
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (e) {
      console.error("Failed to load last status from cache", e);
    }
    return null;
  };

  const clearOldLastStatusCaches = () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const prefix = `last-status-${userDetails.ReferenceID}-`;
      
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && key.startsWith(prefix) && key !== getLastStatusCacheKey()) {
          localStorage.removeItem(key);
        }
      }
    } catch (e) {
      console.error("Failed to clear old last status caches", e);
    }
  };

  // Clear old caches when dialog opens
  useEffect(() => {
    if (open && userDetails.ReferenceID) {
      clearOldLastStatusCaches();
    }
  }, [open, userDetails.ReferenceID]);

  /* ── Login Summary — fetch ONCE when dialog opens ── */
  /* ── Login Summary — fetch ONCE when dialog opens ── */
  useEffect(() => {
    if (!open || !userDetails.ReferenceID) {
      setLoadingStatus(true);
      return;
    }

    setLoadingStatus(true);
    
    // First try to load from cache for immediate display
    const cachedStatus = loadLastStatusFromCache();
    if (cachedStatus) {
      setLastStatus(cachedStatus.status);
      const nextAction = cachedStatus.status === "Login" ? "Logout" : "Login";
      onChangeAction("Status", nextAction);
    }

    fetch(`/api/ModuleSales/Activity/LastStatus?referenceId=${userDetails.ReferenceID}&type=Client Visit`, {
      credentials: "include"
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch status");
        return res.json();
      })
      .then((data) => {
        // API returns { lastStatus, lastTime }
        const status = data.lastStatus ?? null;
        setLastStatus(status);

        const nextAction = status === "Login" ? "Logout" : "Login";
        onChangeAction("Status", nextAction);
        
        // Save to cache
        saveLastStatusToCache(status);
      })
      .catch(() => {
        // If fetch fails, use cached status if available
        if (!cachedStatus) {
          setLastStatus(null);
          onChangeAction("Status", "Login");
          setLoginCountToday(0);
          saveLastStatusToCache(null);
        }
      })
      .finally(() => setLoadingStatus(false));

    // ⚠️ onChangeAction intentionally excluded — it's a prop function that
    // changes reference every render and would cause an infinite fetch loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, userDetails.ReferenceID]);

  // Helper function to get storage key
  const getStorageKey = () => {
    return `client-list-${userDetails.ReferenceID}-${userDetails.Role}`;
  };

  // Function to save accounts to localStorage
  const saveAccountsToLocalStorage = (data: any[], count: number) => {
    try {
      const storageData = {
        data,
        count,
        timestamp: Date.now()
      };
      localStorage.setItem(getStorageKey(), JSON.stringify(storageData));
    } catch (e) {
      console.error("Failed to save accounts to localStorage:", e);
    }
  };

  // Function to load accounts from localStorage
  const loadAccountsFromLocalStorage = () => {
    try {
      const stored = localStorage.getItem(getStorageKey());
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      console.error("Failed to load accounts from localStorage:", e);
    }
    return null;
  };

  /* ── Fetch accounts when Existing Client selected ── */
  useEffect(() => {
    if (!open || clientType !== "Existing Client") {
      setSiteVisitAccounts([]);
      setSiteVisitAccountsCount(0);
      setAccountsError(null);
      setLoadingAccounts(false);
      return;
    }
    if (!userDetails.ReferenceID) {
      setAccountsError("Missing ReferenceID");
      setLoadingAccounts(false);
      return;
    }
    setLoadingAccounts(true);
    setAccountsError(null);

    // First, try to load from localStorage for immediate display
    const cachedData = loadAccountsFromLocalStorage();
    if (cachedData) {
      setSiteVisitAccounts(cachedData.data || []);
      setSiteVisitAccountsCount(cachedData.count || 0);
    }

    const fetchAccounts = (url: string) => {
      fetch(url)
        .then((r) => r.json())
        .then((json) => {
          if (json.success) {
            const data = json.data || [];
            const count = json.count || data.length || 0;
            setSiteVisitAccounts(data);
            setSiteVisitAccountsCount(count);
            setAccountsError(null);
            // Save fresh data to localStorage
            saveAccountsToLocalStorage(data, count);
          } else {
            // If fetch fails but we have cached data, keep it
            if (!cachedData) {
              setSiteVisitAccounts([]);
              setSiteVisitAccountsCount(0);
            }
            setAccountsError(json.error || "No accounts found");
          }
        })
        .catch(() => {
          // If fetch fails but we have cached data, that's okay!
          if (!cachedData) {
            setSiteVisitAccounts([]);
            setSiteVisitAccountsCount(0);
            setAccountsError("Error fetching accounts");
          } else {
            setAccountsError(null); // No error if we have cached data
          }
        })
        .finally(() => setLoadingAccounts(false));
    };

    if (userDetails.Role === "Territory Sales Manager") {
      fetchAccounts(`/api/fetch-tsm?referenceid=${encodeURIComponent(userDetails.ReferenceID)}`);
    } else if (userDetails.Role === "Manager") {
      fetchAccounts(`/api/fetch-manager?referenceid=${encodeURIComponent(userDetails.ReferenceID)}`);
    } else {
      fetchAccounts(`/api/fetch-account?referenceid=${encodeURIComponent(userDetails.ReferenceID)}`);
    }
  }, [open, clientType, userDetails.Role, userDetails.ReferenceID]);

  /* ── Submit ── */
  const handleCreate = async () => {
    if (!capturedImage) return toast.error("Please capture a photo first.");
    if (formData.Status === "Logout" && !clientType) return toast.error("Please select client type.");
    if (formData.Status === "Logout" && clientType === "Existing Client" && !formData.SiteVisitAccount) {
      return toast.error("Please select a company.");
    }


    // Save the new status to cache immediately for offline use
    const newStatus = formData.Status;
    saveLastStatusToCache(newStatus);
    setLastStatus(newStatus);
    
    // Update the next status
    const nextAction = newStatus === "Login" ? "Logout" : "Login";
    onChangeAction("Status", nextAction);

    setLoading(true);

    // ── Geofence check ────────────────────────────────────────────────────
    if ((manualLat ?? latitude) !== null && (manualLng ?? longitude) !== null) {
      try {
        const geofence = await fetchGeofenceConfig();
        const within = isWithinGeofence(manualLat ?? latitude!, manualLng ?? longitude!, geofence);
        if (within === false) {
          toast.error("⚠️ You are outside the allowed area. Please move closer to the office.", { duration: 6000 });
          setLoading(false);
          return;
        }
      } catch { /* non-critical */ }
    }

    // ── Compress photo ────────────────────────────────────────────────────
    let photo = capturedImage!;
    try { photo = await compressImage(capturedImage!); } catch { /* use original */ }

    const basePayload = {
      ...formData,
      Type: "Client Visit",
      Location:  locationAddress,
      Latitude:  manualLat ?? latitude,
      Longitude: manualLng ?? longitude,
      FaceData:  faceData,
      manager:   userDetails.Manager, // Pass manager from userDetails
      type_client: clientType,
    };

    const resetForm = () => {
      fetchAccountAction();
      setFormAction({
        ReferenceID: userDetails.ReferenceID,
        Email: userDetails.Email,
        TSM: userDetails.TSM,
        Type: "Client Visit",
        Status: "",
        PhotoURL: "",
        Remarks: "",
        SiteVisitAccount: "",
        company_name: "",
        contact_person: "",
        contact_number: "",
        email_address: "",
        address: "",
      });
      setCapturedImage(null);
      onOpenChangeAction(false);
    };

    try {
      if (!navigator.onLine) {
        // ── Offline: queue with base64 photo ──────────────────────────────
        await enqueuePendingLog({ ...basePayload, PhotoURL: photo });
        toast.success("Saved offline — will sync when you're back online.", {
          duration: 4000,
        });
        // Dispatch custom event to trigger pending count refresh
        window.dispatchEvent(new CustomEvent("acculog:sync"));
        resetForm();
        return;
      }

      // ── Online: upload photo first ─────────────────────────────────────
      let photoURL: string;
      try {
        photoURL = await uploadToCloudinary(photo);
      } catch {
        // Upload failed — queue with base64 for later
        await enqueuePendingLog({ ...basePayload, PhotoURL: photo });
        toast.success("Photo upload failed — saved offline. Will sync when connection improves.", {
          duration: 4000,
        });
        // Dispatch custom event to trigger pending count refresh
        window.dispatchEvent(new CustomEvent("acculog:sync"));
        resetForm();
        return;
      }

      try {
        const res = await fetch("/api/ModuleSales/Activity/AddLog", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body:    JSON.stringify({ ...basePayload, PhotoURL: photoURL }),
        });
        if (!res.ok) throw new Error("Failed to save attendance");
        toast.success("Attendance created!");
        if ("vibrate" in navigator) navigator.vibrate([50, 30, 50]);
        resetForm();
      } catch {
        // API failed after upload — queue with Cloudinary URL (no re-upload)
        await enqueuePendingLog({ ...basePayload, PhotoURL: photoURL });
        toast.success("Saved offline — will sync when connection returns.", {
          duration: 4000,
        });
        // Dispatch custom event to trigger pending count refresh
        window.dispatchEvent(new CustomEvent("acculog:sync"));
        resetForm();
      }
    } catch (err: any) {
      toast.error(err?.message || "Error saving attendance.");
    } finally {
      setLoading(false);
    }
  };

  // Determine UI state
  const isLogout = lastStatus === "Login";
  const nextAction = formData.Status; // Use the Status from formData which we set in useEffect
  const isSubmitDisabled =
    loading ||
    !capturedImage ||
    loadingStatus ||
    (formData.Status === "Logout" && !clientType) ||
    (formData.Status === "Logout" && clientType === "Existing Client" && !formData.SiteVisitAccount) ||
    (formData.Status === "Logout" && clientType === "New Client" && !formData.company_name);

  /* ── Render ── */
  return (
    <Dialog open={open} onOpenChange={onOpenChangeAction}>
      <DialogContent
        className="p-0 rounded-[28px] max-w-sm w-full mx-auto border-0 shadow-[0_8px_40px_rgba(0,0,0,0.18)] max-h-[92vh] flex flex-col"
      >
        <VisuallyHidden>
          <DialogTitle>Site Visit Log</DialogTitle>
        </VisuallyHidden>
        {/* ── Header ── */}
        <div className="clay-card-brand rounded-none px-6 pt-5 pb-5 flex-shrink-0">
          <div className="flex items-center gap-3 mb-5">
            <button
              onClick={() => onOpenChangeAction(false)}
              className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white hover:bg-white/30 transition-colors"
            >
              <ArrowLeft size={15} />
            </button>
            <div className="flex-1">
              <h2 className="text-white font-semibold text-base leading-tight">Site Visit Log</h2>
              <p className="text-white/65 text-[11px] mt-0.5">Client attendance entry</p>
            </div>
            <div className="text-right">
              <p className="text-white/65 text-[11px]">
                {new Date().toLocaleDateString("en-PH", { month: "short", day: "numeric" })}
              </p>
              <p className="text-white font-semibold text-[13px]">
                {new Date().toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
          </div>

          {/* Status summary pill */}
          <div className="flex items-center gap-3">
            <div className="flex-1 bg-white/15 rounded-2xl px-4 py-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {loadingStatus ? (
                  <div className="w-2 h-2 rounded-full bg-yellow-300 animate-pulse" />
                ) : (
                  <div
                    className={`w-2 h-2 rounded-full ${isLogout ? "bg-red-300" : "bg-green-300"
                      } animate-pulse`}
                  />
                )}
                <span className="text-white/75 text-[11px] font-medium">Next action</span>
              </div>
              <span
                className={`text-[12px] font-bold ${loadingStatus
                  ? "text-yellow-200"
                  : isLogout
                    ? "text-red-200"
                    : "text-green-200"
                  }`}
              >
                {loadingStatus ? "Loading..." : nextAction || "—"}
              </span>
            </div>
            <div className="bg-white/15 rounded-2xl px-4 py-2.5 text-center">
              <p className="text-white/65 text-[10px]">Today</p>
              <p className="text-white font-bold text-[15px]">{loginCountToday}</p>
            </div>
          </div>
        </div>

        {/* ── Body ── */}
        <div className={`flex-1 bg-brand-bg overflow-y-auto ${selectMenuOpen ? 'overflow-visible' : ''}`}>
          <div className="flex flex-col gap-4 p-5">

            {/* Camera */}
            <div>
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2">
                📷 Photo Verification
              </p>
              <Camera
                registeredDescriptors={userDetails.faceDescriptors}
                skipFaceVerification={userDetails.faceVerificationEnabled === false}
                onCaptureAction={(img, face) => {
                  setCapturedImage(img);
                  setFaceData(face);
                }}
              />
              {capturedImage && (
                <div className="mt-2 flex items-center gap-2 bg-[#EEF7F2] rounded-xl px-3 py-2">
                  <CheckCircle2 size={14} className="text-[#1A7A4A]" />
                  <span className="text-[12px] font-semibold text-[#1A7A4A]">
                    Photo captured successfully
                  </span>
                </div>
              )}
            </div>

            {/* Post-capture form */}
            {capturedImage && !loadingStatus && (
              <>
                {/* Client Type toggle — only shown on Logout */}
                {formData.Status === "Logout" && <div>
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2">
                    Client Type
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    {(["New Client", "Existing Client"] as const).map((t) => {
                      const isSelected = clientType === t;
                      const isNew = t === "New Client";
                      return (
                        <button
                          key={t}
                          onClick={() => {
                            setClientType(t);
                            if (t === "New Client") {
                              onChangeAction("SiteVisitAccount", "");
                              onChangeAction("address", locationAddress);
                            } else {
                              // Reset status to the one calculated for Login/Logout
                              const next = lastStatus === "Login" ? "Logout" : "Login";
                              onChangeAction("Status", next);
                            }
                          }}
                          className={[
                            "clay-card p-4 flex flex-col items-center gap-2 transition-all active:scale-95",
                            isSelected
                              ? isNew
                                ? "bg-[#E6F1FB] border-[#185FA5]"
                                : "bg-[#EEF7F2] border-[#1A7A4A]"
                              : "bg-white border-gray-200 hover:border-gray-300",
                          ].join(" ")}
                        >
                          {isNew ? (
                            <UserPlus
                              size={20}
                              className={isSelected ? "text-[#185FA5]" : "text-gray-400"}
                            />
                          ) : (
                            <Users
                              size={20}
                              className={isSelected ? "text-[#1A7A4A]" : "text-gray-400"}
                            />
                          )}
                          <span
                            className={[
                              "text-[13px] font-semibold",
                              isSelected
                                ? isNew
                                  ? "text-[#185FA5]"
                                  : "text-[#1A7A4A]"
                                : "text-gray-700",
                            ].join(" ")}
                          >
                            {t}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>}

                {/* New Client Fields */}
                {formData.Status === "Logout" && clientType === "New Client" && (
                  <div className="flex flex-col gap-3">
                    <div>
                      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-1.5">
                        Company Name
                      </p>
                      <input
                        type="text"
                        value={formData.company_name || ""}
                        onChange={(e) => onChangeAction("company_name", e.target.value)}
                        placeholder="Enter company name..."
                        className="w-full clay-card px-4 py-3 text-[13px] text-gray-800 outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/10 transition-all"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-1.5">
                          Contact Person
                        </p>
                        <input
                          type="text"
                          value={formData.contact_person || ""}
                          onChange={(e) => onChangeAction("contact_person", e.target.value)}
                          placeholder="Name..."
                          className="w-full clay-card px-4 py-3 text-[13px] text-gray-800 outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/10 transition-all"
                        />
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-1.5">
                          Contact Number
                        </p>
                        <input
                          type="text"
                          value={formData.contact_number || ""}
                          onChange={(e) => onChangeAction("contact_number", e.target.value)}
                          placeholder="Phone..."
                          className="w-full clay-card px-4 py-3 text-[13px] text-gray-800 outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/10 transition-all"
                        />
                      </div>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-1.5">
                        Email Address
                      </p>
                      <input
                        type="email"
                        value={formData.email_address || ""}
                        onChange={(e) => onChangeAction("email_address", e.target.value)}
                        placeholder="client@email.com..."
                        className="w-full clay-card px-4 py-3 text-[13px] text-gray-800 outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/10 transition-all"
                      />
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-1.5">
                        Address
                      </p>
                      <textarea
                        value={formData.address || ""}
                        onChange={(e) => onChangeAction("address", e.target.value)}
                        placeholder="Company address..."
                        rows={2}
                        className="w-full clay-card px-4 py-3 text-[13px] text-gray-800 outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/10 transition-all resize-none"
                      />
                    </div>
                  </div>
                )}

                {/* Existing Client — account selector */}
                {formData.Status === "Logout" && clientType === "Existing Client" && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">
                          Site Visit Account
                        </p>
                        {!navigator.onLine && siteVisitAccounts.length > 0 && (
                          <span className="text-[10px] font-medium text-amber-600 bg-amber-50 rounded-full px-2 py-0.5 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                            Offline
                          </span>
                        )}
                      </div>
                      {siteVisitAccountsCount > 0 && (
                        <span className="text-[11px] font-semibold text-[#1A7A4A] bg-[#EEF7F2] rounded-xl px-2.5 py-0.5">
                          {siteVisitAccountsCount} accounts
                        </span>
                      )}
                    </div>

                    {loadingAccounts ? (
                      <div className="bg-white rounded-2xl border border-gray-200 px-4 py-4 flex items-center gap-3">
                        <div className="w-4 h-4 border-2 border-gray-200 border-t-brand-primary rounded-full animate-spin" />
                        <span className="text-[13px] text-gray-400">Loading accounts...</span>
                      </div>
                    ) : accountsError ? (
                      <div className="bg-brand-light border border-red-200 rounded-2xl px-4 py-3 flex items-center gap-2">
                        <AlertCircle size={14} className="text-brand-primary flex-shrink-0" />
                        <span className="text-[12px] text-brand-primary">{accountsError}</span>
                      </div>
                    ) : (
                      <div className="clay-card relative">
                        <Select
                          options={siteVisitAccounts.map((a) => ({
                            value: a.company_name,
                            label: a.company_name,
                          }))}
                          value={
                            formData.SiteVisitAccount
                              ? {
                                value: formData.SiteVisitAccount,
                                label: formData.SiteVisitAccount,
                              }
                              : null
                          }
                          onChange={(s) => onChangeAction("SiteVisitAccount", s?.value || "")}
                          placeholder="Search company..."
                          classNamePrefix="mb-select"
                          onMenuOpen={() => setSelectMenuOpen(true)}
                          onMenuClose={() => setSelectMenuOpen(false)}
                          styles={{
                            control: (base) => ({
                              ...base,
                              border: "none",
                              boxShadow: "none",
                              borderRadius: "16px",
                              padding: "4px 6px",
                              fontSize: "13px",
                              backgroundColor: "transparent",
                              cursor: "pointer",
                            }),
                            menu: (base) => ({
                              ...base,
                              borderRadius: "16px",
                              overflow: "hidden",
                              boxShadow: "0 8px 32px rgba(26,10,11,0.12)",
                              border: "1px solid #EDE5E1",
                              fontSize: "13px",
                              zIndex: 100,
                            }),
                            menuList: (base) => ({
                              ...base,
                              maxHeight: "200px",
                            }),
                            option: (base, state) => ({
                              ...base,
                              backgroundColor: state.isSelected
                                ? "var(--brand-primary)"
                                : state.isFocused
                                  ? "var(--brand-light)"
                                  : "white",
                              color: state.isSelected ? "white" : "#1A0A0B",
                              padding: "10px 16px",
                              cursor: "pointer",
                            }),
                            placeholder: (base) => ({
                              ...base,
                              color: "#A89898",
                              fontSize: "13px",
                            }),
                            singleValue: (base) => ({
                              ...base,
                              color: "#1A0A0B",
                              fontWeight: 600,
                            }),
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Remarks */}
                <div>
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                    <FileText size={11} /> Remarks
                  </p>
                  <textarea
                    value={formData.Remarks}
                    onChange={(e) => onChangeAction("Remarks", e.target.value)}
                    placeholder="Add notes or feedback (optional)..."
                    rows={3}
                    className="w-full clay-card px-4 py-3 text-[13px] text-gray-800 placeholder:text-gray-300 resize-none outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/10 transition-all"
                  />
                </div>

                {/* Location */}
                <div>
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2">
                    📍 Location
                  </p>
                  <div className="clay-card p-4 flex gap-3 items-start">
                    <div className="clay-icon w-9 h-9 rounded-xl bg-[var(--brand-light)] flex items-center justify-center flex-shrink-0">
                      <MapPin size={16} className="text-brand-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-semibold text-brand-primary uppercase tracking-wider mb-1">
                        Detected Location
                      </p>
                      <p className="text-[12px] text-gray-500 leading-snug">{locationAddress}</p>
                      <div className="flex gap-2 mt-2 flex-wrap">
                        <button
                          onClick={getLocation}
                          className="text-[11px] font-semibold text-brand-primary hover:underline"
                        >
                          🔄 Retry Location
                        </button>
                        <button
                          onClick={() => {
                            if (!navigator.onLine) {
                              toast.error("Manual map is not available offline.");
                              return;
                            }
                            setShowMap(!showMap);
                          }}
                          className="text-[11px] font-semibold text-brand-primary hover:underline"
                        >
                          {showMap ? "Hide map" : "⚙ Set manually →"}
                        </button>
                      </div>
                    </div>
                  </div>
                  {showMap && navigator.onLine && (
                    <div className="mt-2 rounded-2xl overflow-hidden border border-gray-200">
                      <ManualLocationPicker
                        latitude={manualLat ?? latitude}
                        longitude={manualLng ?? longitude}
                        onChange={(lat, lng, addr) => {
                          setManualLat(lat);
                          setManualLng(lng);
                          if (addr) {
                            setLocationAddress(addr);
                            if (clientType === "New Client") {
                              onChangeAction("address", addr);
                            }
                          }
                        }}
                      />
                    </div>
                  )}
                </div>

                {/* Submit */}
                <button
                  onClick={handleCreate}
                  disabled={isSubmitDisabled}
                  className={[
                    "w-full rounded-2xl py-4 text-[15px] font-semibold flex items-center justify-center gap-2 transition-all",
                    isSubmitDisabled
                      ? "bg-gray-100 text-gray-300 cursor-not-allowed"
                      : isLogout
                        ? "clay-btn bg-[var(--brand-primary)] text-white active:scale-[0.98]"
                        : "clay-btn bg-[#1A7A4A] text-white active:scale-[0.98]",
                  ].join(" ")}
                >
                  {loading ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      Saving...
                    </>
                  ) : isLogout ? (
                    <>
                      <LogOut size={16} />
                      {navigator.onLine ? "Logout" : "Save Offline (Logout)"}
                    </>
                  ) : (
                    <>
                      <LogIn size={16} />
                      {navigator.onLine ? "Login" : "Save Offline (Login)"}
                    </>
                  )}
                </button>

                <p className="text-center text-[11px] text-gray-300 pb-2">
                  {navigator.onLine
                    ? "Submission will be recorded with timestamp & GPS location"
                    : "Will sync automatically when you're back online"}
                </p>
              </>
            )}

            {loadingStatus && capturedImage && (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <div className="w-8 h-8 border-3 border-brand-primary/20 border-t-brand-primary rounded-full animate-spin" />
                <p className="text-[13px] text-gray-500">Determining login status...</p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
