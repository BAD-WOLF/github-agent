import dotenv from "dotenv";
import fs from 'fs'
import path from 'path'
import {fileURLToPath} from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const agentRoot: string = path.resolve(__dirname, "..");

const envFiles: string[] = [".env.local", ".env"];

for (const file of envFiles) {
    const fullPath: string = path.join(agentRoot, file);
    if (fs.existsSync(fullPath)) {
        dotenv.config({path: fullPath});
        break;
    }
}

dotenv.config({ quiet: true });

function mustGet(key: string): string {
    const val: string = process.env[key] as string;
    if (!val) {
        console.error(`🚨 Environment variable ${key} not defined`);
        process.exit(1);
    }
    return val;
}

export const WEAVIATE_HOST: string = mustGet("WEAVIATE_HOST");
export const WEAVIATE_API_KEY: string = mustGet("WEAVIATE_API_KEY");

export const OPENAI_API_KEY: string = mustGet("OPENAI_API_KEY");
export const GITHUB_TOKEN: string = mustGet("GITHUB_TOKEN");

export const PORT: number = parseInt(process.env.PORT || "3000", 10);
export const BATCH_SIZE: number = parseInt(process.env.BATCH_SIZE || "50", 10);

export const MODE: string = process.env.APP_ENV || "draft";

console.log("✅ All Environment variables loaded");
