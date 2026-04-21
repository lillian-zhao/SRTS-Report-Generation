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

    // The post-survey layer has the school name field; the pre-survey layer does not.
    // Use outFields=* to avoid rejections from strict field-name validation on some layers.
    const postSurveyRows = await queryLayerFeatures(
      config.postSurveyLayerUrl,
      token,
      "1=1",
      "*",
    );

    const rawCount = postSurveyRows.length;

    // Group records by date — date is always populated, school name is only
    // filled by the coordinator role so we take the first non-empty value found
    // across all records sharing the same date.
    const byDate = new Map<string, { school: string; surveyDate: string }>();

    for (const row of postSurveyRows) {
      const surveyDate = String(row.attributes[config.dateField] ?? "").trim();
      if (!surveyDate) continue;

      const school =
        String(row.attributes[config.postSchoolField] ?? "").trim() ||
        String(row.attributes[config.schoolField] ?? "").trim();

      if (!byDate.has(surveyDate)) {
        byDate.set(surveyDate, { school, surveyDate });
      } else if (!byDate.get(surveyDate)!.school && school) {
        byDate.get(surveyDate)!.school = school;
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
