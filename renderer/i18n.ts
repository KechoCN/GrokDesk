import { createContext, useContext } from 'react';
import type { Settings } from '../shared/api';
import { engineExecutable, primaryKey } from './platform';

const words = {
  new: ['新任务', '新工作', 'New task'], search: ['搜索任务', '搜尋工作', 'Search tasks'], projects: ['项目', '專案', 'Projects'], chats: ['对话', '對話', 'Conversations'],
  pinned: ['置顶', '置頂', 'Pinned'], archive: ['归档', '封存', 'Archive'], archived: ['已归档', '已封存', 'Archived'], restore: ['恢复', '還原', 'Restore'],
  settings: ['设置', '設定', 'Settings'], openWorkspace: ['添加项目', '加入專案', 'Add project'], createWorkspace: ['添加项目', '加入專案', 'Add project'],
  rename: ['重命名', '重新命名', 'Rename'], remove: ['删除', '刪除', 'Delete'], unpin: ['取消置顶', '取消置頂', 'Unpin'], cancel: ['取消', '取消', 'Cancel'], save: ['保存', '儲存', 'Save'], close: ['关闭', '關閉', 'Close'],
  noResults: ['没有匹配的任务', '沒有符合的工作', 'No matching tasks'], noProjects: ['添加项目，集中管理任务', '加入專案，集中管理工作', 'Add a project to organize tasks'],
  noChats: ['在这里开始一段对话', '在這裡開始一段對話', 'Start a conversation here'], loose: ['无工作区', '無工作區', 'No workspace'], local: ['本地', '本機', 'Local'],
  greeting: ['今天想做点什么？', '今天想做些什麼？', 'What would you like to work on?'], placeholder: ['描述任务，输入 / 选择技能、@ 添加上下文…', '描述工作，輸入 / 選擇技能、@ 加入上下文…', 'Describe a task, / for skills, @ for context…'],
  followup: ['继续这个任务…', '繼續這項工作…', 'Ask for follow-up changes…'], add: ['添加上下文', '加入上下文', 'Add context'], attach: ['添加文件或图片', '加入檔案或圖片', 'Attach files or images'],
  send: ['发送', '傳送', 'Send'], stop: ['停止', '停止', 'Stop'], model: ['模型', '模型', 'Model'], effort: ['思考强度', '思考強度', 'Reasoning effort'], mode: ['权限与模式', '權限與模式', 'Permissions and mode'],
  modeUnknown: ['模式未确认', '模式尚未確認', 'Mode unconfirmed'], modeNote: ['使用 Grok 的实际权限配置。当前引擎没有返回可编辑的模式选项。', '使用 Grok 的實際權限設定。目前引擎沒有傳回可編輯的模式選項。', 'Uses the actual Grok permission configuration. The engine has not exposed editable mode options.'],
  noModels: ['等待引擎返回模型', '等待引擎傳回模型', 'Waiting for model options'], noEffort: ['此模型未提供思考档位', '此模型未提供思考等級', 'No reasoning options available'],
  connecting: ['正在连接', '正在連線', 'Connecting'], ready: ['已就绪', '已就緒', 'Ready'], running: ['执行中', '執行中', 'Working'], waiting: ['等待批准', '等待核准', 'Awaiting approval'], cancelling: ['正在停止', '正在停止', 'Stopping'], error: ['需要处理', '需要處理', 'Needs attention'],
  terminal: ['原版 TUI', '原版 TUI', 'Original TUI'], terminalHint: ['与当前对话共享 Grok 会话', '與目前對話共用 Grok 工作階段', 'Shares the current Grok session'], terminalBusy: ['正在执行；Ctrl+C 可停止当前任务', '正在執行；Ctrl+C 可停止目前任務', 'Running; Ctrl+C stops the current task'],
  engine: ['引擎', '引擎', 'Engine'], reconnect: ['重新连接', '重新連線', 'Reconnect'], engineMissing: ['未找到 Grok Build', '找不到 Grok Build', 'Grok Build was not found'], configure: ['打开引擎设置', '開啟引擎設定', 'Configure engine'],
  saveReconnect: ['保存路径并重新连接', '儲存路徑並重新連線', 'Save path and reconnect'],
  account: ['本机 Grok 账号', '本機 Grok 帳戶', 'Local Grok account'], inherited: ['继承 Grok 登录状态', '沿用 Grok 登入狀態', 'Uses the local Grok sign-in'], authUnknown: ['登录状态未确认', '登入狀態尚未確認', 'Sign-in not confirmed'],
  loginRequired: ['需要在 Grok 中登录', '需要在 Grok 中登入', 'Sign in with Grok to continue'], accountNote: ['GrokDesk 使用本机 Grok 的登录凭据。不会创建额外套餐或额度。', 'GrokDesk 使用本機 Grok 的登入憑證。不會建立額外方案或額度。', 'GrokDesk uses your local Grok credentials. It does not create an additional plan or quota.'],
  usage: ['本次会话用量', '目前工作階段用量', 'Session usage'], quota: ['这里显示当前会话统计；云端订阅和额度请在设置的账号页查看。', '此處顯示目前工作階段統計；雲端訂閱與額度請在設定的帳戶頁查看。', 'Statistics for this session. See Account in Settings for your cloud subscription and quota.'],
  appearance: ['外观', '外觀', 'Appearance'], general: ['通用', '一般', 'General'], about: ['关于', '關於', 'About'], theme: ['主题', '主題', 'Theme'], themeNote: ['选择配色，界面、菜单和终端会同步更新。', '選擇配色，介面、選單與終端會同步更新。', 'Choose a palette for the interface, menus and terminal.'],
  system: ['跟随系统', '跟隨系統', 'System'], light: ['浅色', '淺色', 'Light'], dark: ['深色', '深色', 'Dark'], language: ['语言', '語言', 'Language'], fontSize: ['界面字号', '介面字級', 'Interface font size'],
  fontNote: ['调整文字大小，保持图标与布局间距。', '調整文字大小，保留圖示與版面間距。', 'Scale interface text while preserving icons and spacing.'], sendKey: ['发送快捷键', '傳送快捷鍵', 'Send shortcut'], enterSend: ['Enter 发送', 'Enter 傳送', 'Enter to send'], ctrlSend: [`${primaryKey}+Enter 发送`, `${primaryKey}+Enter 傳送`, `${primaryKey}+Enter to send`],
  enginePath: ['Grok 程序路径', 'Grok 程式路徑', 'Grok executable path'], enginePathNote: [`留空以自动查找 ${engineExecutable}。保存后可重新连接。`, `留空以自動尋找 ${engineExecutable}。儲存後可重新連線。`, `Leave empty to discover ${engineExecutable} automatically. Reconnect after saving.`],
  saved: ['设置已保存', '設定已儲存', 'Settings saved'], aboutText: ['GrokDesk 是独立的 Grok Build 桌面客户端，不是 xAI 官方产品。界面复用 ZCode 开源组件与设计，按 Apache-2.0 保留来源。', 'GrokDesk 是獨立的 Grok Build 桌面用戶端，並非 xAI 官方產品。介面復用 ZCode 開源元件與設計，依 Apache-2.0 保留來源。', 'GrokDesk is an independent Grok Build desktop client, not an official xAI product. Its interface reuses ZCode open-source components and design under Apache-2.0.'],
  docs: ['Grok Build 文档', 'Grok Build 文件', 'Grok Build documentation'], source: ['ZCode 开源项目', 'ZCode 開源專案', 'ZCode source'], export: ['导出对话', '匯出對話', 'Export conversation'], openFolder: ['打开执行目录', '開啟執行目錄', 'Open working directory'],
  deleteNote: ['删除这条对话及 Grok 会话记录？工作目录、附件和原始文件会保留。', '刪除這筆對話與 Grok 工作階段記錄？工作目錄、附件與原始檔案將保留。', 'Delete this conversation and its Grok session history? Working directories, attachments and original files remain on disk.'],
  name: ['名称', '名稱', 'Name'], workspaceName: ['工作区名称', '工作區名稱', 'Workspace name'], permission: ['Grok 请求批准', 'Grok 請求核准', 'Grok requests permission'], deny: ['拒绝本次请求', '拒絕此次請求', 'Decline this request'],
  copy: ['复制', '複製', 'Copy'], copied: ['已复制', '已複製', 'Copied'], textOutput: ['文本', '文字', 'Text'], copyText: ['复制文本', '複製文字', 'Copy text'], copyCode: ['复制代码', '複製程式碼', 'Copy code'], copyFailed: ['复制失败，请重试。', '複製失敗，請重試。', 'Could not copy. Please try again.'], thought: ['模型推理', '模型推理', 'Model reasoning'], tools: ['工具执行', '工具執行', 'Tool execution'], assistant: ['Grok', 'Grok', 'Grok'], you: ['你', '你', 'You'],
  drop: ['松开以添加文件', '放開以加入檔案', 'Drop files to attach'], attachNote: ['文件快照随消息一起发送', '檔案快照會隨訊息一同傳送', 'File snapshots are sent with your message'], newLine: ['Shift+Enter 换行', 'Shift+Enter 換行', 'Shift+Enter for a new line'],
  imagesUnsupported: ['当前引擎不支持图片输入，请移除图片后发送。', '目前引擎不支援圖片輸入，請移除圖片後傳送。', 'This engine does not support image input. Remove the images before sending.'], viewImage: ['打开图片', '開啟圖片', 'Open image'],
  jumpLatest: ['回到最新消息', '回到最新訊息', 'Jump to latest'], loading: ['正在加载工作台…', '正在載入工作台…', 'Loading workspace…'], desktopOnly: ['请通过 GrokDesk 桌面程序打开此界面。', '請透過 GrokDesk 桌面程式開啟此介面。', 'Open this interface through the GrokDesk desktop application.'],
  collapse: ['收起侧栏', '收起側欄', 'Collapse sidebar'], expand: ['展开侧栏', '展開側欄', 'Expand sidebar'], more: ['更多操作', '更多操作', 'More actions'], minimize: ['最小化', '最小化', 'Minimize'], maximize: ['最大化或还原', '最大化或還原', 'Maximize or restore'],
  all: ['全部', '全部', 'All'], noPermissionOptions: ['引擎未提供可批准选项，可以拒绝并重试。', '引擎未提供可核准選項，可以拒絕並重試。', 'The engine provided no approval options. Decline and retry.'], binary: ['按文件路径提供', '依檔案路徑提供', 'Provided as a file path'],
  startupTerminal: ['启动时展开终端', '啟動時展開終端', 'Show terminal at launch'], status: ['状态', '狀態', 'Status'], untitled: ['新任务', '新工作', 'New task'],
  paste: ['粘贴', '貼上', 'Paste'],
} as const;

export type TextKey = keyof typeof words;
export const LanguageContext = createContext<Settings['language']>('zh-CN');
export function useText() {
  const language = useContext(LanguageContext);
  return (key: TextKey) => words[key][language === 'en-US' ? 2 : language === 'zh-TW' ? 1 : 0];
}
