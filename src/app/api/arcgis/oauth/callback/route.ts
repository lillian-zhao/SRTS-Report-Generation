import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { exchangeOAuthCodeForToken } from "@/lib/arcgis";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;

  try {
    const code = url.searchParams.get("code");
    const incomingState = url.searchParams.get("state");
    const cookieStore = await cookies();
    const expectedState = cookieStore.get("arcgis_oauth_state")?.value;

    cookieStore.delete("arcgis_oauth_state");

    if (!code) {
      throw new Error("ArcGIS OAuth callback is missing code");
    }
    if (!incomingState || !expectedState || incomingState !== expectedState) {
      throw new Error("ArcGIS OAuth state did not match");
    }

    const token = await exchangeOAuthCodeForToken(code);
    const redirectUrl = new URL("/", origin);
    redirectUrl.searchParams.set("oauthToken", token.token);
    redirectUrl.searchParams.set("oauthExpires", String(token.expires));

    return NextResponse.redirect(redirectUrl);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "ArcGIS OAuth callback failed";
    return NextResponse.redirect(
      new URL(`/?authError=${encodeURIComponent(message)}`, origin),
    );
  }
}
