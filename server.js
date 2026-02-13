
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import * as dotenv from 'dotenv';
import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient, ObjectId } from 'mongodb';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const port = 5000;

app.use(cors());
app.use(express.json());


// MongoDB Setup
const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("❌ MONGODB_URI is missing in .env!");
}
const client = new MongoClient(uri);
let mapsCollection;

async function connectDB() {
  try {
    await client.connect();
    const db = client.db('licensing_db');
    mapsCollection = db.collection('maps');
    console.log("🍃 Connected to MongoDB Atlas");
  } catch (err) {
    console.error("❌ MongoDB Connection Error:", err);
    // Retry logic could go here, but for now we'll just log
  }
}
connectDB();

// Middlewares
app.use(cors());
app.use(express.json());

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});

const upload = multer({ storage: storage });

const apiKey = process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;

// Endpoints
app.get('/api/maps', async (req, res) => {
  try {
    if (!mapsCollection) throw new Error("Database not connected");
    const maps = await mapsCollection.find({}).sort({ timestamp: -1 }).toArray();
    res.json(maps);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/maps/:id', async (req, res) => {
  try {
    if (!mapsCollection) throw new Error("Database not connected");
    await mapsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/extract', upload.single('file'), async (req, res) => {
  const { track } = req.body;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  if (!apiKey) {
    return res.status(500).json({ error: 'Server configuration error: Gemini API Key is missing.' });
  }

  if (!mapsCollection) {
    return res.status(503).json({ error: 'Database is still connecting. Please try again in a few seconds.' });
  }

  try {
    console.log(`📄 [v1.0.7] Processing file: ${file.originalname} (${track})`);

    const genAI = new GoogleGenerativeAI(apiKey);
    const modelsToTry = ["gemini-2.0-flash", "gemini-flash-latest", "gemini-pro-latest"];
    let result = null;

    const fileContent = fs.readFileSync(file.path);
    const base64Data = fileContent.toString('base64');

    const prompt = `EXPERT ANALYSIS MODE: Analyze this Microsoft Licensing PDF for ${track} tracks with maximum granularity.
        
        GOAL: Identify EVERY distinct feature, capability, and entitlement. Pay special attention to:
        1. Advanced Security (Defender, Sentinel, Purview integrations)
        2. Compliance & Governance (eDiscovery, Data Loss Prevention, Audit logs)
        3. Management & Automation (Intune, AutoPilot, PowerShell modules)
        4. Identity (Entra ID P1/P2 features)
        5. Productivity differences (storage limits, desktop vs web apps)

        RULES:
        - Extract 50+ distinct features if possible.
        - Be highly specific (e.g., "Defender for Endpoint P2" instead of just "Defender").
        - For 'status', use exactly one of these: "Full", "Partial", "Add-on", "Not Included".
        - Ensure a documentation link from learn.microsoft.com is provided for every single feature.

        Return RAW JSON ONLY:
        {
          "tiers": ["Tier Name A", "Tier Name B"],
          "categories": [
            {
              "name": "Category Name",
              "features": [
                {
                  "name": "Feature Name",
                  "description": "Deep technical description",
                  "link": "https://learn.microsoft.com/...",
                  "status": { "Tier Name A": "Full", "Tier Name B": "Partial" }
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
            break;
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
    let jsonString = textResponse.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(jsonString);
    } catch (parseError) {
      console.error("❌ JSON Parse Error. Raw string preview:", jsonString.substring(0, 100));
      throw new Error(`Invalid JSON format from AI: ${parseError.message}`);
    }

    // Save to MongoDB
    const newMap = {
      title: file.originalname.replace(/\.pdf$/i, ''),
      type: track,
      data: parsed,
      timestamp: Date.now(),
      fileName: file.originalname
    };

    const savedResult = await mapsCollection.insertOne(newMap);
    res.json({ ...newMap, _id: savedResult.insertedId });

  } catch (error) {
    console.error('❌ Extraction Error Detail:', error);
    res.status(500).json({ error: error.message });
  } finally {
    // Safe Cleanup
    if (file && file.path && fs.existsSync(file.path)) {
      try {
        fs.unlinkSync(file.path);
        console.log(`🗑️ Successfully cleaned up: ${file.path}`);
      } catch (cleanupErr) {
        console.warn(`⚠️ Cleanup warning: Could not delete ${file.path}`);
      }
    }
  }
});

// Global Error Handler (Always return JSON)
app.use((err, req, res, next) => {
  console.error("💥 Unhandled Error:", err);
  res.status(500).json({
    error: "Internal Server Error",
    message: err.message
  });
});

app.listen(port, () => {
  console.log(`🚀 [v1.0.7] Server started on http://localhost:${port}`);
});
