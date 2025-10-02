import fs from "fs";
import { handleIssueEvent } from "./worker.js";

async function main(): Promise<void> {
    const payloadPath: string = process.argv[2];
    const payload: any = JSON.parse(fs.readFileSync(payloadPath, "utf-8"));

    let aiModel: number = 1;
    if(process.argv[3] == "--model" && process.argv[4]) {
        aiModel = (process.argv[4] as unknown) as number;
    }

    await handleIssueEvent(payload, aiModel);
}

main().catch((err: any): void => {
    console.error("CLI Error:", err);
    process.exit(1);
});
