import {
  buildDateClause,
  buildWhereClause,
  getSurveyConfig,
  queryLayerAttachments,
  queryLayerFeatures,
} from "@/lib/arcgis";

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

        // Post-survey has the school name field; filter by school + date.
        const postWhere = buildWhereClause(
          body.school,
          body.surveyDate,
          config.schoolField,
          config.dateField,
        );

        // Pre-survey has no school field; filter by date only.
        const preWhere = buildDateClause(config.dateField, body.surveyDate);

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
