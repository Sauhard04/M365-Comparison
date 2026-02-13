
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

// --- Auto-Sync: Microsoft Official Sources ---
const MICROSOFT_SOURCES = {
  enterprise_m365: {
    title: "Microsoft 365 Enterprise (E3 / E5 / F3)",
    type: "Enterprise",
    url: "https://www.microsoft.com/en-us/microsoft-365/enterprise/microsoft365-plans-and-pricing",
    tiers: ["Microsoft 365 E3", "Microsoft 365 E5", "Microsoft 365 F3"],
  },
  enterprise_office365: {
    title: "Office 365 Enterprise (E1 / E3 / E5)",
    type: "Enterprise",
    url: "https://www.microsoft.com/en-us/microsoft-365/enterprise/compare-office-365-plans",
    tiers: ["Office 365 E1", "Office 365 E3", "Office 365 E5"],
  },
  business: {
    title: "Microsoft 365 Business (Basic / Standard / Premium)",
    type: "Business",
    url: "https://www.microsoft.com/en-us/microsoft-365/business/compare-all-plans",
    tiers: ["Microsoft 365 Business Basic", "Microsoft 365 Business Standard", "Microsoft 365 Business Premium"],
  },
};

async function fetchPageContent(url) {
  console.log(`🌐 Fetching: ${url}`);
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!response.ok) throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  const html = await response.text();
  console.log(`📄 Fetched ${html.length} chars from ${url}`);
  return html;
}

async function parseWithGemini(htmlContent, source) {
  if (!apiKey) throw new Error("Gemini API Key not configured.");
  const genAI = new GoogleGenerativeAI(apiKey);
  const modelsToTry = ["gemini-2.0-flash", "gemini-flash-latest"];

  const prompt = `EXPERT LICENSING EXTRACTION MODE.

You are analyzing the raw HTML of an official Microsoft comparison page for: "${source.title}".
The tiers to compare are: ${source.tiers.map(t => `"${t}"`).join(', ')}.

TASK: Extract EVERY feature row from the comparison table on this page into structured JSON.

CRITICAL RULES:
1. Extract ALL features, categories, sub-categories. Aim for 40+ distinct features.
2. For each feature, identify its availability status for EACH tier.
3. Status MUST be one of: "Full" (checkmark/included), "Partial" (limited/basic), "Add-on" (available as add-on), "Not Included" (not available).
4. If a feature says "Plan 1", "Plan 2", "Standard", "Premium", "Kiosk" etc., reflect that in the status.
5. Include the EXACT feature description text from the page.
6. For EVERY feature, provide a valid learn.microsoft.com documentation link.
7. Categories should map to the section headers on the page.
8. Include sub-categories as separate features when they have different statuses per tier.

Return RAW JSON ONLY (no markdown code fences):
{
    "tiers": ${JSON.stringify(source.tiers)},
    "categories": [
        {
            "name": "Category Name",
            "features": [
                {
                    "name": "Feature Name",
                    "description": "Exact description from the page",
                    "link": "https://learn.microsoft.com/...",
                    "status": {
                        "${source.tiers[0]}": "Full",
                        "${source.tiers[1]}": "Partial",
                        "${source.tiers[2] || source.tiers[0]}": "Not Included"
                    }
                }
            ]
        }
    ]
}`;

  let truncatedHtml = htmlContent;
  if (truncatedHtml.length > 80000) {
    const compareIdx = truncatedHtml.toLowerCase().indexOf('compare plans');
    if (compareIdx > -1) {
      const start = Math.max(0, compareIdx - 2000);
      truncatedHtml = truncatedHtml.substring(start, start + 80000);
    } else {
      truncatedHtml = truncatedHtml.substring(0, 80000);
    }
  }

  let result = null;
  const errors = [];
  for (const modelName of modelsToTry) {
    console.log(`🤖 Trying ${modelName}...`);
    let retries = 2;
    let delay = 3000;
    while (retries > 0) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const genResult = await model.generateContent([
          { text: `HTML content:\n\n${truncatedHtml}` },
          { text: prompt }
        ]);
        if (genResult?.response) { result = genResult; break; }
      } catch (err) {
        errors.push({ model: modelName, error: err.message });
        if (err.message.includes('429') && retries > 1) {
          await new Promise(r => setTimeout(r, delay));
          retries--; delay *= 2;
        } else { break; }
      }
    }
    if (result) break;
  }
  if (!result) throw new Error(`All AI models failed: ${JSON.stringify(errors)}`);

  const textResponse = result.response.text();
  let jsonString = textResponse.replace(/```json|```/g, '').trim();
  return JSON.parse(jsonString);
}

app.get('/api/sync-sources', (req, res) => {
  res.json({ sources: MICROSOFT_SOURCES });
});

app.get('/api/sync-history', async (req, res) => {
  try {
    if (!mapsCollection) throw new Error("Database not connected");
    const db = client.db('licensing_db');
    const history = await db.collection('sync_history').find({}).sort({ timestamp: -1 }).limit(10).toArray();
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sync', async (req, res) => {
  if (!mapsCollection) return res.status(503).json({ error: 'Database not connected' });
  if (!apiKey) return res.status(500).json({ error: 'Gemini API Key missing' });

  let sourcesToSync = Object.keys(MICROSOFT_SOURCES);
  if (req.body?.sources && Array.isArray(req.body.sources)) {
    sourcesToSync = req.body.sources.filter(s => MICROSOFT_SOURCES[s]);
  }

  console.log(`\n🚀 AUTO-SYNC STARTED: ${sourcesToSync.join(', ')}`);
  const results = [];
  const errors = [];
  const db = client.db('licensing_db');

  for (const sourceKey of sourcesToSync) {
    const source = MICROSOFT_SOURCES[sourceKey];
    try {
      console.log(`\n🔄 Syncing: ${source.title}`);
      const html = await fetchPageContent(source.url);
      const parsed = await parseWithGemini(html, source);

      if (!parsed.tiers || !parsed.categories || parsed.categories.length === 0) {
        throw new Error(`Invalid parsed data: missing tiers or categories`);
      }

      const totalFeatures = parsed.categories.reduce((sum, c) => sum + (c.features?.length || 0), 0);
      console.log(`📊 Extracted ${parsed.categories.length} categories, ${totalFeatures} features`);

      const mapDoc = {
        title: source.title,
        type: source.type,
        data: parsed,
        source: 'auto-sync',
        sourceUrl: source.url,
        sourceKey,
        timestamp: Date.now(),
        lastSyncedAt: new Date().toISOString(),
        featureCount: totalFeatures,
      };

      const upsertResult = await mapsCollection.updateOne(
        { sourceKey },
        { $set: mapDoc },
        { upsert: true }
      );

      const action = upsertResult.upsertedCount > 0 ? 'CREATED' : 'UPDATED';
      console.log(`💾 ${action}: ${source.title}`);
      results.push({ sourceKey, title: source.title, action, featureCount: totalFeatures });
    } catch (err) {
      console.error(`❌ Failed ${sourceKey}:`, err.message);
      errors.push({ sourceKey, error: err.message });
    }

    if (sourcesToSync.indexOf(sourceKey) < sourcesToSync.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  try {
    await db.collection('sync_history').insertOne({
      timestamp: new Date().toISOString(),
      results, errors,
      triggeredBy: 'manual',
    });
  } catch (logErr) {
    console.error("Failed to log sync history:", logErr.message);
  }

  console.log(`✅ SYNC COMPLETE: ${results.length} success, ${errors.length} failed`);

  res.json({
    success: true,
    syncedAt: new Date().toISOString(),
    results, errors,
    totalSynced: results.length,
    totalFailed: errors.length,
  });
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
  console.log(`🚀 [v2.0.0] Server started on http://localhost:${port}`);
});
