import { NextResponse } from "next/server";
import {
  getSurveyConfig,
  queryLayerFeatures,
} from "@/lib/arcgis";

type Audit = {
  id: string;
  school: string;
  surveyDate: string;
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");

    if (!token) {
      return NextResponse.json({ error: "token is required" }, { status: 400 });
    }

    const config = getSurveyConfig();

    // Fetch post-survey records (grouped by date) and pre-survey records
    // (which reliably contain the school name) in parallel.
    const [postSurveyRows, preSurveyRows] = await Promise.all([
      queryLayerFeatures(config.postSurveyLayerUrl, token, "1=1", "*"),
      queryLayerFeatures(config.preSurveyLayerUrl, token, "1=1", "*"),
    ]);

    const rawCount = postSurveyRows.length;

    // Build a date → school name lookup from the pre-survey.
    // The pre-survey uses which_school_is_this_audit_for and always has
    // school name filled in.  Normalise the date to a plain day string so
    // epoch-millisecond timestamps from both layers can be compared.
    function toDateKey(raw: string): string {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 1_000_000_000_000) {
        return new Date(n).toISOString().slice(0, 10); // "YYYY-MM-DD"
      }
      return String(raw).slice(0, 10);
    }

    const schoolByDate = new Map<string, string>();
    for (const row of preSurveyRows) {
      const school = String(row.attributes[config.schoolField] ?? "").trim();
      const rawDate = String(row.attributes[config.dateField] ?? "").trim();
      if (school && rawDate) {
        schoolByDate.set(toDateKey(rawDate), school);
      }
    }

    // Group post-survey records by date, filling school name from:
    // 1. field_103 (post-survey, newer records)
    // 2. which_school_is_this_audit_for (post-survey, older records)
    // 3. Pre-survey lookup by matching date
    const byDate = new Map<string, { school: string; surveyDate: string }>();

    for (const row of postSurveyRows) {
      const surveyDate = String(row.attributes[config.dateField] ?? "").trim();
      if (!surveyDate) continue;

      const schoolFromPost =
        String(row.attributes[config.postSchoolField] ?? "").trim() ||
        String(row.attributes[config.schoolField] ?? "").trim();

      if (!byDate.has(surveyDate)) {
        byDate.set(surveyDate, { school: schoolFromPost, surveyDate });
      } else if (!byDate.get(surveyDate)!.school && schoolFromPost) {
        byDate.get(surveyDate)!.school = schoolFromPost;
      }
    }

    // Fill any still-missing school names from the pre-survey lookup
    for (const [surveyDate, entry] of byDate) {
      if (!entry.school) {
        const preSchool = schoolByDate.get(toDateKey(surveyDate));
        if (preSchool) entry.school = preSchool;
      }
    }

    const audits: Audit[] = [...byDate.values()]
      .map(({ school, surveyDate }) => ({
        id: `${school || "Unknown"}__${surveyDate}`,
        school: school || "Unknown School",
        surveyDate,
      }))
      .sort((a, b) => b.surveyDate.localeCompare(a.surveyDate));

    return NextResponse.json({ audits, rawCount });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to query audits from ArcGIS";
    console.error("[/api/audits] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
