// Tool media payload tests cover how generated media from tools is attached to
// visible embedded-run replies without disturbing source-reply metadata.
import { describe, expect, it } from "vitest";
import {
  getReplyPayloadMetadata,
  setReplyPayloadMetadata,
} from "../../../auto-reply/reply-payload.js";
import { mergeAttemptToolMediaPayloads } from "./tool-media-payloads.js";

describe("mergeAttemptToolMediaPayloads", () => {
  it("attaches tool media to the first visible reply", () => {
    // Reasoning payloads are not user-visible replies, so media attaches to the
    // first final/visible payload instead.
    expect(
      mergeAttemptToolMediaPayloads({
        payloads: [
          { text: "thinking", isReasoning: true },
          { text: "done", mediaUrls: ["/tmp/a.png"] },
        ],
        toolMediaUrls: ["/tmp/a.png", "/tmp/b.opus"],
        toolAudioAsVoice: true,
      }),
    ).toEqual([
      { text: "thinking", isReasoning: true },
      {
        text: "done",
        mediaUrls: ["/tmp/a.png", "/tmp/b.opus"],
        mediaUrl: "/tmp/a.png",
        audioAsVoice: true,
      },
    ]);
  });

  it("preserves trusted local media metadata on normal visible reply merges", () => {
    expect(
      mergeAttemptToolMediaPayloads({
        payloads: [{ text: "done" }],
        toolMediaUrls: ["/tmp/reply.opus"],
        toolAudioAsVoice: true,
        toolTrustedLocalMedia: true,
        toolSpokenText: "spoken reply",
      }),
    ).toEqual([
      {
        text: "done",
        mediaUrls: ["/tmp/reply.opus"],
        mediaUrl: "/tmp/reply.opus",
        audioAsVoice: true,
        trustedLocalMedia: true,
        spokenText: "spoken reply",
      },
    ]);
  });

  it("preserves trusted TTS spoken text for non-voice audio files", () => {
    expect(
      mergeAttemptToolMediaPayloads({
        payloads: [{ text: "done" }],
        toolMediaUrls: ["/tmp/reply.wav"],
        toolTrustedLocalMedia: true,
        toolSpokenText: "spoken reply",
      }),
    ).toEqual([
      {
        text: "done",
        mediaUrls: ["/tmp/reply.wav"],
        mediaUrl: "/tmp/reply.wav",
        trustedLocalMedia: true,
        spokenText: "spoken reply",
      },
    ]);
  });

  it("creates a media-only reply when no visible reply exists", () => {
    expect(
      mergeAttemptToolMediaPayloads({
        payloads: [{ text: "thinking", isReasoning: true }],
        toolMediaUrls: ["/tmp/reply.opus"],
        toolAudioAsVoice: true,
      }),
    ).toEqual([
      { text: "thinking", isReasoning: true },
      {
        mediaUrls: ["/tmp/reply.opus"],
        mediaUrl: "/tmp/reply.opus",
        audioAsVoice: true,
      },
    ]);
  });

  it("preserves reply metadata when attaching tool media to a visible reply", () => {
    const visibleReply = setReplyPayloadMetadata(
      { text: "done" },
      {
        assistantMessageIndex: 7,
        deliverDespiteSourceReplySuppression: true,
      },
    );

    const [reasoningReply, mergedReply] =
      mergeAttemptToolMediaPayloads({
        payloads: [{ text: "thinking", isReasoning: true }, visibleReply],
        toolMediaUrls: ["/tmp/reply.png"],
      }) ?? [];

    expect(reasoningReply).toEqual({ text: "thinking", isReasoning: true });
    expect(mergedReply).toEqual({
      text: "done",
      mediaUrls: ["/tmp/reply.png"],
      mediaUrl: "/tmp/reply.png",
    });
    expect(getReplyPayloadMetadata(mergedReply ?? {})).toEqual({
      assistantMessageIndex: 7,
      deliverDespiteSourceReplySuppression: true,
    });
  });

  it("preserves trusted local media provenance when merging tool media", () => {
    expect(
      mergeAttemptToolMediaPayloads({
        payloads: [{ text: "done" }],
        toolMediaUrls: ["/tmp/reply.opus"],
        toolAudioAsVoice: true,
        toolTrustedLocalMedia: true,
      }),
    ).toEqual([
      {
        text: "done",
        mediaUrls: ["/tmp/reply.opus"],
        mediaUrl: "/tmp/reply.opus",
        audioAsVoice: true,
        trustedLocalMedia: true,
      },
    ]);
  });

  it("does not attach tool media to message-tool-only source reply mirrors", () => {
    // Source reply mirrors already represent delivered message-tool output;
    // adding separate tool media would duplicate or mutate the transcript mirror.
    const sourceReply = setReplyPayloadMetadata(
      { text: "sent through message tool" },
      {
        deliverDespiteSourceReplySuppression: true,
        sourceReplyTranscriptMirror: {
          sessionKey: "agent:main",
          text: "sent through message tool",
        },
      },
    );

    const [mergedReply] =
      mergeAttemptToolMediaPayloads({
        payloads: [sourceReply],
        toolMediaUrls: ["/tmp/generated.png"],
        sourceReplyDeliveryMode: "message_tool_only",
      }) ?? [];

    expect(mergedReply).toEqual({ text: "sent through message tool" });
    expect(getReplyPayloadMetadata(mergedReply ?? {})).toMatchObject({
      deliverDespiteSourceReplySuppression: true,
      sourceReplyTranscriptMirror: {
        sessionKey: "agent:main",
        text: "sent through message tool",
      },
    });
  });

  it("delivers trusted local voice tool media separately in message-tool-only mode", () => {
    const [privateFinal, mediaOnly] =
      mergeAttemptToolMediaPayloads({
        payloads: [{ text: "private final" }],
        toolMediaUrls: ["/tmp/reply.opus"],
        toolAudioAsVoice: true,
        toolTrustedLocalMedia: true,
        toolSpokenText: "spoken reply",
        sourceReplyDeliveryMode: "message_tool_only",
      }) ?? [];

    expect(privateFinal).toEqual({ text: "private final" });
    expect(getReplyPayloadMetadata(privateFinal ?? {})).toBeUndefined();
    expect(mediaOnly).toEqual({
      mediaUrls: ["/tmp/reply.opus"],
      mediaUrl: "/tmp/reply.opus",
      audioAsVoice: true,
      trustedLocalMedia: true,
      spokenText: "spoken reply",
    });
    expect(getReplyPayloadMetadata(mediaOnly ?? {})).toEqual({
      deliverDespiteSourceReplySuppression: true,
    });
  });

  it("does not bypass source suppression for untrusted or non-voice tool media", () => {
    const untrustedVoice =
      mergeAttemptToolMediaPayloads({
        payloads: [{ text: "private final" }],
        toolMediaUrls: ["/tmp/reply.opus"],
        toolAudioAsVoice: true,
        sourceReplyDeliveryMode: "message_tool_only",
      }) ?? [];
    const trustedImage =
      mergeAttemptToolMediaPayloads({
        payloads: [{ text: "private final" }],
        toolMediaUrls: ["/tmp/reply.png"],
        toolTrustedLocalMedia: true,
        sourceReplyDeliveryMode: "message_tool_only",
      }) ?? [];

    expect(untrustedVoice).toHaveLength(1);
    expect(trustedImage).toHaveLength(1);
    expect(getReplyPayloadMetadata(untrustedVoice[0] ?? {})).toBeUndefined();
    expect(getReplyPayloadMetadata(trustedImage[0] ?? {})).toBeUndefined();
  });
});
