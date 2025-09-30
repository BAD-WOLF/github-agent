import type {Dirent} from 'fs';
import fs from "fs/promises";
import ignore from 'ignore'
import path from "path";
import {CollectionConfig} from 'weaviate-client'
import {chunkTextByTokens} from "./chunker.js";
import {BATCH_SIZE} from "./config.js";
import {getEmbedding} from "./embed.js";
import client from "./weaviateClient.js";
import {fileURLToPath} from 'url';

// global counter of successful requests
// noinspection ES6ConvertVarToLetConst
var successfulRequests: number = 0;

// Ensure that the Document collection exists
async function ensureSchema(): Promise<void> {
    const collections: CollectionConfig[] = await client.collections.listAll();
    const exists: boolean = collections.some((c: CollectionConfig): boolean => c.name === "Document");

    if (!exists) {
        await client.collections.create({
            name: "Document",
            description: "Indexed code/documentation snippets",
            vectorizers: [], // implicit "none", because we will pass vectors manually
            properties: [
                {name: "text", dataType: "text"},
                {name: "repo", dataType: "text"},
                {name: "path", dataType: "text"},
                {name: "chunk_index", dataType: "int"},
            ],
        });
        console.log("✅ Document collection created");
    } else {
        console.log("Document collection already exists");
    }
}

// Indexes multiple objects in batch
async function indexBatch(objs: {
    properties: { text: string; repo: string; path: string; chunk_index: number };
    vector: number[];
}[]): Promise<void> {
    try {
        await client.collections.get("Document").data.insertMany(objs);
        // increments and logs the counter
        successfulRequests++;
    } catch (err) {
        console.error("Error in batch insert: ", err);
        throw err; // in v3 there is no fallback for data.creator()
    }
}

// Indexes a file (with chunk + embedding)
async function indexFile(filePath: string, repoName: string, batch: any[]): Promise<void> {
    const text: string = await fs.readFile(filePath, "utf-8");
    const chunks: string[] = chunkTextByTokens(text, 8191);

    for (const [i, chunk] of chunks.entries()) {
        const vector: number[] = await getEmbedding(chunk);
        batch.push({
            properties: {
                text: chunk,
                repo: repoName,
                path: filePath,
                chunk_index: i,
            },
            vector,
        });

        if (batch.length >= BATCH_SIZE) {
            await indexBatch(batch.splice(0, batch.length));
        }
    }
}

// .gitignore only from the root
async function loadRootIgnore(projectRoot: string): Promise<ignore.Ignore> {
    const gitignorePath: string = path.join(projectRoot, ".gitignore");
    let ig: ignore.Ignore = ignore();

    try {
        const content: string = await fs.readFile(gitignorePath, "utf8");
        ig = ignore().add(content.split(/\r?\n/));
    } catch {
        // if .gitignore doesn't exist, ignore
    }

    // forcibly ignore the github-agent submodule
    const ignoreDir: Array<string> = ['github-agent',  '**/.git'];
    ignoreDir.forEach((d: string): void => {ig.add(d)})
    return ig;
}

async function walkAndIndex(
    dir: string,
    repoName: string,
    batch: any[],
    ig: ignore.Ignore,
    projectRoot: string
): Promise<void> {
    const entries: Dirent[] = await fs.readdir(dir, {withFileTypes: true});

    for (const ent of entries) {
        const full: string = path.join(dir, ent.name);
        const relPath: string = path.relative(projectRoot, full);

        if (ig.ignores(relPath)) continue;

        if (ent.isDirectory()) {
            await walkAndIndex(full, repoName, batch, ig, projectRoot);
        } else
            if (ent.isFile()) {
                await indexFile(full, repoName, batch);
            }
    }
}

// Main
(
    async (): Promise<void> => {
        const __dirname: string = path.dirname(fileURLToPath(import.meta.url));
        // gets the path from where the agent was executed
        const repoDir: string = path.resolve(__dirname, "../../");

        const repoName: string | undefined = process.argv[2];

        if (!repoName) {
            console.error("❌ Use: ts-node index.ts <repoName>");
            process.exit(1);
        }

        await ensureSchema();

        const batch: any[] = [];
        const ig: Promise<ignore.Ignore> = loadRootIgnore(repoDir);

        await walkAndIndex(repoDir, repoName, batch, await ig, repoDir);

        if (batch.length > 0) {
            await indexBatch(batch);
        }

        console.log("✅ Indexing complete");
    }
)();
