import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { deepgramMediaUnderstandingProvider } from "./media-understanding-provider.js";
import { buildDeepgramSpeechProvider } from "./speech-provider.js";

export default definePluginEntry({
  id: "deepgram",
  name: "Deepgram Media Understanding",
  description: "Bundled Deepgram audio transcription and text-to-speech provider",
  register(api) {
    api.registerMediaUnderstandingProvider(deepgramMediaUnderstandingProvider);
    api.registerSpeechProvider(buildDeepgramSpeechProvider());
  },
});
