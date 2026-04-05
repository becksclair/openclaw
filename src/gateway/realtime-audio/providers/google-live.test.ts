import { describe, expect, it } from "vitest";
import { GoogleLiveRealtimeProviderAdapter } from "./google-live.js";

describe("GoogleLiveRealtimeProviderAdapter", () => {
  it("keeps the boundary real by emitting a deterministic not-implemented error", async () => {
    const adapter = new GoogleLiveRealtimeProviderAdapter();
    const events: unknown[] = [];
    adapter.subscribe((event) => {
      events.push(event);
    });

    await adapter.start();

    expect(events).toEqual([
      {
        type: "error",
        code: "GOOGLE_LIVE_NOT_IMPLEMENTED",
        message: "Google Live realtime adapter is not implemented yet.",
        retryable: false,
      },
    ]);
  });
});
