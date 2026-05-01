import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-runtime";

type TestPluginApiInput = Partial<OpenClawPluginApi>;

export function createTestPluginApi(api: TestPluginApiInput = {}): OpenClawPluginApi {
  return {
    id: "test-plugin",
    name: "test-plugin",
    source: "test",
    registrationMode: "full",
    config: {},
    runtime: {} as OpenClawPluginApi["runtime"],
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    registerTool() {},
    registerHook() {},
    registerHttpRoute() {},
    registerChannel() {},
    registerGatewayMethod() {},
    registerCli() {},
    registerCliBackend() {},
    registerTextTransforms() {},
    registerService() {},
    registerReload() {},
    registerNodeHostCommand() {},
    registerNodeInvokePolicy() {},
    registerSecurityAuditCollector() {},
    registerGatewayDiscoveryService() {},
    registerConfigMigration() {},
    registerMigrationProvider() {},
    registerAutoEnableProbe() {},
    registerProvider() {},
    registerSpeechProvider() {},
    registerRealtimeTranscriptionProvider() {},
    registerRealtimeVoiceProvider() {},
    registerMediaUnderstandingProvider() {},
    registerImageGenerationProvider() {},
    registerMusicGenerationProvider() {},
    registerVideoGenerationProvider() {},
    registerWebFetchProvider() {},
    registerWebSearchProvider() {},
    registerInteractiveHandler() {},
    onConversationBindingResolved() {},
    registerCommand() {},
    registerContextEngine() {},
    registerCompactionProvider() {},
    registerAgentHarness() {},
    registerCodexAppServerExtensionFactory() {},
    registerAgentToolResultMiddleware() {},
    registerSessionExtension() {},
    async enqueueNextTurnInjection(injection) {
      return { enqueued: false, id: "", sessionKey: injection.sessionKey };
    },
    registerTrustedToolPolicy() {},
    registerToolMetadata() {},
    registerControlUiDescriptor() {},
    registerRuntimeLifecycle() {},
    registerAgentEventSubscription() {},
    setRunContext() {
      return false;
    },
    getRunContext() {
      return undefined;
    },
    clearRunContext() {},
    registerSessionSchedulerJob() {
      return undefined;
    },
    registerDetachedTaskRuntime() {},
    registerMemoryCapability() {},
    registerMemoryPromptSection() {},
    registerMemoryPromptSupplement() {},
    registerMemoryCorpusSupplement() {},
    registerMemoryFlushPlan() {},
    registerMemoryRuntime() {},
    registerMemoryEmbeddingProvider() {},
    resolvePath(input: string) {
      return input;
    },
    on() {},
    ...api,
  };
}
