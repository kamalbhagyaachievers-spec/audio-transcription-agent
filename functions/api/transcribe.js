
export async function onRequestPost(context) {
  const { request, env } = context;

  const reply = (data, status = 200) =>
    Response.json(data, {
      status,
      headers: { "Cache-Control": "no-store" }
    });

  if (!env.GEMINI_API_KEY) {
    return reply({ error: "Gemini API key is missing." }, 500);
  }

  // Keep the API closed until access protection is configured.
  if (!env.APP_ACCESS_TOKEN) {
    return reply({ error: "Access protection is not configured." }, 503);
  }

  if (request.headers.get("Authorization") !==
      `Bearer ${env.APP_ACCESS_TOKEN}`) {
    return reply({ error: "Unauthorized access." }, 401);
  }

  let uploadedFile;

  try {
    const form = await request.formData();
    const audio = form.get("audio");

    if (!audio || typeof audio.arrayBuffer !== "function" || !audio.size) {
      return reply({ error: "Please upload an audio file." }, 400);
    }

    if (audio.size > 90 * 1024 * 1024) {
      return reply({ error: "File exceeds the 90 MB upload limit." }, 413);
    }

    const extension = audio.name.split(".").pop().toLowerCase();

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

    const mimeType = formats[extension];

    if (!mimeType) {
      return reply({ error: "Unsupported file format." }, 400);
    }

    const apiHeaders = {
      "x-goog-api-key": env.GEMINI_API_KEY
    };

    const prompt = `
You are a professional audio transcription engine
for Bhagya Achievers.

Transcribe the complete recording from beginning to end.

STRICT RULES:
1. Preserve the actual spoken words.
2. Do not summarize or translate the conversation.
3. Preserve Hindi, English and Hinglish.
4. Identify speakers consistently as Speaker A,
   Speaker B, or additional speakers if necessary.
5. Include a timestamp at every speaker turn.
6. Use timestamps relative to the original recording.
7. Never invent dialogue or repeat sentences
   that were not actually spoken.
8. Mark unclear words as [Inaudible].
9. Do not add sales feedback, scores or analysis.
10. Return plain text only.

OUTPUT FORMAT:

Speaker A (00:02)
Hello, good morning.

Speaker B (00:05)
Yes, good morning.

Continue this format for the entire recording.
`;

    let mediaPart;

    if (audio.size <= 14 * 1024 * 1024) {
      const bytes = new Uint8Array(await audio.arrayBuffer());
      let binary = "";

      for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode(
          ...bytes.subarray(i, i + 8192)
        );
      }

      mediaPart = {
        inline_data: {
          mime_type: mimeType,
          data: btoa(binary)
        }
      };
    } else {
      // Use the Gemini Files API for larger recordings.
      const start = await fetch(
        "https://generativelanguage.googleapis.com/upload/v1beta/files",
        {
          method: "POST",
          headers: {
            ...apiHeaders,
            "Content-Type": "application/json",
            "X-Goog-Upload-Protocol": "resumable",
            "X-Goog-Upload-Command": "start",
            "X-Goog-Upload-Header-Content-Length": String(audio.size),
            "X-Goog-Upload-Header-Content-Type": mimeType
          },
          body: JSON.stringify({
            file: { display_name: "BA Call Recording" }
          })
        }
      );

      if (!start.ok) {
        return reply({ error: "Unable to initialize audio upload." }, 502);
      }

      const uploadUrl = start.headers.get("X-Goog-Upload-URL");

      if (!uploadUrl) {
        return reply({ error: "Upload URL is missing." }, 502);
      }

      const upload = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          "Content-Length": String(audio.size),
          "X-Goog-Upload-Offset": "0",
          "X-Goog-Upload-Command": "upload, finalize"
        },
        body: audio
      });

      if (!upload.ok) {
        return reply({ error: "Audio upload failed." }, 502);
      }

      uploadedFile = (await upload.json()).file;

      for (let i = 0;
           uploadedFile.state === "PROCESSING" && i < 40;
           i++) {

        await new Promise(resolve => setTimeout(resolve, 2000));

        const check = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/${uploadedFile.name}`,
          { headers: apiHeaders }
        );

        if (!check.ok) {
          return reply({ error: "File processing failed." }, 502);
        }

        uploadedFile = await check.json();
      }

      if (uploadedFile.state !== "ACTIVE") {
        return reply({
          error: "Recording could not be prepared in time."
        }, 502);
      }

      mediaPart = {
        file_data: {
          mime_type: uploadedFile.mimeType || mimeType,
          file_uri: uploadedFile.uri
        }
      };
    }

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent",
      {
        method: "POST",
        headers: {
          ...apiHeaders,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [{
            role: "user",
            parts: [
              { text: prompt },
              mediaPart
            ]
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 32768
          }
        })
      }
    );

    const result = await response.json();

    if (response.status === 429) {
      return reply({
        error: "Gemini quota reached. Please try again after the quota resets."
      }, 429);
    }

    if (!response.ok) {
      return reply({
        error: `Gemini API request failed (${response.status}).`
      }, 502);
    }

    const candidate = result.candidates?.[0];

    const transcription = candidate?.content?.parts
      ?.filter(part => !part.thought)
      .map(part => part.text || "")
      .join("\n")
      .trim();

    if (!transcription) {
      return reply({ error: "No transcription was returned." }, 502);
    }

    if (candidate.finishReason !== "STOP") {
      return reply({
        error: "Transcription may be incomplete.",
        transcription,
        incomplete: true
      }, 422);
    }

    return reply({
      success: true,
      transcription,
      feedback: null,
      feedbackStatus: "Coming Soon"
    });

  } catch (error) {
    return reply({
      error: "Transcription failed. Please try again."
    }, 500);

  } finally {
    if (uploadedFile?.name) {
      try {
        await fetch(
          `https://generativelanguage.googleapis.com/v1beta/${uploadedFile.name}`,
          {
            method: "DELETE",
            headers: {
              "x-goog-api-key": env.GEMINI_API_KEY
            }
          }
        );
      } catch {
        // File cleanup could not be completed.
      }
    }
  }
}
