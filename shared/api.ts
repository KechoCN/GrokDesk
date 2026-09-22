export type Phase = 'ready' | 'connecting' | 'running' | 'waiting' | 'cancelling' | 'error';
export type ThemeId = 'system'|'light'|'dark'|'lagoon'|'midnight'|'forest'|'rose';
export interface Settings { theme: ThemeId; language: 'zh-CN'|'zh-TW'|'en-US'; fontSize: number; sendKey: 'enter'|'ctrl-enter'; enginePath: string; terminalVisible: boolean; copyOnSelect: boolean; }
export interface Workspace { id: string; name: string; path: string; pinned: boolean; archived: boolean; }
export interface Attachment { id: string; name: string; path: string; sourcePath?: string; mime: string; size: number; kind: 'image'|'text'|'binary'; preview?: string; }
export interface AvailableCommand { name: string; description: string; input?: { hint: string }; }
export interface ContextItem { id: string; kind: 'command'|'skill'|'plugin'|'file'; name: string; description: string; path?: string; insertText?: string; }
export interface ContextCatalog { items: ContextItem[]; truncated: boolean; warning?: string; }
export interface AccountSnapshot { state: 'ready'|'unavailable'|'auth-required'|'error'; checkedAt: string; source: 'grok-cloud'; subscriptionTier?: string; usedPercent?: number; remainingPercent?: number; periodStart?: string; periodEnd?: string; periodType?: string; sharedPool?: boolean; includedLimitCents?: number; includedUsedCents?: number; prepaidBalanceCents?: number; onDemandUsedCents?: number; onDemandCapCents?: number; onDemandEnabled?: boolean; history?: { year: number; month: number; includedUsedCents?: number; onDemandUsedCents?: number; totalUsedCents?: number }[]; error?: string; }
export interface EngineConfig { path: string; content: string; revision: string; exists: boolean; }
export interface PreviewFile { path: string; name: string; size: number; modifiedAt?: string; }
export interface PreviewDocument { path: string; name: string; kind: 'text'|'image'|'unsupported'; content?: string; dataUrl?: string; mime?: string; truncated?: boolean; size: number; }
export interface WebChatState { url: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean; visible: boolean; error?: string; profiles: { id: string; label: string }[]; activeProfileId: string; connection?: 'disconnected'|'connected'|'error'; account?: { nickname: string; avatarUrl?: string; syncedAt: string }; messages?: { id: string; role: 'user'|'assistant'; content: string }[]; history?: { title: string; url: string }[]; capabilities?: { send: boolean; stop: boolean; attachments: boolean }; setupPath?: string; setupRequestedAt?: number; }
export interface AuthState { state: 'idle'|'starting'|'waiting'|'success'|'error'; profile?: { email?: string; firstName?: string; lastName?: string; teamName?: string; methodId?: string }; url?: string; code?: string; mode?: 'device'|'loopback'|'command'; error?: string; }
export interface Message { id: string; role: 'user'|'assistant'|'thought'|'tool'|'system'; content: string; createdAt: string; toolId?: string; title?: string; status?: string; attachments?: Attachment[]; planEntries?: {content:string;status:'pending'|'in_progress'|'completed'}[]; toolKind?: string; locations?: {path:string;line?:number}[]; artifacts?: {path:string;name?:string}[]; }
export interface Model { id: string; name: string; efforts: { id: string; label: string }[]; }
export interface ConfigOption { id: string; name: string; category?: string; type: string; currentValue: string; options: { value: string; name: string }[]; }
export interface Conversation { id: string; title: string; workspaceId: string|null; cwd: string; engineSessionId?: string; pinned: boolean; archived: boolean; updatedAt: string; draft: string; attachments: Attachment[]; messages: Message[]; phase: Phase; error?: string; supportsImages?: boolean; supportsEmbeddedContext?: boolean; models: Model[]; configOptions: ConfigOption[]; availableCommands?: AvailableCommand[]; currentModelId?: string|null; currentEffort?: string|null; }
export interface EngineStatus { state: 'discovering'|'connecting'|'ready'|'missing'|'error'; path?: string; version?: string; auth: 'inherited'|'required'|'unknown'; error?: string; }
export interface Permission { requestId: string; conversationId: string; engineSessionId: string; title: string; detail: string; options: { optionId: string; name: string; kind: string }[]; }
export interface AppSnapshot { version: number; settings: Settings; workspaces: Workspace[]; conversations: Conversation[]; activeConversationId: string|null; engine: EngineStatus; permissions: Permission[]; }
export type AppEvent = { type: 'state'; state: AppSnapshot } | { type: 'terminal'; conversationId: string; sequence: number; data: string } | { type: 'notice'; message: string } | { type: 'web'; state: WebChatState } | { type: 'auth'; state: AuthState };
export interface GrokDeskApi {
  readonly platform: 'win32' | 'darwin' | 'linux';
  readonly version: string;
  bootstrap(): Promise<AppSnapshot>;
  newConversation(workspaceId?: string|null): Promise<AppSnapshot>;
  selectConversation(id: string): Promise<AppSnapshot>;
  updateConversation(id: string, patch: Partial<Pick<Conversation,'title'|'pinned'|'archived'|'draft'>>): Promise<AppSnapshot>;
  setConversationWorkspace(id: string, workspaceId: string|null): Promise<AppSnapshot>;
  deleteConversation(id: string): Promise<AppSnapshot>;
  closeConversation(id: string): Promise<AppSnapshot>;
  addWorkspace(): Promise<AppSnapshot & { selectedWorkspaceId?: string }>;
  createWorkspace(name: string): Promise<AppSnapshot>;
  updateWorkspace(id: string, patch: Partial<Pick<Workspace,'name'|'pinned'|'archived'>>): Promise<AppSnapshot>;
  chooseAttachments(id: string): Promise<AppSnapshot>;
  attachFiles(id: string, paths: string[]): Promise<AppSnapshot>;
  attachClipboard(id: string): Promise<{ state: AppSnapshot; handled: boolean }>;
  attachData(id: string, files: { name: string; mime: string; data: Uint8Array }[]): Promise<AppSnapshot>;
  previewFiles(id: string): Promise<{ files: PreviewFile[]; truncated?: boolean }>;
  readPreview(id: string, path: string): Promise<PreviewDocument>;
  webMount(bounds: { x: number; y: number; width: number; height: number; visible: boolean }): Promise<WebChatState>;
  webAction(action: 'home'|'back'|'forward'|'reload'|'login'|'switch-account'|'add-account'|'external'|'usage'|'setup'|'new-chat'|'stop'|'open-chat', profileId?: string, target?: {profileId:string;url:string;accountNickname?:string}): Promise<WebChatState>;
  webSend(text: string, files?: { name: string; mime: string; data: Uint8Array }[], target?: {profileId:string;url:string;accountNickname?:string}): Promise<WebChatState>;
  webSetup(): Promise<WebChatState>;
  webStatus(): Promise<WebChatState>;
  authStatus(): Promise<AuthState>;
  authStart(): Promise<AuthState>;
  authCancel(): Promise<AuthState>;
  authExternal(): Promise<void>;
  authSubmitCode(code: string): Promise<AuthState>;
  contextCatalog(id: string, kind: 'command'|'mention', query: string): Promise<ContextCatalog>;
  removeAttachment(id: string, attachmentId: string): Promise<AppSnapshot>;
  getFilePath(file: File): string;
  readClipboard(): Promise<string>;
  writeClipboard(text: string): Promise<void>;
  send(id: string, text: string): Promise<void>;
  cancel(id: string): Promise<void>;
  setConfig(id: string, configId: string, value: string): Promise<void>;
  respondPermission(requestId: string, optionId: string|null): Promise<void>;
  terminalInput(id: string, data: string): Promise<void>;
  terminalResize(id: string, cols: number, rows: number): Promise<void>;
  terminalSnapshot(id: string): Promise<{ data: string; sequence: number }>;
  updateSettings(patch: Partial<Settings>): Promise<AppSnapshot>;
  reconnect(): Promise<void>;
  usage(id: string): Promise<string>;
  account(): Promise<AccountSnapshot>;
  engineConfig(): Promise<EngineConfig>;
  saveEngineConfig(content: string, revision: string): Promise<EngineConfig>;
  openEngineConfig(): Promise<void>;
  exportConversation(id: string): Promise<void>;
  openFolder(id: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  window(action: 'minimize'|'maximize'|'close'): Promise<void>;
  onEvent(listener: (event: AppEvent)=>void): ()=>void;
}
declare global { interface Window { grokdesk: GrokDeskApi; } }
