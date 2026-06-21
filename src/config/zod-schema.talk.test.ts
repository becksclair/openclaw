// Covers talk schema parsing and validation behavior.
import { describe, expect, it } from "vitest";
import { OpenClawSchema } from "./zod-schema.js";

describe("OpenClawSchema talk validation", () => {
  it("accepts a positive integer talk.silenceTimeoutMs", () => {
    const result = OpenClawSchema.safeParse({
      talk: {
        consultThinkingLevel: "low",
        consultFastMode: true,
        silenceTimeoutMs: 1500,
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects invalid talk.consultThinkingLevel", () => {
    expect(() =>
      OpenClawSchema.parse({
        talk: {
          consultThinkingLevel: "turbo",
        },
      }),
    ).toThrow(/consultThinkingLevel/i);
  });

  it("accepts additional realtime Talk instructions", () => {
    expect(() =>
      OpenClawSchema.parse({
        talk: {
          realtime: {
            provider: "openai",
            providers: {
              openai: {
                model: "gpt-realtime",
                speakerVoice: "alloy",
                speakerVoiceId: "voice-123",
              },
            },
            instructions: "Speak with crisp diction.",
            consultRouting: "force-agent-consult",
            tools: {
              profile: "voice",
              alsoAllow: ["bundle-mcp"],
              deny: ["message"],
            },
          },
        },
      }),
    ).not.toThrow();
  });

  it("accepts all profile ids for realtime Talk tools", () => {
    for (const profile of ["minimal", "coding", "messaging", "full", "voice"]) {
      expect(() =>
        OpenClawSchema.parse({
          talk: {
            realtime: {
              tools: { profile },
            },
          },
        }),
      ).not.toThrow();
    }
  });

  it("rejects invalid realtime Talk consult routing", () => {
    expect(() =>
      OpenClawSchema.parse({
        talk: {
          realtime: {
            consultRouting: "always",
          },
        },
      }),
    ).toThrow(/consultRouting/i);
  });

  it("rejects invalid realtime Talk tool profile", () => {
    expect(() =>
      OpenClawSchema.parse({
        talk: {
          realtime: {
            tools: {
              profile: "admin",
            },
          },
        },
      }),
    ).toThrow(/profile/i);
  });

  it("rejects realtime Talk tools allow and alsoAllow together", () => {
    expect(() =>
      OpenClawSchema.parse({
        talk: {
          realtime: {
            tools: {
              allow: ["read"],
              alsoAllow: ["exec"],
            },
          },
        },
      }),
    ).toThrow(/allow.*alsoAllow|alsoAllow.*allow/i);
  });

  it.each([
    ["boolean", true],
    ["string", "1500"],
    ["float", 1500.5],
  ])("rejects %s talk.silenceTimeoutMs", (_label, value) => {
    expect(() =>
      OpenClawSchema.parse({
        talk: {
          silenceTimeoutMs: value,
        },
      }),
    ).toThrow(/silenceTimeoutMs|number|integer/i);
  });

  it("rejects talk.provider when it does not match talk.providers", () => {
    expect(() =>
      OpenClawSchema.parse({
        talk: {
          provider: "acme",
          providers: {
            elevenlabs: {
              voiceId: "voice-123",
            },
          },
        },
      }),
    ).toThrow(/talk\.provider|talk\.providers|missing "acme"/i);
  });

  it("rejects multi-provider talk config without talk.provider", () => {
    expect(() =>
      OpenClawSchema.parse({
        talk: {
          providers: {
            acme: {
              voiceId: "voice-acme",
            },
            elevenlabs: {
              voiceId: "voice-eleven",
            },
          },
        },
      }),
    ).toThrow(/talk\.provider|required/i);
  });
});
