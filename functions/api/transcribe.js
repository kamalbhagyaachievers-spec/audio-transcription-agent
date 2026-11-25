
const BASE = "https://generativelanguage.googleapis.com";
const MODEL = "gemini-3.8-flash";

function reply(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export async function onRequestGet() {
  return reply({
    success: true,
    service: "BA Transcription API",
    model: MODEL,
    status: "Backend is active"
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const key = env.GEMINI_API_KEY;

  if (!key) {
    return reply({
      error: "GEMINI_API_KEY is missing in Cloudflare."
    }, 500);
  }

  const headers = {
    "x-goog-api-key": key
  };

  let uploadedFile = null;
  let step = "Initialization";

  async function readResponse(response) {
    const raw = await response.text();

    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(
        `Google returned a non-JSON response (${response.status}).`
      );
    }

    if (!response.ok) {
      throw new Error(
        `Google API ${response.status}: ` +
        (data.error?.message || "Request failed.")
      );
    }

    return data;
  }

  try {

    step = "Reading recording";

    const form = await request.formData();
    const audio = form.get("audio");

    if (!audio || typeof audio.arrayBuffer !== "function" || !audio.size) {
      return reply({
        error: "Please upload an audio recording."
      }, 400);
    }

    if (audio.size > 90 * 1024 * 1024) {
      return reply({
        error: "Recording exceeds the 90 MB limit."
      }, 413);
    }

    const extension = audio.name
      .split(".")
      .pop()
      .toLowerCase();

    const formats = {
      mp3: "audio/mp3",
      mp4: "video/mp4",
      m4a: "audio/m4a",
      wav: "audio/wav",
      ogg: "audio/ogg",
      flac: "audio/flac",
      aac: "audio/aac",
      webm: "audio/webm"
    };

    const mimeType = formats[extension];

    if (!mimeType) {
      return reply({
        error: "Unsupported recording format."
      }, 400);
    }

    // Upload using Gemini Files API.

    step = "Starting Google file upload";

    const start = await fetch(
      `${BASE}/upload/v1beta/files`,
      {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "X-Goog-Upload-Protocol": "resumable",
          "X-Goog-Upload-Command": "start",
          "X-Goog-Upload-Header-Content-Length":
            String(audio.size),
          "X-Goog-Upload-Header-Content-Type":
            mimeType
        },
        body: JSON.stringify({
          file: {
            display_name: "BA Call Recording"
          }
        })
      }
    );

    if (!start.ok) {
      await readResponse(start);
    }

    const uploadUrl = start.headers.get(
      "X-Goog-Upload-URL"
    );

    if (!uploadUrl) {
      throw new Error("Google upload URL not received.");
    }

    step = "Uploading recording";

    const uploadResponse = await fetch(
      uploadUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": mimeType,
          "Content-Length": String(audio.size),
          "X-Goog-Upload-Offset": "0",
          "X-Goog-Upload-Command": "upload, finalize"
        },
        body: audio
      }
    );

    const uploadResult = await readResponse(
      uploadResponse
    );

    uploadedFile = uploadResult.file;

    if (!uploadedFile?.name) {
      throw new Error("Google did not return a file.");
    }

    // Wait until Google finishes processing.

    step = "Preparing recording";

    for (let i = 0; i < 40; i++) {

      if (uploadedFile.state === "ACTIVE") {
        break;
      }

      if (uploadedFile.state === "FAILED") {
        throw new Error(
          "Google could not process this recording."
        );
      }

      await new Promise(resolve =>
        setTimeout(resolve, 2000)
      );

      const check = await fetch(
        `${BASE}/v1beta/${uploadedFile.name}`,
        { headers }
      );

      uploadedFile = await readResponse(check);
    }

    if (uploadedFile.state !== "ACTIVE") {
      throw new Error(
        "Recording preparation timed out."
      );
    }

    // Transcription instructions.

    const prompt = `
You are the professional audio transcription
engine for Bhagya Achievers.

Transcribe the entire recording accurately
from beginning to end.

REQUIREMENTS:

- Preserve the actual spoken conversation.
- Automatically detect Hindi, English and Hinglish.
- Preserve the original spoken language.
- Do not translate or summarize.
- Identify speakers consistently.
- Add timestamps at every speaker turn.
- Use timestamps relative to the original recording.
- Do not invent dialogue.
- Do not repeat unspoken sentences.
- Mark unclear sections as [Inaudible].
- Do not add feedback, analysis or scores.
- Return plain text only.

OUTPUT FORMAT:

Speaker A (00:02)
Hello, good morning.

Speaker B (00:05)
Yes, good morning ma'am.

Speaker A (00:08)
Aap kaunsa attempt target kar rahe ho?

Continue until the end of the recording.
`;

    step = "Generating transcription";

    const response = await fetch(
      `${BASE}/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  fileData: {
                    mimeType: uploadedFile.mimeType || mimeType,
                    fileUri: uploadedFile.uri
                  }
                },
                {
                  text: prompt
                }
              ]
            }
          ],
          generationConfig: {
            maxOutputTokens: 32768
          }
        })
      }
    );

    const result = await readResponse(response);

    const candidate = result.candidates?.[0];

    const transcription = candidate?.content?.parts
      ?.filter(part => !part.thought)
      .map(part => part.text || "")
      .join("\n")
      .trim();

    if (!transcription) {
      throw new Error(
        "Gemini returned no transcription. Reason: " +
        (
          candidate?.finishReason ||
          result.promptFeedback?.blockReason ||
          "Unknown"
        )
      );
    }

    if (candidate.finishReason !== "STOP") {
      return reply({
        success: false,
        transcription,
        incomplete: true,
        error: "Transcription may be incomplete: " +
          candidate.finishReason
      }, 422);
    }

    return reply({
      success: true,
      model: MODEL,
      transcription,
      feedback: null,
      feedbackStatus: "Coming Soon"
    });

  } catch (error) {

    const message = String(
      error.message || "Unknown error"
    ).split(key).join("[REDACTED]");

    console.error(step, message);

    return reply({
      success: false,
      error: `${step}: ${message}`
    }, message.includes("API 429") ? 429 : 502);

  } finally {

    // Remove uploaded recording after processing.

    if (uploadedFile?.name) {
      try {
        await fetch(
          `${BASE}/v1beta/${uploadedFile.name}`,
          {
            method: "DELETE",
            headers
          }
        );
      } catch {
        console.error("File cleanup failed.");
      }
    }
  }
}
