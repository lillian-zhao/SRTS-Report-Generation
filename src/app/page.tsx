"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

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
    try {
      const response = await fetch(
        `/api/audits?token=${encodeURIComponent(currentToken)}`,
      );
      const payload = (await response.json()) as {
        audits?: Audit[];
        error?: string;
      };
      if (!response.ok || !payload.audits) {
        throw new Error(payload.error ?? "Unable to load audits");
      }

      setAudits(payload.audits);
      if (payload.audits.length > 0) {
        setSelectedAuditId(payload.audits[0].id);
      }
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

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-10">
      <section className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-zinc-900">
          SRTS Report Builder (ArcGIS data retrieval)
        </h1>
        <p className="mt-2 text-sm text-zinc-600">
          Sign in with ArcGIS credentials, pick an audit (school + date), then
          run data retrieval through the serverless backend.
        </p>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-zinc-900">1) ArcGIS Login</h2>
        <div className="mt-4">
          <a
            href="/api/arcgis/oauth/start"
            className="inline-flex rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Sign in with ArcGIS OAuth
          </a>
          <p className="mt-2 text-xs text-zinc-600">
            Use this for organization/SSO accounts. Keep username/password below
            only if your ArcGIS account supports direct token login.
          </p>
        </div>
        {/* Username/password login — disabled for production (OAuth only)
        <form onSubmit={handleLogin} className="mt-4 grid gap-3 sm:max-w-lg">
          <p className="text-xs text-zinc-600">
            Use the same <strong>User name</strong> shown under your ArcGIS
            profile (not always your email). If you use 2FA, password-based
            token login may fail here.
          </p>
          <input
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400"
            placeholder="ArcGIS username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
          />
          <input
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400"
            placeholder="ArcGIS password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <button
            type="submit"
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-500"
            disabled={isLoggingIn}
          >
            {isLoggingIn ? "Signing in..." : "Login + Load Audits"}
          </button>
        </form>
        */}

        {/* Paste-token fallback — disabled for production (OAuth only)
        <div className="mt-6 rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-4 sm:max-w-lg">
          <p className="text-sm font-medium text-zinc-900">
            Or paste an ArcGIS token
          </p>
          <p className="mt-1 text-xs text-zinc-600">
            Generate a token at{" "}
            <a
              href="https://www.arcgis.com/sharing/rest/generateToken"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              arcgis.com/sharing/rest/generateToken
            </a>{" "}
            — set <strong>Client</strong> to <strong>Referer</strong> and{" "}
            <strong>Referer URL</strong> to{" "}
            <code className="rounded bg-zinc-200 px-1">
              {process.env.NEXT_PUBLIC_ARCGIS_REFERER ?? "http://localhost:3000"}
            </code>
            , then paste the token below.
          </p>
          <textarea
            className="mt-2 w-full rounded-md border border-zinc-300 px-3 py-2 font-mono text-xs text-zinc-900 placeholder:text-zinc-400"
            placeholder="Paste token..."
            rows={3}
            value={pastedToken}
            onChange={(event) => setPastedToken(event.target.value)}
          />
          <button
            type="button"
            className="mt-2 rounded-md bg-zinc-600 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
            onClick={handleUsePastedToken}
          >
            Use token + load audits
          </button>
        </div>
        */}
        {token && (
          <div className="mt-3 flex flex-col gap-3 sm:max-w-lg">
            <div className="flex items-center gap-4">
              <p className="text-sm text-emerald-700">
                Logged in. Token expires:{" "}
                {tokenExpires ? new Date(tokenExpires).toLocaleString() : "unknown"}
              </p>
              <button
                type="button"
                className="text-xs text-zinc-500 underline hover:text-zinc-700"
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
            <button
              type="button"
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
              disabled={isLoadingAudits}
              onClick={() =>
                loadAudits(token).catch((error) =>
                  setLoginError(error instanceof Error ? error.message : "Unable to load audits"),
                )
              }
            >
              {isLoadingAudits ? "Loading audits…" : "Load Audits"}
            </button>
            {audits.length > 0 && (
              <p className="text-xs text-zinc-500">{audits.length} audit{audits.length !== 1 ? "s" : ""} loaded.</p>
            )}
          </div>
        )}
        {loginError && <p className="mt-3 text-sm text-red-600">{loginError}</p>}
        <div className="mt-4">
          <button
            type="button"
            className="rounded-md bg-zinc-700 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
            disabled={!token || isLoadingFields}
            onClick={loadFieldNames}
          >
            {isLoadingFields ? "Checking fields..." : "Check Field Names"}
          </button>
          {fieldError && <p className="mt-2 text-sm text-red-600">{fieldError}</p>}
          {(preFields.length > 0 || postFields.length > 0) && (
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <div className="rounded-md bg-zinc-100 p-3">
                <p className="text-sm font-semibold text-zinc-900">
                  Pre layer fields
                </p>
                <p className="mt-1 text-xs text-zinc-600">
                  Look for your school/date fields here.
                </p>
                <ul className="mt-2 max-h-56 list-disc space-y-1 overflow-auto pl-5 text-xs text-zinc-700">
                  {preFields.map((field) => (
                    <li key={`pre-${field.name}`}>
                      {field.name}
                      {field.alias ? ` (${field.alias})` : ""} -{" "}
                      {field.type ?? "unknown"}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-md bg-zinc-100 p-3">
                <p className="text-sm font-semibold text-zinc-900">
                  Post layer fields
                </p>
                <p className="mt-1 text-xs text-zinc-600">
                  Confirm names match your `.env.local`.
                </p>
                <ul className="mt-2 max-h-56 list-disc space-y-1 overflow-auto pl-5 text-xs text-zinc-700">
                  {postFields.map((field) => (
                    <li key={`post-${field.name}`}>
                      {field.name}
                      {field.alias ? ` (${field.alias})` : ""} -{" "}
                      {field.type ?? "unknown"}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-zinc-900">
          2) Select Audit + Retrieve Data
        </h2>
        <div className="mt-4 flex flex-col gap-3 sm:max-w-lg">
          <select
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900"
            value={selectedAuditId}
            onChange={(event) => setSelectedAuditId(event.target.value)}
            disabled={!token || isLoadingAudits || audits.length === 0}
          >
            {audits.length === 0 ? (
              <option value="">No audits loaded</option>
            ) : (
              audits.map((audit) => {
                const epochMs = Number(audit.surveyDate);
                const displayDate =
                  Number.isFinite(epochMs) && epochMs > 1_000_000_000_000
                    ? new Date(epochMs).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })
                    : audit.surveyDate;
                return (
                  <option key={audit.id} value={audit.id}>
                    {audit.school} — {displayDate}
                  </option>
                );
              })
            )}
          </select>
          <button
            type="button"
            className="rounded-md bg-zinc-500 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!selectedAudit || isGenerating}
            onClick={handleGenerate}
          >
            {isGenerating ? "Loading…" : "Preview raw data"}
          </button>
          <div className="flex flex-col gap-2 pt-1">
            <p className="text-xs font-semibold text-zinc-700">Generate AI report (.docx):</p>
            {(
              [
                { type: "domi-internal", label: "DOMI Internal (confidential)", color: "bg-red-700 disabled:bg-red-300" },
                { type: "school-community", label: "School & Community Report", color: "bg-emerald-600 disabled:bg-emerald-300" },
                { type: "public-update", label: "Public Community Update", color: "bg-blue-600 disabled:bg-blue-300" },
              ] as const
            ).map(({ type, label, color }) => (
              <button
                key={type}
                type="button"
                className={`rounded-md px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed ${color}`}
                disabled={!selectedAudit || downloadingType !== null}
                onClick={() => handleDownload(type)}
              >
                {downloadingType === type ? "Generating with Claude…" : `⬇ ${label}`}
              </button>
            ))}
          </div>
          {downloadError && (
            <p className="text-sm text-red-600">{downloadError}</p>
          )}
        </div>

        <div className="mt-6 rounded-md bg-zinc-100 p-4">
          <h3 className="text-sm font-semibold text-zinc-900">Streaming status</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-700">
            {streamMessages.length === 0 ? (
              <li>No events yet.</li>
            ) : (
              streamMessages.map((message, index) => (
                <li key={`${message}-${index}`}>{message}</li>
              ))
            )}
          </ul>
        </div>

        {auditContext && (
          <div className="mt-6 space-y-4">
            <h3 className="text-sm font-semibold text-zinc-900">Parsed audit data</h3>

            {recordCounts && (
              <div className={`flex gap-4 rounded-md border px-4 py-3 text-sm ${
                recordCounts.pre === 0 ? "border-amber-300 bg-amber-50" : "border-green-300 bg-green-50"
              }`}>
                <span className={recordCounts.post > 0 ? "text-green-800" : "text-red-700"}>
                  <strong>Post-survey records:</strong> {recordCounts.post}
                  {recordCounts.post === 1 && " (only coordinator — planner/traffic not yet submitted)"}
                  {recordCounts.post === 0 && " ⚠ none found"}
                </span>
                <span className={recordCounts.pre > 0 ? "text-green-800" : "text-amber-800"}>
                  <strong>Pre-survey records:</strong> {recordCounts.pre}
                  {recordCounts.pre === 0 && " ⚠ none found — pre-survey uses a different date"}
                </span>
              </div>
            )}

            <p className="text-xs text-zinc-500">
              Rows with data are white; grey rows show fields that were empty or not matched.
            </p>

            {(
              [
                {
                  heading: "Identity & Route",
                  keys: ["school","address","dateDisplay","time","weather","coordinator","auditorEmail","role","schoolContact","schoolContactEmail","initiatedBy","previousAudit","routeDescription","preExistingConcerns"],
                },
                {
                  heading: "Mode Split",
                  keys: ["modeWalk","modeBike","modeTransit","modeBus","modeDropOff","studentCount","designatedRoutes","mainConcerns","landmarks","parentConcerns","parentConcernDetails"],
                },
                {
                  heading: "Infrastructure Findings",
                  keys: ["adaSignage","vegetationBlocking","poolingWater","immediateHazards","trippingHazards","sidewalkGaps","grantOpportunities","grantDetails","nearbyConstruction","constructionDetails","additionalInfrastructureNotes"],
                },
                {
                  heading: "Traffic & Safety Findings",
                  keys: ["conflictingSignage","wayfinding","wayfindingLocations","trafficConditions","crashHistory","crashDetails","crosswalks","vehicleSpeeds","crossingGuard","schoolZoneSigns","dropOffConflict","pedestrianGenerators","pedestrianGeneratorDetails","additionalTrafficNotes"],
                },
                {
                  heading: "Summary",
                  keys: ["topConcern1","topConcern2","topConcern3","overallSeverity","safetyRating","comfortableLetChild","comfortDetails","designatedRouteDetails","participantsPresent","participantsMissing","additionalNotes","additionalComments"],
                },
              ] as { heading: string; keys: string[] }[]
            ).map(({ heading, keys }) => (
              <div key={heading}>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-1">{heading}</h4>
                <table className="w-full text-xs border border-zinc-200 rounded overflow-hidden">
                  <tbody>
                    {keys.map((k) => {
                      const val = auditContext[k] ?? "";
                      return (
                        <tr key={k} className={val ? "bg-white" : "bg-zinc-50"}>
                          <td className="px-3 py-1 font-medium text-zinc-600 w-56 border-b border-zinc-100 whitespace-nowrap">{k}</td>
                          <td className={`px-3 py-1 border-b border-zinc-100 ${val ? "text-zinc-900" : "text-zinc-400 italic"}`}>
                            {val || "— not mapped"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}

            <div className="space-y-2">
              <p className="text-xs font-semibold text-zinc-600">Raw field dumps — use these to verify or fix field name mappings:</p>

              <details className="rounded border border-zinc-200">
                <summary className="cursor-pointer px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-50">
                  Post-survey raw fields ({postAllFields ? Object.keys(postAllFields).length : 0} fields with data)
                </summary>
                {postAllFields && Object.keys(postAllFields).length > 0 ? (
                  <table className="w-full text-xs">
                    <tbody>
                      {Object.entries(postAllFields).map(([k, v]) => (
                        <tr key={k} className="odd:bg-white even:bg-zinc-50">
                          <td className="px-3 py-1 font-mono text-zinc-500 w-64 border-b border-zinc-100">{k}</td>
                          <td className="px-3 py-1 text-zinc-900 border-b border-zinc-100">{String(v)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="px-3 py-2 text-xs text-zinc-400">No post-survey fields with data</p>
                )}
              </details>

              <details className="rounded border border-zinc-200">
                <summary className="cursor-pointer px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-50">
                  Pre-survey raw fields ({preAllFields ? Object.keys(preAllFields).length : 0} fields with data)
                </summary>
                {preAllFields && Object.keys(preAllFields).length > 0 ? (
                  <table className="w-full text-xs">
                    <tbody>
                      {Object.entries(preAllFields).map(([k, v]) => (
                        <tr key={k} className="odd:bg-white even:bg-zinc-50">
                          <td className="px-3 py-1 font-mono text-zinc-500 w-64 border-b border-zinc-100">{k}</td>
                          <td className="px-3 py-1 text-zinc-900 border-b border-zinc-100">{String(v)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="px-3 py-2 text-xs text-zinc-400 italic">
                    No pre-survey records found for this date. The pre-survey may have been submitted
                    on a different date — check the raw data or expand the date range.
                  </p>
                )}
              </details>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
