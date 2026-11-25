
const $ = (id) => document.getElementById(id);

const audioFile = $("audioFile");
const dropZone = $("dropZone");
const audioPlayer = $("audioPlayer");
const fileName = $("fileName");
const transcribeBtn = $("transcribeBtn");
const cancelBtn = $("cancelBtn");
const progressBar = $("progressBar");
const statusText = $("statusText");
const transcription = $("transcription");
const wordCount = $("wordCount");

let selectedFile = null;
let worker = null;
let audioURL = null;
let chunks = [];
let busy = false;
let jobId = 0;

// Update transcription word count

function updateWordCount() {
    const text = transcription.value.trim();

    const count = text
        ? text.split(/\s+/).length
        : 0;

    wordCount.textContent = `${count} words`;
}

transcription.addEventListener(
    "input",
    updateWordCount
);

// Update processing status

function setStatus(message, progress) {
    statusText.textContent = message;

    if (typeof progress === "number") {
        progressBar.value = progress;
    }
}

// Enable or disable controls

function setBusy(value) {
    busy = value;

    transcribeBtn.disabled = value || !selectedFile;
    cancelBtn.hidden = !value;
    audioFile.disabled = value;
    $("language").disabled = value;
    $("model").disabled = value;
    $("clearBtn").disabled = value;
}

// Select audio file

function selectAudio(file) {
    if (!file || busy) return;

    selectedFile = file;
    chunks = [];

    if (audioURL) {
        URL.revokeObjectURL(audioURL);
    }

    audioURL = URL.createObjectURL(file);

    audioPlayer.src = audioURL;
    audioPlayer.hidden = false;

    const size = (file.size / 1024 / 1024).toFixed(2);

    fileName.textContent =
        `${file.name} | ${size} MB`;

    transcription.value = "";
    updateWordCount();

    transcribeBtn.disabled = false;

    setStatus("Audio selected. Ready to transcribe.", 0);
}

audioFile.addEventListener("change", (event) => {
    selectAudio(event.target.files[0]);
});

// Drag and drop functionality

dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();

    if (!busy) {
        dropZone.classList.add("dragover");
    }
});

dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("dragover");
});

dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragover");

    selectAudio(event.dataTransfer.files[0]);
});

// Convert audio to 16 kHz mono for Whisper

async function decodeAudio(file) {
    const buffer = await file.arrayBuffer();

    const context = new AudioContext();

    try {
        const decoded = await context.decodeAudioData(buffer);

        const offline = new OfflineAudioContext(
            1,
            Math.ceil(decoded.duration * 16000),
            16000
        );

        const source = offline.createBufferSource();

        source.buffer = decoded;
        source.connect(offline.destination);
        source.start(0);

        const rendered = await offline.startRendering();

        return rendered.getChannelData(0);

    } finally {
        await context.close();
    }
}

// Create background AI worker

function createWorker() {
    const instance = new Worker("./worker.js", {
        type: "module"
    });

    instance.onmessage = (event) => {
        if (worker !== instance || !busy) return;

        const data = event.data;

        switch (data.type) {

            case "loading":
                setStatus(
                    data.message || "Loading AI model...",
                    data.progress
                );
                break;

            case "ready":
                setStatus(
                    "AI model ready. Transcribing audio...",
                    0
                );
                break;

            case "progress":
                setStatus(
                    data.message || "Transcribing audio...",
                    data.progress
                );
                break;

            case "partial":
                transcription.value = data.text || "";
                updateWordCount();
                break;

            case "complete":
                transcription.value = data.text || "";
                chunks = data.chunks || [];

                updateWordCount();
                setBusy(false);

                setStatus(
                    "Transcription completed successfully.",
                    100
                );
                break;

            case "error":
                setBusy(false);

                setStatus(
                    "Error: " + data.message,
                    0
                );
                break;
        }
    };

    instance.onerror = (event) => {
        if (worker !== instance) return;

        instance.terminate();
        worker = null;

        setBusy(false);

        setStatus(
            "AI engine error: " + event.message,
            0
        );
    };

    return instance;
}

// Start transcription

transcribeBtn.addEventListener("click", async () => {

    if (!selectedFile || busy) return;

    const currentJob = ++jobId;

    setBusy(true);

    transcription.value = "";
    chunks = [];
    updateWordCount();

    setStatus("Preparing audio locally...", 0);

    try {
        const audio = await decodeAudio(selectedFile);

        if (currentJob !== jobId) return;

        if (!worker) {
            worker = createWorker();
        }

        const model = $("model").value;
        const language = $("language").value;

        setStatus("Preparing Whisper AI model...", 0);

        worker.postMessage({
            type: "transcribe",
            audio: audio,
            model: model,
            language: language
        }, [audio.buffer]);

    } catch (error) {
        if (currentJob !== jobId) return;

        setBusy(false);

        setStatus(
            "Unable to process audio: " + error.message,
            0
        );
    }
});

// Cancel transcription

cancelBtn.addEventListener("click", () => {

    jobId++;

    if (worker) {
        worker.terminate();
        worker = null;
    }

    setBusy(false);

    setStatus("Transcription cancelled.", 0);
});

// Copy transcription

$("copyBtn").addEventListener("click", async () => {

    if (!transcription.value.trim()) {
        alert("No transcription available.");
        return;
    }

    try {
        await navigator.clipboard.writeText(
            transcription.value
        );

        const button = $("copyBtn");

        button.textContent = "Copied!";

        setTimeout(() => {
            button.textContent = "Copy Text";
        }, 1500);

    } catch {
        alert("Unable to copy automatically. Please select and copy the text.");
    }
});

// Download helper

function downloadFile(content, extension, mimeType) {

    const blob = new Blob([content], {
        type: mimeType
    });

    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");

    const name = selectedFile
        ? selectedFile.name.replace(/\.[^.]+$/, "")
        : "transcription";

    link.href = url;
    link.download = `${name}.${extension}`;

    document.body.appendChild(link);

    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Download TXT

$("downloadBtn").addEventListener("click", () => {

    if (!transcription.value.trim()) {
        alert("No transcription available.");
        return;
    }

    downloadFile(
        transcription.value,
        "txt",
        "text/plain;charset=utf-8"
    );
});

// Convert seconds to subtitle timestamp

function formatTimestamp(seconds) {

    const total = Math.max(
        0,
        Math.round((seconds || 0) * 1000)
    );

    const hours = Math.floor(total / 3600000);
    const minutes = Math.floor(total / 60000) % 60;
    const secs = Math.floor(total / 1000) % 60;
    const ms = total % 1000;

    return (
        String(hours).padStart(2, "0") + ":" +
        String(minutes).padStart(2, "0") + ":" +
        String(secs).padStart(2, "0") + "," +
        String(ms).padStart(3, "0")
    );
}

// Download SRT subtitles

$("srtBtn").addEventListener("click", () => {

    const validChunks = chunks.filter(
        (chunk) =>
            chunk.timestamp &&
            Number.isFinite(chunk.timestamp[0]) &&
            Number.isFinite(chunk.timestamp[1])
    );

    if (!validChunks.length) {
        alert("No completed timestamp data available.");
        return;
    }

    const content = validChunks.map((chunk, index) => {

        const start = formatTimestamp(chunk.timestamp[0]);
        const end = formatTimestamp(chunk.timestamp[1]);

        return (
            `${index + 1}\n` +
            `${start} --> ${end}\n` +
            `${chunk.text.trim()}\n`
        );

    }).join("\n");

    downloadFile(
        content,
        "srt",
        "text/plain;charset=utf-8"
    );
});

// Clear audio and transcription

$("clearBtn").addEventListener("click", () => {

    if (busy) return;

    selectedFile = null;
    chunks = [];

    audioFile.value = "";
    transcription.value = "";

    audioPlayer.pause();
    audioPlayer.removeAttribute("src");
    audioPlayer.load();
    audioPlayer.hidden = true;

    if (audioURL) {
        URL.revokeObjectURL(audioURL);
        audioURL = null;
    }

    fileName.textContent = "No file selected";

    transcribeBtn.disabled = true;

    updateWordCount();

    setStatus("Ready to transcribe", 0);
});

// Register offline service worker

if ("serviceWorker" in navigator) {

    window.addEventListener("load", () => {

        navigator.serviceWorker
            .register("./sw.js")
            .catch((error) => {
                console.warn(
                    "Offline setup unavailable:",
                    error
                );
            });
    });
}

updateWordCount();
