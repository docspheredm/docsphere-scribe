const https = require('https');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY is not set');
    return res.status(500).json({ error: 'Server configuration error: API key missing.' });
  }

  let body = req.body;

  // Manually parse body if Vercel didn't auto-parse (shouldn't happen, but safe fallback)
  if (!body || typeof body === 'string') {
    try {
      body = JSON.parse(body || '{}');
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body.' });
    }
  }

  const { audioData, mimeType } = body;

  if (!audioData || !mimeType) {
    return res.status(400).json({ error: 'Missing audioData or mimeType in request body.' });
  }

  const prompt = `You are a medical transcription assistant. Listen to this audio recording of a clinical consultation.

Your task is to:
1. Transcribe the audio accurately, labeling each speaker turn as "Doctor" or "Patient" based on context clues (tone, vocabulary, questions being asked). If speaker roles cannot be confidently determined, use "Speaker 1" and "Speaker 2".
2. Identify ICD-10-CM diagnosis codes that are clearly mentioned or reasonably implied by the clinical content of the conversation. Only return codes that are well-supported by what was actually said — do not fabricate codes. If no codes are identifiable, return an empty array.

Return your response as valid JSON only, with no markdown code fences, no explanation text, nothing outside the JSON. Use this exact structure:
{
  "transcript": [
    { "speaker": "Doctor", "text": "..." },
    { "speaker": "Patient", "text": "..." }
  ],
  "icd10_codes": [
    { "code": "E11.9", "description": "Type 2 diabetes mellitus without complications" }
  ]
}`;

  const requestBody = JSON.stringify({
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: audioData,
            },
          },
          {
            text: prompt,
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1,
    },
  });

  const model = 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const parsedUrl = new URL(url);

  try {
    const geminiResponse = await new Promise((resolve, reject) => {
      const options = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestBody),
        },
      };

      const request = https.request(options, (response) => {
        let data = '';
        response.on('data', (chunk) => { data += chunk; });
        response.on('end', () => {
          resolve({ statusCode: response.statusCode, body: data });
        });
      });

      request.on('error', reject);
      request.setTimeout(55000, () => {
        request.destroy(new Error('Gemini API request timed out after 55 seconds'));
      });

      request.write(requestBody);
      request.end();
    });

    if (geminiResponse.statusCode !== 200) {
      console.error('Gemini API error:', geminiResponse.statusCode, geminiResponse.body);
      let errorDetail = geminiResponse.body;
      try {
        const parsed = JSON.parse(geminiResponse.body);
        errorDetail = parsed?.error?.message || errorDetail;
      } catch {}
      return res.status(502).json({
        error: `Gemini API returned status ${geminiResponse.statusCode}: ${errorDetail}`,
      });
    }

    let geminiData;
    try {
      geminiData = JSON.parse(geminiResponse.body);
    } catch {
      console.error('Failed to parse Gemini response as JSON:', geminiResponse.body);
      return res.status(502).json({ error: 'Unexpected response format from Gemini API.' });
    }

    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      console.error('No text in Gemini response:', JSON.stringify(geminiData));
      return res.status(502).json({ error: 'Gemini returned an empty response. The audio may be too short or contain no speech.' });
    }

    // Strip markdown fences if present, despite asking Gemini not to add them
    const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    let result;
    try {
      result = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('Failed to parse Gemini text as JSON:', cleaned);
      return res.status(502).json({
        error: `Could not parse structured response from Gemini. Raw output: ${cleaned.substring(0, 300)}`,
      });
    }

    // Validate shape and normalise
    const transcript = Array.isArray(result.transcript) ? result.transcript : [];
    const icd10Codes = Array.isArray(result.icd10_codes) ? result.icd10_codes : [];

    return res.status(200).json({ transcript, icd10_codes: icd10Codes });

  } catch (err) {
    console.error('Transcription handler error:', err);
    return res.status(500).json({ error: `Internal error: ${err.message}` });
  }
};
