import { NextResponse } from "next/server";
import { getLayerFields, getSurveyConfig } from "@/lib/arcgis";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");

    if (!token) {
      return NextResponse.json({ error: "token is required" }, { status: 400 });
    }

    const config = getSurveyConfig();
    const [preFields, postFields] = await Promise.all([
      getLayerFields(config.preSurveyLayerUrl, token),
      getLayerFields(config.postSurveyLayerUrl, token),
    ]);

    return NextResponse.json({
      preFields,
      postFields,
      currentConfig: {
        schoolField: config.schoolField,
        dateField: config.dateField,
        objectIdField: config.objectIdField,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load ArcGIS field metadata",
      },
      { status: 500 },
    );
  }
}
