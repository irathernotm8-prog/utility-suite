// Runs the optional offline language model off the main thread so Datum stays smooth.
import { WebWorkerMLCEngineHandler } from '../vendor/web-llm/web-llm.js';

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg) => handler.onmessage(msg);
