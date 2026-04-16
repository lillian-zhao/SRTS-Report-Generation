import { NextResponse } from "next/server";
import { generateUserToken } from "@/lib/arcgis";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      username?: string;
      password?: string;
    };

    const username = body.username?.trim() ?? "";
    const password = body.password?.trim() ?? "";
    if (!username || !password) {
      return NextResponse.json(
        { error: "username and password are required" },
        { status: 400 },
      );
    }

    const token = await generateUserToken(username, password);
    return NextResponse.json(token);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "ArcGIS login failed unexpectedly",
      },
      { status: 401 },
    );
  }
}
