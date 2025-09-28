import dotenv from 'dotenv';
import weaviate, {WeaviateClient} from "weaviate-client";
import {WEAVIATE_API_KEY, WEAVIATE_HOST} from "./config.js";

dotenv.config({path: '.env.local'});
dotenv.config({quiet: true});

const weaviateUrl: string = WEAVIATE_HOST as string;
const weaviateApiKey: string = WEAVIATE_API_KEY as string;

const client: WeaviateClient = await weaviate.connectToWeaviateCloud(
    weaviateUrl, // ex: "https://abcd.weaviate.network"
    {
        authCredentials: new weaviate.ApiKey(weaviateApiKey),
    }
);

export default client;