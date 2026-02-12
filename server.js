
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import * as dotenv from 'dotenv';
import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const port = 5000;

app.use(cors());
app.use(express.json());

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Fixed Storage: Save in /uploads with original filename
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});

const upload = multer({ storage: storage });

// Use the API KEY from env
const apiKey = process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error("❌ ERROR: VITE_GEMINI_API_KEY is missing in .env file!");
}

app.post('/api/extract', upload.single('file'), async (req, res) => {
  const { track } = req.body;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  if (!apiKey) {
    return res.status(500).json({ error: 'Server configuration error: Gemini API Key is missing.' });
  }

  try {
    console.log(`📄 [v1.0.5] Processing file: ${file.originalname} (${track})`);

    const genAI = new GoogleGenerativeAI(apiKey);

    // Multi-model Fallback Strategy
    const modelsToTry = ["gemini-2.0-flash", "gemini-flash-latest", "gemini-pro-latest"];
    let result = null;
    let lastError = null;

    const fileContent = fs.readFileSync(file.path);
    const base64Data = fileContent.toString('base64');

    const prompt = `Analyze this Microsoft Licensing PDF for ${track} tracks.
        
        Return RAW JSON ONLY with this structure:
        {
          "tiers": ["Tier Name A", "Tier Name B"],
          "categories": [
            {
              "name": "Category Name",
              "features": [
                {
                  "name": "Feature Name",
                  "description": "Short description",
                  "link": "https://learn.microsoft.com/...",
                  "status": { "Tier Name A": "Included", "Tier Name B": "Excluded" }
                }
              ]
            }
          ]
        }`;

    const modelErrors = [];

    for (const modelName of modelsToTry) {
      console.log(`🤖 Attempting extraction with ${modelName}...`);
      let retries = 2;
      let delay = 3000;

      while (retries > 0) {
        try {
          const model = genAI.getGenerativeModel({ model: modelName });
          const genResult = await model.generateContent([
            {
              inlineData: {
                data: base64Data,
                mimeType: 'application/pdf'
              }
            },
            { text: prompt }
          ]);

          if (genResult && genResult.response) {
            result = genResult;
            break;
          }
        } catch (err) {
          console.warn(`❌ Model ${modelName} failed: ${err.message}`);
          modelErrors.push({ model: modelName, error: err.message });

          if (err.message.includes('429') && retries > 1) {
            console.warn(`⚠️ Quota hit. Retrying in ${delay / 1000}s...`);
            await new Promise(r => setTimeout(r, delay));
            retries--;
            delay *= 2;
          } else {
            break; // Try next model
          }
        }
      }
      if (result) break;
    }

    if (!result) {
      return res.status(503).json({
        error: "All AI models are currently unavailable (Quota Limit Reached).",
        details: modelErrors
      });
    }

    const textResponse = result.response.text();
    console.log("✅ Received response from Gemini");

    let jsonString = textResponse.replace(/```json|```/g, '').trim();

    try {
      const parsed = JSON.parse(jsonString);
      res.json(parsed);
    } catch (parseError) {
      console.error("❌ JSON Parse Error. Raw string preview:", jsonString.substring(0, 100));
      throw new Error(`Invalid JSON format from AI: ${parseError.message}`);
    }

  } catch (error) {
    console.error('❌ Extraction Error Detail:', error);
    res.status(500).json({
      error: error.message,
      details: error.stack
    });
  }
});

app.listen(port, () => {
  console.log(`🚀 [v1.0.5] Server started on http://localhost:${port}`);
});
