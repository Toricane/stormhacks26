export type Artifact = {
  name: string;
  url: string;
  kind: "model" | "image" | "file";
  warning?: string;
};

type OutputFile = { url: string; name: string; kind: Artifact["kind"] };

function file(url: string, path: string, filename?: string, contentType?: string): OutputFile {
  const name = filename || new URL(url).pathname.split("/").pop() || "output";
  const model = /\.glb(?:$|[?#])/i.test(name) || /\.glb$/i.test(new URL(url).pathname) ||
    contentType === "model/gltf-binary" || /(?:^|\.)(model_mesh|model_glb|model_url|glb)(?:\.url)?$/.test(path);
  const image = /\.(png|jpe?g|webp)$/i.test(name) || contentType?.startsWith("image/");
  return { url, name: `${path || "output"} - ${name}`, kind: model ? "model" : image ? "image" : "file" };
}

export function outputFiles(value: unknown, path = ""): OutputFile[] {
  if (typeof value === "string" && /^https:\/\//.test(value)) {
    return [file(value, path)];
  }
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  if (typeof object.url === "string" && /^https:\/\//.test(object.url)) {
    return [file(object.url, path,
      typeof object.file_name === "string" ? object.file_name : undefined,
      typeof object.content_type === "string" ? object.content_type : undefined,
    )];
  }
  return Object.entries(object).flatMap(([key, child]) => outputFiles(child, path ? `${path}.${key}` : key));
}

export function modelUrl(value: unknown): string | undefined {
  return outputFiles(value).find(file => file.kind === "model")?.url;
}
