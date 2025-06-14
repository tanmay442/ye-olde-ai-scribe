// api/chat.js
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";

const API_KEY = process.env.GOOGLE_API_KEY;

let genAI;
if (API_KEY) {
    try {
        genAI = new GoogleGenerativeAI(API_KEY);
    } catch (e) {
        console.error("Failed to initialize GoogleGenerativeAI in serverless function:", e.message);
        // genAI will remain undefined, and requests will fail
    }
} else {
    console.error("GOOGLE_API_KEY environment variable is not set or empty.");
}

const generationConfig = {
    // temperature: 0.9, // Consider making this configurable or persona-based
    // topK: 1,
    // topP: 1,
    // maxOutputTokens: 2048, // Gemini 1.5 Flash can go higher
};

const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

export default async function handler(req, res) {
    if (!genAI) {
        // This means API_KEY was missing or invalid at startup
        console.error("AI Service not initialized due to API key issue or SDK failure at startup.");
        return res.status(500).json({ error: "AI Service not initialized on server. Please contact support." });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { message, history = [], systemPrompt } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Message content is required.' });
        }
        if (!systemPrompt) {
            return res.status(400).json({ error: 'System prompt is required.' });
        }
        if (typeof message !== 'string' || typeof systemPrompt !== 'string') {
            return res.status(400).json({ error: 'Invalid message or system prompt format.' });
        }
        if (!Array.isArray(history)) {
            return res.status(400).json({error: 'History must be an array.'});
        }

        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-flash-latest",
            systemInstruction: systemPrompt,
            generationConfig,
            safetySettings
        });
        
        // Ensure history is correctly formatted for the SDK
        // The client sends 'ai' for model role, map it to 'model'
        const chatHistoryForSDK = history.map(msg => {
            if (!msg || typeof msg.role !== 'string' || typeof msg.content !== 'string') {
                console.warn('Invalid history item:', msg);
                return null; // or skip it
            }
            return {
                role: msg.role === 'ai' ? 'model' : msg.role, // 'user' remains 'user'
                parts: [{ text: msg.content }]
            };
        }).filter(Boolean); // Remove any null items from invalid entries


        const chat = model.startChat({
            history: chatHistoryForSDK,
        });

        const result = await chat.sendMessage(message);
        
        if (!result.response) {
            console.error("No response from AI model, result:", result);
            // Check for blocking due to safety settings
            const promptFeedback = result.promptFeedback;
            if (promptFeedback && promptFeedback.blockReason) {
                return res.status(400).json({ error: `Message blocked by content policy: ${promptFeedback.blockReason}` });
            }
            return res.status(500).json({ error: "AI model did not return a response."});
        }
        
        const aiResponseText = result.response.text();
        return res.status(200).json({ reply: aiResponseText });

    } catch (error) {
        console.error('Error in /api/chat:', error);
        let errorMessage = 'An unexpected error occurred with the AI Scribe.';
        let statusCode = 500;

        if (error.message) {
            if (error.message.includes('quota')) {
                errorMessage = 'The Scribe has reached its daily/rate limit. Please try again later.';
                statusCode = 429; // Too Many Requests
            } else if (error.message.includes('API key not valid') || error.message.includes('permission denied')) {
                errorMessage = 'The Scribe\'s ink has run dry (API key or permission issue). Please contact the admin.';
                statusCode = 500; // Internal Server Error (config issue)
            } else if (error.message.toLowerCase().includes('deadline exceeded')) {
                errorMessage = 'The Scribe took too long to respond. Your request may have timed out.';
                statusCode = 504; // Gateway Timeout
            } else if (error.message.includes("candidate must be non-empty")) {
                errorMessage = "The Scribe had nothing to say in response, possibly due to safety filters or an unusual prompt.";
                statusCode = 400; // Bad Request (from user prompt leading to no valid response)
            }
        }
        
        // Check for specific Google AI error structure if available
        if (error.status && error.statusText) { // From a fetch-like error
             errorMessage = `AI Service Error: ${error.statusText} (${error.status})`;
             statusCode = error.status;
        } else if (error.response && error.response.data && error.response.data.error) { // Axios-like error
            errorMessage = `AI Service Error: ${error.response.data.error.message}`;
            statusCode = error.response.data.error.code || 500;
        }


        return res.status(statusCode).json({
            error: errorMessage,
            details: error.message // For server logs, be cautious about sending to client
        });
    }
}
