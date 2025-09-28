import weaviateClient from "../weaviateClient.js";
import '../config.js';

console.log(await weaviateClient.isReady());