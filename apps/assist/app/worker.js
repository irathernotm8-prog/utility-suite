// Runs the language model off the main thread so the interface stays smooth.
import { WebWorkerMLCEngineHandler } from "./web-llm.js";

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg) => handler.onmessage(msg);
