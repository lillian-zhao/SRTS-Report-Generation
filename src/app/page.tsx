"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Image from "next/image";

import { tryGenerateTokenInBrowser } from "@/lib/arcgis-browser-token";

type Audit = {
  id: string;
  school: string;
  surveyDate: string;
};

type StreamEvent = {
  type: "status" | "complete" | "error";
  message: string;
  data?: {
    auditContext?: Record<string, string>;
    postAllFields?: Record<string, unknown>;
    [key: string]: unknown;
  };
};

type LayerField = {
  name: string;
  alias?: string;
  type?: string;
};

export default function Home() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pastedToken, setPastedToken] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [tokenExpires, setTokenExpires] = useState<number | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [audits, setAudits] = useState<Audit[]>([]);
  const [selectedAuditId, setSelectedAuditId] = useState("");
  const [isLoadingAudits, setIsLoadingAudits] = useState(false);
  const [auditsError, setAuditsError] = useState<string | null>(null);
  const [isLoadingFields, setIsLoadingFields] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [preFields, setPreFields] = useState<LayerField[]>([]);
  const [postFields, setPostFields] = useState<LayerField[]>([]);

  const [streamMessages, setStreamMessages] = useState<string[]>([]);
  const [, setResultJson] = useState<string | null>(null);
  const [auditContext, setAuditContext] = useState<Record<string, string> | null>(null);
  const [postAllFields, setPostAllFields] = useState<Record<string, unknown> | null>(null);
  const [preAllFields, setPreAllFields] = useState<Record<string, unknown> | null>(null);
  const [recordCounts, setRecordCounts] = useState<{ pre: number; post: number } | null>(null);
  const [, setShowRawFields] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [downloadingType, setDownloadingType] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [previewExpanded, setPreviewExpanded] = useState(true);

  const selectedAudit = useMemo(
    () => audits.find((audit) => audit.id === selectedAuditId),
    [audits, selectedAuditId],
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthToken = params.get("oauthToken");
    const oauthExpires = params.get("oauthExpires");
    const authError = params.get("authError");

    if (authError) {
      setLoginError(authError);
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }

    if (oauthToken) {
      const expiresValue = oauthExpires ? Number(oauthExpires) : null;
      const expires = expiresValue && Number.isFinite(expiresValue) ? expiresValue : null;
      setToken(oauthToken);
      setTokenExpires(expires);
      localStorage.setItem("arcgis_token", oauthToken);
      if (expires) localStorage.setItem("arcgis_token_expires", String(expires));
      window.history.replaceState({}, "", window.location.pathname);
      loadAudits(oauthToken).catch((error) =>
        setLoginError(error instanceof Error ? error.message : "Unable to load audits"),
      );
      return;
    }

    // On page load, restore a saved token and auto-load audits
    const savedToken = localStorage.getItem("arcgis_token");
    const savedExpires = localStorage.getItem("arcgis_token_expires");
    const expiresMs = savedExpires ? Number(savedExpires) : null;
    if (savedToken && (!expiresMs || expiresMs > Date.now())) {
      setToken(savedToken);
      setTokenExpires(expiresMs);
      loadAudits(savedToken).catch((error) =>
        setLoginError(error instanceof Error ? error.message : "Unable to load audits"),
      );
    }
  }, []);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoggingIn(true);
    setLoginError(null);
    setStreamMessages([]);
    setResultJson(null);
    setAuditContext(null);
    setPostAllFields(null);
    setPreAllFields(null);
    setRecordCounts(null);

    try {
      // Prefer token from the browser so ArcGIS sees your network client like a
      // normal sign-in, not the Next.js server.
      const direct = await tryGenerateTokenInBrowser(username, password);
      let accessToken: string;
      let expires: number | null = null;

      if (direct.kind === "success") {
        accessToken = direct.token;
        expires = direct.expires ?? null;
      } else if (direct.kind === "auth") {
        throw new Error(direct.message);
      } else {
        const response = await fetch("/api/arcgis/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });
        const payload = (await response.json()) as {
          token?: string;
          expires?: number;
          error?: string;
        };
        if (!response.ok || !payload.token) {
          throw new Error(
            payload.error ??
              "ArcGIS login failed (browser and server token requests both failed)",
          );
        }
        accessToken = payload.token;
        expires = payload.expires ?? null;
      }

      setToken(accessToken);
      setTokenExpires(expires);
      await loadAudits(accessToken);
    } catch (error) {
      setToken(null);
      setAudits([]);
      setSelectedAuditId("");
      setLoginError(error instanceof Error ? error.message : "Login failed");
    } finally {
      setIsLoggingIn(false);
    }
  }

  async function loadAudits(currentToken: string) {
    setIsLoadingAudits(true);
    setAuditsError(null);
    try {
      const response = await fetch(
        `/api/audits?token=${encodeURIComponent(currentToken)}`,
      );
      const payload = (await response.json()) as {
        audits?: Audit[];
        rawCount?: number;
        error?: string;
      };
      if (!response.ok || !payload.audits) {
        throw new Error(payload.error ?? "Unable to load audits");
      }

      setAudits(payload.audits);
      if (payload.audits.length > 0) {
        setSelectedAuditId(payload.audits[0].id);
      } else {
        const raw = payload.rawCount ?? 0;
        setAuditsError(
          raw === 0
            ? `ArcGIS returned 0 records — token may not have access to the layer, or the layer URL is wrong.`
            : `ArcGIS returned ${raw} records but none had a date field populated. Check ARCGIS_DATE_FIELD config.`,
        );
      }
    } catch (error) {
      setAuditsError(error instanceof Error ? error.message : "Unable to load audits");
    } finally {
      setIsLoadingAudits(false);
    }
  }

  async function handleUsePastedToken() {
    const trimmed = pastedToken.trim();
    if (!trimmed) {
      setLoginError("Paste an ArcGIS token first.");
      return;
    }
    setLoginError(null);
    setStreamMessages([]);
    setResultJson(null);
    setAuditContext(null);
    setPostAllFields(null);
    setPreAllFields(null);
    setRecordCounts(null);
    setToken(trimmed);
    setTokenExpires(null);
    try {
      await loadAudits(trimmed);
    } catch (error) {
      setToken(null);
      setAudits([]);
      setSelectedAuditId("");
      setLoginError(
        error instanceof Error ? error.message : "Token did not work",
      );
    }
  }

  async function loadFieldNames() {
    if (!token) return;
    setIsLoadingFields(true);
    setFieldError(null);
    try {
      const response = await fetch(
        `/api/arcgis/fields?token=${encodeURIComponent(token)}`,
      );
      const payload = (await response.json()) as {
        preFields?: LayerField[];
        postFields?: LayerField[];
        error?: string;
      };
      if (!response.ok || !payload.preFields || !payload.postFields) {
        throw new Error(payload.error ?? "Unable to fetch layer fields");
      }
      setPreFields(payload.preFields);
      setPostFields(payload.postFields);
    } catch (error) {
      setFieldError(
        error instanceof Error ? error.message : "Unable to fetch layer fields",
      );
    } finally {
      setIsLoadingFields(false);
    }
  }

  async function handleDownload(reportType: "domi-internal" | "school-community" | "public-update") {
    if (!token || !selectedAudit) return;
    setDownloadingType(reportType);
    setDownloadError(null);
    try {
      const response = await fetch("/api/report/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          school: selectedAudit.school,
          surveyDate: selectedAudit.surveyDate,
          reportType,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Download failed");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      a.download = match?.[1] ?? "SRTS_Report.docx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "Download failed");
    } finally {
      setDownloadingType(null);
    }
  }

  async function handleGenerate() {
    if (!token || !selectedAudit) {
      return;
    }
    setStreamMessages([]);
    setResultJson(null);
    setAuditContext(null);
    setPostAllFields(null);
    setPreAllFields(null);
    setRecordCounts(null);
    setShowRawFields(false);
    setIsGenerating(true);

    try {
      const response = await fetch("/api/report/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          school: selectedAudit.school,
          surveyDate: selectedAudit.surveyDate,
        }),
      });
      if (!response.ok || !response.body) {
        throw new Error("Unable to start report stream");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const event of events) {
          if (!event.startsWith("data: ")) continue;
          const parsed = JSON.parse(event.slice(6)) as StreamEvent;
          setStreamMessages((existing) => [...existing, parsed.message]);
          if (parsed.type === "complete" && parsed.data) {
            setResultJson(JSON.stringify(parsed.data, null, 2));
            if (parsed.data.auditContext) setAuditContext(parsed.data.auditContext as Record<string, string>);
            if (parsed.data.postAllFields) setPostAllFields(parsed.data.postAllFields as Record<string, unknown>);
            if (parsed.data.preAllFields) setPreAllFields(parsed.data.preAllFields as Record<string, unknown>);
            const counts = (parsed.data.counts as { preFeatures?: number; postFeatures?: number }) ?? {};
            setRecordCounts({ pre: counts.preFeatures ?? 0, post: counts.postFeatures ?? 0 });
          }
          if (parsed.type === "error") {
            throw new Error(parsed.message);
          }
        }
      }
    } catch (error) {
      setStreamMessages((existing) => [
        ...existing,
        error instanceof Error ? error.message : "Report generation failed",
      ]);
    } finally {
      setIsGenerating(false);
    }
  }

  const isLoggedIn = !!token;
  const hasAudits = audits.length > 0;

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="mx-auto max-w-4xl flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Image src="/logo.png" alt="SRTS Pittsburgh logo" width={52} height={52} className="shrink-0" />
            <div>
              <h1 className="text-xl font-bold text-gray-900">SRTS Report Builder</h1>
              <p className="text-sm text-gray-500">Safe Routes to School · Pittsburgh</p>
            </div>
          </div>
          {isLoggedIn && (
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5 text-sm text-emerald-700 font-medium">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/></svg>
                Signed in
              </span>
              <button
                type="button"
                className="text-sm text-gray-400 hover:text-gray-600 underline"
                onClick={() => {
                  localStorage.removeItem("arcgis_token");
                  localStorage.removeItem("arcgis_token_expires");
                  setToken(null);
                  setTokenExpires(null);
                  setAudits([]);
                  setSelectedAuditId("");
                }}
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-6 py-10 flex flex-col gap-10">
      {/* ── How it works ── */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-400 mb-4">How it works</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          {[
            { step: "1", icon: "🔑", title: "Sign In", desc: "Authenticate with your ArcGIS Pittsburgh account to access survey data." },
            { step: "2", icon: "📋", title: "Select an Audit", desc: "Choose the walkability audit you want to generate a report for." },
            { step: "3", icon: "🔍", title: "Preview Data", desc: "Review the survey responses that will be used to generate your report." },
            { step: "4", icon: "⬇", title: "Download Report", desc: "Generate and download an AI-written report tailored to your audience." },
          ].map(({ step, icon, title, desc }) => (
            <div key={step} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-3 mb-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">{step}</span>
                <span className="text-lg">{icon}</span>
              </div>
              <p className="font-semibold text-gray-900">{title}</p>
              <p className="mt-1 text-sm text-gray-500">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Step 1: Sign In ── */}
      <section className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center gap-3 border-b border-gray-100 px-6 py-4">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">1</span>
          <h2 className="text-lg font-semibold text-gray-900">Sign In</h2>
          {isLoggedIn && (
            <span className="ml-auto flex items-center gap-1.5 text-sm font-medium text-emerald-600">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/></svg>
              Signed in
            </span>
          )}
        </div>
        <div className="px-6 py-8">
          {!isLoggedIn ? (
            <div className="flex flex-col items-start gap-4">
              <p className="text-gray-600 max-w-md">
                Use your Pittsburgh ArcGIS organization account to sign in. This gives the app permission to read your survey data.
              </p>
              <a
                href="/api/arcgis/oauth/start"
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-3 text-base font-semibold text-white shadow-sm hover:bg-blue-700 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" /></svg>
                Sign in with ArcGIS
              </a>
              {loginError && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{loginError}</p>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3 rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3">
                <svg className="w-5 h-5 text-emerald-600 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/></svg>
                <p className="text-sm text-emerald-800 font-medium">
                  You&apos;re signed in.{tokenExpires ? ` Session valid until ${new Date(tokenExpires).toLocaleTimeString()}.` : ""}
                </p>
              </div>
              {!hasAudits && (
                <div>
                  <p className="text-gray-600 mb-3">Click below to load your available audits.</p>
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed transition-colors"
                    disabled={isLoadingAudits}
                    onClick={() => loadAudits(token!)}
                  >
                    {isLoadingAudits ? (
                      <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg> Loading audits…</>
                    ) : "Load Audits"}
                  </button>
                  {auditsError && (
                    <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{auditsError}</p>
                  )}
                </div>
              )}
              {hasAudits && (
                <p className="text-sm text-emerald-700 font-medium">
                  ✓ {audits.length} audit{audits.length !== 1 ? "s" : ""} loaded — scroll down to select one.
                </p>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ── Step 2: Select Audit ── */}
      <section className={`rounded-2xl border bg-white shadow-sm overflow-hidden transition-opacity ${!isLoggedIn ? "opacity-40 pointer-events-none" : "border-gray-200"}`}>
        <div className="flex items-center gap-3 border-b border-gray-100 px-6 py-4">
          <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white ${isLoggedIn ? "bg-blue-600" : "bg-gray-300"}`}>2</span>
          <h2 className="text-lg font-semibold text-gray-900">Select an Audit</h2>
          {selectedAudit && (
            <span className="ml-auto flex items-center gap-1.5 text-sm font-medium text-emerald-600">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/></svg>
              Audit selected
            </span>
          )}
        </div>
        <div className="px-6 py-8">
          {!isLoggedIn ? (
            <p className="text-gray-400 italic">Complete Step 1 first.</p>
          ) : !hasAudits ? (
            <p className="text-gray-500">Load your audits in Step 1 to continue.</p>
          ) : (
            <div className="flex flex-col gap-4 max-w-lg">
              <div className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-2.5">
                <svg className="w-4 h-4 text-emerald-600 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/></svg>
                <p className="text-sm text-emerald-800 font-medium">{audits.length} audit{audits.length !== 1 ? "s" : ""} loaded</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Choose an audit</label>
                <select
                  className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-base text-gray-900 shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  value={selectedAuditId}
                  onChange={(event) => setSelectedAuditId(event.target.value)}
                >
                  <option value="">— Select an audit —</option>
                  {audits.map((audit) => {
                    const epochMs = Number(audit.surveyDate);
                    const displayDate =
                      Number.isFinite(epochMs) && epochMs > 1_000_000_000_000
                        ? new Date(epochMs).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
                        : audit.surveyDate;
                    return (
                      <option key={audit.id} value={audit.id}>
                        {audit.school} — {displayDate}
                      </option>
                    );
                  })}
                </select>
              </div>
              {selectedAudit && (
                <p className="text-sm text-emerald-700 font-medium">✓ Selected — scroll down to preview your data.</p>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ── Preview Survey Data ── */}
      {selectedAudit && (
        <section className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-6 py-4">
            <div className="flex items-center gap-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white shrink-0">3</span>
              <span className="text-xl">🔍</span>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Preview Survey Data</h2>
                <p className="text-sm text-gray-500">Verify the data that will be used to generate your report.</p>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {!auditContext && (
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-lg bg-gray-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  disabled={isGenerating}
                  onClick={handleGenerate}
                >
                  {isGenerating ? (
                    <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg> Loading…</>
                  ) : "Load Preview"}
                </button>
              )}
              {auditContext && (
                <button
                  type="button"
                  className="text-sm text-gray-400 hover:text-gray-600 underline"
                  onClick={handleGenerate}
                >
                  Refresh
                </button>
              )}
              {auditContext && (
                <button
                  type="button"
                  className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50 transition-colors"
                  onClick={() => setPreviewExpanded((v) => !v)}
                >
                  {previewExpanded ? (
                    <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7"/></svg> Collapse</>
                  ) : (
                    <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/></svg> Expand</>
                  )}
                </button>
              )}
            </div>
          </div>

          <div className={previewExpanded ? "px-6 py-6" : "hidden"}>
            {!auditContext && !isGenerating && (
              <p className="text-gray-500 text-sm">Click <strong>Load Preview</strong> to fetch and display the survey responses for this audit.</p>
            )}
            {isGenerating && (
              <div className="flex items-center gap-3 text-gray-500">
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                <span className="text-sm">
                  {streamMessages.length > 0 ? streamMessages[streamMessages.length - 1] : "Fetching survey data…"}
                </span>
              </div>
            )}
            {auditContext && (
              <div className="flex flex-col gap-6">
                {(
                  [
                    {
                      heading: "Audit Overview",
                      icon: "📅",
                      fields: [
                        { key: "school", label: "School" },
                        { key: "address", label: "Address" },
                        { key: "dateDisplay", label: "Date" },
                        { key: "time", label: "Time" },
                        { key: "weather", label: "Weather" },
                        { key: "coordinator", label: "Lead Coordinator" },
                        { key: "schoolContact", label: "School Contact" },
                        { key: "initiatedBy", label: "Audit Initiated By" },
                        { key: "previousAudit", label: "Previously Audited" },
                        { key: "participantsPresent", label: "All Participants Present" },
                        { key: "participantsMissing", label: "Missing Participants" },
                        { key: "routeDescription", label: "Route Description" },
                        { key: "preExistingConcerns", label: "Pre-existing Concerns" },
                      ],
                    },
                    {
                      heading: "Student Travel Modes",
                      icon: "🚶",
                      fields: [
                        { key: "modeWalk", label: "Walk" },
                        { key: "modeBike", label: "Bike" },
                        { key: "modeTransit", label: "Public Transit" },
                        { key: "modeBus", label: "School Bus" },
                        { key: "modeDropOff", label: "Dropped Off" },
                        { key: "studentCount", label: "Total Enrollment" },
                        { key: "designatedRoutes", label: "Designated Walking Routes" },
                        { key: "designatedRouteDetails", label: "Route Details" },
                        { key: "mainConcerns", label: "Main Concerns Before Audit" },
                        { key: "landmarks", label: "Notable Landmarks" },
                        { key: "parentConcerns", label: "Parent/Student Concerns Reported" },
                        { key: "parentConcernDetails", label: "Concern Details" },
                      ],
                    },
                    {
                      heading: "Infrastructure Findings",
                      icon: "🏗️",
                      fields: [
                        { key: "adaSignage", label: "ADA-Compliant Signage" },
                        { key: "vegetationBlocking", label: "Vegetation Blocking Sidewalks" },
                        { key: "poolingWater", label: "Pooling Water at Curb Ramps" },
                        { key: "immediateHazards", label: "Immediate Hazards" },
                        { key: "trippingHazards", label: "Tripping Hazards (>1 inch)" },
                        { key: "sidewalkGaps", label: "Critical Sidewalk Gaps" },
                        { key: "grantOpportunities", label: "Grant Opportunities" },
                        { key: "grantDetails", label: "Grant Details" },
                        { key: "nearbyConstruction", label: "Nearby Construction" },
                        { key: "constructionDetails", label: "Construction Details" },
                        { key: "additionalInfrastructureNotes", label: "Additional Notes" },
                      ],
                    },
                    {
                      heading: "Traffic & Safety Findings",
                      icon: "🚦",
                      fields: [
                        { key: "conflictingSignage", label: "Conflicting/Unclear Signage" },
                        { key: "wayfinding", label: "Wayfinding Signage Present" },
                        { key: "wayfindingLocations", label: "Suggested Wayfinding Locations" },
                        { key: "trafficConditions", label: "Peak vs. Non-Peak Traffic Difference" },
                        { key: "crashHistory", label: "Known Crash History" },
                        { key: "crashDetails", label: "Crash Details" },
                        { key: "crosswalks", label: "Crosswalks Visible & Maintained" },
                        { key: "vehicleSpeeds", label: "Vehicle Speeds Appropriate" },
                        { key: "crossingGuard", label: "Crossing Guard Present" },
                        { key: "schoolZoneSigns", label: "School Zone Signs Visible" },
                        { key: "dropOffConflict", label: "Drop-Off Zone Pedestrian Conflict" },
                        { key: "pedestrianGenerators", label: "Pedestrian Generators Along Route" },
                        { key: "pedestrianGeneratorDetails", label: "Generator Details" },
                        { key: "additionalTrafficNotes", label: "Additional Notes" },
                      ],
                    },
                    {
                      heading: "Summary",
                      icon: "📋",
                      fields: [
                        { key: "topConcern1", label: "Top Concern #1" },
                        { key: "topConcern2", label: "Top Concern #2" },
                        { key: "topConcern3", label: "Top Concern #3" },
                        { key: "overallSeverity", label: "Overall Severity" },
                        { key: "safetyRating", label: "Student Safety Rating" },
                        { key: "comfortableLetChild", label: "Comfortable Letting Child Walk Alone" },
                        { key: "comfortDetails", label: "Details" },
                        { key: "additionalNotes", label: "Additional Notes" },
                        { key: "additionalComments", label: "Additional Comments" },
                      ],
                    },
                  ] as { heading: string; icon: string; fields: { key: string; label: string }[] }[]
                ).map(({ heading, icon, fields }) => {
                  const populated = fields.filter((f) => auditContext[f.key]?.trim());
                  if (populated.length === 0) return null;
                  return (
                    <div key={heading}>
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-base">{icon}</span>
                        <h3 className="font-semibold text-gray-800">{heading}</h3>
                        <span className="text-xs text-gray-400">{populated.length} field{populated.length !== 1 ? "s" : ""}</span>
                      </div>
                      <div className="rounded-xl border border-gray-200 overflow-hidden">
                        {populated.map((f, i) => (
                          <div key={f.key} className={`flex gap-4 px-4 py-3 ${i % 2 === 0 ? "bg-white" : "bg-gray-50"}`}>
                            <span className="w-52 shrink-0 text-sm font-medium text-gray-500">{f.label}</span>
                            <span className="text-sm text-gray-900">{auditContext[f.key]}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── Step 4: Download Reports ── */}
      <section className={`rounded-2xl border bg-white shadow-sm overflow-hidden transition-opacity ${!selectedAudit ? "opacity-40 pointer-events-none" : "border-gray-200"}`}>
        <div className="flex items-center gap-3 border-b border-gray-100 px-6 py-4">
          <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white ${selectedAudit ? "bg-blue-600" : "bg-gray-300"}`}>4</span>
          <h2 className="text-lg font-semibold text-gray-900">Download Report</h2>
        </div>
        <div className="px-6 py-8">
          {!selectedAudit ? (
            <p className="text-gray-400 italic">Complete Steps 1–3 first.</p>
          ) : (
            <div className="flex flex-col gap-6">
              <p className="text-gray-600">
                Choose a report type below. Each is written by AI using the audit data and tailored for a different audience. Reports download as a <strong>.docx</strong> file.
              </p>
              {downloadError && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{downloadError}</p>
              )}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {(
                  [
                    {
                      type: "domi-internal" as const,
                      label: "DOMI Internal",
                      badge: "Confidential",
                      badgeColor: "bg-red-100 text-red-700",
                      desc: "Detailed technical findings for city planners and DOMI staff. Includes all data, severity ratings, and infrastructure notes.",
                      buttonColor: "bg-red-600 hover:bg-red-700 disabled:bg-red-300",
                    },
                    {
                      type: "school-community" as const,
                      label: "School & Community",
                      badge: "For schools",
                      badgeColor: "bg-emerald-100 text-emerald-700",
                      desc: "Accessible summary for school administrators, PTAs, and community members focused on student safety.",
                      buttonColor: "bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300",
                    },
                    {
                      type: "public-update" as const,
                      label: "Public Update",
                      badge: "Public",
                      badgeColor: "bg-blue-100 text-blue-700",
                      desc: "Plain-language overview suitable for public newsletters, social media, or community meetings.",
                      buttonColor: "bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300",
                    },
                  ]
                ).map(({ type, label, badge, badgeColor, desc, buttonColor }) => (
                  <div key={type} className="flex flex-col rounded-xl border border-gray-200 p-5 gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold text-gray-900">{label}</p>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${badgeColor}`}>{badge}</span>
                    </div>
                    <p className="text-sm text-gray-500 flex-1">{desc}</p>
                    <button
                      type="button"
                      className={`mt-auto w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed ${buttonColor}`}
                      disabled={downloadingType !== null}
                      onClick={() => handleDownload(type)}
                    >
                      {downloadingType === type ? (
                        <span className="flex items-center justify-center gap-2">
                          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                          Generating…
                        </span>
                      ) : "⬇ Download"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── Footer padding ── */}
      <div className="h-8" />
      </div>

      {/* ── Developer tools button (fixed, bottom-right) ── */}
      <button
        type="button"
        title="Developer tools"
        className="fixed bottom-4 right-4 z-50 flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-gray-500 opacity-40 shadow hover:opacity-100 hover:bg-gray-300 transition-all text-xs font-mono"
        onClick={() => window.open("/dev", "_blank")}
      >
        {"</>"}
      </button>
    </main>
  );
}
