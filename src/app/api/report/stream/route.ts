import {
  buildDateClause,
  getSurveyConfig,
  queryLayerAttachments,
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
        );

        const preObjectIds = preFeatures
          .map((feature) => Number(feature.attributes[config.objectIdField]))
          .filter((value) => Number.isFinite(value));
        const postObjectIds = postFeatures
          .map((feature) => Number(feature.attributes[config.objectIdField]))
          .filter((value) => Number.isFinite(value));

        sendChunk(controller, {
          type: "status",
          message: "Fetching pre-survey attachments...",
        });
        const preAttachments = await queryLayerAttachments(
          config.preSurveyLayerUrl,
          body.token,
          preObjectIds,
        );

        sendChunk(controller, {
          type: "status",
          message: "Fetching post-survey attachments...",
        });
        const postAttachments = await queryLayerAttachments(
          config.postSurveyLayerUrl,
          body.token,
          postObjectIds,
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
              preAttachments: Object.values(preAttachments).flat().length,
              postAttachments: Object.values(postAttachments).flat().length,
            },
            auditContext,
            postAllFields: postFieldMap,
            preAllFields: preFieldMap,
            preFeatures,
            postFeatures,
            preAttachments,
            postAttachments,
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
