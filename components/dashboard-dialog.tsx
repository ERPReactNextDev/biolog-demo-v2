"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Calendar, Clock, User, FileText, Building2, ArrowLeft, LogIn, LogOut, Navigation, Camera, Loader2, Download } from "lucide-react";
import { toast } from "sonner";

interface ActivityLog {
  ReferenceID: string;
  Type: string;
  Status: string;
  Location: string;
  PhotoURL?: string;
  date_created: string;
  Remarks: string;
  SiteVisitAccount: string | null;
  _id?: string;
  Latitude?: number | null;
  Longitude?: number | null;
}

// Cache for reverse geocoding results
const addressCache = new Map<string, string>();

// Check if location is in coordinate format (lat, lng)
function isCoordinateFormat(location: string): boolean {
  if (!location) return false;
  // Pattern: "14.12345, 121.12345" or similar coordinate formats
  const coordPattern = /^-?\d+\.?\d*,\s*-?\d+\.?\d*$/;
  return coordPattern.test(location.trim());
}

// Reverse geocode coordinates to address
async function reverseGeocode(coords: string): Promise<string | null> {
  if (addressCache.has(coords)) {
    return addressCache.get(coords)!;
  }
  
  try {
    const [lat, lon] = coords.split(',').map(s => parseFloat(s.trim()));
    if (isNaN(lat) || isNaN(lon)) return null;
    
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`,
      { headers: { 'Accept-Language': 'en' } }
    );
    
    if (!response.ok) return null;
    
    const data = await response.json();
    const address = data.display_name || null;
    
    if (address) {
      addressCache.set(coords, address);
    }
    return address;
  } catch {
    return null;
  }
}

interface UserInfo {
  Firstname: string;
  Lastname: string;
  profilePicture?: string;
}

interface ActivityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedEvent: ActivityLog | null;
  usersMap: Record<string, UserInfo>;
}

export default function ActivityDialog({ open, onOpenChange, selectedEvent, usersMap }: ActivityDialogProps) {
  const user = selectedEvent ? usersMap[selectedEvent.ReferenceID] : null;
  const fullName = user ? `${user.Firstname} ${user.Lastname}` : "Unknown User";
  const initials = user ? `${user.Firstname[0]}${user.Lastname[0]}` : "?";

  const isLogin = selectedEvent?.Status === "Login";
  const isLogout = selectedEvent?.Status === "Logout";

  const statusColor = isLogin ? "#1A7A4A" : isLogout ? "var(--brand-primary)" : "#888";
  const statusBg = isLogin ? "#EEF7F2" : isLogout ? "var(--brand-light)" : "#F5F5F5";

  // State for resolved address (reverse geocoding)
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(false);

  // Reverse geocode coordinates when dialog opens
  useEffect(() => {
    if (!open || !selectedEvent) {
      setResolvedAddress(null);
      return;
    }

    // First check if we have Latitude and Longitude to use
    let coordString: string | null = null;
    
    // Convert to numbers if they are strings
    const latNum = typeof selectedEvent.Latitude === 'string' ? parseFloat(selectedEvent.Latitude) : selectedEvent.Latitude;
    const lngNum = typeof selectedEvent.Longitude === 'string' ? parseFloat(selectedEvent.Longitude) : selectedEvent.Longitude;
    
    if (latNum !== null && latNum !== undefined && !isNaN(latNum) && lngNum !== null && lngNum !== undefined && !isNaN(lngNum)) {
      coordString = `${latNum.toFixed(6)}, ${lngNum.toFixed(6)}`;
    } else if (selectedEvent.Location) {
      coordString = selectedEvent.Location;
    }

    if (!coordString) {
      setResolvedAddress(null);
      return;
    }
    
    // If it's already an address (not coordinates), use it directly
    if (!isCoordinateFormat(coordString)) {
      setResolvedAddress(null);
      return;
    }

    // If we have it cached, use it
    if (addressCache.has(coordString)) {
      setResolvedAddress(addressCache.get(coordString)!);
      return;
    }

    // Try to reverse geocode if online
    if (navigator.onLine) {
      setIsResolving(true);
      reverseGeocode(coordString)
        .then(address => {
          if (address) {
            setResolvedAddress(address);
          }
        })
        .finally(() => setIsResolving(false));
    }
  }, [open, selectedEvent?.Location, selectedEvent?.Latitude, selectedEvent?.Longitude]);

  // Get display location (resolved address or original)
  const getCoordString = () => {
    if (!selectedEvent) return null;
    
    // Convert to numbers if they are strings
    const latNum = typeof selectedEvent.Latitude === 'string' ? parseFloat(selectedEvent.Latitude) : selectedEvent.Latitude;
    const lngNum = typeof selectedEvent.Longitude === 'string' ? parseFloat(selectedEvent.Longitude) : selectedEvent.Longitude;
    
    if (latNum !== null && latNum !== undefined && !isNaN(latNum) && lngNum !== null && lngNum !== undefined && !isNaN(lngNum)) {
      return `${latNum.toFixed(6)}, ${lngNum.toFixed(6)}`;
    }
    return selectedEvent.Location;
  };
  const coordString = getCoordString();
  const displayLocation = resolvedAddress || selectedEvent?.Location || "No location recorded";
  const isCoords = coordString ? isCoordinateFormat(coordString) : false;

  // State for download loading
  const [isDownloading, setIsDownloading] = useState(false);

  // Download photo with watermark
  const downloadPhoto = useCallback(async () => {
    if (!selectedEvent?.PhotoURL) return;

    setIsDownloading(true);
    try {
      // Load the image
      const img = new Image();
      img.crossOrigin = "anonymous";
      
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Failed to load image"));
        img.src = selectedEvent.PhotoURL!;
      });

      // Create canvas
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Failed to get canvas context");

      // Set canvas dimensions to match image
      canvas.width = img.width;
      canvas.height = img.height;

      // Draw the original image
      ctx.drawImage(img, 0, 0);

      // Watermark configuration - smaller and professional
      const padding = Math.max(10, canvas.width * 0.015);
      const maxAvailableWidth = canvas.width - (padding * 2);
      const fontSize = Math.max(10, Math.min(canvas.width / 35, 14));
      const lineHeight = fontSize * 1.25;
      
      // Prepare text lines
      const timeText = new Date(selectedEvent.date_created).toLocaleTimeString("en-PH", { 
        hour: "2-digit", 
        minute: "2-digit", 
        hour12: true 
      });
      const statusTimeText = `${selectedEvent.Status} · ${timeText}`;
      
      // Truncate location if too long (max 2 lines worth)
      let locationText = displayLocation;
      ctx.font = `${fontSize}px system-ui, -apple-system, sans-serif`;
      
      // Word wrap function for location - with strict max width
      const wrapText = (text: string, maxW: number): string[] => {
        const words = text.split(' ');
        const lines: string[] = [];
        let currentLine = '';
        
        for (const word of words) {
          const testLine = currentLine ? `${currentLine} ${word}` : word;
          const metrics = ctx.measureText(testLine);
          if (metrics.width > maxW - 4 && currentLine) {
            lines.push(currentLine);
            currentLine = word;
            // Stop after 2 lines
            if (lines.length >= 2) break;
          } else {
            currentLine = testLine;
          }
        }
        if (currentLine && lines.length < 2) lines.push(currentLine);
        
        // Add ellipsis to last line if text was truncated
        if (lines.length === 2 && words.length > lines.join(' ').split(' ').length) {
          const lastLine = lines[1];
          if (lastLine.length > 5) {
            lines[1] = lastLine.substring(0, lastLine.length - 3).trim() + '...';
          }
        }
        return lines;
      };
      
      const locationLines = wrapText(locationText, maxAvailableWidth);

      // Calculate watermark dimensions based on actual wrapped text widths
      ctx.font = `${fontSize}px system-ui, -apple-system, sans-serif`;
      const allLines = [...locationLines, statusTimeText];
      let actualMaxWidth = 0;
      for (const line of allLines) {
        const width = ctx.measureText(line).width;
        if (width > actualMaxWidth) actualMaxWidth = width;
      }
      
      // Strictly constrain watermark within image
      const boxPadding = 10;
      const watermarkWidth = Math.min(actualMaxWidth + (boxPadding * 2), maxAvailableWidth - 4);
      const watermarkHeight = (allLines.length * lineHeight) + (boxPadding * 1.5);
      const startX = padding + boxPadding;
      const startY = canvas.height - padding - watermarkHeight + boxPadding + fontSize;

      // Draw elegant background with rounded corners
      ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
      ctx.beginPath();
      const cornerRadius = 5;
      const x = padding;
      const y = canvas.height - padding - watermarkHeight;
      const w = watermarkWidth;
      const h = watermarkHeight;
      
      ctx.moveTo(x + cornerRadius, y);
      ctx.lineTo(x + w - cornerRadius, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + cornerRadius);
      ctx.lineTo(x + w, y + h - cornerRadius);
      ctx.quadraticCurveTo(x + w, y + h, x + w - cornerRadius, y + h);
      ctx.lineTo(x + cornerRadius, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - cornerRadius);
      ctx.lineTo(x, y + cornerRadius);
      ctx.quadraticCurveTo(x, y, x + cornerRadius, y);
      ctx.closePath();
      ctx.fill();

      // Draw watermark text
      ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.font = `${fontSize}px system-ui, -apple-system, sans-serif`;

      // Draw location lines
      locationLines.forEach((line, index) => {
        ctx.fillText(line, startX, startY + (index * lineHeight));
      });

      // Draw status and time with subtle accent color
      ctx.fillStyle = "rgba(255, 200, 200, 0.9)";
      ctx.font = `${fontSize}px system-ui, -apple-system, sans-serif`;
      ctx.fillText(statusTimeText, startX, startY + (locationLines.length * lineHeight));

      // Draw Biolog footer watermark at bottom right (very small)
      const footerFontSize = Math.max(8, Math.min(canvas.width / 45, 10));
      const footerText = `Biolog · ${new Date().getFullYear()}`;
      ctx.font = `600 ${footerFontSize}px system-ui, -apple-system, sans-serif`;
      const footerMetrics = ctx.measureText(footerText);
      const footerX = canvas.width - padding - footerMetrics.width;
      const footerY = canvas.height - padding - 2;
      
      // Subtle shadow for readability
      ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
      ctx.fillText(footerText, footerX + 1, footerY + 1);
      // White text
      ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
      ctx.fillText(footerText, footerX, footerY);

      // Convert to blob and download
      canvas.toBlob((blob) => {
        if (!blob) {
          toast.error("Failed to create image");
          return;
        }

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const dateStr = new Date(selectedEvent.date_created).toISOString().split('T')[0];
        link.href = url;
        link.download = `attendance-${selectedEvent.Status.toLowerCase()}-${dateStr}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        toast.success("Photo downloaded with watermark");
      }, "image/png");
    } catch (error) {
      console.error("Download error:", error);
      toast.error("Failed to download photo");
    } finally {
      setIsDownloading(false);
    }
  }, [selectedEvent, displayLocation]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 rounded-[28px] max-w-sm w-full mx-auto overflow-hidden border-0 shadow-2xl max-h-[85vh] flex flex-col">
        <VisuallyHidden>
          <DialogTitle>Activity Details</DialogTitle>
        </VisuallyHidden>

        {/* Header */}
        <div className="clay-card-brand rounded-none px-6 pt-5 pb-8">
          <div className="flex items-center gap-3 mb-6">
            <button
              onClick={() => onOpenChange(false)}
              className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white hover:bg-white/30 transition-colors"
            >
              <ArrowLeft size={15} />
            </button>
            <div>
              <h2 className="text-white font-semibold text-base">Event Details</h2>
              <p className="text-white/65 text-[11px]">Activity log entry</p>
            </div>
          </div>

          {/* User card floating */}
          <div className="bg-white/15 backdrop-blur-sm rounded-2xl px-4 py-3 flex items-center gap-3">
            {user?.profilePicture ? (
              <img src={user.profilePicture} alt={fullName} className="w-10 h-10 rounded-full object-cover border-2 border-white/40" />
            ) : (
              <div className="w-10 h-10 rounded-full bg-white/30 flex items-center justify-center text-white font-semibold text-sm border-2 border-white/40">
                {initials}
              </div>
            )}
            <div>
              <p className="text-white font-semibold text-sm">{fullName}</p>
              <p className="text-white/65 text-[11px]">
                {selectedEvent?.Type || "Unknown type"}
              </p>
            </div>
            {selectedEvent && (
              <div
                className="ml-auto rounded-xl px-3 py-1.5 text-[11px] font-semibold"
                style={{ background: statusBg, color: statusColor }}
              >
                {isLogin ? <LogIn size={10} className="inline mr-1" /> : <LogOut size={10} className="inline mr-1" />}
                {selectedEvent.Status}
              </div>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto clay-bg px-5 py-5 flex flex-col gap-3 -mt-4 rounded-t-[24px] relative z-10">

          {selectedEvent ? (
            <>
              {/* Site Visit Account */}
              {selectedEvent.SiteVisitAccount && (
                <div className="clay-card px-4 py-3 flex items-start gap-3">
                  <div className="clay-icon w-8 h-8 rounded-xl bg-[#FDF4E7] flex items-center justify-center flex-shrink-0">
                    <Building2 size={14} className="text-[#A0611A]" />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Site Visit</p>
                    <p className="text-[13px] font-semibold text-gray-800">{selectedEvent.SiteVisitAccount}</p>
                  </div>
                </div>
              )}

              {/* Date & Time */}
              <div className="clay-card px-4 py-3 grid grid-cols-2 gap-4">
                <div className="flex items-start gap-3">
                  <div className="clay-icon w-8 h-8 rounded-xl bg-[var(--brand-light)] flex items-center justify-center flex-shrink-0">
                    <Calendar size={14} className="text-brand-primary" />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Date</p>
                    <p className="text-[13px] font-semibold text-gray-800">
                      {new Date(selectedEvent.date_created).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="clay-icon w-8 h-8 rounded-xl bg-[#E6F1FB] flex items-center justify-center flex-shrink-0">
                    <Clock size={14} className="text-[#185FA5]" />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Time</p>
                    <p className="text-[13px] font-semibold text-gray-800">
                      {new Date(selectedEvent.date_created).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", hour12: true })}
                    </p>
                  </div>
                </div>
              </div>

              {/* Location */}
              <div className="clay-card px-4 py-3 flex items-start gap-3">
                <div className="clay-icon w-8 h-8 rounded-xl bg-[var(--brand-light)] flex items-center justify-center flex-shrink-0">
                  <Navigation size={14} className="text-brand-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">
                    Location
                    {isCoords && !resolvedAddress && !isResolving && (
                      <span className="ml-1.5 text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">Offline</span>
                    )}
                  </p>
                  {isResolving ? (
                    <div className="flex items-center gap-2 text-gray-500">
                      <Loader2 size={12} className="animate-spin" />
                      <span className="text-[12px]">Resolving address...</span>
                    </div>
                  ) : (
                    <p className="text-[12px] text-gray-700 leading-snug">{displayLocation}</p>
                  )}
                  {isCoords && resolvedAddress && (
                    <p className="text-[10px] text-gray-400 mt-1 italic">
                      Coordinates: {selectedEvent.Location}
                    </p>
                  )}
                </div>
              </div>

              {/* Photo Verification */}
              {selectedEvent.PhotoURL && (
                <div className="clay-card p-1 flex flex-col">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-gray-50">
                    <div className="flex items-center gap-2">
                      <Camera size={13} className="text-brand-primary" />
                      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Photo Verification</p>
                    </div>
                    <button
                      onClick={downloadPhoto}
                      disabled={isDownloading}
                      className="clay-btn flex items-center gap-1.5 px-3 py-1.5 bg-[var(--brand-primary)] text-white rounded-lg text-[11px] font-semibold transition-colors active:scale-95 disabled:opacity-50"
                    >
                      {isDownloading ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Download size={12} />
                      )}
                      {isDownloading ? "Downloading..." : "Download"}
                    </button>
                  </div>
                  <div className="relative aspect-[4/3] rounded-xl overflow-hidden mt-1">
                    <img 
                      src={selectedEvent.PhotoURL} 
                      alt="Attendance verification" 
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
              )}

              {/* Remarks */}
              {selectedEvent.Remarks && (
                <div className="clay-card px-4 py-3 flex items-start gap-3">
                  <div className="clay-icon w-8 h-8 rounded-xl bg-gray-50 flex items-center justify-center flex-shrink-0">
                    <FileText size={14} className="text-gray-400" />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Remarks</p>
                    <p className="text-[13px] text-gray-700">{selectedEvent.Remarks}</p>
                  </div>
                </div>
              )}

              <button
                onClick={() => onOpenChange(false)}
                className="clay-btn w-full mt-1 rounded-2xl py-3.5 bg-[var(--brand-primary)] text-white font-semibold text-[14px] transition-colors active:scale-[0.98]"
              >
                Close
              </button>
            </>
          ) : (
            <div className="text-center py-8 text-gray-400 text-sm">No event selected.</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}