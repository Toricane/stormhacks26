import { ApiError, assetUrl, failure } from "@/lib/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    let url = assetUrl(new URL(request.url).searchParams.get("url"));
    // Validate each redirect too; do not turn this into an arbitrary URL proxy.
    for (let redirects = 0; redirects <= 3; redirects++) {
      const response = await fetch(url, {
        redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(45_000),
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw new ApiError("Asset redirect has no location.", 502);
        await response.body?.cancel();
        url = assetUrl(new URL(location, url).href);
        continue;
      }
      if (!response.ok) throw new ApiError(`Asset download failed (${response.status}).`, 502);
      return new Response(response.body, { headers: {
        "Content-Type": response.headers.get("content-type") || "application/octet-stream",
        "Cache-Control": "no-store",
      } });
    }
    throw new ApiError("Too many asset redirects.", 502);
  } catch (error) { return failure(error); }
}
