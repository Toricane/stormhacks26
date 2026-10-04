import { fal } from "@fal-ai/client";
import { ApiError, assetUrl, failure } from "@/lib/server";
import { isRigType } from "@/lib/rig-types";

export const runtime = "nodejs";
export const maxDuration = 60;
const trellis = "tripo3d/h3.1/image-to-3d";
const tripoBase = "https://openapi.tripo3d.ai/v3";

function requireKeys(provider: "fal" | "tripo") {
  if (provider === "fal") {
    if (!process.env.FAL_KEY) throw new ApiError("Add FAL_KEY to .env, then restart the server.");
    fal.config({ credentials: process.env.FAL_KEY });
  } else if (!process.env.TRIPO_API_KEY) {
    throw new ApiError("Add TRIPO_API_KEY to .env, then restart the server.");
  }
}

async function tripo(path: string, body?: Record<string, unknown>) {
  const response = await fetch(`${tripoBase}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${process.env.TRIPO_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
  });
  const result = await response.json();
  if (!response.ok || result.code !== 0) {
    throw new ApiError(result.message || result.error_message || `Tripo request failed (${response.status}).`, 502);
  }
  if (!result.data) throw new ApiError("Tripo returned no task data.", 502);
  return result.data;
}

export async function POST(request: Request) {
  try {
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      requireKeys("fal");
      const image = (await request.formData()).get("image");
      if (!(image instanceof File) || !["image/png", "image/jpeg", "image/webp"].includes(image.type)) {
        throw new ApiError("Choose a PNG, JPG, or WebP image.");
      }
      if (!image.size || image.size > 10 * 1024 * 1024) throw new ApiError("Image must be between 1 byte and 10 MB.");
      const imageUrl = await fal.storage.upload(image);
      const task = await fal.queue.submit(trellis, { input: { image_url: imageUrl } });
      return Response.json({ taskId: task.request_id });
    }
    const { action, modelUrl, rigType = "quadruped" } = await request.json();
    const input = assetUrl(modelUrl).href;
    if (action !== "check" && action !== "rig") throw new ApiError("Unknown action.");
    if (action === "rig" && !isRigType(rigType)) throw new ApiError("Choose a supported Tripo rig type.");
    requireKeys("tripo");
    const task = await tripo(`/animations/${action === "check" ? "rig-check" : "rig"}`, {
      input,
      ...(action === "rig" ? {
        model: rigType === "biped" ? "v1.0-20240301" : "v2.5-20260210",
        rig_type: rigType,
        spec: "tripo",
        out_format: "glb",
      } : {}),
    });
    if (!task.task_id) throw new ApiError("Tripo returned no task ID.", 502);
    return Response.json({ taskId: task.task_id });
  } catch (error) { return failure(error); }
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const taskId = params.get("taskId");
    if (!taskId || !/^[\w-]{1,160}$/.test(taskId)) throw new ApiError("Invalid task ID.");
    if (params.get("provider") === "fal") {
      requireKeys("fal");
      const task = await fal.queue.status(trellis, { requestId: taskId });
      if (task.status !== "COMPLETED") return Response.json({ status: "running" });
      const result = await fal.queue.result(trellis, { requestId: taskId });
      return Response.json({ status: "success", result: result.data });
    }
    if (params.get("provider") !== "tripo") throw new ApiError("Unknown provider.");
    requireKeys("tripo");
    const task = await tripo(`/tasks/${encodeURIComponent(taskId)}`);
    return Response.json({
      status: task.status,
      progress: task.progress,
      error: task.error_message || task.error_code,
      result: task.status === "success" ? task : undefined,
    });
  } catch (error) { return failure(error); }
}
