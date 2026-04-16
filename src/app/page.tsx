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
  data?: unknown;
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
  const [resultJson, setResultJson] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
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
    }

    if (oauthToken) {
      setToken(oauthToken);
      const expiresValue = oauthExpires ? Number(oauthExpires) : null;
      setTokenExpires(
        expiresValue && Number.isFinite(expiresValue) ? expiresValue : null,
      );
      loadAudits(oauthToken).catch((error) =>
        setLoginError(
          error instanceof Error ? error.message : "Unable to load audits",
        ),
      );
    }

    if (oauthToken || oauthExpires || authError) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoggingIn(true);
    setLoginError(null);
    setStreamMessages([]);
    setResultJson(null);

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

  async function handleDownload() {
    if (!token || !selectedAudit) return;
    setIsDownloading(true);
    setDownloadError(null);
    try {
      const response = await fetch("/api/report/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          school: selectedAudit.school,
          surveyDate: selectedAudit.surveyDate,
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
      setDownloadError(
        error instanceof Error ? error.message : "Download failed",
      );
    } finally {
      setIsDownloading(false);
    }
  }

  async function handleGenerate() {
    if (!token || !selectedAudit) {
      return;
    }
    setStreamMessages([]);
    setResultJson(null);
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
              http://localhost:3000
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
        {token && (
          <p className="mt-3 text-sm text-emerald-700">
            Logged in. Token expires:{" "}
            {tokenExpires ? new Date(tokenExpires).toLocaleString() : "unknown"}
          </p>
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
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-indigo-300"
            disabled={!selectedAudit || isGenerating}
            onClick={handleGenerate}
          >
            {isGenerating ? "Running retrieval..." : "Preview raw data"}
          </button>
          <button
            type="button"
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-emerald-300"
            disabled={!selectedAudit || isDownloading}
            onClick={handleDownload}
          >
            {isDownloading ? "Generating…" : "⬇ Download Report (.docx)"}
          </button>
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

        {resultJson && (
          <div className="mt-6">
            <h3 className="text-sm font-semibold text-zinc-900">
              Retrieved payload preview
            </h3>
            <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-zinc-900 p-4 text-xs text-zinc-100">
              {resultJson}
            </pre>
          </div>
        )}
      </section>
    </main>
  );
}
