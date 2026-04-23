import {
  buildDateClause,
  getSurveyConfig,
  queryLayerFeatures,
  queryRelatedPhotoAttachments,
} from "@/lib/arcgis";
import { fetchAuditMap, extractRouteGeometry } from "@/lib/map-utils";

// Claude + ArcGIS can take up to ~30s — raise Vercel's default 10s limit.
export const maxDuration = 60;
import { buildAuditContext } from "@/lib/audit-context";
import {
  buildDomiReport,
  buildPublicReport,
  buildSchoolCommunityReport,
  type ReportPhoto,
} from "@/lib/build-report-doc";
import {
  generateDomiContent,
  generatePublicContent,
  generateSchoolCommunityContent,
} from "@/lib/claude-reports";

async function fetchPhotoBinaries(
  layerUrl: string,
  token: string,
  globalIds: string[],
): Promise<ReportPhoto[]> {
  if (!globalIds.length) return [];
  try {
    const photoMeta = await queryRelatedPhotoAttachments(layerUrl, token, globalIds);
    const results: ReportPhoto[] = [];
    for (const photo of photoMeta) {
      try {
        const resp = await fetch(photo.url, { cache: "no-store" });
        if (!resp.ok) continue;
        const buf = await resp.arrayBuffer();
        results.push({ data: new Uint8Array(buf), name: photo.name, contentType: photo.contentType, caption: photo.caption });
      } catch {
        console.warn("[fetchPhotoBinaries] Failed to fetch", photo.url);
      }
    }
    console.log("[fetchPhotoBinaries] Fetched", results.length, "photos");
    return results;
  } catch (err) {
    console.warn("[fetchPhotoBinaries] Photo retrieval skipped:", String(err));
    return [];
  }
}

export type ReportType = "domi-internal" | "school-community" | "public-update";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      token?: string;
      school?: string;
      surveyDate?: string;
      reportType?: ReportType;
    };

    if (!body.token || !body.school || !body.surveyDate || !body.reportType) {
      return new Response(
        JSON.stringify({ error: "token, school, surveyDate, and reportType are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const config = getSurveyConfig();

    // All roles share the same date_of_audit but only the coordinator fills in
    // the school name — use date filter only so all role records are returned.
    const postWhere = buildDateClause(config.dateField, body.surveyDate);

    // Pre-survey: filter by school name so we don't mix in other schools' data.
    const escapedSchool = body.school.replace(/'/g, "''");
    const preWhere = `which_school_is_this_audit_for = '${escapedSchool}'`;

    console.log(`[/api/report/download] type=${body.reportType}`);
    console.log("[/api/report/download] postWhere:", postWhere);
    console.log("[/api/report/download] preWhere:", preWhere);

    const [preFeatures, postFeatures] = await Promise.all([
      queryLayerFeatures(config.preSurveyLayerUrl, body.token, preWhere),
      queryLayerFeatures(config.postSurveyLayerUrl, body.token, postWhere, "*", true),
    ]);

    console.log(`[/api/report/download] pre=${preFeatures.length} post=${postFeatures.length}`);

    const ctx = buildAuditContext(body.school, body.surveyDate, preFeatures, postFeatures);

    // Extract route geometry from whichever post-survey feature has it
    const routePaths = extractRouteGeometry(postFeatures);
    console.log(`[/api/report/download] routePaths=${routePaths ? routePaths.flat().length + " vertices" : "none"}`);

    // Fetch photos and map image in parallel
    const postGlobalIds = postFeatures
      .map((f) => String(f.attributes["globalid"] ?? f.attributes["GlobalID"] ?? ""))
      .filter(Boolean);
    const [photos, mapImage] = await Promise.all([
      fetchPhotoBinaries(config.postSurveyLayerUrl, body.token, postGlobalIds),
      fetchAuditMap(routePaths, ctx.address || body.school),
    ]);

    console.log(`[/api/report/download] photos=${photos.length} mapImage=${mapImage ? "yes" : "none"}`);

    let docBuffer: ArrayBuffer;
    let filename: string;
    const safeSchool = body.school.replace(/[^a-z0-9]/gi, "_").slice(0, 40);
    const safeDate = ctx.dateDisplay.replace(/[^a-z0-9]/gi, "-").slice(0, 20);

    if (body.reportType === "domi-internal") {
      const llm = await generateDomiContent(ctx);
      docBuffer = await buildDomiReport(ctx, llm, photos, mapImage);
      filename = `SRTS_DOMI_Internal_${safeSchool}_${safeDate}.docx`;
    } else if (body.reportType === "school-community") {
      const llm = await generateSchoolCommunityContent(ctx);
      docBuffer = await buildSchoolCommunityReport(ctx, llm, photos, mapImage);
      filename = `SRTS_School_Community_${safeSchool}_${safeDate}.docx`;
    } else {
      const llm = await generatePublicContent(ctx);
      docBuffer = await buildPublicReport(ctx, llm, photos, mapImage);
      filename = `SRTS_Public_Update_${safeSchool}_${safeDate}.docx`;
    }

    const blob = new Blob([docBuffer], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    return new Response(blob, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Report generation failed";
    console.error("[/api/report/download] error:", message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
