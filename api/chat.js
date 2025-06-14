// api/chat.js
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";

// --- Persona Configurations (including system prompts) moved to backend ---
const personaStore = {
    standard: {
        name: "The Mindful Barista", // Name for logging or potential future use on backend
        systemPrompt: "You are The Mindful Barista. You've seen it all from behind the polished espresso machine of a bustling, independent coffee shop. The user is a regular. Your chat is a break from the 9-to-5 grind. You are warm, engaging, and genuinely curious. Your linguistic style is modern, casual, coffeehouse English. Never just answer; wrap it in an anecdote about a customer or a café observation. Be intensely curious about the user's personal 'vibe.' Your anecdotes should be brief and insightful, like a perfectly pulled shot of espresso—potent and to the point. Keep your responses to a moderate length. Use Markdown for formatting like **bold text** or lists when it enhances clarity.",
    },
    shakespearean: {
        name: "The Globe's Fool",
        systemPrompt: "Thou art The Globe's Fool, a player in Lord Burbage's own company in 1590s London. The user is a keen-eyed patron. Your conversation is a merry war of wits. You are a whirlwind of dramatic energy: witty, bawdy, and profound. Thy linguistic style is Elizabethan English ('thee,' 'thou,' 'forsooth'). An answer must be a performance, couched in a wild tale or juicy gossip. Thy wit is thy sharpest dagger. Thy responses must be witty and brief, like a sharp aside, not a long-winded soliloquy. Deliver thy wisdom with potent brevity. Use Markdown for formatting like **bold text** or lists when it enhances clarity.",
    },
    victorian: {
        name: "The Intrepid Naturalist",
        systemPrompt: "You are The Intrepid Naturalist, a titan of the Victorian era of discovery. The user is an esteemed colleague from the Royal Society. Your conversation is a joint expedition of the mind. You are a booming, hearty extrovert and magnificent storyteller. Your linguistic style is educated, formal 19th-century English ('my dear fellow,' 'capital'). An answer is an expedition report, illustrated with a breathless tale from your travels. Your wit is dry. While your enthusiasm is boundless, your reports must be concise. Present your findings as you would in a brief field note—clear, direct, and of moderate length. Use Markdown for formatting like **bold text** or lists when it enhances clarity.",
    },
    medieval: {
        name: "The Wandering Skald",
        systemPrompt: "Hark, you are The Wandering Skald of the North, a walker of the old roads with a mind full of sagas. The user is a shield-brother or hearth-sister across the fire. Your talk is a weaving of tales. Your worldview is that life is a saga, and a man's worth is measured by his courage. You are boisterous and hearty. Your linguistic style is archaic, poetic, North-inspired English, using alliteration and kennings. No answer is a simple fact; it is a piece of a larger saga. Thy humor is grim and hearty. Thy tales should be a short, powerful verse, not an entire epic. Speak with the direct, impactful weight of a well-thrown axe. Keep thy counsel brief and memorable. Use Markdown for formatting like **bold text** or lists when it enhances clarity.",
    }
};
// --- End Persona Configurations ---

const API_KEY = process.env.GOOGLE_API_KEY;

let genAI;
if (API_KEY) {
    try {
        genAI = new GoogleGenerativeAI(API_KEY);
    } catch (e) {
        console.error("Failed to initialize GoogleGenerativeAI in serverless function:", e.message);
    }
} else {
    console.error("GOOGLE_API_KEY environment variable is not set or empty.");
}

const generationConfig = { /* Adjust as needed, e.g., temperature: 0.8 */ };
const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

export default async function handler(req, res) {
    if (!genAI) {
        console.error("AI Service not initialized (API key or SDK issue at startup).");
        return res.status(503).json({ error: "AI Service is currently unavailable. Please try again later." });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { message, history = [], era } = req.body;

        if (!message || typeof message !== 'string') {
            return res.status(400).json({ error: 'Message content is required and must be a string.' });
        }
        if (!era || typeof era !== 'string' || !personaStore[era]) {
            return res.status(400).json({ error: 'Valid era identifier is required.' });
        }
        if (!Array.isArray(history)) {
            return res.status(400).json({error: 'History must be an array.'});
        }
        
        const selectedPersona = personaStore[era];
        if (!selectedPersona || !selectedPersona.systemPrompt) {
             console.error(`System prompt not found for era: ${era}`);
             return res.status(500).json({ error: 'Internal server error: Persona configuration missing.' });
        }

        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-flash-latest",
            systemInstruction: selectedPersona.systemPrompt, // Use backend system prompt
            generationConfig,
            safetySettings
        });
        
        const chatHistoryForSDK = history.map(msg => {
            if (!msg || typeof msg.role !== 'string' || typeof msg.content !== 'string') {
                console.warn('Invalid history item skipped:', msg); return null;
            }
            return {
                role: msg.role === 'ai' ? 'model' : 'user',
                parts: [{ text: msg.content }]
            };
        }).filter(Boolean);


        const chat = model.startChat({
            history: chatHistoryForSDK,
        });

        const result = await chat.sendMessage(message);
        
        if (!result.response) {
            const promptFeedback = result.promptFeedback;
            if (promptFeedback && promptFeedback.blockReason) {
                console.warn(`Message blocked for era ${era}. Reason: ${promptFeedback.blockReason}`);
                return res.status(400).json({ error: `Message blocked due to content policy: ${promptFeedback.blockReason}` });
            }
            console.error("No response from AI model, result:", result);
            return res.status(500).json({ error: "AI model did not provide a response."});
        }
        
        const aiResponseText = result.response.text();
        return res.status(200).json({ reply: aiResponseText });

    } catch (error) {
        console.error(`Error in /api/chat for era ${req.body.era || 'unknown'}:`, error.message, error.stack);
        let errorMessage = 'An unexpected error occurred with the AI Scribe.';
        let statusCode = 500;

        // Simplified error handling, you can expand this based on common errors
        if (error.message) {
            if (error.message.includes('quota')) {
                errorMessage = 'The Scribe has reached its daily/rate limit. Please try again later.'; statusCode = 429;
            } else if (error.message.includes('API key not valid') || error.message.includes('permission denied')) {
                errorMessage = 'Scribe configuration error (API key/permission). Admin notified.'; statusCode = 500;
            } else if (error.message.toLowerCase().includes('deadline exceeded')) {
                errorMessage = 'The Scribe took too long to respond. Your request timed out.'; statusCode = 504;
            } else if (error.message.includes("candidate must be non-empty")) {
                errorMessage = "The Scribe had nothing to say, possibly due to restrictive filters or an unusual prompt."; statusCode = 400;
            }
        }
        
        return res.status(statusCode).json({ error: errorMessage, details: error.message });
    }
}
