
const BASE = "https://generativelanguage.googleapis.com";
const MODEL = "gemini-3.8-flash";

const INLINE_LIMIT = 14 * 1024 * 1024;
const MAX_SIZE = 90 * 1024 * 1024;

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
    version: "3.0",
    model: MODEL,
    status: "Backend is active"
  });
}

export async function onRequestPost(context) {

  const { request, env } = context;
  const key = env.GEMINI_API_KEY;

  if (!key) {
    return reply({
      error: "Gemini API key is missing."
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
        `Non-JSON API response (${response.status})`
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

    if (
      !audio ||
      typeof audio.arrayBuffer !== "function" ||
      !audio.size
    ) {
      return reply({
        error: "Please upload a recording."
      }, 400);
    }

    if (audio.size > MAX_SIZE) {
      return reply({
        error: "Maximum recording size is 90 MB."
      }, 413);
    }

    const extension = audio.name
      .split(".")
      .pop()
      .toLowerCase();

    const formats = {
      mp3: "audio/mpeg",
      mp4: "video/mp4",
      m4a: "audio/mp4",
      wav: "audio/wav",
      ogg: "audio/ogg",
      flac: "audio/flac",
      aac: "audio/aac",
      webm: "audio/webm"
    };

    let mimeType = formats[extension];

    if (!mimeType) {
      return reply({
        error: "Unsupported recording format."
      }, 400);
    }

    if (
      extension === "mp4" &&
      audio.type === "audio/mp4"
    ) {
      mimeType = "audio/mp4";
    }

    if (
      extension === "webm" &&
      audio.type === "video/webm"
    ) {
      mimeType = "video/webm";
    }

    const prompt = `
You are the professional transcription engine
for Bhagya Achievers.

Transcribe the complete spoken conversation
from the beginning to the end of the recording.

STRICT INSTRUCTIONS:

1. Preserve the original spoken words.
2. Support Hindi, English and Hinglish.
3. Do not translate the conversation.
4. Do not summarize the conversation.
5. Identify each speaker consistently.
6. Add a timestamp at every speaker change.
7. Use timestamps from the original recording.
8. Do not fabricate any dialogue.
9. Do not repeat sentences unnecessarily.
10. Mark unclear speech as [Inaudible].
11. Ignore visual content and focus on speech.
12. Do not provide feedback or analysis.
13. Return plain text only.
14. Do not skip any portion of the conversation.

OUTPUT FORMAT:

Speaker A (00:02)
Hello, good morning.

Speaker B (00:05)
Yes, good morning ma'am.

Speaker A (00:09)
Aap kaunsa attempt target kar rahe ho?

Continue until the recording ends.
`;

    let mediaPart;
    let uploadMethod;

    // Direct upload for smaller recordings.

    if (audio.size <= INLINE_LIMIT) {

      step = "Preparing direct upload";
      uploadMethod = "Direct Inline Upload";

      const buffer = await audio.arrayBuffer();
      const bytes = new Uint8Array(buffer);

      let binary = "";

      for (
        let i = 0;
        i < bytes.length;
        i += 8192
      ) {
        binary += String.fromCharCode(
          ...bytes.subarray(i, i + 8192)
        );
      }

      const base64 = btoa(binary);

      mediaPart = {
        inlineData: {
          mimeType: mimeType,
          data: base64
        }
      };

    } else {

      // Files API for larger recordings.

      uploadMethod = "Gemini Files API";

      step = "Initializing large file upload";

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
        throw new Error(
          "Google upload URL not received."
        );
      }

      step = "Uploading large recording";

      const uploadResponse = await fetch(
        uploadUrl,
        {
          method: "POST",
          headers: {
            "Content-Length": String(audio.size),
            "Content-Type": mimeType,
            "X-Goog-Upload-Offset": "0",
            "X-Goog-Upload-Command":
              "upload, finalize"
          },
          body: audio
        }
      );

      const uploadResult = await readResponse(
        uploadResponse
      );

      uploadedFile = uploadResult.file;

      if (!uploadedFile?.name) {
        throw new Error(
          "Google did not return a file."
        );
      }

      step = "Processing large recording";

      for (let i = 0; i < 30; i++) {

        if (uploadedFile.state === "ACTIVE") {
          break;
        }

        if (uploadedFile.state === "FAILED") {
          throw new Error(
            uploadedFile.error?.message ||
            "Google could not decode this recording."
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
          uploadedFile.error?.message ||
          "Recording processing did not complete."
        );
      }

      mediaPart = {
        fileData: {
          mimeType:
            uploadedFile.mimeType || mimeType,
          fileUri: uploadedFile.uri
        }
      };
    }

    // Generate complete transcription.

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
              role: "user",
              parts: [
                mediaPart,
                { text: prompt }
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

    const transcription = candidate
      ?.content
      ?.parts
      ?.filter(part => !part.thought)
      .map(part => part.text || "")
      .join("\n")
      .trim();

    if (!transcription) {
      throw new Error(
        "No transcription received. Reason: " +
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
        error:
          "Transcription may be incomplete: " +
          candidate.finishReason
      }, 422);
    }

    return reply({
      success: true,
      transcription,
      model: MODEL,
      uploadMethod,
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
