"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { modelUrl, outputFiles, type Artifact } from "@/lib/artifacts";
import { validateGlb } from "@/lib/glb";
import { RIG_TYPES, type RigType } from "@/lib/rig-types";
import { ENVIRONMENTS, type EnvironmentId } from "@/lib/environments/study-lounge";
import type { ViewerView } from "@/components/viewer";

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
  const [tab, setTab] = useState<"view" | "generate">("view");
  const [view, setView] = useState<ViewerView>("model");
  const [environmentId, setEnvironmentId] = useState<EnvironmentId>("default");
  const [scene, setScene] = useState({ url: "/dog-animated.glb", view: "model" as ViewerView, environmentId: "default" as EnvironmentId });
  const [sceneActive, setSceneActive] = useState(false);
  const onEnvironmentChange = useCallback((id: EnvironmentId) => {
    setEnvironmentId(id);
    setScene(previous => ({ ...previous, environmentId: id }));
  }, []);
  const [image, setImage] = useState<File | null>(null);
  const [rigType, setRigType] = useState<RigType | "none">("quadruped");
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [artifacts, setArtifacts] = useState<Artifact[]>([
    { name: "Animated dog.glb", url: "/dog-animated.glb", kind: "model" },
    { name: "Animated Pikachu.glb", url: "/Pikachu.glb", kind: "model" },
    { name: "Animated LeBron James.glb", url: "/lebron-animated.glb", kind: "model" },
    { name: "Animated Keanu Reeves.glb", url: "/keanu-animated.glb", kind: "model" },
  ]);
  const [selected, setSelected] = useState("/dog-animated.glb");
  const [uploadError, setUploadError] = useState("");
  const [check, setCheck] = useState<Result | null>(null);
  const objectUrls = useRef<string[]>([]);
  const active = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!image) { setPreview(""); return; }
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
      setSelected(url); setSceneActive(false);
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
    if (model) { setSelected(model.url); setSceneActive(false); }
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

      if (rigType === "none") {
        setStatus("Done. Rigging skipped. Open View to inspect your model.");
        return;
      }

      async function startTripo(action: "check" | "rig") {
        return json<{ taskId: string }>("/api/pipeline", {
          method: "POST", headers: { "Content-Type": "application/json" }, signal,
          body: JSON.stringify({ action, modelUrl: meshUrl, rigType }),
        });
      }
      setStatus("Starting Tripo rig check…");
      const checking = await startTripo("check");
      const checked = await poll("tripo", checking.taskId, "Checking riggability", signal);
      await keepOutputs("Rig check", checked, signal);
      const output = checked.output as Result | undefined;
      setCheck(output || checked);
      if (output?.riggable !== true) throw new Error("Tripo reports that this model cannot be rigged. The Trellis model is available below.");

      setStatus(`Starting ${rigType} auto rig…`);
      const rigging = await startTripo("rig");
      const rigged = await poll("tripo", rigging.taskId, `Auto rigging ${rigType}`, signal);
      await keepOutputs("Auto rig", rigged, signal);
      if (!modelUrl(rigged)) throw new Error("Tripo returned no rigged GLB. Check the Auto rig report below.");
      setStatus("Done. Open View to inspect your model.");
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
    <div className="app-shell">
      <header className="toolbar">
        <a className="brand" href="/" aria-label="Studio home"><span className="brand-mark" aria-hidden="true">S</span><span>Studio</span></a>
        <nav className="tabs" aria-label="Workspace">
          <button aria-pressed={tab === "view"} onClick={() => setTab("view")}>View</button>
          <button aria-pressed={tab === "generate"} onClick={() => { setTab("generate"); setSceneActive(false); }}>Generate</button>
        </nav>
      </header>
      <main>
        {tab === "view" ? <>
          <div className="page-heading"><h1>View</h1><p className="muted">Explore an environment or bring a character into it.</p></div>
          <div className="view-workspace">
            <aside className="view-settings" aria-label="View settings">
              <label className="field">View type
                <select value={view} onChange={event => { setView(event.target.value as ViewerView); setSceneActive(false); }}>
                  <option value="model">Model</option>
                  <option value="animation">Animation</option>
                  <option value="firstPerson">First person</option>
                  <option value="lifelike">Lifelike</option>
                </select>
              </label>
              <label className="field">Environment
                <select value={environmentId} onChange={event => { setEnvironmentId(event.target.value as EnvironmentId); setSceneActive(false); }}>
                  {ENVIRONMENTS.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
                </select>
              </label>
              <div className="model-settings">
                <label className="field">Model <span className="optional">Optional</span>
                  <select value={selected} onChange={event => { setSelected(event.target.value); setSceneActive(false); }}>
                    <option value="">No model</option>
                    {models.map(file => <option key={file.url} value={file.url}>{file.name}</option>)}
                  </select>
                </label>
                <p className="field-hint">Choose No model to explore on your own.</p>
                <label className="field upload-field">Upload a model
                  <input type="file" accept=".glb,model/gltf-binary" onChange={event => {
                    const file = event.target.files?.[0];
                    if (file) void uploadGlb(file);
                    event.target.value = "";
                  }} />
                </label>
                {uploadError && <p className="error" role="alert">{uploadError}</p>}
              </div>
              <button className="primary-button activate-view" onClick={() => {
                setScene({ url: selected, view, environmentId }); setSceneActive(true);
              }}>View</button>
              <p className="scene-state" role="status">{sceneActive ? "Scene active" : "Scene paused · click View to start"}</p>
            </aside>
            <section className="viewer-panel" aria-label="Scene preview">
              <Viewer key={scene.url} url={scene.url} view={scene.view} environmentId={scene.environmentId} onEnvironmentChange={onEnvironmentChange} active={sceneActive} />
            </section>
          </div>
        </> : <>
          <div className="page-heading"><h1>Generate</h1><p className="muted">Create a model from an image.</p></div>
          <div className="generate-workspace">
            <section className="panel">
              <h2>Model</h2>
              <p className="muted">Upload an image and choose how to rig your model.</p>
              <label className="field">Image
                <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={event => setImage(event.target.files?.[0] || null)} />
              </label>
              <p className="field-hint">PNG, JPG, WebP · max 10 MB</p>
              {preview && <img className="preview" src={preview} alt="Input character or creature" />}
              <label className="field">Rig type
                <select value={rigType} disabled={busy} onChange={event => setRigType(event.target.value as RigType | "none")}>
                  <option value="none">No rigging</option>
                  {RIG_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
                </select>
              </label>
              <button className="primary-button" onClick={run} disabled={!image || busy}>{busy ? "Processing…" : rigType === "none" ? "Generate model" : "Generate & rig"}</button>
              {status && <p role="status">{status}</p>}
              {error && <p className="error" role="alert">{error}</p>}
              {check && <details><summary>Rig check result</summary><pre>{JSON.stringify(check, null, 2)}</pre></details>}
            </section>
            <div className="deferred-generators">
              <section className="panel placeholder-panel" aria-label="Behavior generator, coming soon">
                <div className="panel-heading"><h2>Behavior</h2><span className="coming-soon">Coming soon</span></div>
                <p className="muted">Define how your character acts and responds.</p>
              </section>
              <section className="panel placeholder-panel">
                <div className="panel-heading"><h2>Image</h2><span className="coming-soon">Coming soon</span></div>
                <p className="muted">Create an image from a reference and an optional prompt.</p>
                <fieldset disabled>
                  <label className="field">Reference image<input type="file" accept="image/png,image/jpeg,image/webp" /></label>
                  <label className="field">Prompt <span className="optional">Optional</span><textarea rows={2} placeholder="Describe your image" /></label>
                  <button>Generate image</button>
                </fieldset>
              </section>
            </div>
          </div>
          {artifacts.length > 0 && <section className="panel outputs">
            <h2>Library & downloads</h2>
            {artifacts.map((file, index) => <div className="artifact" key={`${index}-${file.url}`}>
              {file.kind === "image" && <img className="artifact-preview" src={file.url} alt={file.name} />}
              <span>{file.name}{file.warning && <small className="error"> · {file.warning}</small>}</span>
              {file.kind === "model" && <button onClick={() => { setSelected(file.url); setSceneActive(false); setTab("view"); }}>View</button>}
              <a className="download" href={file.url} download={file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}>Download</a>
            </div>)}
            <p className="field-hint">Uploads and generated files stay in this tab. Download them before refreshing or closing it.</p>
          </section>}
        </>}
      </main>
    </div>
  );
}
