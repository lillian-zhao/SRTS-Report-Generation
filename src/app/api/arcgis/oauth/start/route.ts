import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getArcGISOAuthConfig } from "@/lib/arcgis";

export async function GET(request: Request) {
  try {
    const oauth = getArcGISOAuthConfig();
    const state = randomUUID();

    const cookieStore = await cookies();
    cookieStore.set("arcgis_oauth_state", state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 10 * 60,
    });

    const authorizeUrl = new URL(`${oauth.portalUrl}/sharing/rest/oauth2/authorize`);
    authorizeUrl.searchParams.set("client_id", oauth.clientId);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("redirect_uri", oauth.redirectUri);
    authorizeUrl.searchParams.set("expiration", "120");
    authorizeUrl.searchParams.set("state", state);

    return NextResponse.redirect(authorizeUrl);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to start ArcGIS OAuth flow";
    const origin = new URL(request.url).origin;
    return NextResponse.redirect(
      new URL(`/?authError=${encodeURIComponent(message)}`, origin),
    );
  }
}
