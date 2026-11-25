
const API_URL =
  "https://api.groq.com/openai/v1/audio/transcriptions";

const MODEL = "whisper-large-v3";
const MAX_SIZE = 25 * 1000 * 1000;

function reply(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function timestamp(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  return [h, m, s]
    .map(n => String(n).padStart(2, "0"))
    .join(":");
}

export async function onRequestGet(context) {
  return reply({
    success: true,
    service: "Bhagya Achievers Transcription API",
    version: "4.0",
    provider: "Groq",
    model: MODEL,
    apiKeyConfigured: Boolean(context.env.GROQ_API_KEY),
    status: "Backend is active"
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const apiKey = env.GROQ_API_KEY;

  if (!apiKey) {
    return reply({
      success: false,
      error: "GROQ_API_KEY is missing in Cloudflare."
    }, 500);
  }

  try {
    const incoming = await request.formData();
    const audio = incoming.get("audio");

    if (
      !audio ||
      typeof audio.arrayBuffer !== "function" ||
      !audio.size
    ) {
      return reply({
        success: false,
        error: "Please upload a valid audio recording."
      }, 400);
    }

    if (audio.size > MAX_SIZE) {
      return reply({
        success: false,
        error: "Maximum file size is 25 MB on Groq free tier."
      }, 413);
    }

    const extension = audio.name
      .split(".")
      .pop()
      .toLowerCase();

    const supported = [
      "mp3", "mp4", "wav", "m4a",
      "ogg", "flac", "webm", "mpeg", "mpga"
    ];

    if (!supported.includes(extension)) {
      return reply({
        success: false,
        error: "Unsupported audio format."
      }, 400);
    }

    const body = new FormData();

    body.append("file", audio, audio.name);
    body.append("model", MODEL);
    body.append("response_format", "verbose_json");
    body.append("temperature", "0");
    body.append("timestamp_granularities[]", "segment");

    body.append(
      "prompt",
      "Bhagya Achievers education counselling call. " +
      "Hindi, English and Hinglish conversation. " +
      "CA, CS, CMA, Banking, ICAI, Test Series, " +
      "Mentorship, Mock Tests, Examination, Fees."
    );

    let response;

    // Retry once if Groq is temporarily unavailable.
    for (let attempt = 0; attempt < 2; attempt++) {
      response = await fetch(API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`
        },
        body
      });

      if (![502, 503, 504].includes(response.status) ||
          attempt === 1) {
        break;
      }

      await response.body?.cancel();

      await new Promise(resolve =>
        setTimeout(resolve, 2000)
      );
    }

    const raw = await response.text();

    let result;

    try {
      result = JSON.parse(raw);
    } catch {
      return reply({
        success: false,
        error: `Invalid Groq response (${response.status})`
      }, 502);
    }

    if (!response.ok) {
      if (response.status === 429) {
        return reply({
          success: false,
          error: "Groq rate limit reached. Check your free quota and try again later."
        }, 429);
      }

      const message = String(
        result.error?.message || "Transcription failed."
      ).split(apiKey).join("[REDACTED]");

      return reply({
        success: false,
        error: `Groq API ${response.status}: ${message}`
      }, response.status);
    }

    let transcription = "";

    if (Array.isArray(result.segments) &&
        result.segments.length > 0) {

      transcription = result.segments
        .filter(segment => segment.text?.trim())
        .map(segment => {
          const start = timestamp(segment.start);
          const end = timestamp(segment.end);

          return `[${start} - ${end}]\n${segment.text.trim()}`;
        })
        .join("\n\n");

    } else {
      transcription = result.text?.trim() || "";
    }

    if (!transcription) {
      return reply({
        success: false,
        error: "No spoken content could be detected."
      }, 422);
    }

    return reply({
      success: true,
      transcription,
      provider: "Groq",
      model: MODEL,
      language: result.language || "Auto",
      duration: result.duration || null,
      speakerIdentification: false,
      feedback: null,
      feedbackStatus: "Coming Soon"
    });

  } catch (error) {
    return reply({
      success: false,
      error: String(error.message || "Unexpected error")
        .split(apiKey).join("[REDACTED]")
    }, 500);
  }
}
