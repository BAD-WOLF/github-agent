import { encoding_for_model, Tiktoken, TiktokenModel } from "tiktoken";

// Split text into chunks based on token limits
// Needed because embeddings have a max token/character limit
export function chunkTextByTokens(
    text: string,
    maxTokens: number = 8191,
    model: TiktokenModel = "text-embedding-3-large"
): string[] {
    const encoder: Tiktoken = encoding_for_model(model);
    const tokens: Uint32Array = encoder.encode(text);

    const chunks: string[] = [];

    for (let i = 0; i < tokens.length; i += maxTokens) {
        const tokenSlice: Uint32Array<ArrayBuffer> = tokens.slice(i, i + maxTokens); // stays Uint32Array
        const decoded: Uint8Array = encoder.decode(tokenSlice);
        // Turn Uint8Array back into JS string
        chunks.push(new TextDecoder().decode(decoded));
    }

    encoder.free(); // free native memory from WASM
    return chunks;
}
