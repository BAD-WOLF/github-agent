import {chunkTextByTokens} from '../chunker.js'
import weaviateClient from "../weaviateClient.js";
import {getEmbedding} from '../embed.js'
import '../config.js';

console.log(await weaviateClient.isReady());

console.log(await getEmbedding("test"));

console.log(chunkTextByTokens("test"));