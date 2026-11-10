/**
 * Browser Whisper (Transformers.js + ONNX WASM). No API keys.
 * Loaded as a module worker from the static site (github.io / out/).
 * Model: Xenova/whisper-tiny (multilingual, Russian via language:"ru").
 */
import { env, pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2/+esm";

env.allowLocalModels = false;
env.useBrowserCache = true;

const MODEL_ID = "Xenova/whisper-tiny";

/** @type {Awaited<ReturnType<typeof pipeline>> | null} */
let transcriber = null;
/** @type {Promise<Awaited<ReturnType<typeof pipeline>>> | null} */
let loading = null;

async function getTranscriber(jobId) {
  if (transcriber) return transcriber;
  if (!loading) {
    loading = pipeline("automatic-speech-recognition", MODEL_ID, {
      dtype: "q8",
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
      // Chunk long clips; tiny model stays usable in WASM.
      chunk_length_s: 30,
      stride_length_s: 5,
    });

    const text = (typeof result === "string" ? result : result?.text || "").trim();
    self.postMessage({ type: "done", id, text });
  } catch (error) {
    const message = error && typeof error === "object" && "message" in error ? String(error.message) : String(error);
    self.postMessage({ type: "error", id, error: message || "whisper_failed" });
  }
});
