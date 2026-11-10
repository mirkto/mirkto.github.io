/**
 * Browser Whisper (Transformers.js + ONNX WASM). No API keys.
 * Loaded as a module worker from the static site (github.io / out/).
 * Default model: Xenova/whisper-small (multilingual) q8 — better Russian than base.
 * Main thread may pass modelId (desktop small / Android base). language forced to "ru".
 */
import { env, pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2/+esm";

env.allowLocalModels = false;
env.useBrowserCache = true;

/** Desktop default ≈240–250 MB q8 — better medical RU than base. */
const DEFAULT_MODEL_ID = "Xenova/whisper-small";

/** @type {string | null} */
let loadedModelId = null;
/** @type {Awaited<ReturnType<typeof pipeline>> | null} */
let transcriber = null;
/** @type {Promise<Awaited<ReturnType<typeof pipeline>>> | null} */
let loading = null;

async function getTranscriber(jobId, modelId) {
  const wanted = typeof modelId === "string" && modelId ? modelId : DEFAULT_MODEL_ID;
  if (transcriber && loadedModelId === wanted) return transcriber;
  if (loading && loadedModelId === wanted) return loading;

  loadedModelId = wanted;
  transcriber = null;
  loading = pipeline("automatic-speech-recognition", wanted, {
    // q8 WASM: works on Android / Yandex without WebGPU.
    dtype: "q8",
    device: "wasm",
    progress_callback: (progress) => {
      self.postMessage({ type: "progress", id: jobId, progress });
    },
  }).then((instance) => {
    transcriber = instance;
    return instance;
  });
  return loading;
}

self.addEventListener("message", async (event) => {
  const data = event.data || {};
  const { type, id } = data;

  if (type === "ping") {
    self.postMessage({ type: "pong", id });
    return;
  }

  if (type !== "transcribe") return;

  try {
    const asr = await getTranscriber(id, data.modelId);
    self.postMessage({ type: "status", id, status: "running" });

    const audio = data.audio;
    if (!(audio instanceof Float32Array) || audio.length === 0) {
      throw new Error("empty_audio");
    }

    const language = typeof data.language === "string" && data.language ? data.language : "ru";
    // Shorter overlapping chunks + previous-text conditioning help Russian morphology / medical phrases.
    const result = await asr(audio, {
      language,
      task: "transcribe",
      chunk_length_s: 20,
      stride_length_s: 4,
      condition_on_previous_text: true,
      temperature: 0,
    });

    const text = (typeof result === "string" ? result : result?.text || "").trim();
    self.postMessage({ type: "done", id, text });
  } catch (error) {
    const message = error && typeof error === "object" && "message" in error ? String(error.message) : String(error);
    self.postMessage({ type: "error", id, error: message || "whisper_failed" });
  }
});
