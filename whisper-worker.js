/**
 * Browser Whisper (Transformers.js + ONNX WASM). No API keys.
 * Loaded as a module worker from the static site (github.io / out/).
 * Model: Xenova/whisper-base (multilingual) — better Russian than tiny; q8 keeps download feasible.
 * language forced to "ru"; task "transcribe".
 */
import { env, pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2/+esm";

env.allowLocalModels = false;
env.useBrowserCache = true;

/** Multilingual base ≈73–110 MB q8 — sweet spot for RU quality vs phone download. */
const MODEL_ID = "Xenova/whisper-base";

/** @type {Awaited<ReturnType<typeof pipeline>> | null} */
let transcriber = null;
/** @type {Promise<Awaited<ReturnType<typeof pipeline>>> | null} */
let loading = null;

async function getTranscriber(jobId) {
  if (transcriber) return transcriber;
  if (!loading) {
    loading = pipeline("automatic-speech-recognition", MODEL_ID, {
      // q8 WASM: works on Android / Yandex without WebGPU; quality comes from base vs tiny.
      dtype: "q8",
      device: "wasm",
      progress_callback: (progress) => {
        self.postMessage({ type: "progress", id: jobId, progress });
      },
    }).then((instance) => {
      transcriber = instance;
      return instance;
    });
  }
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
    const asr = await getTranscriber(id);
    self.postMessage({ type: "status", id, status: "running" });

    const audio = data.audio;
    if (!(audio instanceof Float32Array) || audio.length === 0) {
      throw new Error("empty_audio");
    }

    const language = typeof data.language === "string" && data.language ? data.language : "ru";
    const result = await asr(audio, {
      language,
      task: "transcribe",
      // Overlapping chunks reduce cut-off words in medical RU speech.
      chunk_length_s: 30,
      stride_length_s: 5,
      // Continuity across chunks helps Russian morphology.
      condition_on_previous_text: true,
    });

    const text = (typeof result === "string" ? result : result?.text || "").trim();
    self.postMessage({ type: "done", id, text });
  } catch (error) {
    const message = error && typeof error === "object" && "message" in error ? String(error.message) : String(error);
    self.postMessage({ type: "error", id, error: message || "whisper_failed" });
  }
});
