// server.ts (TypeScript, strict)
import crypto from "crypto";
import express, {Express, NextFunction, Request, Response} from "express";
import {createHmac, Hmac} from 'node:crypto';
import {GITHUB_TOKEN, PORT} from "./config.js";
import {handleIssueEvent} from "./worker.js";

/* ----------------------------- Types ----------------------------- */

type GitHubEventType = "issues" | "issue_comment" | "discussion" | "discussion_comment" | "ping" | string;

interface GitHubWebhookPayload {
    action?: string;
    issue?: Record<string, unknown>;
    comment?: Record<string, unknown>;
    discussion?: Record<string, unknown>;
    repository?: { name?: string; full_name?: string };
    sender?: { login?: string };
    zen?: string;
    hook_id?: number;

    [k: string]: unknown;
}

interface RawBodyRequest extends Request {
    rawBody: Buffer;
}

/* --------------------------- Utilities --------------------------- */

function safeEqual(a: Buffer, b: Buffer): boolean {
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifyGitHubSignature(
    rawBody: Buffer, signatureHeader: string | undefined, secret: string | undefined): boolean {
    if (!secret) {
        console.warn("⚠️ GITHUB_TOKEN not set — skipping signature verification (DEV mode).");
        return true;
    }
    if (!signatureHeader) return false;
    const [algo, signature]: string[] = signatureHeader.split("=");
    if (algo !== "sha256" || !signature) return false;
    const hmac: Hmac = createHmac("sha256", secret);
    hmac.update(rawBody);
    const digest: string = hmac.digest("hex");
    return safeEqual(Buffer.from(digest, "hex"), Buffer.from(signature, "hex"));
}

/**
 * Try to extract JSON payload from raw body for multiple GitHub delivery formats:
 * - If content-type is application/json -> parse directly
 * - If application/x-www-form-urlencoded -> look for `payload` key (common with "form")
 * - Otherwise: try to find first JSON substring inside raw body
 */
function parseGitHubPayload(raw: Buffer, contentType: string | undefined): GitHubWebhookPayload | null {
    const text: string = raw.toString("utf8");
    try {
        if (contentType?.includes("application/json")) {
            return JSON.parse(text) as GitHubWebhookPayload;
        }

        if (contentType?.includes("application/x-www-form-urlencoded")) {
            // Example raw: "payload=%7B%22zen%22%3A...%7D" or "payload={...}"
            const params: URLSearchParams = new URLSearchParams(text);
            if (params.has("payload")) {
                const payloadText: string = params.get("payload") ?? "";
                return JSON.parse(payloadText) as GitHubWebhookPayload;
            }

            // fallback: look for a JSON substring
            const firstJson: number = text.indexOf("{");
            if (firstJson >= 0) {
                const maybe: string = text.slice(firstJson);
                return JSON.parse(maybe) as GitHubWebhookPayload;
            }

            return null;
        }

        // Other content-types: try to locate JSON substring
        const idx: number = text.indexOf("{");
        if (idx >= 0) {
            const maybe: string = text.slice(idx);
            return JSON.parse(maybe) as GitHubWebhookPayload;
        }

        return null;
    } catch (err) {
        console.error(
            "❌ parseGitHubPayload error:", (
                err as Error
            ).message);
        return null;
    }
}

/* --------------------------- App Setup --------------------------- */

const app: Express = express();

/* Capture raw body for ANY content-type (so we can verify signature and parse manually) */
app.use(
    express.raw({
        type: (): true => true,
        limit: "2mb",
    })
);

/* Convert rawBody into req.body (robust) */
app.use((req: Request, _res: Response, next: NextFunction): void => {
    const r: RawBodyRequest = req as RawBodyRequest;
    r.rawBody = r.body instanceof Buffer ? r.body : Buffer.from("");

    const contentType: string = req.get("content-type") ?? "";

    const parsed: GitHubWebhookPayload | null = parseGitHubPayload(r.rawBody, contentType);
    if (parsed === null) {
        console.warn("⚠️ Could not parse JSON payload from request. content-type=", contentType);
        // leave req.body as empty object to avoid breaking handlers
        req.body = {};
    } else {
        req.body = parsed as unknown;
    }
    next();
});

/* Signature middleware */
function githubSignatureMiddleware(req: Request, res: Response, next: NextFunction): void {
    const rawReq: Partial<RawBodyRequest> = req as Partial<RawBodyRequest>;
    const rawBody: Buffer<ArrayBufferLike> | undefined = rawReq.rawBody;
    if (!rawBody || rawBody.length === 0) {
        console.error("❌ Missing raw body for signature verification.");
        res.status(400).send("Missing raw body for signature verification.");
        return;
    }

    const signatureHeader: string | undefined = req.get("X-Hub-Signature-256") ?? undefined;
    const ok: boolean = verifyGitHubSignature(rawBody, signatureHeader, GITHUB_TOKEN);
    if (!ok) {
        console.error("❌ Invalid or missing GitHub signature.");
        res.status(401).send("Invalid GitHub signature.");
        return;
    }

    next();
}

/* Healthcheck */
app.get("/health", (_req: Request, res: Response): void => {
    res.status(200).send("OK");
});

/* ------------------------ Webhook endpoint ------------------------ */

app.post(
    "/webhook",
    githubSignatureMiddleware,
    async (req: Request<unknown, unknown, GitHubWebhookPayload>, res: Response): Promise<void> => {
        const eventType: "issues" | "issue_comment" | "discussion" | "discussion_comment" | "ping" | string = (
            req.get("X-GitHub-Event") ?? "unknown"
        ) as GitHubEventType;
        console.log(`📬 Received GitHub event: ${eventType}`);

        // req.body should already be parsed into JSON object by middleware
        const payload: GitHubWebhookPayload = req.body as GitHubWebhookPayload;

        // Defensive logging: always print a short summary of what we found
        const repoName: string = payload.repository?.full_name ?? "<unknown>";
        console.log(
            `📦 Repo: ${repoName} | action: ${payload.action ?? "<none>"} | keys: ${Object.keys(payload).join(", ")}`);

        try {
            switch (eventType) {
                case "ping": {
                    console.log("✅ Ping received:", payload.zen ?? "(no zen)");
                    res.status(200).send("Pong");
                    return;
                }

                case "issues": {
                    console.log("⚙️ Handling 'issues' event (create/update/etc.)");
                    await handleIssueEvent(payload);
                    console.log("✅ 'issues' processed");
                    res.status(200).send("issues processed");
                    return;
                }

                case "issue_comment": {
                    console.log("⚙️ Handling 'issue_comment' event");
                    // payload.comment is expected; worker code earlier checks payload.comment?.body
                    await handleIssueEvent(payload);
                    console.log("✅ 'issue_comment' processed");
                    res.status(200).send("issue_comment processed");
                    return;
                }

                case "discussion": {
                    console.log("⚙️ Handling 'discussion' event");
                    await handleIssueEvent(payload);
                    console.log("✅ 'discussion' processed");
                    res.status(200).send("discussion processed");
                    return;
                }

                case "discussion_comment": {
                    console.log("⚙️ Handling 'discussion_comment' event");
                    await handleIssueEvent(payload);
                    console.log("✅ 'discussion_comment' processed");
                    res.status(200).send("discussion_comment processed");
                    return;
                }

                default: {
                    console.warn(`⚠️ Unhandled event type received: ${eventType}. Will ignore but logged.`);
                    res.status(204).send("Event ignored");
                    return;
                }
            }
        } catch (err) {
            // never be silent: log details and return 500
            console.error(
                "💥 Error while processing webhook event:", (
                err as Error
            ).stack ?? (
                err as Error
            ).message);
            // In development, you might want to surface the error; in prod avoid leaking internals.
            res.status(500).send("Internal Server Error");
        }
    }
);

/* Global error handler to avoid silent failures */
app.use((err: Error, _req: Request, res: Response, _next: NextFunction): void => {
    console.error("💣 Uncaught server error:", err.stack ?? err.message);
    res.status(500).send("Unexpected server error");
});

/* Start */
app.listen(PORT, "0.0.0.0", (): void => {
    console.log(`🚀 Webhook server running on port ${PORT}`);
});

