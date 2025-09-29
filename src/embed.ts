import OpenAI from "openai";
import { OPENAI_API_KEY } from "./config.js";

const openai = new OpenAI({baseURL: 'https://models.github.ai/inference', apiKey: OPENAI_API_KEY });

async function retryEmbedding(
    fn: () => Promise<OpenAI.Embeddings.CreateEmbeddingResponse>,
    retries = 2,
    delayMs = 1000
): Promise<OpenAI.Embeddings.CreateEmbeddingResponse> {
    try {
        return await fn();
    } catch (err) {
        if (retries > 0) {
            console.warn("Failed to embed, trying again: ", err);
            await new Promise((r) => setTimeout(r, delayMs));
            return retryEmbedding(fn, retries - 1, delayMs * 2);
        } else {
            throw err;
        }
    }
}

export async function getEmbedding(text: string): Promise<number[]> {
    const res: OpenAI.Embeddings.CreateEmbeddingResponse = await retryEmbedding(() =>
        openai.embeddings.create({
            model: 'openai/text-embedding-3-large',
            input: text,
        })
    );

    return res.data[0].embedding;
}
