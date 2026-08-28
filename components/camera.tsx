"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import * as faceapi from "face-api.js";
import { toast } from "sonner";
import { RefreshCcw, SwitchCamera, Camera as CameraIcon, CheckCircle2, AlertCircle, Maximize2, Minimize2 } from "lucide-react";
import { getPreferences } from "@/lib/preferences";

interface CameraProps {
  onCaptureAction: (dataUrl: string, faceData?: any) => void;
  onRegisterAction?: (descriptors: number[][]) => void;
  mode?: "capture" | "register";
  registeredDescriptors?: number[][];
  skipFaceVerification?: boolean;
}

// Fallback default — overridden at runtime by user preferences
const DEFAULT_COUNTDOWN_SECONDS = 10;

type FaceStatus = "idle" | "no-face" | "multiple" | "detected" | "unsupported";

export default function Camera({
  onCaptureAction,
  onRegisterAction,
  mode = "capture",
  registeredDescriptors,
  skipFaceVerification = false,
}: CameraProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const modelsLoadedRef = useRef(false);
  const recognitionAvailableRef = useRef(false);
  const faceMatcherRef = useRef<faceapi.FaceMatcher | null>(null);

  // ── Use refs for values accessed inside the RAF loop to avoid stale closures ──
  const faceStatusRef = useRef<FaceStatus>("idle");
  const isMatchRef = useRef<boolean | null>(null);
  const lastDetectionsRef = useRef<any[]>([]);
  const registrationTakesRef = useRef<number[][]>([]);
  const registrationStepRef = useRef<number>(0);
  const modeRef = useRef(mode);
  const registeredDescriptorsRef = useRef(registeredDescriptors);
  const skipFaceVerificationRef = useRef(skipFaceVerification);

  // Keep refs in sync with props/state
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { registeredDescriptorsRef.current = registeredDescriptors; }, [registeredDescriptors]);
  useEffect(() => { skipFaceVerificationRef.current = skipFaceVerification; }, [skipFaceVerification]);

  // ── UI state (only for rendering) ──
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>("");
  const [permissionGiven, setPermissionGiven] = useState(false);
  const [cameraStarted, setCameraStarted] = useState(false);
  const [faceStatus, setFaceStatus] = useState<FaceStatus>("idle");
  const [isMatch, setIsMatch] = useState<boolean | null>(null);
  const [registrationStep, setRegistrationStep] = useState<number>(0);
  const [registrationTakesCount, setRegistrationTakesCount] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Sync ref → state for rendering
  const updateFaceStatus = useCallback((s: FaceStatus) => {
    faceStatusRef.current = s;
    setFaceStatus(s);
  }, []);

  const updateIsMatch = useCallback((v: boolean | null) => {
    isMatchRef.current = v;
    setIsMatch(v);
  }, []);

  // ── Landmark helpers ──
  const getNormalizedLandmarks = useCallback((det: any): number[] | null => {
    if (!det.landmarks) return null;
    const box = det.detection.box;
    const points: number[] = [];
    (det.landmarks.positions as { x: number; y: number }[]).forEach((p) => {
      points.push((p.x - box.x) / box.width);
      points.push((p.y - box.y) / box.height);
    });
    return points;
  }, []);

  const compareLandmarks = useCallback((current: number[], registered: number[][]): boolean => {
    if (registered.length === 0) return false;
    return registered.some((reg) => {
      if (reg.length !== current.length) return false;
      let sumSq = 0;
      for (let i = 0; i < current.length; i++) sumSq += Math.pow(current[i] - reg[i], 2);
      return Math.sqrt(sumSq) < 0.5;
    });
  }, []);

  // ── Initialize FaceMatcher when descriptors change ──
  useEffect(() => {
    if (registeredDescriptors && registeredDescriptors.length > 0) {
      const isFullDescriptor = registeredDescriptors[0].length === 128;
      if (isFullDescriptor && recognitionAvailableRef.current) {
        try {
          const labeled = new faceapi.LabeledFaceDescriptors(
            "user",
            registeredDescriptors.map((d) => new Float32Array(d))
          );
          faceMatcherRef.current = new faceapi.FaceMatcher(labeled, 0.6);
        } catch {
          /* silent */
        }
      } else {
        faceMatcherRef.current = null;
      }
    } else {
      faceMatcherRef.current = null;
    }
  }, [registeredDescriptors]);

  // ── Face detection loop (uses refs, never re-created) ──
  const runFaceDetection = useCallback(async () => {
    const video = videoRef.current;
    const overlay = overlayRef.current;

    if (!video || !overlay || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(runFaceDetection);
      return;
    }

    const ctx = overlay.getContext("2d");
    if (!ctx) { rafRef.current = requestAnimationFrame(runFaceDetection); return; }

    overlay.width = video.videoWidth || video.clientWidth;
    overlay.height = video.videoHeight || video.clientHeight;
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    // If skipFaceVerification is true, don't do face detection
    if (skipFaceVerificationRef.current) {
      updateFaceStatus("idle");
      updateIsMatch(null);
      rafRef.current = requestAnimationFrame(runFaceDetection);
      return;
    }

    if (!modelsLoadedRef.current) {
      rafRef.current = requestAnimationFrame(runFaceDetection);
      return;
    }

    try {
      let task = faceapi
        .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
        .withFaceLandmarks();

      if (recognitionAvailableRef.current) {
        (task as any) = (task as any).withFaceDescriptors();
      }

      const detections = await task;
      lastDetectionsRef.current = detections;

      if (detections.length === 0) {
        updateFaceStatus("no-face");
        updateIsMatch(null);
      } else if (detections.length > 1) {
        updateFaceStatus("multiple");
        updateIsMatch(null);
        detections.forEach((det: any) => {
          const { x, y, width, height } = det.detection.box;
          const scaleX = overlay.width / video.videoWidth;
          const scaleY = overlay.height / video.videoHeight;
          ctx.strokeStyle = "#CC1318";
          ctx.lineWidth = 2;
          ctx.strokeRect(x * scaleX, y * scaleY, width * scaleX, height * scaleY);
        });
      } else {
        updateFaceStatus("detected");
        const det = detections[0] as any;
        const currentMode = modeRef.current;
        const currentDescriptors = registeredDescriptorsRef.current;

        // ── Identity verification ──
        if (currentMode === "capture" && currentDescriptors && currentDescriptors.length > 0) {
          const isFullDescriptor = currentDescriptors[0].length === 128;
          if (isFullDescriptor && faceMatcherRef.current && recognitionAvailableRef.current && det.descriptor) {
            const best = faceMatcherRef.current.findBestMatch(det.descriptor);
            updateIsMatch(best.label !== "unknown");
          } else {
            const lm = getNormalizedLandmarks(det);
            if (lm) updateIsMatch(compareLandmarks(lm, currentDescriptors));
          }
        } else if (currentMode === "capture") {
          updateIsMatch(false);
        }

        // ── Draw face frame ──
        const currentIsMatch = isMatchRef.current;
        const { x, y, width, height } = det.detection.box;
        const scaleX = overlay.width / video.videoWidth;
        const scaleY = overlay.height / video.videoHeight;
        const fx = x * scaleX, fy = y * scaleY, fw = width * scaleX, fh = height * scaleY;
        const pad = 20;
        const px = fx - pad, py = fy - pad, pw = fw + pad * 2, ph = fh + pad * 2;
        const corner = 18;

        const isGreen = currentMode === "register" || currentIsMatch === true || currentIsMatch === null;
        const statusColor = isGreen ? "#1A7A4A" : "#CC1318";
        const statusBg = isGreen ? "rgba(26,122,74,0.06)" : "rgba(204,19,24,0.06)";

        ctx.fillStyle = statusBg;
        ctx.beginPath();
        ctx.roundRect(px, py, pw, ph, corner);
        ctx.fill();

        ctx.strokeStyle = statusColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(px, py, pw, ph, corner);
        ctx.stroke();

        const len = 18, lw = 3;
        ctx.strokeStyle = statusColor;
        ctx.lineWidth = lw;
        ctx.lineCap = "round";

        [
          [px, py + len, px, py, px + len, py],
          [px + pw - len, py, px + pw, py, px + pw, py + len],
          [px, py + ph - len, px, py + ph, px + len, py + ph],
          [px + pw - len, py + ph, px + pw, py + ph, px + pw, py + ph - len],
        ].forEach(([x1, y1, x2, y2, x3, y3]) => {
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.lineTo(x3, y3);
          ctx.stroke();
        });

        // Scan line
        const t = ((performance.now() % 2000) / 2000);
        const scanY = py + t * ph;
        const grad = ctx.createLinearGradient(px, scanY - 8, px, scanY + 8);
        grad.addColorStop(0, "rgba(0,0,0,0)");
        grad.addColorStop(0.5, isGreen ? "rgba(26,122,74,0.35)" : "rgba(204,19,24,0.35)");
        grad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grad;
        ctx.fillRect(px, scanY - 8, pw, 16);
      }
    } catch {
      updateFaceStatus("unsupported");
    }

    rafRef.current = requestAnimationFrame(runFaceDetection);
  }, [updateFaceStatus, updateIsMatch, getNormalizedLandmarks, compareLandmarks]);

  // ── Load models once ──
  useEffect(() => {
    const loadModels = async () => {
      const MODEL_URL = "/models";
      try {
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(`${MODEL_URL}/tiny_face_detector`),
          faceapi.nets.faceLandmark68Net.loadFromUri(`${MODEL_URL}/face_landmark68`),
        ]);
        modelsLoadedRef.current = true;
        try {
          await faceapi.nets.faceRecognitionNet.loadFromUri(`${MODEL_URL}/face_recognition`);
          recognitionAvailableRef.current = true;
        } catch {
          /* fallback to landmark mode */
        }
        try {
          await faceapi.nets.faceExpressionNet.loadFromUri(`${MODEL_URL}/face_expression`);
        } catch (_) {}
      } catch {
        updateFaceStatus("unsupported");
      }
    };
    loadModels();
  }, [updateFaceStatus]);

  // ── Start/stop RAF loop ──
  useEffect(() => {
    if (permissionGiven && cameraStarted && !capturedImage) {
      rafRef.current = requestAnimationFrame(runFaceDetection);
    }
    return () => {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    };
  }, [permissionGiven, cameraStarted, capturedImage, runFaceDetection]);

  // ── Camera control ──
  const startCamera = async (deviceId?: string) => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    const constraints: MediaStreamConstraints = deviceId
      ? { video: { deviceId: { exact: deviceId }, facingMode: "user" } }
      : { video: { facingMode: "user" } };
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (videoRef.current) videoRef.current.srcObject = stream;
      streamRef.current = stream;
    } catch {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        if (videoRef.current) videoRef.current.srcObject = stream;
        streamRef.current = stream;
      } catch { /* silent */ }
    }
  };

  const requestPermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      setPermissionGiven(true);
      if (videoRef.current) videoRef.current.srcObject = stream;
      streamRef.current = stream;
      const all = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = all.filter((d) => d.kind === "videoinput");
      setDevices(videoDevices);
      if (videoDevices.length > 0) setSelectedDevice(videoDevices[0].deviceId);
      setCameraStarted(true);
    } catch (e: any) {
      if (e.name === "NotAllowedError") alert("Camera access denied. Please enable it in browser settings.");
      else if (e.name === "NotFoundError") alert("No camera found on this device.");
      else alert("Could not start camera. Please refresh and try again.");
    }
  };

  useEffect(() => {
    const checkPermission = async () => {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      try {
        const devs = await navigator.mediaDevices.enumerateDevices();
        if (devs.some((d) => d.kind === "videoinput" && d.label !== "")) requestPermission();
      } catch (_) {}
    };
    checkPermission();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!permissionGiven || !cameraStarted || !selectedDevice) return;
    startCamera(selectedDevice);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDevice, permissionGiven, cameraStarted]);

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        setIsFullscreen(true);
      } else {
          await document.exitFullscreen();
          setIsFullscreen(false);
        }
    } catch (err) {
      console.error("Error toggling fullscreen:", err);
      toast.error("Failed to enter fullscreen");
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  const flipCamera = () => {
    if (devices.length < 2) return;
    const idx = devices.findIndex((d) => d.deviceId === selectedDevice);
    setSelectedDevice(devices[(idx + 1) % devices.length].deviceId);
  };

  // ── Registration take ──
  const registerTake = useCallback(() => {
    const detections = lastDetectionsRef.current;
    if (detections.length === 0 || registrationTakesRef.current.length >= 3) return;
    const det = detections[0] as any;
    const normalizedPoints = getNormalizedLandmarks(det);
    if (!normalizedPoints) { toast.error("Landmarks not found. Try again."); return; }

    const newTakes = [...registrationTakesRef.current, normalizedPoints];
    registrationTakesRef.current = newTakes;

    if (newTakes.length < 3) {
      const nextStep = newTakes.length;
      registrationStepRef.current = nextStep;
      setRegistrationStep(nextStep);
      setRegistrationTakesCount(newTakes.length);
      const hints = ["Harap sa gitna (Center)", "Lumingon sa kaliwa (Left)", "Lumingon sa kanan (Right)"];
      toast.success(`Take ${newTakes.length}/3 captured! Ngayon, ${hints[nextStep]}.`);
    } else {
      setRegistrationTakesCount(3);
      toast.success("Face registration complete!");
      onRegisterAction?.(newTakes);
    }
  }, [getNormalizedLandmarks, onRegisterAction]);

  // ── Tap to capture/register ──
  const handleTap = useCallback(() => {
    const currentFaceStatus = faceStatusRef.current;
    const currentIsMatch = isMatchRef.current;
    const currentMode = modeRef.current;
    const currentDescriptors = registeredDescriptorsRef.current;

    if (capturedImage || countdown !== null) return;

    const canCapture = skipFaceVerification || currentFaceStatus === "detected" || currentFaceStatus === "unsupported";
    if (!canCapture) return;

    if (currentMode === "register") {
      registerTake();
      return;
    }

    // capture mode checks - skip if face verification is disabled
    if (!skipFaceVerification) {
      const isRegistered = currentDescriptors && currentDescriptors.length > 0;
      if (!isRegistered) {
        toast.error("Biometrics not registered! Please register your face first.");
        return;
      }
      if (faceMatcherRef.current && currentIsMatch === false) {
        toast.error("Identity mismatch! Please ensure you are the registered user.");
        return;
      }
    }

    // Read timer prefs at tap-time so it always reflects the latest setting
    const timerPrefs = getPreferences();
    const seconds = timerPrefs.cameraTimerEnabled
      ? (timerPrefs.cameraTimerSeconds ?? DEFAULT_COUNTDOWN_SECONDS)
      : 0;
    setCountdown(seconds);
  }, [capturedImage, countdown, registerTake, skipFaceVerification]);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) { capture(); return; }
    const t = setTimeout(() => setCountdown((p) => (p! > 0 ? p! - 1 : 0)), 1000);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown]);

  const capture = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    setCapturedImage(dataUrl);

    let faceData = null;
    const dets = lastDetectionsRef.current;
    if (dets.length > 0) {
      const det = dets[0];
      const box = det.detection ? det.detection.box : (det as any).box;
      const score = det.detection ? det.detection.score : (det as any).score;
      faceData = { box: { x: box.x, y: box.y, width: box.width, height: box.height }, score };
    }

    onCaptureAction(dataUrl, faceData);
    setCountdown(null);
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, [onCaptureAction]);

  const retake = useCallback(() => {
    setCapturedImage(null);
    setCountdown(null);
    updateFaceStatus("idle");
    updateIsMatch(null);
    setRegistrationStep(0);
    setRegistrationTakesCount(0);
    registrationTakesRef.current = [];
    registrationStepRef.current = 0;
    lastDetectionsRef.current = [];
    if (selectedDevice) startCamera(selectedDevice);
    setTimeout(() => {
      rafRef.current = requestAnimationFrame(runFaceDetection);
    }, 500);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDevice, runFaceDetection, updateFaceStatus, updateIsMatch]);

  // ── Status config ──
  const registrationGuidance = [
    { label: "Harap sa gitna (Center)", icon: "👤" },
    { label: "Lumingon sa kaliwa (Left)", icon: "⬅️" },
    { label: "Lumingon sa kanan (Right)", icon: "➡️" },
  ];

  const getStatusLabel = () => {
    if (skipFaceVerification) return "Tap to capture";
    if (faceStatus === "idle") return "Starting camera…";
    if (faceStatus === "unsupported") return "Tap to capture";
    if (faceStatus === "no-face") return "No face detected";
    if (faceStatus === "multiple") return "Multiple faces detected";
    if (faceStatus === "detected") {
      if (mode === "register") {
        const step = Math.min(registrationStep, 2);
        return `${registrationGuidance[step].icon} Step ${registrationTakesCount + 1}/3: ${registrationGuidance[step].label}`;
      }
      const isRegistered = registeredDescriptors && registeredDescriptors.length > 0;
      if (!isRegistered) return "User not registered — capture blocked";
      if (isMatch === null) return "Face detected — verifying identity…";
      if (isMatch) return "Identity verified — tap to capture";
      return "Identity mismatch!";
    }
    return "";
  };

  const isGreenStatus = faceStatus === "detected" && (mode === "register" || isMatch === true || isMatch === null);
  const statusColor = isGreenStatus ? "#1A7A4A" : faceStatus === "detected" ? "#CC1318" : faceStatus === "multiple" ? "#A0611A" : faceStatus === "no-face" ? "#CC1318" : "#6B7280";
  const statusBg = isGreenStatus ? "bg-[#EEF7F2]" : faceStatus === "detected" ? "bg-[#FEF0F0]" : faceStatus === "multiple" ? "bg-[#FDF4E7]" : faceStatus === "no-face" ? "bg-[#FEF0F0]" : "bg-gray-100";

  const canTap = skipFaceVerification || faceStatus === "detected" || faceStatus === "unsupported";

  return (
    <div className="w-full flex flex-col gap-3">
      {/* Permission prompt */}
      {!permissionGiven && (
        <button
          onClick={requestPermission}
          className="w-full clay-card rounded-[20px] border-2 border-dashed border-gray-200 py-8 flex flex-col items-center gap-3 hover:border-[#CC1318]/40 transition-all group"
        >
          <div className="clay-icon w-14 h-14 rounded-2xl bg-[#FEF0F0] flex items-center justify-center group-hover:bg-[#CC1318] transition-colors">
            <CameraIcon size={24} className="text-[#CC1318] group-hover:text-white transition-colors" />
          </div>
          <div className="text-center">
            <p className="text-[13px] font-semibold text-gray-700">Start Camera</p>
            <p className="text-[11px] text-gray-400 mt-0.5">Tap to allow camera access</p>
          </div>
        </button>
      )}

      {/* Live camera */}
      {permissionGiven && !capturedImage && (
        <>
          {!skipFaceVerification && faceStatus !== "idle" && (
            <div className={`clay-pill flex items-center gap-2 rounded-2xl px-3 py-2 ${statusBg}`}>
              {(faceStatus === "no-face" || faceStatus === "multiple" || (faceStatus === "detected" && !isGreenStatus)) && (
                <AlertCircle size={13} style={{ color: statusColor }} />
              )}
              {faceStatus === "detected" && isGreenStatus && (
                <CheckCircle2 size={13} style={{ color: statusColor }} />
              )}
              <span className="text-[12px] font-semibold flex-1" style={{ color: statusColor }}>{getStatusLabel()}</span>
              {faceStatus === "detected" && (
                <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: statusColor }} />
              )}
            </div>
          )}

          <div
            className={`clay-card relative w-full select-none overflow-hidden transition-all ${canTap ? "cursor-pointer active:scale-[0.995]" : "cursor-not-allowed"} ${isFullscreen ? "fixed inset-0 z-50 rounded-none aspect-video" : ""}`}
            onClick={handleTap}
            onTouchStart={(e) => { e.preventDefault(); handleTap(); }}
            style={{ aspectRatio: isFullscreen ? undefined : "4/3" }}
          >
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            {!skipFaceVerification && <canvas ref={overlayRef} className="absolute inset-0 w-full h-full pointer-events-none" />}
            
            {/* Fullscreen button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleFullscreen();
              }}
              className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/50 flex items-center justify-center text-white hover:bg-black/70 transition-colors z-10"
            >
              {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>

            {countdown !== null && countdown > 0 && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <div className="flex flex-col items-center gap-2">
                  <span className="text-white font-bold leading-none" style={{ fontSize: 72, textShadow: "0 0 32px #CC1318" }}>{countdown}</span>
                  <span className="text-white/70 text-[13px] font-medium tracking-wide">Capturing…</span>
                </div>
              </div>
            )}

            {countdown === null && (skipFaceVerification || faceStatus === "unsupported" || faceStatus === "idle") && (
              <div className="absolute inset-0 flex items-end justify-center pb-4 pointer-events-none">
                <div className="bg-black/50 rounded-full px-4 py-2">
                  <span className="text-white text-[12px] font-medium">Tap to capture</span>
                </div>
              </div>
            )}

            {!skipFaceVerification && countdown === null && faceStatus === "detected" && (
              <div className="absolute inset-0 flex items-end justify-center pb-4 pointer-events-none">
                <div
                  className="rounded-full px-4 py-2 flex items-center gap-2 shadow-lg"
                  style={{ background: isGreenStatus ? "rgba(26,122,74,0.85)" : "rgba(204,19,24,0.85)" }}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                  <span className="text-white text-[12px] font-medium">
                    {mode === "register"
                      ? `Tap to take photo ${registrationTakesCount + 1}/3`
                      : (!(registeredDescriptors && registeredDescriptors.length > 0)
                            ? "User not registered"
                            : (isMatch === false ? "Identity mismatch!" : "Tap to capture"))}
                  </span>
                </div>
              </div>
            )}

            {!skipFaceVerification && countdown === null && (faceStatus === "no-face" || faceStatus === "multiple") && (
              <div className="absolute inset-0 flex items-end justify-center pb-6 pointer-events-none">
                <div className="bg-[#CC1318]/90 backdrop-blur-sm rounded-full px-5 py-2.5 flex items-center gap-2 shadow-lg">
                  <AlertCircle size={14} className="text-white" />
                  <span className="text-white text-[12px] font-semibold">
                    {faceStatus === "no-face" ? "Position your face in frame" : "Multiple faces detected"}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            {devices.length > 1 && (
              <button
                onClick={flipCamera}
                className="clay-card flex items-center gap-2 rounded-2xl px-4 py-2.5 text-[12px] font-semibold text-gray-600 transition-all active:scale-95 flex-shrink-0"
              >
                <SwitchCamera size={15} />
                Flip
              </button>
            )}
            {devices.length > 2 && (
              <select
                value={selectedDevice}
                onChange={(e) => setSelectedDevice(e.target.value)}
                className="flex-1 rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-[12px] text-gray-700 outline-none focus:border-[#CC1318] transition-all"
              >
                {devices.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>
                ))}
              </select>
            )}
          </div>
        </>
      )}

      {/* Captured photo preview */}
      {capturedImage && (
        <div className="flex flex-col gap-3">
          <div className="clay-pill flex items-center gap-2 bg-[#EEF7F2] rounded-2xl px-3 py-2.5">
            <CheckCircle2 size={15} className="text-[#1A7A4A] flex-shrink-0" />
            <span className="text-[12px] font-semibold text-[#1A7A4A]">Photo captured successfully</span>
          </div>
          <div className="clay-card relative overflow-hidden">
            <img src={capturedImage} alt="Captured" className="w-full object-cover" style={{ aspectRatio: "4/3" }} />
            <div className="absolute top-3 right-3 w-8 h-8 rounded-full bg-[#1A7A4A] flex items-center justify-center shadow-lg">
              <CheckCircle2 size={16} className="text-white" />
            </div>
          </div>
          <button
            onClick={retake}
            className="clay-card w-full flex items-center justify-center gap-2 rounded-2xl py-3 text-[13px] font-semibold text-gray-600 hover:text-[#CC1318] transition-all active:scale-[0.98]"
          >
            <RefreshCcw size={14} />
            Retake Photo
          </button>
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}