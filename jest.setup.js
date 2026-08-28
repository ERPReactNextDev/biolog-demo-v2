// jest.setup.js
// Global test setup

// Polyfill structuredClone if needed
if (typeof structuredClone === "undefined") {
  global.structuredClone = (obj) => JSON.parse(JSON.stringify(obj));
}

// Suppress Next.js server-component warnings in JSDOM
process.env.NODE_ENV = "test";

// Provide a basic TextEncoder/TextDecoder for jsdom
const { TextEncoder, TextDecoder } = require("util");
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Polyfill Fetch API globals required by next/server (Request, Response, Headers, fetch)
// These are not available in the jsdom test environment by default.
// We patch ReadableStream/WritableStream/TransformStream first because undici
// requires them and jsdom may not expose them on globalThis at module load time.
if (typeof globalThis.ReadableStream === "undefined") {
  const streams = require("stream/web");
  globalThis.ReadableStream = streams.ReadableStream;
  globalThis.WritableStream = streams.WritableStream;
  globalThis.TransformStream = streams.TransformStream;
}
// undici requires MessagePort (from worker_threads) to be on globalThis
if (typeof globalThis.MessagePort === "undefined") {
  const { MessageChannel, MessagePort } = require("worker_threads");
  globalThis.MessageChannel = MessageChannel;
  globalThis.MessagePort = MessagePort;
}
if (typeof globalThis.Request === "undefined") {
  const { fetch, Request, Response, Headers, FormData } = require("undici");
  globalThis.fetch = fetch;
  globalThis.Request = Request;
  globalThis.Response = Response;
  globalThis.Headers = Headers;
  globalThis.FormData = FormData;
}
