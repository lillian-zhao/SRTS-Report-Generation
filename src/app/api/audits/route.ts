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
    const sampleAttributes = postSurveyRows[0]?.attributes ?? null;

    const uniqueAuditMap = new Map<string, Audit>();
    for (const row of postSurveyRows) {
      const school = String(row.attributes[config.schoolField] ?? "").trim();
      const surveyDate = String(row.attributes[config.dateField] ?? "").trim();
      if (!school || !surveyDate) {
        continue;
      }

      const id = `${school}__${surveyDate}`;
      if (!uniqueAuditMap.has(id)) {
        uniqueAuditMap.set(id, { id, school, surveyDate });
      }
    }

    const audits = [...uniqueAuditMap.values()].sort((a, b) => {
      if (a.surveyDate === b.surveyDate) {
        return a.school.localeCompare(b.school);
      }
      return b.surveyDate.localeCompare(a.surveyDate);
    });

    return NextResponse.json({ audits, rawCount, sampleAttributes });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to query audits from ArcGIS";
    console.error("[/api/audits] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
