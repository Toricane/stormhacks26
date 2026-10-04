export class ApiError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function failure(error: unknown) {
  return Response.json(
    { error: error instanceof Error ? error.message : "Request failed." },
    { status: error instanceof ApiError ? error.status : 502 },
  );
}

// Restrict the asset proxy and model inputs to these providers' storage.
export function assetUrl(value: unknown): URL {
  if (typeof value !== "string") throw new ApiError("Missing model URL.");
  let url: URL;
  try { url = new URL(value); } catch { throw new ApiError("Invalid asset URL."); }
  const allowed = ["fal.media", "tripo3d.ai", "tripo3d.com"];
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !allowed.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
    throw new ApiError("Asset URL must use fal or Tripo storage.");
  }
  return url;
}
