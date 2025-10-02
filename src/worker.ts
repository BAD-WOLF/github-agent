import { Octokit } from "@octokit/rest";
import gepetoResponse from './AiModel/gepeto.js';
import weaviateAgentResponse from './AiModel/weaviateAgents.js';
import { Collection, WeaviateReturn } from 'weaviate-client';
import { MODE } from "./config.js";
import { getEmbedding } from "./embed.js";
import client from "./weaviateClient.js";

const octokit: any = new Octokit({ auth: process.env.GITHUB_TOKEN });

export async function handleIssueEvent(payload: any, aiModel: number): Promise<void> {
    // ---- robust event-type detection ----
    const hasDiscussion = !!payload.discussion;
    const hasIssue = !!payload.issue;
    const hasComment = !!payload.comment;

    const isDiscussionCreated = hasDiscussion && !hasComment; // new discussion root
    const isIssueCreated = hasIssue && !hasComment; // new issue root
    const isDiscussionComment = hasComment && hasDiscussion; // comment inside a discussion
    const isIssueComment = hasComment && hasIssue; // comment inside an issue

    // ---- owner / repo parsing (single place) ----
    const fullRepo: string | undefined = payload.repository?.full_name;
    if (!fullRepo) {
        console.warn("Repository information missing from payload; ignoring.");
        return;
    }
    const [owner, repoName] = fullRepo.split("/");
    if (!owner || !repoName) {
        console.warn("Invalid repository fullname:", fullRepo);
        return;
    }

    // ---- extract text and contextual ids ----
    let text: string | undefined;
    let discussionNumber: number | undefined;
    let issueNumber: number | undefined;
    let commentId: number | undefined;

    if (isDiscussionCreated) {
        discussionNumber = payload.discussion?.number;
        text = (payload.discussion?.body ?? "") + "\n\n" + (payload.discussion?.title ?? "");
    } else if (isIssueCreated) {
        issueNumber = payload.issue?.number;
        text = (payload.issue?.body ?? "") + "\n\n" + (payload.issue?.title ?? "");
    } else if (isDiscussionComment) {
        discussionNumber = payload.discussion?.number;
        commentId = payload.comment?.id;
        text = payload.comment?.body;
    } else if (isIssueComment) {
        issueNumber = payload.issue?.number;
        commentId = payload.comment?.id;
        text = payload.comment?.body;
    } else {
        console.warn("Unhandled payload shape; ignoring.", { hasDiscussion, hasIssue, hasComment });
        return;
    }

    text = typeof text === "string" ? text.trim() : undefined;
    if (!text) {
        console.warn("No text to process; ignoring.");
        return;
    }

    // For comments only: respond only if bot was mentioned
    const shouldRequireMention = isDiscussionComment || isIssueComment;
    if (shouldRequireMention && !text.includes("@BAD-WOLF")) {
        console.log("Comment does not mention @BAD-WOLF — ignoring.");
        return;
    }

    const contextTarget = isDiscussionCreated ? `discussion#${discussionNumber}` :
        isIssueCreated ? `issue#${issueNumber}` :
            isDiscussionComment ? `discussion#${discussionNumber} comment#${commentId}` :
                `issue#${issueNumber} comment#${commentId}`;

    console.log(`Processing event for ${owner}/${repoName} → ${contextTarget}`);

    // ---- generate embedding (guarded) ----
    let qVec: any;
    try {
        qVec = await getEmbedding(text);
    } catch (err) {
        console.error("Error generating question embedding:", err);
        return;
    }

    // ---- retrieve context from Weaviate ----
    let docs = "";
    try {
        const collection: Collection<undefined, "Document", undefined> = client.collections.use("Document");
        const res: WeaviateReturn<undefined, undefined> = await collection.query.nearVector(qVec, {
            returnProperties: ["text", "repo", "path"],
            returnMetadata: ["distance"],
            limit: 6
        });
        docs = (res.objects || []).map((d: any) => d.properties?.text || "").filter(Boolean).join("\n\n---\n\n");
    } catch (err) {
        console.error("Error fetching context from Weaviate:", err);
        docs = "";
    }

    // ---- call LLM ----
    let reply: string;
    try {
        if (aiModel === 1) {
            reply = await gepetoResponse(docs, text);
        } else {
            reply = await weaviateAgentResponse(text, client);
        }
    } catch (err) {
        console.error("Error calling LLM:", err);
        reply = "Sorry, I couldn't formulate a response right now.";
    }

    // ---- post or draft ----
    const body = `🤖 Automatic response:\n\n${reply}\n\n*Generated via Weaviate RAG*`;

    if (MODE === "draft") {
        console.log("DRAFT mode — would post to:", { owner, repoName, discussionNumber, issueNumber, commentId });
        console.log("Generated body:\n", body);
        return;
    }

    try {
        if (isDiscussionCreated) {
            // create a root discussion comment (REST endpoint exists for this)
            if (!discussionNumber) throw new Error("discussionNumber missing");
            console.log("Calling: POST /repos/{owner}/{repo}/discussions/{discussion_number}/comments");
            await octokit.request(
                "POST /repos/{owner}/{repo}/discussions/{discussion_number}/comments",
                {
                    owner,
                    repo: repoName,
                    discussion_number: discussionNumber,
                    body
                }
            );
            console.log("Discussion root comment posted successfully");
        } else if (isIssueCreated) {
            // comment on issue
            if (!issueNumber) throw new Error("issueNumber missing");
            console.log("Calling: octokit.issues.createComment");
            await octokit.issues.createComment({
                owner,
                repo: repoName,
                issue_number: issueNumber,
                body
            });
            console.log("Issue comment posted successfully");
        } else if (isDiscussionComment) {
            // === CORRECT: use GraphQL to create a threaded reply ===
            const discussionNodeId: string | undefined = payload.discussion?.node_id;
            const commentNodeId: string | undefined = payload.comment?.node_id;

            if (!discussionNodeId || !commentNodeId) {
                console.error("Missing `node_id` fields in payload; cannot create threaded reply via GraphQL. Received:", {
                    discussionNodeId,
                    commentNodeId
                });
                // fallback: post a root comment on the discussion (non-threaded) if you prefer:
                // if (discussionNumber) { ... octokit.request(POST /discussions/.../comments) }
                return;
            }

            const mutation = `
              mutation AddDiscussionComment($input: AddDiscussionCommentInput!) {
                addDiscussionComment(input: $input) {
                  comment {
                    id
                    url
                    body
                  }
                }
              }
            `;

            const variables = {
                input: {
                    discussionId: discussionNodeId,
                    replyToId: commentNodeId,
                    body: body
                }
            };

            console.log("Calling GraphQL: addDiscussionComment (reply) with discussionId and replyToId");
            const res = await octokit.request("POST /graphql", {
                query: mutation,
                variables
            });

            // GraphQL errors appear in res.data.errors
            if (res?.data?.errors) {
                console.error("GraphQL returned errors:", res.data.errors);
                throw new Error("GraphQL addDiscussionComment failed");
            }

            console.log("Discussion comment reply posted successfully (GraphQL):", res.data?.data?.addDiscussionComment?.comment?.url ?? res.data);
        } else if (isIssueComment) {
            // comment on issue (issue comments use same API)
            if (!issueNumber) throw new Error("issueNumber missing for issue comment");
            console.log("Calling: octokit.issues.createComment (issue comment reply)");
            await octokit.issues.createComment({
                owner,
                repo: repoName,
                issue_number: issueNumber,
                body
            });
            console.log("Issue comment posted successfully");
        } else {
            console.warn("No matching posting path for this payload; nothing sent.");
        }
    } catch (err: any) {
        // log request/response info if available
        console.error("Failed to post comment:", err?.message ?? err);
        if (err?.request) {
            console.error("Request:", {
                method: err.request?.method,
                url: err.request?.url
            });
        }
        if (err?.response) {
            console.error("Response status:", err.response?.status, "data:", err.response?.data);
        }
    }
}
