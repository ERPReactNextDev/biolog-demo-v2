"use client";
import React, { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";
import {
  Eye, EyeOff, ArrowRight, Shield, Fingerprint,
  UserPlus, X, ChevronRight, CheckCircle2, Clock,
  User, Mail, Lock, Building2, Briefcase, Hash,
} from "lucide-react";

/* ─────────────────────────────────────────────
   GOOGLE ICON (inline SVG — no extra dep)
───────────────────────────────────────────── */
function GoogleIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

/* ─────────────────────────────────────────────
   SIGNUP FORM TYPES
───────────────────────────────────────────── */
interface SignUpForm {
  Firstname: string;
  Lastname: string;
  Email: string;
  Password: string;
  ConfirmPassword: string;
  Department: string;
  Company: string;
  ReferenceID: string;
}

const EMPTY_SIGNUP: SignUpForm = {
  Firstname: "", Lastname: "", Email: "",
  Password: "", ConfirmPassword: "",
  Department: "", Company: "", ReferenceID: "",
};

/* ─────────────────────────────────────────────
   SIGNUP DIALOG
───────────────────────────────────────────── */
function SignUpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState<SignUpForm>(EMPTY_SIGNUP);
  const [showPass, setShowPass] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  if (!open) return null;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleClose = () => {
    setForm(EMPTY_SIGNUP);
    setDone(false);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.Password !== form.ConfirmPassword) {
      toast.error("Passwords do not match!");
      return;
    }
    if (form.Password.length < 6) {
      toast.error("Password must be at least 6 characters.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Firstname: form.Firstname,
          Lastname: form.Lastname,
          Email: form.Email,
          Password: form.Password,
          Department: form.Department,
          Company: form.Company,
          ReferenceID: form.ReferenceID,
          // Status is always "Revoked" — set by the API
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        toast.error(result.message || "Sign up failed.");
        return;
      }
      setDone(true);
    } catch {
      toast.error("An error occurred. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSignUp = async () => {
    setGoogleLoading(true);
    try {
      // Redirect to Google OAuth — adjust provider name if using NextAuth
      window.location.href = "/api/auth/signin/google?callbackUrl=/pending-approval";
    } catch {
      toast.error("Google sign-up failed.");
      setGoogleLoading(false);
    }
  };

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(6px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div
        className="clay-card relative w-full max-w-lg rounded-[2.5rem] overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        style={{ maxHeight: "90vh", overflowY: "auto" }}
      >
        {/* Close */}
        <button
          onClick={handleClose}
          className="absolute top-5 right-5 z-10 w-9 h-9 rounded-2xl bg-gray-100 flex items-center justify-center text-gray-400 hover:bg-gray-200 hover:text-gray-700 transition-all"
        >
          <X size={16} />
        </button>

        {done ? (
          /* ── Success State ── */
          <div className="flex flex-col items-center text-center p-10 gap-6">
            <div className="w-20 h-20 rounded-[2rem] bg-amber-50 flex items-center justify-center text-amber-500 shadow-inner">
              <Clock size={40} />
            </div>
            <div className="flex flex-col gap-2">
              <h2 className="text-2xl font-bold text-gray-900">Account Submitted!</h2>
              <p className="text-sm text-gray-500 leading-relaxed max-w-xs">
                Your account has been created and is <span className="font-bold text-amber-600">pending admin approval</span>. You'll be able to login once an administrator grants you access.
              </p>
            </div>
            <div className="w-full bg-amber-50 rounded-2xl p-4 flex items-start gap-3 text-left border border-amber-100">
              <CheckCircle2 size={16} className="text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 font-medium leading-relaxed">
                Account created for <span className="font-black">{form.Email}</span>. Contact your administrator to activate your account.
              </p>
            </div>
            <button
              onClick={handleClose}
              className="clay-btn w-full rounded-2xl py-3.5 text-sm font-bold bg-[var(--brand-primary)] text-white transition-all active:scale-[0.98]"
            >
              Back to Login
            </button>
          </div>
        ) : (
          /* ── Sign Up Form ── */
          <>
            {/* Header */}
            <div className="px-8 pt-8 pb-0">
              <div className="mb-6">
                <h2 className="text-2xl font-bold text-gray-900 mb-1">Create Account</h2>
                <p className="text-sm text-gray-400">
                  Your account will be reviewed by an admin before you can log in.
                </p>
              </div>

              {/* Google Sign Up */}
              <button
                type="button"
                onClick={handleGoogleSignUp}
                disabled={googleLoading || submitting}
                className="w-full flex items-center justify-center gap-3 rounded-2xl border border-gray-200 bg-white py-3.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed mb-5"
              >
                {googleLoading ? (
                  <span className="w-4 h-4 border-2 border-gray-200 border-t-brand-primary rounded-full animate-spin" />
                ) : (
                  <GoogleIcon size={18} />
                )}
                Continue with Google
              </button>

              {/* Divider */}
              <div className="relative flex items-center mb-5">
                <span className="flex-1 border-t border-gray-100" />
                <span className="px-3 text-[11px] font-bold text-gray-300 uppercase tracking-widest">
                  or sign up with email
                </span>
                <span className="flex-1 border-t border-gray-100" />
              </div>
            </div>

            {/* Form body */}
            <form onSubmit={handleSubmit}>
              <div className="px-8 pb-4 flex flex-col gap-4">

                {/* Name row */}
                <div className="grid grid-cols-2 gap-3">
                  <Field icon={<User size={14} />} label="First Name">
                    <input
                      name="Firstname" value={form.Firstname} onChange={handleChange}
                      required placeholder="Juan"
                      className="field-input"
                    />
                  </Field>
                  <Field icon={<User size={14} />} label="Last Name">
                    <input
                      name="Lastname" value={form.Lastname} onChange={handleChange}
                      required placeholder="Dela Cruz"
                      className="field-input"
                    />
                  </Field>
                </div>

                {/* Email */}
                <Field icon={<Mail size={14} />} label="Email Address">
                  <input
                    name="Email" type="email" value={form.Email} onChange={handleChange}
                    required placeholder="juan@company.com"
                    className="field-input"
                  />
                </Field>

                {/* Password row */}
                <div className="grid grid-cols-2 gap-3">
                  <Field icon={<Lock size={14} />} label="Password">
                    <div className="relative">
                      <input
                        name="Password" type={showPass ? "text" : "password"}
                        value={form.Password} onChange={handleChange}
                        required placeholder="Min. 6 chars"
                        className="field-input pr-10"
                      />
                      <button
                        type="button" tabIndex={-1}
                        onClick={() => setShowPass(p => !p)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500"
                      >
                        {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </Field>
                  <Field icon={<Lock size={14} />} label="Confirm Password">
                    <input
                      name="ConfirmPassword" type="password"
                      value={form.ConfirmPassword} onChange={handleChange}
                      required placeholder="Repeat password"
                      className="field-input"
                    />
                  </Field>
                </div>

                {/* Department & Company */}
                <div className="grid grid-cols-2 gap-3">
                  <Field icon={<Building2 size={14} />} label="Department">
                    <input
                      name="Department" value={form.Department} onChange={handleChange}
                      required placeholder="e.g. Sales"
                      className="field-input"
                    />
                  </Field>
                  <Field icon={<Briefcase size={14} />} label="Company (optional)">
                    <input
                      name="Company" value={form.Company} onChange={handleChange}
                      placeholder="e.g. Biolog Inc."
                      className="field-input"
                    />
                  </Field>
                </div>

                {/* Reference ID */}
                <Field icon={<Hash size={14} />} label="Reference / Employee ID">
                  <input
                    name="ReferenceID" value={form.ReferenceID} onChange={handleChange}
                    required placeholder="e.g. EMP-2024-001"
                    className="field-input"
                  />
                </Field>

                {/* Notice */}
                <div className="flex items-start gap-2.5 bg-amber-50 rounded-2xl p-3.5 border border-amber-100 mt-1">
                  <Clock size={14} className="text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-amber-700 leading-relaxed font-medium">
                    New accounts are <span className="font-black">pending by default</span>. An administrator must approve your account before you can log in.
                  </p>
                </div>
              </div>

              {/* Footer */}
              <div className="px-8 py-6 bg-gray-50 border-t border-gray-100 flex gap-3 mt-2">
                <button
                  type="button" onClick={handleClose}
                  className="flex-1 rounded-2xl py-3.5 text-sm font-bold text-gray-500 bg-white border border-gray-200 hover:bg-gray-100 transition-all active:scale-[0.98]"
                >
                  Cancel
                </button>
                <button
                  type="submit" disabled={submitting}
                  className="clay-btn flex-1 rounded-2xl py-3.5 text-sm font-bold text-white bg-[var(--brand-primary)] transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {submitting ? (
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>Create Account <ChevronRight size={15} /></>
                  )}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   FIELD WRAPPER (small helper)
───────────────────────────────────────────── */
function Field({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center gap-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">
        <span className="text-gray-300">{icon}</span>
        {label}
      </label>
      <style jsx>{`
        :global(.field-input) {
          width: 100%;
          border-radius: 1rem;
          border: 1px solid #f0f0f0;
          background: #fafafa;
          padding: 0.75rem 1rem;
          font-size: 0.8125rem;
          color: #111;
          outline: none;
          transition: all 0.15s;
        }
        :global(.field-input::placeholder) { color: #ccc; }
        :global(.field-input:focus) {
          border-color: var(--brand-primary);
          background: white;
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand-primary) 10%, transparent);
        }
      `}</style>
      {children}
    </div>
  );
}

/* ─────────────────────────────────────────────
   LOGIN FORM  (original + signup button)
───────────────────────────────────────────── */
export function LoginForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const [Email, setEmail] = useState("");
  const [Password, setPassword] = useState("");

  const [otp, setOtp] = useState("");
  const [twoFactorRequired, setTwoFactorRequired] = useState(false);
  const [loading, setLoading] = useState(false);
  const [biometricLoading, setBiometricLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [settings, setSettings] = useState<any>(null);
  const [signUpOpen, setSignUpOpen] = useState(false);
  const [googleLoginLoading, setGoogleLoginLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const syncOnlineState = () => {
      setIsOnline(navigator.onLine);
    };

    syncOnlineState();
    window.addEventListener("online", syncOnlineState);
    window.addEventListener("offline", syncOnlineState);

    return () => {
      window.removeEventListener("online", syncOnlineState);
      window.removeEventListener("offline", syncOnlineState);
    };
  }, []);

  React.useEffect(() => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      // Offline branch: load branding from localStorage cache
      const raw = localStorage.getItem("acculog_settings_cache");
      if (raw) {
        try {
          const cached = JSON.parse(raw);
          setSettings(cached);
          if (cached.themeColor) {
            document.documentElement.setAttribute("data-theme", cached.themeColor);
          }
        } catch {
          // Corrupted cache — silently ignore; default logo/styles apply via built-in fallbacks
        }
      }
      // If no cache found, return without error — built-in fallbacks handle rendering
      return;
    }

    fetch("/api/admin/settings")
      .then(r => r.json())
      .then(data => {
        setSettings(data);
        localStorage.setItem("acculog_settings_cache", JSON.stringify(data));
        if (data.themeColor) {
          document.documentElement.setAttribute("data-theme", data.themeColor);
        }
      })
      .catch(() => {});
  }, []);

  function getDeviceId() {
    let deviceId = localStorage.getItem("deviceId");
    if (!deviceId) {
      deviceId = uuidv4();
      localStorage.setItem("deviceId", deviceId);
    }
    return deviceId;
  }

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      let deviceId = getDeviceId();
      e.preventDefault();
      if (!Email || !Password) {
        toast.error("Email and Password are required!");
        return;
      }
      setLoading(true);

      // Fast-path: if browser knows we're offline, skip the network round-trip
      // and verify directly against the local cache.
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        const { verifyOfflineCredential } = await import("@/lib/offline-auth");
        const offlineResult = await verifyOfflineCredential({
          email:      Email,
          secret:     Password,
          isPinLogin: false,
        });
        if (offlineResult) {
          // ── Set session start time for session timeout hook ──────────────────────
          localStorage.setItem("acculog_session_start", Date.now().toString());
          
          // ── Store userId in localStorage for future visits ───────────────────────
          localStorage.setItem("userId", offlineResult.userId);
          
          // Persist offline session so protected pages stay accessible
          try {
            const { setOfflineSession } = await import("@/lib/offline-auth");
            await setOfflineSession(offlineResult.userId);
          } catch { /* silent */ }
          toast.success("Offline login — using cached credentials.");
          setTimeout(() => {
            router.push(`/activity-planner?id=${encodeURIComponent(offlineResult.userId)}`);
          }, 600);
        } else {
          toast.error("You are offline and these credentials are not cached.");
        }
        setLoading(false);
        return;
      }

      try {
        const res = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include", // Important: receive cookies in response!
          body: JSON.stringify({
            Email,
            Password,
            deviceId, otp,
          }),
        });
        const result = await res.json();

        if (res.ok && result.twoFactorRequired) {
          setTwoFactorRequired(true);
          toast.info("Verification code sent to your email.");
          return;
        }

        if (res.ok && result.userId) {
          console.log("[LoginForm] Login successful! userId:", result.userId);
          
          // ── Store userId in localStorage for future visits ───────────────────────
          localStorage.setItem("userId", result.userId);
          console.log("[LoginForm] Set userId in localStorage:", result.userId);
          
          // ── Set session start time for session timeout hook ──────────────────────
          localStorage.setItem("acculog_session_start", Date.now().toString());
          console.log("[LoginForm] Set acculog_session_start in localStorage");
          
          // ── Cache credentials for offline login ──────────────────────────
          let cached = false;
          try {
            const { cacheCredential, setOfflineSession } = await import("@/lib/offline-auth");
            await cacheCredential({
              email:      Email,
              secret:     Password,
              isPinLogin: false,
              userId:     result.userId,
            });
            await setOfflineSession(result.userId);
            console.log("[LoginForm] Offline credentials cached successfully");
            cached = true;
          } catch (cacheErr) {
            // Log so we can debug — but don't block login
            console.warn("[offline-auth] cacheCredential failed:", cacheErr);
          }

          toast.success(
            cached
              ? "Login successful! Credentials saved for offline use."
              : "Login successful! (Offline cache unavailable on this device)"
          );
          console.log("[LoginForm] About to redirect to activity-planner...");
          setTimeout(() => {
            router.push(`/activity-planner?id=${encodeURIComponent(result.userId)}`);
          }, 800);
        } else {
          toast.error(result.message || "Login failed!");
        }
      } catch {
        // Network failed mid-request — try the offline cache as a fallback.
        try {
          const { verifyOfflineCredential } = await import("@/lib/offline-auth");
          const offlineResult = await verifyOfflineCredential({
            email:      Email,
            secret:     Password,
            isPinLogin: false,
          });
          if (offlineResult) {
            // ── Set session start time for session timeout hook ──────────────────────
            localStorage.setItem("acculog_session_start", Date.now().toString());
            
            // ── Store userId in localStorage for future visits ───────────────────────
            localStorage.setItem("userId", offlineResult.userId);
            
            // Persist offline session so protected pages stay accessible
            try {
              const { setOfflineSession } = await import("@/lib/offline-auth");
              await setOfflineSession(offlineResult.userId);
            } catch { /* silent */ }
            toast.success("Offline login — using cached credentials.");
            setTimeout(() => {
              router.push(`/activity-planner?id=${encodeURIComponent(offlineResult.userId)}`);
            }, 600);
            return;
          }
        } catch { /* silent */ }
        toast.error("Connection error. Please check your internet and try again.");
      } finally {
        setLoading(false);
      }
    },
    [Email, Password, otp, router]
  );

  const handleBiometricLogin = useCallback(async () => {
    // Biometric login requires internet - check first
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      toast.error("Biometric login requires internet. Please use Email/Password to login offline.");
      return;
    }
    
    setBiometricLoading(true);
    let deviceId = getDeviceId();
    try {
      const challenge = new Uint8Array(32);
      window.crypto.getRandomValues(challenge);
      const credential = await navigator.credentials.get({
        publicKey: { 
          challenge, 
          rpId: window.location.hostname, 
          userVerification: "required",
        },
      }) as any;
      if (!credential) throw new Error("Biometric authentication failed.");
      console.log("Biometric credential obtained:", credential);
      const response = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include", // Important: receive cookies in response!
          body: JSON.stringify({ credentialId: credential.id, deviceId }),
        });
      const result = await response.json();
      console.log("Login API response:", result);
      if (response.ok && result.userId) {
        // ── Set session start time for session timeout hook ──────────────────────
        localStorage.setItem("acculog_session_start", Date.now().toString());
        
        // ── Store userId in localStorage for future visits ───────────────────────
        localStorage.setItem("userId", result.userId);
        
        // Store offline session for protected page access
        const { setOfflineSession } = await import("@/lib/offline-auth");
        await setOfflineSession(result.userId).catch(() => {});
        toast.success("Biometric login successful!");
        setTimeout(() => {
          router.push(`/activity-planner?id=${encodeURIComponent(result.userId)}`);
        }, 800);
      } else {
        toast.error(result.message || "Biometric login failed!");
      }
    } catch (err: any) {
      console.error("Biometric login error:", err);
      if (err.name !== "NotAllowedError") toast.error(err.message || "An error occurred during biometric login.");
    } finally {
      setBiometricLoading(false);
    }
  }, [router]);

  return (
    <>
      {/* ── Sign Up Dialog ── */}
      <SignUpDialog open={signUpOpen} onClose={() => setSignUpOpen(false)} />

      <div className={cn("min-h-screen w-full flex", className)} {...props}>

        {/* ── Left Panel — Branding ── */}
        <div
          className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 relative overflow-hidden"
          style={{ background: "linear-gradient(145deg, var(--brand-primary) 0%, var(--brand-primary-hover) 60%, #4A0608 100%)" }}
        >
          <div className="absolute -top-20 -right-20 w-80 h-80 rounded-full bg-white/[0.04] pointer-events-none" />
          <div className="absolute top-1/3 -left-16 w-64 h-64 rounded-full bg-white/[0.03] pointer-events-none" />
          <div className="absolute -bottom-24 right-16 w-96 h-96 rounded-full bg-white/[0.03] pointer-events-none" />

          <div className="relative z-10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white rounded-2xl flex items-center justify-center shadow-lg overflow-hidden">
                {settings?.logoUrl ? (
                  <img src={settings.logoUrl} alt="Logo" className="w-full h-full object-contain p-1" />
                ) : (
                  <svg width="22" height="22" viewBox="0 0 18 18" fill="none">
                    <rect x="2" y="8" width="14" height="2" rx="1" fill="var(--brand-primary)" />
                    <rect x="2" y="4" width="9" height="2" rx="1" fill="var(--brand-primary)" />
                    <rect x="2" y="12" width="11" height="2" rx="1" fill="var(--brand-primary)" />
                  </svg>
                )}
              </div>
              <span className="text-white text-[16px] font-bold tracking-[0.1em]">BIOLOG</span>
            </div>
          </div>

          <div className="relative z-10 flex-1 flex flex-col justify-center py-16">
            <div className="mb-8">
              <div className="inline-flex items-center gap-2 bg-white/15 rounded-full px-4 py-2 mb-6">
                <Shield size={13} className="text-white/80" />
                <span className="text-white/80 text-[12px] font-medium tracking-wide">Secure Time Tracking</span>
              </div>
              <h2 className="text-white text-[40px] font-bold leading-[1.1] mb-5">
                Track time.<br />
                Stay on field.<br />
                <span className="text-white/50">Stay accountable.</span>
              </h2>
              <p className="text-white/55 text-[15px] leading-relaxed max-w-sm">
                A unified platform for field attendance, site visits, and timesheet management — built for your team's daily operations.
              </p>
            </div>
            <div className="flex flex-col gap-3">
              {[
                { label: "Real-time GPS tracking", sub: "Know where your team is" },
                { label: "Client visit logs", sub: "Track every site interaction" },
                { label: "Automated timesheets", sub: "Hours calculated automatically" },
              ].map((f) => (
                <div key={f.label} className="flex items-center gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-white/40 flex-shrink-0" />
                  <div>
                    <span className="text-white text-[13px] font-semibold">{f.label} </span>
                    <span className="text-white/45 text-[13px]">— {f.sub}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="relative z-10">
            <p className="text-white/30 text-[11px] tracking-wider">
              © {new Date().getFullYear()} BIOLOG · Time Tracker Activity
            </p>
          </div>
        </div>

        {/* ── Right Panel — Login Form ── */}
        <div className="flex-1 flex flex-col items-center justify-center clay-bg px-6 py-12 relative">

          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-2 mb-10">
            <div className="w-8 h-8 bg-[var(--brand-primary)] rounded-xl flex items-center justify-center overflow-hidden">
              {settings?.logoUrl ? (
                <img src={settings.logoUrl} alt="Logo" className="w-full h-full object-contain p-1" />
              ) : (
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <rect x="2" y="8" width="14" height="2" rx="1" fill="white" />
                  <rect x="2" y="4" width="9" height="2" rx="1" fill="white" />
                  <rect x="2" y="12" width="11" height="2" rx="1" fill="white" />
                </svg>
              )}
            </div>
            <span className="text-[var(--brand-primary)] text-[15px] font-bold tracking-[0.1em]">BIOLOG</span>
          </div>

          <div className="w-full max-w-sm">

            {/* Heading */}
            <div className="mb-8 flex items-start justify-between">
              <div>
                <h1 className="text-[28px] font-bold text-gray-900 mb-2 leading-tight">Welcome back</h1>
                <p className="text-[14px] text-gray-400 leading-relaxed">
                  Sign in to your account to continue tracking your field activity.
                </p>
              </div>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">

              {/* Email */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="email" className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest">
                  Email Address
                </label>
                <input
                  id="email" type="email" value={Email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@acculog.com"
                  required autoComplete="email" disabled={loading}
                  className="w-full clay-card px-4 py-3.5 text-[14px] text-gray-900 placeholder:text-gray-300 outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/10 transition-all"
                />
              </div>

              {/* OTP (2FA) */}
              {twoFactorRequired && (
                <div className="flex flex-col gap-1.5 animate-in fade-in slide-in-from-top-2 duration-300">
                  <label htmlFor="otp" className="text-[11px] font-bold text-brand-primary uppercase tracking-widest flex items-center gap-2">
                    <Shield size={12} /> Verification Code
                  </label>
                  <input
                    id="otp" type="text" maxLength={6}
                    value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                    placeholder="Enter 6-digit code" required disabled={loading}
                    className="w-full clay-card px-4 py-3.5 text-center text-[20px] font-bold tracking-[8px] text-gray-900 placeholder:text-gray-300 placeholder:tracking-normal outline-none focus:ring-4 focus:ring-[var(--brand-primary)]/5 transition-all"
                  />
                  <p className="text-[11px] text-gray-400 text-center">Enter 6-digit code from authenticator app</p>
                </div>
              )}

              {/* Password */}
              {!twoFactorRequired && (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="password" className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      id="password" type={showPassword ? "text" : "password"}
                      value={Password} onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password" required autoComplete="current-password" disabled={loading}
                      className="w-full clay-card px-4 py-3.5 pr-12 text-[14px] text-gray-900 placeholder:text-gray-300 outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/10 transition-all"
                    />
                    <button
                      type="button" tabIndex={-1}
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500 transition-colors"
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
              )}

              {/* Submit */}
              <button
                type="submit" disabled={loading || biometricLoading}
                className={[
                  "mt-2 w-full rounded-2xl py-4 text-[15px] font-semibold flex items-center justify-center gap-2 transition-all",
                  loading || biometricLoading
                    ? "bg-gray-100 text-gray-300 cursor-not-allowed" :"clay-btn bg-[var(--brand-primary)] text-white active:scale-[0.98]",
                ].join(" ")}
              >
                {loading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {twoFactorRequired ? "Verifying..." : "Signing in..."}
                  </>
                ) : (
                  <>{twoFactorRequired ? "Complete Sign In" : "Sign In"}<ArrowRight size={16} /></>
                )}
              </button>

              {/* Back from 2FA */}
              {twoFactorRequired && (
                <button
                  type="button"
                  onClick={() => { setTwoFactorRequired(false); setOtp(""); }}
                  className="text-[12px] font-semibold text-gray-400 hover:text-gray-600 transition-colors"
                >
                  ← Back to Password
                </button>
              )}

              {/* Biometric + Sign Up */}
              {!twoFactorRequired && (
                <>
                  {!isOnline ? (
                    <div
                      className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800"
                      data-testid="offline-login-note"
                    >
                      Offline mode: Email and password login stays available when this device has cached credentials. Network-only sign-in options are disabled.
                    </div>
                  ) : null}
                  <div className="relative my-2">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t border-gray-100" />
                    </div>
                    <div className="relative flex justify-center text-[11px] uppercase tracking-widest">
                      <span className="bg-[#F9F6F4] px-3 text-gray-300 font-semibold">Or</span>
                    </div>
                  </div>

                  {/* ── Google Login ── */}
                  <button
                    type="button"
                    onClick={() => {
                      setGoogleLoginLoading(true);
                      window.location.href = "/api/auth/google";
                    }}
                    disabled={loading || biometricLoading || googleLoginLoading || !isOnline}
                    className={[
                      "w-full rounded-2xl py-4 text-[15px] font-semibold flex items-center justify-center gap-2 transition-all border border-gray-200",
                      loading || biometricLoading || googleLoginLoading || !isOnline
                        ? "bg-gray-50 text-gray-300 cursor-not-allowed" :"clay-card bg-white text-gray-700 active:scale-[0.98]",
                    ].join(" ")}
                  >
                    {googleLoginLoading ? (
                      <>
                        <span className="w-4 h-4 border-2 border-gray-200 border-t-brand-primary rounded-full animate-spin" />
                        Redirecting...
                      </>
                    ) : (
                      <><GoogleIcon size={18} />Continue with Google</>
                    )}
                  </button>

                  {/* ── Biometric ── */}
                  <button
                    type="button" onClick={handleBiometricLogin}
                    disabled={loading || biometricLoading || googleLoginLoading || !isOnline}
                    className={[
                      "w-full rounded-2xl py-4 text-[15px] font-semibold flex items-center justify-center gap-2 transition-all border border-gray-200",
                      loading || biometricLoading || googleLoginLoading || !isOnline
                        ? "bg-gray-50 text-gray-300 cursor-not-allowed" :"clay-card bg-white text-gray-700 active:scale-[0.98]",
                    ].join(" ")}
                  >
                    {biometricLoading ? (
                      <>
                        <span className="w-4 h-4 border-2 border-gray-200 border-t-brand-primary rounded-full animate-spin" />
                        Verifying...
                      </>
                    ) : (
                      <><Fingerprint size={18} className="text-brand-primary" />Login with Fingerprint</>
                    )}
                  </button>
                  <p className="text-[11px] text-gray-400 text-center -mt-1">
                    Fingerprint login requires internet. Use Email/Password when offline.
                  </p>

                  {/* ── SIGN UP BUTTON ── */}
                  <div className="flex items-center justify-center gap-2 mt-2">
                    <span className="text-[13px] text-gray-400">Don't have an account?</span>
                    <button
                      type="button"
                      onClick={() => setSignUpOpen(true)}
                      disabled={!isOnline}
                      className="text-[13px] font-bold text-brand-primary hover:underline flex items-center gap-1 transition-all disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
                    >
                      <UserPlus size={13} /> Sign Up
                    </button>
                  </div>
                </>
              )}
            </form>

            {/* Security note */}
            <div className="mt-6 flex items-center gap-2 justify-center">
              <Shield size={12} className="text-gray-300" />
              <p className="text-[11px] text-gray-400 text-center">
                Your session is secured with device authentication
              </p>
            </div>
          </div>

          {/* Mobile footer */}
          <p className="lg:hidden absolute bottom-6 text-[11px] text-gray-300">
            © {new Date().getFullYear()} Acculog Time Tracker Activity
          </p>
        </div>
      </div>
    </>
  );
}
