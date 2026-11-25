
import {
    pipeline,
    env
} from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.2";

// Enable browser model caching

env.allowLocalModels = false;
env.useBrowserCache = true;

// Use local CPU processing through WebAssembly

env.backends.onnx.wasm.numThreads = 1;

// Available multilingual Whisper models

const MODELS = {
    tiny: "onnx-community/whisper-tiny",
    base: "onnx-community/whisper-base",
    small: "onnx-community/whisper-small"
};

let transcriber = null;
let loadedModel = null;
let processing = false;

// Send updates to website

function send(type, data = {}) {
    self.postMessage({
        type,
        ...data
    });
}

// Load Whisper model

async function loadModel(modelSize) {

    const modelId = MODELS[modelSize] || MODELS.base;

    if (transcriber && loadedModel === modelId) {
        return transcriber;
    }

    if (transcriber) {
        await transcriber.dispose();
        transcriber = null;
        loadedModel = null;
    }

    send("loading", {
        message: "Preparing local Whisper AI model...",
        progress: 0
    });

    transcriber = await pipeline(
        "automatic-speech-recognition",
        modelId,
        {
            device: "wasm",
            dtype: "q8",

            progress_callback: (data) => {

                if (data.status === "progress") {

                    const progress = Number.isFinite(data.progress)
                        ? Math.round(data.progress)
                        : 0;

                    send("loading", {
                        message:
                            `Downloading model: ${data.file || ""} (${progress}%)`,
                        progress: progress
                    });
                }

                if (data.status === "initiate") {
                    send("loading", {
                        message:
                            `Preparing ${data.file || "model file"}...`
                    });
                }

                if (data.status === "done") {
                    send("loading", {
                        message:
                            "Model file downloaded successfully."
                    });
                }
            }
        }
    );

    loadedModel = modelId;

    return transcriber;
}

// Process audio locally

async function transcribeAudio(audio, model, language) {

    const engine = await loadModel(model);

    send("ready");

    const options = {
        task: "transcribe",
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: true
    };

    // Apply selected language

    if (language && language !== "auto") {
        options.language = language;
    }

    // Process recording in manageable sections

    const sampleRate = 16000;
    const sectionDuration = 120;
    const sectionSize = sampleRate * sectionDuration;

    const totalSections = Math.ceil(
        audio.length / sectionSize
    );

    let fullText = [];
    let allChunks = [];

    for (let i = 0; i < totalSections; i++) {

        const start = i * sectionSize;

        const end = Math.min(
            start + sectionSize,
            audio.length
        );

        const section = audio.subarray(start, end);

        const offset = start / sampleRate;

        const sectionSeconds =
            section.length / sampleRate;

        send("progress", {
            message:
                `Transcribing section ${i + 1} of ${totalSections}...`,
            progress: Math.round(
                (i / totalSections) * 100
            )
        });

        const result = await engine(
            section,
            options
        );

        if (result.text) {
            fullText.push(result.text.trim());
        }

        if (Array.isArray(result.chunks)) {

            for (const chunk of result.chunks) {

                const startTime = chunk.timestamp?.[0];

                const endTime = chunk.timestamp?.[1];

                if (!Number.isFinite(startTime)) {
                    continue;
                }

                allChunks.push({
                    text: chunk.text,
                    timestamp: [
                        startTime + offset,
                        Number.isFinite(endTime)
                            ? endTime + offset
                            : sectionSeconds + offset
                    ]
                });
            }
        }

        send("partial", {
            text: fullText.join(" ")
        });

        send("progress", {
            message:
                `Completed ${i + 1} of ${totalSections} sections.`,
            progress: Math.round(
                ((i + 1) / totalSections) * 100
            )
        });
    }

    send("complete", {
        text: fullText.join(" "),
        chunks: allChunks
    });
}

// Receive transcription request

self.onmessage = async (event) => {

    const data = event.data;

    if (data.type !== "transcribe" || processing) {
        return;
    }

    processing = true;

    try {

        if (!data.audio || !data.audio.length) {
            throw new Error("The audio file is empty.");
        }

        await transcribeAudio(
            data.audio,
            data.model,
            data.language
        );

    } catch (error) {

        send("error", {
            message: error.message || String(error)
        });

    } finally {

        processing = false;
    }
};
