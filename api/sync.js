
import { GoogleGenerativeAI } from "@google/generative-ai";
import { MongoClient } from 'mongodb';

// --- Database Setup ---
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri, {
    tls: true,
    connectTimeoutMS: 15000,
    serverSelectionTimeoutMS: 15000,
});

let db;
async function getDB() {
    try {
        if (db) return db;
        await client.connect();
        db = client.db('licensing_db');
        return db;
    } catch (err) {
        console.error("DB Connection Failed:", err);
        await client.close().catch(() => { });
        db = null;
        throw err;
    }
}

const apiKey = process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;

// --- Official Microsoft Sources ---
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

// --- Fetch HTML from Microsoft ---
async function fetchPageContent(url) {
    console.log(`🌐 Fetching: ${url}`);
    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
    }

    const html = await response.text();
    console.log(`📄 Fetched ${html.length} chars from ${url}`);
    return html;
}

// --- AI Parsing via Gemini ---
async function parseWithGemini(htmlContent, source) {
    if (!apiKey) throw new Error("Gemini API Key is not configured.");

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
4. If a feature says "Plan 1", "Plan 2", "Standard", "Premium", "Kiosk" etc., reflect that in the status (e.g., "Plan 1", "Plan 2", "Premium").
5. Include the EXACT feature description text from the page.
6. For EVERY feature, provide a valid learn.microsoft.com documentation link. Use the feature name to construct a reasonable URL if not available.
7. Categories should map to the section headers on the page (e.g., "Productivity apps", "Security and administration", "Identity and access management", "Cyberthreat protection", etc.).
8. Include sub-categories as separate features when they have different statuses per tier (e.g., "Microsoft Entra ID - Plan 1" vs "Plan 2").

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

    // Truncate HTML to avoid token limits - keep comparison table section
    let truncatedHtml = htmlContent;
    if (truncatedHtml.length > 80000) {
        // Try to find the comparison table section
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
        console.log(`🤖 Trying ${modelName} for "${source.title}"...`);
        let retries = 2;
        let delay = 3000;

        while (retries > 0) {
            try {
                const model = genAI.getGenerativeModel({ model: modelName });
                const genResult = await model.generateContent([
                    { text: `Here is the HTML content of the Microsoft comparison page:\n\n${truncatedHtml}` },
                    { text: prompt }
                ]);

                if (genResult?.response) {
                    result = genResult;
                    console.log(`✅ Success with ${modelName}`);
                    break;
                }
            } catch (err) {
                errors.push({ model: modelName, error: err.message });
                console.error(`❌ ${modelName} failed: ${err.message}`);
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
        throw new Error(`All AI models failed: ${JSON.stringify(errors)}`);
    }

    const textResponse = result.response.text();
    let jsonString = textResponse.replace(/```json|```/g, '').trim();

    try {
        return JSON.parse(jsonString);
    } catch (parseError) {
        console.error("JSON Parse Error:", parseError.message);
        console.error("Raw AI Response (first 500 chars):", jsonString.substring(0, 500));
        throw new Error(`AI returned invalid JSON: ${parseError.message}`);
    }
}

// --- Main Sync Logic ---
async function syncSource(sourceKey, database) {
    const source = MICROSOFT_SOURCES[sourceKey];
    if (!source) throw new Error(`Unknown source: ${sourceKey}`);

    console.log(`\n🔄 Syncing: ${source.title}`);

    // 1. Fetch live page
    const html = await fetchPageContent(source.url);

    // 2. Parse with AI
    const parsed = await parseWithGemini(html, source);

    // 3. Validate parsed data
    if (!parsed.tiers || !parsed.categories || parsed.categories.length === 0) {
        throw new Error(`Invalid parsed data for ${source.title}: missing tiers or categories`);
    }

    const totalFeatures = parsed.categories.reduce((sum, c) => sum + (c.features?.length || 0), 0);
    console.log(`📊 Extracted ${parsed.categories.length} categories, ${totalFeatures} features for ${source.title}`);

    // 4. Upsert in MongoDB (replace existing or create new)
    const mapDoc = {
        title: source.title,
        type: source.type,
        data: parsed,
        source: 'auto-sync',
        sourceUrl: source.url,
        sourceKey: sourceKey,
        timestamp: Date.now(),
        lastSyncedAt: new Date().toISOString(),
        featureCount: totalFeatures,
    };

    const result = await database.collection('maps').updateOne(
        { sourceKey: sourceKey },
        { $set: mapDoc },
        { upsert: true }
    );

    const action = result.upsertedCount > 0 ? 'CREATED' : 'UPDATED';
    console.log(`💾 ${action}: ${source.title} (${totalFeatures} features)`);

    return { sourceKey, title: source.title, action, featureCount: totalFeatures };
}

// --- API Handler ---
export default async function handler(req, res) {
    // Vercel cron sends GET, manual trigger sends POST
    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Optional: Verify cron secret for scheduled calls
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
        // Allow POST from frontend (admin) without cron secret
        if (req.method === 'GET') {
            return res.status(401).json({ error: 'Unauthorized' });
        }
    }

    // Determine which sources to sync
    let sourcesToSync = Object.keys(MICROSOFT_SOURCES);
    if (req.body?.sources && Array.isArray(req.body.sources)) {
        sourcesToSync = req.body.sources.filter(s => MICROSOFT_SOURCES[s]);
    }

    console.log(`\n========================================`);
    console.log(`🚀 AUTO-SYNC STARTED at ${new Date().toISOString()}`);
    console.log(`Sources: ${sourcesToSync.join(', ')}`);
    console.log(`========================================\n`);

    const results = [];
    const errors = [];

    try {
        const database = await getDB();

        for (const sourceKey of sourcesToSync) {
            try {
                const result = await syncSource(sourceKey, database);
                results.push(result);
            } catch (err) {
                console.error(`❌ Failed to sync ${sourceKey}:`, err.message);
                errors.push({ sourceKey, error: err.message });
            }

            // Brief pause between sources to avoid rate limiting
            if (sourcesToSync.indexOf(sourceKey) < sourcesToSync.length - 1) {
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        // Log sync history
        try {
            await database.collection('sync_history').insertOne({
                timestamp: new Date().toISOString(),
                results,
                errors,
                triggeredBy: req.method === 'GET' ? 'cron' : 'manual',
            });
        } catch (logErr) {
            console.error("Failed to log sync history:", logErr.message);
        }

    } catch (dbErr) {
        return res.status(500).json({
            error: `Database connection failed: ${dbErr.message}`,
            results,
            errors,
        });
    }

    console.log(`\n========================================`);
    console.log(`✅ AUTO-SYNC COMPLETE`);
    console.log(`Success: ${results.length}, Failed: ${errors.length}`);
    console.log(`========================================\n`);

    return res.status(200).json({
        success: true,
        syncedAt: new Date().toISOString(),
        results,
        errors,
        totalSynced: results.length,
        totalFailed: errors.length,
    });
}
