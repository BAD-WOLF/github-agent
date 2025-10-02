import { QueryAgent } from 'weaviate-agents';
import {WeaviateClient} from 'weaviate-client'

export default async function weaviateAgentResponse(text: string, client: WeaviateClient): Promise<any> {
    const agent: any = new QueryAgent(
        client,
        {
            collections: [
                {
                    name: "Document",
                },
            ],
        }
    );

    const result: any = await agent.ask(text);
    return result.finalAnswer;
}
