"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { modelUrl, outputFiles, type Artifact } from "@/lib/artifacts";
import { validateGlb } from "@/lib/glb";

const Viewer = dynamic(() => import("@/components/viewer"), { ssr: false });
type Result = Record<string, unknown>;
type Poll = { status: string; progress?: number; error?: string; result?: Result };

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data as T;
}

export default function Page() {
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [artifacts, setArtifacts] = useState<Artifact[]>([
    { name: "Animated dog.glb", url: "/dog-animated.glb", kind: "model" },
  ]);
  const [selected, setSelected] = useState("/dog-animated.glb");
  const [uploadError, setUploadError] = useState("");
  const [check, setCheck] = useState<Result | null>(null);
  const objectUrls = useRef<string[]>([]);
  const active = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!image) return;
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  useEffect(() => () => {
    active.current?.abort();
    objectUrls.current.forEach(url => URL.revokeObjectURL(url));
  }, []);

  function blobUrl(blob: Blob) {
    const url = URL.createObjectURL(blob);
    objectUrls.current.push(url);
    return url;
  }

  async function uploadGlb(file: File) {
    setUploadError("");
    try {
      await validateGlb(file);
      const url = blobUrl(file);
      setArtifacts(previous => [...previous, { name: file.name, url, kind: "model" }]);
      setSelected(url);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Could not open GLB.");
    }
  }

  async function keepOutputs(label: string, result: Result, signal: AbortSignal) {
    const report: Artifact = {
      name: `${label}.json`, kind: "file",
      url: blobUrl(new Blob([JSON.stringify(result, null, 2)], { type: "application/json" })),
    };
    setArtifacts(previous => [...previous, report]);
    const files = outputFiles(result);
    const unique = files.filter((file, index) => files.findIndex(other => other.url === file.url) === index);
    const saved = await Promise.all(unique.map(async file => {
      const proxy = `/api/asset?url=${encodeURIComponent(file.url)}`;
      const artifact: Artifact = { name: `${label} - ${file.name}`, kind: file.kind, url: proxy };
      try {
        const response = await fetch(proxy, { signal });
        if (!response.ok) throw new Error("Could not download output.");
        artifact.url = blobUrl(await response.blob());
      } catch (error) {
        if (signal.aborted) throw error;
        artifact.warning = "Local copy unavailable; download will retry.";
      }
      return artifact;
    }));
    setArtifacts(previous => [...previous, ...saved]);
    const model = saved.find(file => file.kind === "model");
    if (model) setSelected(model.url);
  }

  async function poll(provider: "fal" | "tripo", taskId: string, label: string, signal: AbortSignal) {
    const deadline = Date.now() + 15 * 60_000;
    while (Date.now() < deadline) {
      const task = await json<Poll>(`/api/pipeline?provider=${provider}&taskId=${encodeURIComponent(taskId)}`, { signal });
      if (task.status === "success" && task.result) return task.result;
      if (["failed", "cancelled", "banned", "expired"].includes(task.status)) {
        throw new Error(`${label}: ${task.error || task.status}`);
      }
      setStatus(`${label}…${typeof task.progress === "number" ? ` ${task.progress}%` : ""}`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    throw new Error(`${label} timed out. Task ID: ${taskId}`);
  }

  async function run() {
    if (!image || busy) return;
    const controller = new AbortController();
    active.current = controller;
    const signal = controller.signal;
    const inputUrl = blobUrl(image);
    setArtifacts(previous => [...previous, { name: image.name, kind: "image", url: inputUrl }]);
    setCheck(null); setError(""); setBusy(true);
    try {
      setStatus("Uploading image and starting Trellis…");
      const form = new FormData();
      form.set("image", image);
      const generated = await json<{ taskId: string }>("/api/pipeline", { method: "POST", body: form, signal });
      const trellis = await poll("fal", generated.taskId, "Generating Trellis model", signal);
      await keepOutputs("Trellis", trellis, signal);
      const meshUrl = modelUrl(trellis);
      if (!meshUrl) throw new Error(`Trellis returned no GLB file. Response fields: ${Object.keys(trellis).join(", ")}. See Trellis.json below.`);

      async function startTripo(action: "check" | "rig") {
        return json<{ taskId: string }>("/api/pipeline", {
          method: "POST", headers: { "Content-Type": "application/json" }, signal,
          body: JSON.stringify({ action, modelUrl: meshUrl }),
        });
      }
      setStatus("Starting Tripo rig check…");
      const checking = await startTripo("check");
      const checked = await poll("tripo", checking.taskId, "Checking riggability", signal);
      await keepOutputs("Rig check", checked, signal);
      const output = checked.output as Result | undefined;
      setCheck(output || checked);
      if (output?.riggable !== true) throw new Error("Tripo reports that this model cannot be rigged. The Trellis model is available below.");
      if (output.rig_type !== "quadruped") throw new Error(`Tripo detected ${String(output.rig_type)} instead of quadruped. Try an image with four clearly visible legs.`);

      setStatus("Starting quadruped auto rig…");
      const rigging = await startTripo("rig");
      const rigged = await poll("tripo", rigging.taskId, "Auto rigging quadruped", signal);
      await keepOutputs("Auto rig", rigged, signal);
      if (!modelUrl(rigged)) throw new Error("Tripo returned no rigged GLB. Check the Auto rig report below.");
      setStatus("Done. Select a model below to inspect it.");
    } catch (error) {
      if (!signal.aborted) {
        setError(error instanceof Error ? error.message : "Pipeline failed.");
        setStatus("Stopped.");
      }
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }

  const models = artifacts.filter(file => file.kind === "model");
  return (
    <main>
      <h1>GLB viewer</h1>
      <h2>Generate a model</h2>
      <p>Upload a picture of a four-legged animal. Trellis creates a GLB; Tripo checks and rigs it.</p>
      <div className="row">
        <label>Image <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={event => setImage(event.target.files?.[0] || null)} /></label>
        <button onClick={run} disabled={!image || busy}>{busy ? "Processing…" : "Generate & rig"}</button>
      </div>
      <p className="muted">PNG, JPG, WebP · max 10 MB</p>
      {preview && <img className="preview" src={preview} alt="Input quadruped" />}
      <p role="status">{status}</p>
      {error && <p className="error" role="alert">{error}</p>}
      {check && <details open><summary>Rig check result</summary><pre>{JSON.stringify(check, null, 2)}</pre></details>}
      <section>
        <h2>Upload & select GLB</h2>
        <div className="row">
          <label>GLB file <input type="file" accept=".glb,model/gltf-binary" onChange={event => {
            const file = event.target.files?.[0];
            if (file) void uploadGlb(file);
            event.target.value = "";
          }} /></label>
        </div>
        {uploadError && <p className="error" role="alert">{uploadError}</p>}
        <label>Model <select value={selected} onChange={event => setSelected(event.target.value)}>
          {models.map(file => <option key={file.url} value={file.url}>{file.name}</option>)}
        </select></label>
        <p className="muted">Uploaded and generated GLBs stay available in this tab.</p>
        <h2>Inspect model</h2>
        <Viewer key={selected} url={selected} />
      </section>
      {artifacts.length > 0 && <section>
        <h2>Models & byproducts</h2>
        {artifacts.map((file, index) => <div className="artifact" key={`${index}-${file.url}`}>
          {file.kind === "image" && <img className="preview" src={file.url} alt={file.name} />}
          <span>{file.name}{file.warning && <small className="error"> · {file.warning}</small>}</span>
          {file.kind === "model" && <button onClick={() => setSelected(file.url)}>View</button>}
          <a className="download" href={file.url} download={file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}>Download</a>
        </div>)}
        <p className="muted">Outputs are kept in this tab. Download them before closing or refreshing it.</p>
      </section>}
    </main>
  );
}
