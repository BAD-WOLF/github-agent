import OpenAI from "openai";

export default async function gepetoResponse(docs: string, text: string): Promise<string> {
    const openai: OpenAI = new OpenAI({baseURL: 'https://models.github.ai/inference', apiKey: process.env.OPENAI_API_KEY});

    // Prompt Mount
    let system_prompt: string = `Você é um assistente técnico para este repositório.
Use somente o contexto abaixo para responder.
Se não houver resposta clara, peça mais informações.

Contexto:
${docs}`

    let user_prompt: string = `Pergunta:
${text.replace(/@BAD-WOLF/g, '')}`;

    const completion: OpenAI.Chat.Completions.ChatCompletion & {
        _request_id?: string | null
    } = await openai.chat.completions.create({
        model: "openai/gpt-4.1",
        messages: [{role: "system", content: system_prompt}, {role: "user", content: user_prompt}],
        max_completion_tokens: 8000,
    });
    return completion.choices[0].message.content ?? "";
}