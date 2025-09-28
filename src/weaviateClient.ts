import weaviate, { WeaviateClient } from "weaviate-client";
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config({ quiet: true });

const weaviateUrl: string = process.env.WEAVIATE_URL as string;
const weaviateApiKey: string = process.env.WEAVIATE_API_KEY as string;

const client: WeaviateClient = await weaviate.connectToWeaviateCloud(
    weaviateUrl, // ex: "https://abcd.weaviate.network"
    {
        authCredentials: new weaviate.ApiKey(weaviateApiKey),
    }
);

export default client;