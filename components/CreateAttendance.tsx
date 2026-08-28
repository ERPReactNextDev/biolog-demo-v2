"use client";

import dynamic from "next/dynamic";
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import Camera from "./camera";
import { enqueuePendingLog } from "@/lib/offline-store";
import { uploadToCloudinary } from "@/lib/cloudinary";
import { compressImage } from "@/lib/image-compress";
import { fetchGeofenceConfig, isWithinGeofence } from "@/lib/geofence";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { MapPin, ArrowLeft, CheckCircle2, LogIn, LogOut, FileText, AlertCircle } from "lucide-react";

const ManualLocationPicker = dynamic(() => import("./manual-location-picker"), { ssr: false });

interface FormData {
  ReferenceID: string;
  Email: string;
  Type: string;
  Status: string;
  PhotoURL: string;
  Remarks: string;
  TSM: string;
  manager?: string;
  _id?: string;
}

interface UserDetails {
  ReferenceID: string;
  Email: string;
  TSM: string;
  Manager?: string;
  faceDescriptors?: number[][];
  faceVerificationEnabled?: boolean;
}
interface CreateAttendanceProps {
  open: boolean;
  onOpenChangeAction: (open: boolean) => void;
  formData: FormData;
  onChangeAction: (field: Exclude<keyof FormData, "_id">, value: any) => void;
  userDetails: UserDetails;
  fetchAccountAction: () => void;
  setFormAction: React.Dispatch<React.SetStateAction<FormData>>;
}

const LOCATION_PENDING = "Fetching location...";

function isLocationReady(addr: string): boolean {
  return (
    addr !== LOCATION_PENDING &&
    !addr.includes("permission denied") &&
    addr.length > 0
  );
}

export default function CreateAttendance({
  open,
  onOpenChangeAction,
  formData,
  onChangeAction,
  userDetails,
  fetchAccountAction,
  setFormAction,
}: CreateAttendanceProps) {
  const [locationAddress, setLocationAddress] = useState(LOCATION_PENDING);
  const [manualLat, setManualLat] = useState<number | null>(null);
  const [manualLng, setManualLng] = useState<number | null>(null);
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [faceData, setFaceData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [lastStatus, setLastStatus] = useState<"Login" | "Logout" | null>(null);
  const [lastTime, setLastTime] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(false);

  // Reset state when dialog opens
  useEffect(() => {
    if (!open) return;
    if (formData.Type !== "On Field") onChangeAction("Type", "On Field");
    setCapturedImage(null);
    setLocationAddress(LOCATION_PENDING);
    setManualLat(null);
    setManualLng(null);
    setShowMap(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Geolocation function
  const getLocation = () => {
    setLocationAddress(LOCATION_PENDING);
    const options: PositionOptions = { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 };

    const onSuccess = (pos: GeolocationPosition) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      setLatitude(lat);
      setLongitude(lng);

      const latLngFallback = `Latitude: ${lat.toFixed(6)}, Longitude: ${lng.toFixed(6)}`;
      
      // Reverse geocode — if offline this will fail, fall back to coords string
      fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`)
        .then((r) => r.json())
        .then((d) => setLocationAddress(d.display_name || latLngFallback))
        .catch(() => setLocationAddress(latLngFallback));
    };

    const onError = (err: GeolocationPositionError) => {
      if (err.code === err.TIMEOUT || err.code === err.POSITION_UNAVAILABLE) {
        // Retry with lower accuracy
        navigator.geolocation.getCurrentPosition(
          onSuccess,
          () => setLocationAddress("Location unavailable — check GPS settings."),
          { ...options, enableHighAccuracy: false, timeout: 10000 }
        );
      } else {
        setLocationAddress("Location permission denied.");
      }
    };

    if (!navigator.geolocation) {
      setLocationAddress("Geolocation not supported.");
      return;
    }

    navigator.geolocation.getCurrentPosition(onSuccess, onError, options);
  };

  // Geolocation
  useEffect(() => {
    if (!open) return;
    getLocation();
  }, [open]);

  /* ── Helper functions for last status cache ── */
  const getLastStatusCacheKey = () => {
    const today = new Date().toISOString().split('T')[0];
    return `create-attendance-last-status-${userDetails.ReferenceID}-${today}`;
  };

  const saveLastStatusToCache = (status: "Login" | "Logout" | null, time: string | null) => {
    try {
      const cacheData = {
        status,
        time,
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
      const prefix = `create-attendance-last-status-${userDetails.ReferenceID}-`;
      
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

  // Fetch last status
  useEffect(() => {
    if (!open) return;
    
    // First try to load from cache
    const cachedStatus = loadLastStatusFromCache();
    if (cachedStatus) {
      setLastStatus(cachedStatus.status);
      setLastTime(cachedStatus.time);
    }
    
    fetch(`/api/ModuleSales/Activity/LastStatus?referenceId=${userDetails.ReferenceID}&type=On Field`, {
      credentials: "include"
    })
      .then((r) => r.json())
      .then((data) => {
        if (data?.lastStatus) {
          const time = data.lastTime ? new Date(data.lastTime).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" }) : null;
          setLastStatus(data.lastStatus);
          setLastTime(time);
          saveLastStatusToCache(data.lastStatus, time);
        } else {
          setLastStatus(null);
          setLastTime(null);
          saveLastStatusToCache(null, null);
        }
      })
      .catch(() => { /* silent — offline, use cached status if available */ });
  }, [open, userDetails.ReferenceID]);

  const resetForm = () => {
    setFormAction({ ReferenceID: userDetails.ReferenceID, Email: userDetails.Email, Type: "On Field", Status: "", PhotoURL: "", Remarks: "", TSM: userDetails.TSM });
    setCapturedImage(null);
  };

  const handleCreate = async () => {
    if (!capturedImage) return toast.error("Please capture a photo first.");
    if (!formData.Status) return toast.error("Please select Login or Logout.");
    if (!isLocationReady(locationAddress)) return toast.error("Location not ready yet. Please wait.");

    // Save the new status to cache immediately
    const newStatus = formData.Status as "Login" | "Logout" | null;
    const newTime = new Date().toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" });
    saveLastStatusToCache(newStatus, newTime);
    setLastStatus(newStatus);
    setLastTime(newTime);
    
    setLoading(true);

    // ── Geofence check ────────────────────────────────────────────────────
    if (latitude !== null && longitude !== null) {
      try {
        const geofence = await fetchGeofenceConfig();
        const within = isWithinGeofence(latitude, longitude, geofence);
        if (within === false) {
          toast.error("⚠️ You are outside the allowed area. Please move closer to the office to log attendance.", { duration: 6000 });
          setLoading(false);
          return;
        }
      } catch { /* non-critical — allow if geofence check fails */ }
    }

    // ── Compress photo before storing/uploading ───────────────────────────
    let photo = capturedImage;
    try {
      photo = await compressImage(capturedImage);
    } catch { /* use original if compression fails */ }

const basePayload = {
  ...formData,
  Location:  locationAddress,
  Latitude:  manualLat ?? latitude,
  Longitude: manualLng ?? longitude,
  FaceData:  faceData,
  manager:   userDetails.Manager,
};

    try {
      if (!navigator.onLine) {
        await enqueuePendingLog({ ...basePayload, PhotoURL: photo });
        toast.success("Saved offline — will sync when you're back online.", {
          duration: 4000,
        });
        // Dispatch custom event to trigger pending count refresh
        window.dispatchEvent(new CustomEvent("acculog:sync"));
        onOpenChangeAction(false);
        resetForm();
        return;
      }

      let photoURL: string;
      try {
        photoURL = await uploadToCloudinary(photo);
      } catch {
        await enqueuePendingLog({ ...basePayload, PhotoURL: photo });
        toast.success("Photo upload failed — saved offline. Will sync when connection improves.");
        onOpenChangeAction(false);
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
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Server error");
        toast.success("Attendance recorded successfully!");
        if ("vibrate" in navigator) navigator.vibrate([50, 30, 50]);
        fetchAccountAction();
        onOpenChangeAction(false);
        resetForm();
      } catch {
        await enqueuePendingLog({ ...basePayload, PhotoURL: photoURL });
        toast.success("Saved offline — will sync when connection returns.");
        onOpenChangeAction(false);
        resetForm();
      }
    } catch (err: any) {
      toast.error(err?.message || "Error saving attendance.");
    } finally {
      setLoading(false);
    }
  };

  const isSubmitDisabled =
    loading ||
    !formData.Status ||
    !capturedImage ||
    !isLocationReady(locationAddress);

  return (
    <Dialog open={open} onOpenChange={onOpenChangeAction}>
      <DialogContent className="p-0 rounded-[28px] max-w-sm w-full mx-auto overflow-hidden border-0 shadow-[0_8px_40px_rgba(0,0,0,0.18)] max-h-[92vh] flex flex-col">
        <VisuallyHidden>
          <DialogTitle>Create Attendance</DialogTitle>
        </VisuallyHidden>

        {/* ── Header ── */}
        <div className="clay-card-brand rounded-none px-6 pt-5 pb-6 flex-shrink-0">
          <div className="flex items-center gap-3 mb-5">
            <button
              onClick={() => onOpenChangeAction(false)}
              className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white hover:bg-white/30 transition-colors"
            >
              <ArrowLeft size={15} />
            </button>
            <div className="flex-1">
              <h2 className="text-white font-semibold text-base leading-tight">Create Attendance</h2>
              <p className="text-white/65 text-[11px] mt-0.5">Field log entry</p>
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
        </div>

        {/* ── Body ── */}
        <div className="overflow-y-auto flex-1 clay-bg">
          <div className="flex flex-col gap-4 p-5">

            {/* Current Status Banner */}
            {lastStatus && (
              <div className={`clay-card px-4 py-3 flex items-center gap-3 ${lastStatus === "Login" ? "bg-[#EEF7F2]" : "bg-[var(--brand-light)]"}`}>
                {lastStatus === "Login"
                  ? <CheckCircle2 size={18} className="text-[#1A7A4A] flex-shrink-0" />
                  : <AlertCircle size={18} className="text-brand-primary flex-shrink-0" />}
                <div>
                  <p className={`text-[12px] font-semibold ${lastStatus === "Login" ? "text-[#1A7A4A]" : "text-brand-primary"}`}>
                    Currently {lastStatus === "Login" ? "Logged In" : "Logged Out"}
                  </p>
                  {lastTime && <p className="text-[11px] text-gray-400 mt-0.5">Last activity: {lastStatus} at {lastTime}</p>}
                </div>
              </div>
            )}

            {/* Camera */}
            <div>
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2">Photo Verification</p>
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
                  <span className="text-[12px] font-semibold text-[#1A7A4A]">Photo captured successfully</span>
                </div>
              )}
            </div>

            {capturedImage && (
              <>
                {/* Attendance Status */}
                <div>
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2">Attendance Status</p>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => onChangeAction("Status", "Login")}
                      disabled={lastStatus === "Login"}
                      className={`clay-card p-4 flex flex-col items-center gap-2 transition-all active:scale-95 ${
                        formData.Status === "Login" ? "bg-[#EEF7F2] border-[#1A7A4A]" : "bg-white border-gray-200 hover:border-gray-300"
                      } ${lastStatus === "Login" ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
                    >
                      <LogIn size={20} className={formData.Status === "Login" ? "text-[#1A7A4A]" : "text-gray-400"} />
                      <span className={`text-[13px] font-semibold ${formData.Status === "Login" ? "text-[#1A7A4A]" : "text-gray-700"}`}>Login</span>
                      <span className="text-[10px] text-gray-400">Start of shift</span>
                    </button>
                    <button
                      onClick={() => onChangeAction("Status", "Logout")}
                      disabled={lastStatus === "Logout"}
                      className={`clay-card p-4 flex flex-col items-center gap-2 transition-all active:scale-95 ${
                        formData.Status === "Logout" ? "bg-brand-light border-brand-primary" : "bg-white border-gray-200 hover:border-gray-300"
                      } ${lastStatus === "Logout" ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
                    >
                      <LogOut size={20} className={formData.Status === "Logout" ? "text-brand-primary" : "text-gray-400"} />
                      <span className={`text-[13px] font-semibold ${formData.Status === "Logout" ? "text-brand-primary" : "text-gray-700"}`}>Logout</span>
                      <span className="text-[10px] text-gray-400">End of shift</span>
                    </button>
                  </div>
                </div>

                {/* Remarks */}
                <div>
                  <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                    <FileText size={12} /> Remarks
                  </label>
                  <textarea
                    value={formData.Remarks}
                    onChange={(e) => onChangeAction("Remarks", e.target.value)}
                    placeholder="Add notes or remarks (optional)..."
                    rows={3}
                    className="w-full clay-card px-4 py-3 text-[13px] text-gray-800 placeholder:text-gray-300 resize-none outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/10 transition-all"
                  />
                </div>

                {/* Location */}
                <div>
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2">Location</p>
                  <div className="clay-card p-4 flex gap-3 items-start">
                    <div className="clay-icon w-9 h-9 rounded-xl bg-[var(--brand-light)] flex items-center justify-center flex-shrink-0">
                      <MapPin size={16} className="text-brand-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-semibold text-brand-primary uppercase tracking-wider mb-1">
                        {locationAddress === LOCATION_PENDING ? "Detecting location..." : "Detected Location"}
                      </p>
                      <p className="text-[12px] text-gray-500 leading-snug">{locationAddress}</p>
                      <div className="flex gap-2 mt-2 flex-wrap">
                        <button
                          onClick={getLocation}
                          className="text-[11px] font-semibold text-brand-primary hover:underline"
                        >
                          🔄 Retry Location
                        </button>
                        {isLocationReady(locationAddress) && (
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
                        )}
                      </div>
                    </div>
                  </div>
                  {showMap && (
                    <div className="mt-2 rounded-2xl overflow-hidden border border-gray-200">
                      <ManualLocationPicker
                        latitude={manualLat ?? latitude}
                        longitude={manualLng ?? longitude}
                        onChange={(lat, lng, address) => {
                          setManualLat(lat);
                          setManualLng(lng);
                          if (address) setLocationAddress(address);
                        }}
                      />
                    </div>
                  )}
                </div>

                {/* Submit */}
                <button
                  onClick={handleCreate}
                  disabled={isSubmitDisabled}
                  className={`w-full rounded-2xl py-4 text-[15px] font-semibold flex items-center justify-center gap-2 transition-all ${
                    isSubmitDisabled
                      ? "bg-gray-100 text-gray-300 cursor-not-allowed" :"clay-btn bg-[var(--brand-primary)] text-white active:scale-[0.98]"
                  }`}
                >
                  {loading ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={16} />
                      {navigator.onLine ? "Submit Attendance" : "Save Offline"}
                    </>
                  )}
                </button>

                <p className="text-center text-[11px] text-gray-300 pb-2">
                  {navigator.onLine
                    ? "Submission will be recorded with timestamp & GPS location" :"Will sync automatically when you're back online"}
                </p>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
