# Github Agent

**An intelligent Node.js agent that integrates your repository with Weaviate and OpenAI to automatically respond to Issues and Discussions via RAG.**

---

## 🚀 Overview

This submodule (`github-agent`) is a Node.js workflow that:

1. Receives GitHub events (Issues and Discussions) via webhook.
2. Splits texts into chunks and generates embeddings with OpenAI.
3. Indexes the embeddings in **Weaviate**.
4. Retrieves relevant context using **RAG** (Retrieve + Generate).
5. Generates automatic responses with LLM (OpenAI) and posts on GitHub.

All of this **maintaining full control** over the pipeline: embeddings, vectors, queries, and prompts.
