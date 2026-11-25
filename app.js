
const audioFile = document.getElementById("audioFile");
const dropZone = document.getElementById("dropZone");
const audioPlayer = document.getElementById("audioPlayer");
const fileName = document.getElementById("fileName");
const transcribeBtn = document.getElementById("transcribeBtn");
const cancelBtn = document.getElementById("cancelBtn");
const progressBar = document.getElementById("progressBar");
const statusText = document.getElementById("statusText");
const transcription = document.getElementById("transcription");
const wordCount = document.getElementById("wordCount");
const copyBtn = document.getElementById("copyBtn");
const downloadBtn = document.getElementById("downloadBtn");
const clearBtn = document.getElementById("clearBtn");
const srtBtn = document.getElementById("srtBtn");

let selectedFile = null;
let controller = null;
let audioURL = null;
let progressTimer = null;
let running = false;

// Update progress display.

function setProgress(value) {
  if (!progressBar) return;

  progressBar.style.width = value + "%";

  if (progressBar.tagName === "PROGRESS") {
    progressBar.value = value;
  }
}

function setStatus(message) {
  if (statusText) {
    statusText.textContent = message;
  }
}

// Read and display transcription.

function getText() {
  return "value" in transcription
    ? transcription.value
    : transcription.textContent;
}

function setText(text) {
  if ("value" in transcription) {
    transcription.value = text;
  } else {
    transcription.textContent = text;
  }

  updateWordCount();
}

function updateWordCount() {
  const text = getText().trim();
  const count = text ? text.split(/\s+/).length : 0;

  if (wordCount) {
    wordCount.textContent = count + " words";
  }
}

// Handle uploaded recording.

function selectFile(file) {
  if (!file || running) return;

  const allowed = [
    "mp3", "mp4", "wav", "m4a",
    "ogg", "flac", "aac", "webm"
  ];

  const extension = file.name
    .split(".")
    .pop()
    .toLowerCase();

  if (!allowed.includes(extension)) {
    setStatus("Unsupported audio format.");
    return;
  }

  if (file.size > 90 * 1024 * 1024) {
    setStatus("Maximum file size is 90 MB.");
    return;
  }

  selectedFile = file;

  if (fileName) {
    fileName.textContent =
      file.name + " (" +
      (file.size / 1024 / 1024).toFixed(2) +
      " MB)";
  }

  if (audioURL) {
    URL.revokeObjectURL(audioURL);
  }

  audioURL = URL.createObjectURL(file);

  if (audioPlayer) {
    audioPlayer.src = audioURL;
    audioPlayer.hidden = false;
    audioPlayer.style.display = "block";
  }

  setText("");
  setProgress(0);
  setStatus("Recording ready for transcription.");

  transcribeBtn.disabled = false;
}

audioFile.accept =
  "audio/*,video/mp4,.mp3,.mp4,.wav,.m4a,.ogg,.flac,.aac,.webm";

audioFile.addEventListener("change", event => {
  selectFile(event.target.files[0]);
});

// Drag and drop support.

if (dropZone) {
  dropZone.addEventListener("dragover", event => {
    event.preventDefault();
    dropZone.classList.add("dragover");
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("dragover");
  });

  dropZone.addEventListener("drop", event => {
    event.preventDefault();
    dropZone.classList.remove("dragover");
    selectFile(event.dataTransfer.files[0]);
  });

  dropZone.addEventListener("click", event => {
    if (!event.target.closest("input, button, label, audio")) {
      audioFile.click();
    }
  });
}

// Generate transcription using Gemini.

transcribeBtn.addEventListener("click", async () => {
  if (running) return;

  if (!selectedFile) {
    setStatus("Please upload a recording first.");
    return;
  }

  running = true;
  controller = new AbortController();

  transcribeBtn.disabled = true;
  audioFile.disabled = true;

  if (cancelBtn) {
    cancelBtn.disabled = false;
  }

  setText("");
  setProgress(5);

  setStatus(
    "Uploading recording to Gemini AI..."
  );

  let progress = 5;

  // Estimated progress, not actual API progress.

  progressTimer = setInterval(() => {
    progress = Math.min(progress + 1, 90);
    setProgress(progress);

    setStatus(
      "Gemini is processing your recording. Please wait..."
    );
  }, 1500);

  try {
    const formData = new FormData();

    formData.append("audio", selectedFile);

    const response = await fetch("/api/transcribe", {
      method: "POST",
      body: formData,
      signal: controller.signal
    });

    const result = await response.json();

    if (result.transcription) {
      setText(result.transcription);
    }

    if (!response.ok) {
      throw new Error(
        result.error || "Transcription failed."
      );
    }

    if (!result.transcription) {
      throw new Error(
        "No transcription received."
      );
    }

    setProgress(100);

    setStatus(
      "Transcription completed successfully!"
    );

  } catch (error) {

    if (error.name === "AbortError") {
      setStatus("Transcription request cancelled.");
    } else {
      setStatus(error.message);
    }

    setProgress(0);

  } finally {

    clearInterval(progressTimer);

    running = false;
    controller = null;

    transcribeBtn.disabled = false;
    audioFile.disabled = false;

    if (cancelBtn) {
      cancelBtn.disabled = true;
    }
  }
});

// Cancel transcription request.

if (cancelBtn) {
  cancelBtn.addEventListener("click", () => {
    if (controller) {
      controller.abort();
    }
  });
}

// Copy transcription.

if (copyBtn) {
  copyBtn.addEventListener("click", async () => {
    const text = getText();

    if (!text.trim()) {
      setStatus("No transcription available.");
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      setStatus("Transcription copied.");
    } catch {
      setStatus("Unable to copy. Select text manually.");
    }
  });
}

// Download file helper.

function downloadFile(content, name, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");

  link.href = url;
  link.download = name;

  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function outputName() {
  return selectedFile
    ? selectedFile.name.replace(/\.[^.]+$/, "")
    : "BA-Transcription";
}

// Download TXT.

if (downloadBtn) {
  downloadBtn.addEventListener("click", () => {
    const text = getText();

    if (!text.trim()) {
      setStatus("No transcription available.");
      return;
    }

    downloadFile(
      text,
      outputName() + "-Transcription.txt",
      "text/plain;charset=utf-8"
    );

    setStatus("Text file downloaded.");
  });
}

// Word-compatible document export.

function escapeHTML(text) {
  return text.replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

if (srtBtn) {
  srtBtn.textContent = "Download Word";

  srtBtn.addEventListener("click", () => {
    const text = getText();

    if (!text.trim()) {
      setStatus("No transcription available.");
      return;
    }

    const html = `
      <html>
      <head>
      <meta charset="UTF-8">
      </head>
      <body style="font-family:Calibri;font-size:11pt;">
      <h1 style="color:#b91c1c;">
        Bhagya Achievers
      </h1>
      <h2>Sales Call Transcription</h2>
      <p>${escapeHTML(outputName())}</p>
      <hr>
      <div style="white-space:pre-wrap;">
        ${escapeHTML(text)}
      </div>
      </body>
      </html>
    `;

    downloadFile(
      "\ufeff" + html,
      outputName() + "-Transcription.doc",
      "application/msword"
    );

    setStatus("Word-compatible document downloaded.");
  });
}

// Clear transcription and recording.

if (clearBtn) {
  clearBtn.addEventListener("click", () => {
    if (running) {
      setStatus("Cancel the current request first.");
      return;
    }

    selectedFile = null;
    audioFile.value = "";

    if (audioURL) {
      URL.revokeObjectURL(audioURL);
      audioURL = null;
    }

    if (audioPlayer) {
      audioPlayer.removeAttribute("src");
      audioPlayer.load();
    }

    if (fileName) {
      fileName.textContent = "No file selected";
    }

    setText("");
    setProgress(0);
    setStatus("Upload a recording to begin.");

    transcribeBtn.disabled = true;
  });
}

// Update word count after manual editing.

transcription.addEventListener(
  "input",
  updateWordCount
);

// Initial interface state.

transcribeBtn.disabled = true;

if (cancelBtn) {
  cancelBtn.disabled = true;
}

setProgress(0);
setStatus("Upload a recording to begin.");
