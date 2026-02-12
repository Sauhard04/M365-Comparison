
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as dotenv from 'dotenv';
dotenv.config();

const apiKey = process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

async function list() {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        console.log("Model initialized");
        // We can't easily list models with this simple SDK without more setup, 
        // but let's just try to generate a tiny thing.
        const result = await model.generateContent("test");
        console.log(result.response.text());
    } catch (e) {
        console.error(e);
    }
}
list();
