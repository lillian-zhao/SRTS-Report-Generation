import { buildDateClause, buildWhereClause, getSurveyConfig, queryLayerFeatures } from "@/lib/arcgis";
import { buildReportDocx } from "@/lib/build-report-doc";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      token?: string;
      school?: string;
      surveyDate?: string;
    };

    if (!body.token || !body.school || !body.surveyDate) {
      return new Response(
        JSON.stringify({ error: "token, school, and surveyDate are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const config = getSurveyConfig();

    const postWhere = buildWhereClause(
      body.school,
      body.surveyDate,
      config.schoolField,
      config.dateField,
    );
    const preWhere = buildDateClause(config.dateField, body.surveyDate);

    console.log("[/api/report/download] postWhere:", postWhere);
    console.log("[/api/report/download] preWhere:", preWhere);

    const [preFeatures, postFeatures] = await Promise.all([
      queryLayerFeatures(config.preSurveyLayerUrl, body.token, preWhere),
      queryLayerFeatures(config.postSurveyLayerUrl, body.token, postWhere),
    ]);

    const docBuffer = await buildReportDocx(
      body.school,
      body.surveyDate,
      preFeatures,
      postFeatures,
    );

    const safeSchool = body.school.replace(/[^a-z0-9]/gi, "_").slice(0, 40);
    const safeDate = body.surveyDate.replace(/[^a-z0-9]/gi, "-").slice(0, 20);
    const filename = `SRTS_Report_${safeSchool}_${safeDate}.docx`;

    return new Response(docBuffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error:
          error instanceof Error ? error.message : "Report generation failed",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
