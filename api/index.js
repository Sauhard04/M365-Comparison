
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { MongoClient, ObjectId } from 'mongodb';

const app = express();
app.use(cors());
app.use(express.json());

// MongoDB Setup
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);
let db;

async function getDB() {
    if (db) return db;
    await client.connect();
    db = client.db('licensing_db');
    return db;
}

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const apiKey = process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;

// Endpoints
app.get('/api/maps', async (req, res) => {
    try {
        const database = await getDB();
        const maps = await database.collection('maps').find({}).sort({ timestamp: -1 }).toArray();
        res.json(maps);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/maps/:id', async (req, res) => {
    try {
        const database = await getDB();
        await database.collection('maps').deleteOne({ _id: new ObjectId(req.params.id) });
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

    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const modelsToTry = ["gemini-2.0-flash", "gemini-flash-latest", "gemini-pro-latest"];
        let result = null;

        const base64Data = file.buffer.toString('base64');

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
                    modelErrors.push({ model: modelName, error: err.message });
                    if (err.message.includes('429') && retries > 1) {
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

        try {
            const parsed = JSON.parse(jsonString);

            const newMap = {
                title: file.originalname.replace(/\.pdf$/i, ''),
                type: track,
                data: parsed,
                timestamp: Date.now(),
                fileName: file.originalname
            };

            const database = await getDB();
            const savedResult = await database.collection('maps').insertOne(newMap);

            res.json({ ...newMap, _id: savedResult.insertedId });
        } catch (parseError) {
            throw new Error(`Invalid JSON format from AI: ${parseError.message}`);
        }

    } catch (error) {
        res.status(500).json({
            error: error.message,
        });
    }
});

export default app;
