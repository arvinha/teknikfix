// Reads a photo (the "About" screen, the label on the back, or the box) and finds the model in our list.
// Uses Claude vision when ANTHROPIC_API_KEY is in .env. The photo is not stored.

const MODEL = (process.env.VISION_MODEL || "claude-haiku-5-5").trim();

function enabled() {
  return (process.env.ANTHROPIC_API_KEY || "").trim().startsWith("sk-ant-");
}

function luhnOk(digits) {
  if (!/^\d{15}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i += 1) {
    let n = Number(digits[14 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

function parseImage(dataUrl) {
  const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!match) return null;
  if (match[2].length > 5_000_000) return null;
  return { mediaType: match[1], data: match[2] };
}

/** models: [{ id, name, group }]. Returns { modelId, storage, imei, serial, chip, confidence, note }. */
async function identify(dataUrl, models) {
  const image = parseImage(dataUrl);
  if (!image) return { error: "billede" };
  const list = models.map((model) => `${model.id}: ${model.group} ${model.name}`).join("\n");
  const prompt =
    "You identify phones, tablets and computers for a Danish buyback service. The photo shows the device itself, " +
    "its Settings > About screen, a label on the back or bottom, or the box.\n" +
    "Pick the matching id from this list, or null if none fits or you are unsure:\n" +
    list +
    "\n\nReply with JSON only, no prose: " +
    '{"modelId": string|null, "storageGb": number|null, "imei": string|null, "imei2": string|null, "serial": string|null, ' +
    '"chip": "intel"|"m1"|"m2"|"m3"|"m4"|null, "confidence": "high"|"medium"|"low", "note": short Danish sentence}. ' +
    "Only report an IMEI or serial number you can actually read in the image. If the image is the *#06# screen or shows " +
    "IMEI numbers, copy every digit of the IMEI (15 digits) and IMEI2 exactly as printed under the barcodes; ignore EID and MEID. " +
    "Do not guess the model from an IMEI yourself; leave modelId null unless the model is visible. For a photo of the back of a phone, " +
    "judge the model from the camera layout and colour, and say so in the note.";
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY.trim(),
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 800,
      thinking: { type: "disabled" },
      output_config: { effort: "low" },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } },
            { type: "text", text: prompt }
          ]
        }
      ]
    }),
    signal: AbortSignal.timeout(30_000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Claude ${response.status}: ${(body.error && body.error.message) || ""}`);
  const text = (body.content || [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
  const json = /\{[\s\S]*\}/.exec(text);
  if (!json) return { modelId: null, confidence: "low", note: "Vi kunne ikke læse billedet." };
  let parsed;
  try {
    parsed = JSON.parse(json[0]);
  } catch (error) {
    return { modelId: null, confidence: "low", note: "Vi kunne ikke læse billedet." };
  }
  const ids = new Set(models.map((model) => model.id));
  const imeis = [parsed.imei, parsed.imei2].map((value) => String(value || "").replace(/\D/g, "")).filter(luhnOk);
  return {
    modelId: ids.has(parsed.modelId) ? parsed.modelId : null,
    storage: Number.isInteger(parsed.storageGb) ? String(parsed.storageGb) : "",
    imei: imeis[0] || "",
    imeis,
    serial: /^[A-Z0-9]{8,20}$/i.test(String(parsed.serial || "")) ? String(parsed.serial).toUpperCase() : "",
    chip: ["intel", "m1", "m2", "m3", "m4"].includes(parsed.chip) ? parsed.chip : "",
    confidence: ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "low",
    note: String(parsed.note || "").slice(0, 200)
  };
}

module.exports = { enabled, identify, luhnOk };
