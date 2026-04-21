"use client";

import { useEffect, useState } from "react";

type LayerField = { name: string; alias?: string; type?: string };
type Audit = { id: string; school: string; surveyDate: string };
type StreamEvent = {
  type: "status" | "complete" | "error";
  message: string;
  data?: Record<string, unknown>;
};

export default function DevPage() {
  const [token, setToken] = useState<string | null>(null);
  const [pastedToken, setPastedToken] = useState("");
  const [tokenExpires, setTokenExpires] = useState<number | null>(null);

  const [preFields, setPreFields] = useState<LayerField[]>([]);
  const [postFields, setPostFields] = useState<LayerField[]>([]);
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [fieldsError, setFieldsError] = useState<string | null>(null);

  const [audits, setAudits] = useState<Audit[]>([]);
  const [auditsLoading, setAuditsLoading] = useState(false);
  const [auditsError, setAuditsError] = useState<string | null>(null);
  const [selectedAuditId, setSelectedAuditId] = useState("");

  const [streamLog, setStreamLog] = useState<string[]>([]);
  const [rawData, setRawData] = useState<Record<string, unknown> | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);

  const [activeTab, setActiveTab] = useState<"token" | "fields" | "audits" | "raw">("token");

  useEffect(() => {
    const saved = localStorage.getItem("arcgis_token");
    const expires = localStorage.getItem("arcgis_token_expires");
    if (saved) {
      setToken(saved);
      setTokenExpires(expires ? Number(expires) : null);
    }
  }, []);

  function applyToken(t: string) {
    const trimmed = t.trim();
    if (!trimmed) return;
    setToken(trimmed);
    localStorage.setItem("arcgis_token", trimmed);
  }

  function clearToken() {
    setToken(null);
    setTokenExpires(null);
    setPastedToken("");
    localStorage.removeItem("arcgis_token");
    localStorage.removeItem("arcgis_token_expires");
  }

  async function loadFields() {
    if (!token) return;
    setFieldsLoading(true);
    setFieldsError(null);
    try {
      const res = await fetch(`/api/arcgis/fields?token=${encodeURIComponent(token)}`);
      const payload = (await res.json()) as { preFields?: LayerField[]; postFields?: LayerField[]; error?: string };
      if (!res.ok || !payload.preFields) throw new Error(payload.error ?? "Failed to fetch fields");
      setPreFields(payload.preFields);
      setPostFields(payload.postFields ?? []);
    } catch (e) {
      setFieldsError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setFieldsLoading(false);
    }
  }

  async function loadAudits() {
    if (!token) return;
    setAuditsLoading(true);
    setAuditsError(null);
    try {
      const res = await fetch(`/api/audits?token=${encodeURIComponent(token)}`);
      const payload = (await res.json()) as { audits?: Audit[]; rawCount?: number; error?: string };
      if (!res.ok || !payload.audits) throw new Error(payload.error ?? "Failed to fetch audits");
      setAudits(payload.audits);
      if (payload.audits.length > 0) setSelectedAuditId(payload.audits[0].id);
      if (payload.audits.length === 0)
        setAuditsError(`ArcGIS returned ${payload.rawCount ?? 0} raw records but none matched school+date.`);
    } catch (e) {
      setAuditsError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setAuditsLoading(false);
    }
  }

  async function streamAudit() {
    if (!token || !selectedAuditId) return;
    const audit = audits.find((a) => a.id === selectedAuditId);
    if (!audit) return;
    setStreamLog([]);
    setRawData(null);
    setIsStreaming(true);
    try {
      const res = await fetch("/api/report/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, school: audit.school, surveyDate: audit.surveyDate }),
      });
      if (!res.body) throw new Error("No stream body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          const evt = JSON.parse(part.slice(6)) as StreamEvent;
          setStreamLog((prev) => [...prev, `[${evt.type}] ${evt.message}`]);
          if (evt.type === "complete" && evt.data) setRawData(evt.data);
        }
      }
    } catch (e) {
      setStreamLog((prev) => [...prev, `[error] ${e instanceof Error ? e.message : "Stream failed"}`]);
    } finally {
      setIsStreaming(false);
    }
  }

  const tabs = [
    { id: "token" as const, label: "Token" },
    { id: "fields" as const, label: "Layer Fields" },
    { id: "audits" as const, label: "Audits" },
    { id: "raw" as const, label: "Raw Data" },
  ];

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-mono text-sm">
      {/* Header */}
      <div className="border-b border-gray-800 px-6 py-4 flex items-center gap-3">
        <span className="text-green-400 font-bold text-base">&lt;/&gt;</span>
        <h1 className="text-base font-semibold text-gray-100">SRTS Developer Tools</h1>
        <span className="ml-auto text-xs text-gray-500">srts-report-generation</span>
      </div>

      {/* Token status bar */}
      <div className={`px-6 py-2 text-xs flex items-center gap-2 ${token ? "bg-green-950 text-green-400" : "bg-red-950 text-red-400"}`}>
        <span className={`h-2 w-2 rounded-full ${token ? "bg-green-400" : "bg-red-400"}`} />
        {token
          ? `Token active${tokenExpires ? ` · expires ${new Date(tokenExpires).toLocaleTimeString()}` : ""} · ${token.slice(0, 16)}…`
          : "No token — paste one in the Token tab or sign in via OAuth on the main page."}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-800 px-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-3 text-sm border-b-2 transition-colors ${
              activeTab === tab.id
                ? "border-green-400 text-green-400"
                : "border-transparent text-gray-500 hover:text-gray-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="px-6 py-6 max-w-4xl">

        {/* ── TOKEN TAB ── */}
        {activeTab === "token" && (
          <div className="flex flex-col gap-6">
            <div>
              <p className="text-gray-400 mb-3">
                The token is read from <code className="text-yellow-400">localStorage</code>. Sign in via OAuth on the main page,
                or paste a manually generated token here. Tokens generated at{" "}
                <a href="https://www.arcgis.com/sharing/rest/generateToken" target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">
                  arcgis.com/sharing/rest/generateToken
                </a>{" "}
                should use <strong>Client = Referer</strong> and the app URL as the referer.
              </p>
              <a
                href="/api/arcgis/oauth/start"
                className="inline-flex items-center gap-2 rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600 transition-colors"
              >
                Sign in via OAuth (opens main flow)
              </a>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-xs text-gray-400 uppercase tracking-wider">Paste token manually</label>
              <textarea
                className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-xs text-green-300 placeholder:text-gray-600 focus:border-green-500 focus:outline-none"
                rows={4}
                placeholder="Paste ArcGIS token here…"
                value={pastedToken}
                onChange={(e) => setPastedToken(e.target.value)}
              />
              <div className="flex gap-3">
                <button
                  type="button"
                  className="rounded bg-green-700 px-4 py-2 text-sm font-semibold hover:bg-green-600 transition-colors"
                  onClick={() => applyToken(pastedToken)}
                >
                  Apply Token
                </button>
                {token && (
                  <button
                    type="button"
                    className="rounded bg-red-900 px-4 py-2 text-sm text-red-300 hover:bg-red-800 transition-colors"
                    onClick={clearToken}
                  >
                    Clear Token
                  </button>
                )}
              </div>
            </div>
            {token && (
              <div className="rounded border border-gray-700 bg-gray-900 p-4">
                <p className="text-xs text-gray-400 mb-1 uppercase tracking-wider">Current token (full)</p>
                <p className="break-all text-xs text-green-300 select-all">{token}</p>
              </div>
            )}
          </div>
        )}

        {/* ── FIELDS TAB ── */}
        {activeTab === "fields" && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="rounded bg-gray-700 px-4 py-2 text-sm hover:bg-gray-600 disabled:opacity-50 transition-colors"
                disabled={!token || fieldsLoading}
                onClick={loadFields}
              >
                {fieldsLoading ? "Loading…" : "Fetch Layer Fields"}
              </button>
              <p className="text-xs text-gray-500">Fetches field definitions from both pre- and post-survey layers.</p>
            </div>
            {fieldsError && <p className="rounded border border-red-800 bg-red-950 px-3 py-2 text-red-400">{fieldsError}</p>}
            {(preFields.length > 0 || postFields.length > 0) && (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {[{ label: "Pre-survey layer", fields: preFields }, { label: "Post-survey layer", fields: postFields }].map(({ label, fields }) => (
                  <div key={label} className="rounded border border-gray-700 bg-gray-900 overflow-hidden">
                    <div className="border-b border-gray-700 px-3 py-2 text-xs font-semibold text-yellow-400">{label} — {fields.length} fields</div>
                    <div className="max-h-96 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-gray-800">
                          <tr>
                            <th className="px-3 py-1.5 text-left text-gray-400">Field name</th>
                            <th className="px-3 py-1.5 text-left text-gray-400">Alias</th>
                            <th className="px-3 py-1.5 text-left text-gray-400">Type</th>
                          </tr>
                        </thead>
                        <tbody>
                          {fields.map((f) => (
                            <tr key={f.name} className="border-t border-gray-800 hover:bg-gray-800">
                              <td className="px-3 py-1 text-green-300 font-mono">{f.name}</td>
                              <td className="px-3 py-1 text-gray-300">{f.alias ?? "—"}</td>
                              <td className="px-3 py-1 text-gray-500">{f.type ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── AUDITS TAB ── */}
        {activeTab === "audits" && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="rounded bg-gray-700 px-4 py-2 text-sm hover:bg-gray-600 disabled:opacity-50 transition-colors"
                disabled={!token || auditsLoading}
                onClick={loadAudits}
              >
                {auditsLoading ? "Loading…" : "Fetch Audits"}
              </button>
              <p className="text-xs text-gray-500">{audits.length > 0 ? `${audits.length} audits loaded` : "No audits loaded yet."}</p>
            </div>
            {auditsError && <p className="rounded border border-red-800 bg-red-950 px-3 py-2 text-red-400">{auditsError}</p>}
            {audits.length > 0 && (
              <div className="rounded border border-gray-700 bg-gray-900 overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-gray-800">
                    <tr>
                      <th className="px-3 py-2 text-left text-gray-400">#</th>
                      <th className="px-3 py-2 text-left text-gray-400">School</th>
                      <th className="px-3 py-2 text-left text-gray-400">Survey date (raw)</th>
                      <th className="px-3 py-2 text-left text-gray-400">Formatted date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audits.map((a, i) => {
                      const epochMs = Number(a.surveyDate);
                      const displayDate = Number.isFinite(epochMs) && epochMs > 1_000_000_000_000
                        ? new Date(epochMs).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
                        : a.surveyDate;
                      return (
                        <tr key={a.id} className="border-t border-gray-800 hover:bg-gray-800">
                          <td className="px-3 py-1.5 text-gray-500">{i + 1}</td>
                          <td className="px-3 py-1.5 text-green-300">{a.school}</td>
                          <td className="px-3 py-1.5 text-gray-400 font-mono">{a.surveyDate}</td>
                          <td className="px-3 py-1.5 text-gray-300">{displayDate}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── RAW DATA TAB ── */}
        {activeTab === "raw" && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <select
                className="rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-200"
                value={selectedAuditId}
                onChange={(e) => setSelectedAuditId(e.target.value)}
                disabled={audits.length === 0}
              >
                <option value="">— Select audit —</option>
                {audits.map((a) => {
                  const epochMs = Number(a.surveyDate);
                  const d = Number.isFinite(epochMs) && epochMs > 1_000_000_000_000
                    ? new Date(epochMs).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                    : a.surveyDate;
                  return <option key={a.id} value={a.id}>{a.school} — {d}</option>;
                })}
              </select>
              <button
                type="button"
                className="rounded bg-gray-700 px-4 py-2 text-sm hover:bg-gray-600 disabled:opacity-50 transition-colors"
                disabled={!token || !selectedAuditId || isStreaming}
                onClick={streamAudit}
              >
                {isStreaming ? "Streaming…" : "Fetch Raw Data"}
              </button>
              {audits.length === 0 && (
                <p className="text-xs text-yellow-500">Load audits in the Audits tab first.</p>
              )}
            </div>

            {streamLog.length > 0 && (
              <div className="rounded border border-gray-700 bg-gray-900 p-3 max-h-40 overflow-y-auto">
                <p className="text-xs text-gray-500 mb-1 uppercase tracking-wider">Stream log</p>
                {streamLog.map((line, i) => (
                  <p key={i} className={`text-xs ${line.startsWith("[error]") ? "text-red-400" : line.startsWith("[complete]") ? "text-green-400" : "text-gray-400"}`}>{line}</p>
                ))}
              </div>
            )}

            {rawData && (
              <div className="flex flex-col gap-3">
                {(["postAllFields", "preAllFields", "auditContext"] as const).map((key) => {
                  const val = rawData[key] as Record<string, unknown> | null;
                  if (!val) return null;
                  const entries = Object.entries(val).filter(([, v]) => v !== null && String(v).trim() !== "");
                  return (
                    <details key={key} open={key === "auditContext"} className="rounded border border-gray-700 bg-gray-900 overflow-hidden">
                      <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold text-yellow-400 hover:bg-gray-800">
                        {key} — {entries.length} populated fields
                      </summary>
                      <div className="max-h-96 overflow-y-auto">
                        <table className="w-full text-xs">
                          <tbody>
                            {entries.map(([k, v]) => (
                              <tr key={k} className="border-t border-gray-800 hover:bg-gray-800">
                                <td className="px-3 py-1 text-green-300 font-mono w-64 whitespace-nowrap">{k}</td>
                                <td className="px-3 py-1 text-gray-200 break-all">{String(v)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  );
                })}
                <details className="rounded border border-gray-700 bg-gray-900 overflow-hidden">
                  <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold text-yellow-400 hover:bg-gray-800">
                    Full JSON payload
                  </summary>
                  <pre className="max-h-96 overflow-auto px-4 py-3 text-xs text-gray-300 whitespace-pre-wrap break-all">
                    {JSON.stringify(rawData, null, 2)}
                  </pre>
                </details>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
