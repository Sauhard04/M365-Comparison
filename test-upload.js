
import fs from 'node:fs';
import path from 'node:path';

async function testUpload() {
    const filePath = 'c:/Users/SauhardKaushik/OneDrive - Meridian Solutions/Desktop/M365-Comparison/uploads/Modern-Work-Plan-Comparison-Enterprise (2).pdf';
    const url = 'http://localhost:5000/api/extract';

    const fileBuffer = fs.readFileSync(filePath);
    const blob = new Blob([fileBuffer], { type: 'application/pdf' });
    const formData = new FormData();
    formData.append('file', blob, path.basename(filePath));
    formData.append('track', 'Enterprise');

    try {
        console.log("Sending request to server...");
        const response = await fetch(url, {
            method: 'POST',
            body: formData
        });

        const data = await response.json();
        fs.writeFileSync('test-result.json', JSON.stringify({
            status: response.status,
            data: data
        }, null, 2));
        console.log("Result saved to test-result.json");
    } catch (error) {
        console.error("Fetch Error:", error);
    }
}

testUpload();
