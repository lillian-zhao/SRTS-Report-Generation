import {
  buildDateClause,
  getSurveyConfig,
  queryRelatedPhotoAttachments,
  queryLayerFeatures,
} from "@/lib/arcgis";

export const maxDuration = 30;
import { buildAuditContext } from "@/lib/audit-context";

type StreamStep = {
  type: "status" | "complete" | "error";
  message: string;
  data?: unknown;
};

function sendChunk(controller: ReadableStreamDefaultController, event: StreamStep) {
  controller.enqueue(`data: ${JSON.stringify(event)}\n\n`);
}

export async function POST(request: Request) {
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const body = (await request.json()) as {
          token?: string;
          school?: string;
          surveyDate?: string;
        };

        if (!body.token || !body.school || !body.surveyDate) {
          sendChunk(controller, {
            type: "error",
            message: "token, school, and surveyDate are required",
          });
          controller.close();
          return;
        }

        const config = getSurveyConfig();

        // Each role (coordinator, school, guests, traffic) submits a separate
        // record for the same audit. Only the coordinator fills in the school
        // name field — the others leave it blank. So filtering by school name
        // misses most records. Filter by date instead: all participants fill in
        // date_of_audit with the same value.
        const postWhere = buildDateClause(config.dateField, body.surveyDate);

        // Pre-survey: fetch all records — it may use a different date.
        const preWhere = "1=1";

        console.log("[stream] postWhere:", postWhere);

        sendChunk(controller, {
          type: "status",
          message: "Querying pre-survey features...",
        });
        const preFeatures = await queryLayerFeatures(
          config.preSurveyLayerUrl,
          body.token,
          preWhere,
        );

        sendChunk(controller, {
          type: "status",
          message: "Querying post-survey features...",
        });
        const postFeatures = await queryLayerFeatures(
          config.postSurveyLayerUrl,
          body.token,
          postWhere,
          "*",
          true, // return geometry to check for route polyline
        );

        // Extract globalids for related-table photo lookup
        const preGlobalIds = preFeatures
          .map((f) => String(f.attributes["globalid"] ?? f.attributes["GlobalID"] ?? ""))
          .filter(Boolean);
        const postGlobalIds = postFeatures
          .map((f) => String(f.attributes["globalid"] ?? f.attributes["GlobalID"] ?? ""))
          .filter(Boolean);

        sendChunk(controller, {
          type: "status",
          message: "Fetching pre-survey photos...",
        });
        const prePhotos = await queryRelatedPhotoAttachments(
          config.preSurveyLayerUrl,
          body.token,
          preGlobalIds,
        );

        sendChunk(controller, {
          type: "status",
          message: "Fetching post-survey photos...",
        });
        const postPhotos = await queryRelatedPhotoAttachments(
          config.postSurveyLayerUrl,
          body.token,
          postGlobalIds,
        );

        // Build parsed context (merging all post records across roles)
        const auditContext = buildAuditContext(
          body.school,
          body.surveyDate,
          preFeatures,
          postFeatures,
        );

        // Flat map of every field that has a non-null value across all post records
        const postFieldMap: Record<string, unknown> = {};
        for (const feature of postFeatures) {
          for (const [k, v] of Object.entries(feature.attributes)) {
            if (v !== null && v !== undefined && String(v).trim() !== "") {
              postFieldMap[k] = v;
            }
          }
        }

        // Same for pre-survey records
        const preFieldMap: Record<string, unknown> = {};
        for (const feature of preFeatures) {
          for (const [k, v] of Object.entries(feature.attributes)) {
            if (v !== null && v !== undefined && String(v).trim() !== "") {
              preFieldMap[k] = v;
            }
          }
        }

        sendChunk(controller, {
          type: "complete",
          message: "ArcGIS data retrieval complete.",
          data: {
            selectedAudit: {
              school: body.school,
              surveyDate: body.surveyDate,
            },
            counts: {
              preFeatures: preFeatures.length,
              postFeatures: postFeatures.length,
              prePhotos: prePhotos.length,
              postPhotos: postPhotos.length,
            },
            auditContext,
            postAllFields: postFieldMap,
            preAllFields: preFieldMap,
            preFeatures,
            postFeatures,
            prePhotos,
            postPhotos,
          },
        });
      } catch (error) {
        sendChunk(controller, {
          type: "error",
          message:
            error instanceof Error
              ? error.message
              : "Unable to complete report data retrieval",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
