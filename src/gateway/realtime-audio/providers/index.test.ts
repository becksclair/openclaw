import { describe, expect, it } from "vitest";
import { GoogleLiveRealtimeProviderAdapter } from "./google-live.js";
import { createRealtimeProviderAdapter } from "./index.js";
import { OpenAIRealtimeProviderAdapter } from "./openai.js";

describe("createRealtimeProviderAdapter", () => {
  it("creates the expected adapter types", () => {
    expect(createRealtimeProviderAdapter({ provider: "openai" })).toBeInstanceOf(
      OpenAIRealtimeProviderAdapter,
    );
    expect(createRealtimeProviderAdapter({ provider: "google-live" })).toBeInstanceOf(
      GoogleLiveRealtimeProviderAdapter,
    );
  });

  it("canonicalizes upstream realtime voice provider aliases before selecting an adapter", () => {
    expect(createRealtimeProviderAdapter({ provider: "OpenAI" })).toBeInstanceOf(
      OpenAIRealtimeProviderAdapter,
    );
  });

  it("fails loudly for unsupported realtime providers", () => {
    expect(() => createRealtimeProviderAdapter({ provider: "mystery-box" })).toThrow(
      /Unsupported realtime voice provider: mystery-box/u,
    );
  });
});
