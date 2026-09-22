import { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Circle, File, FolderOpen, Globe, ListTodo, LoaderCircle, PanelRightClose, Paperclip, X } from 'lucide-react';
import type { Conversation, Settings } from '../shared/api';
import { deriveWorkPanel, readWorkPanelPreferences, type WorkPanelPreferences, type WorkTaskStatus } from './work-panel-model';
import './work-panel.css';

interface WorkPanelProps {
  conversation: Conversation;
  language: Settings['language'];
  onOpenFile: (path?: string) => void;
  onOpenFolder: () => void;
  onOpenExternal: (url: string) => void;
}

function TaskIcon({ status, active }: { status: WorkTaskStatus; active: boolean }) {
  if (status === 'completed') return <Check className="work-task-icon is-complete" />;
  if (status === 'in_progress') return active ? <LoaderCircle className="work-task-icon is-running" /> : <Circle className="work-task-icon" />;
  if (status === 'failed' || status === 'cancelled') return <X className="work-task-icon is-failed" />;
  return <Circle className="work-task-icon" />;
}

function ConversationWorkPanel({ conversation, language, onOpenFile, onOpenFolder, onOpenExternal }: WorkPanelProps) {
  const L = (zh: string, tw: string, en: string) => language === 'en-US' ? en : language === 'zh-TW' ? tw : zh;
  const model = useMemo(() => deriveWorkPanel(conversation), [conversation]);
  const [preferences, setPreferences] = useState(() => readWorkPanelPreferences(localStorage, conversation.id));
  const toggle = (section: keyof WorkPanelPreferences) => setPreferences(current => {
    const next = { ...current, [section]: !current[section] };
    try { localStorage.setItem(`grokdesk-work-panel:${conversation.id}`, JSON.stringify(next)); } catch { /* Still usable when storage is unavailable. */ }
    return next;
  });
  const statusText = (status: WorkTaskStatus) => ({
    pending: L('待处理', '待處理', 'Pending'),
    in_progress: model.active ? L('进行中', '進行中', 'In progress') : L('未确认完成', '尚未確認完成', 'Completion unconfirmed'),
    completed: L('已完成', '已完成', 'Completed'), failed: L('失败', '失敗', 'Failed'), cancelled: L('已取消', '已取消', 'Cancelled'),
  })[status];
  if (!model.visible) return null;
  const summary = `${model.completed}/${model.tasks.length}`;
  return <aside className={`work-panel${preferences.collapsed ? ' is-collapsed' : ''}`} aria-label={L('工作进度', '工作進度', 'Work progress')} data-conversation-id={conversation.id}>
    {preferences.collapsed ? <button className="work-panel-reopen" onClick={() => toggle('collapsed')} aria-label={L('展开工作进度', '展開工作進度', 'Expand work progress')} aria-expanded={false} title={L('展开工作进度', '展開工作進度', 'Expand work progress')}><ListTodo /><span>{summary}</span><ChevronDown /></button> : <>
      <section className="work-panel-section">
        <div className="work-panel-section-heading">
          <button className="work-panel-section-toggle" aria-expanded={preferences.tasks} aria-controls={`work-tasks-${conversation.id}`} onClick={() => toggle('tasks')}><span>{L('任务清单', '工作清單', 'Tasks')}</span>{preferences.tasks ? <ChevronDown /> : <ChevronRight />}<span className="work-panel-count">{summary}</span></button>
          <button className="work-panel-collapse" onClick={() => toggle('collapsed')} aria-label={L('收起工作进度', '收起工作進度', 'Collapse work progress')} title={L('收起工作进度', '收起工作進度', 'Collapse work progress')} aria-expanded={true}><PanelRightClose /></button>
        </div>
        {preferences.tasks && <div id={`work-tasks-${conversation.id}`} className="work-panel-section-content">
          {!model.tasks.length ? <p className="work-panel-empty">{model.active ? L('Grok 正在处理…', 'Grok 正在處理…', 'Grok is working…') : L('未提供任务清单', '未提供工作清單', 'No task list provided')}</p> : <>
            {!model.hasPlan && <p className="work-panel-caption">{L('工具活动', '工具活動', 'Tool activity')}</p>}
            <ol className="work-panel-tasks">{model.tasks.map(task => <li key={task.id} title={`${statusText(task.status)} · ${task.content}`}><TaskIcon status={task.status} active={model.active} /><span className="work-panel-task-text">{task.content}</span><span className="sr-only">{statusText(task.status)}</span></li>)}</ol>
          </>}
        </div>}
      </section>
      <section className="work-panel-section">
        <button className="work-panel-section-toggle" aria-expanded={preferences.artifacts} aria-controls={`work-artifacts-${conversation.id}`} onClick={() => toggle('artifacts')}><span>{L('产物', '產物', 'Artifacts')}</span>{preferences.artifacts ? <ChevronDown /> : <ChevronRight />}{!!model.artifacts.length && <span className="work-panel-count">{model.artifacts.length}</span>}</button>
        {preferences.artifacts && <div id={`work-artifacts-${conversation.id}`} className="work-panel-section-content">{model.artifacts.length ? <ul className="work-panel-files">{model.artifacts.map(file => <li key={file.id}><button title={file.path} onClick={() => onOpenFile(file.path)}><File /><span>{file.name}</span></button></li>)}</ul> : <p className="work-panel-empty">{L('暂无产物', '暫無產物', 'No artifacts yet')}</p>}</div>}
      </section>
      <section className="work-panel-section">
        <button className="work-panel-section-toggle" aria-expanded={preferences.references} aria-controls={`work-references-${conversation.id}`} onClick={() => toggle('references')}><span>{L('参考', '參考', 'References')}</span>{preferences.references ? <ChevronDown /> : <ChevronRight />}<span className="work-panel-count">{model.references.length + (conversation.cwd ? 1 : 0)}</span></button>
        {preferences.references && <div id={`work-references-${conversation.id}`} className="work-panel-section-content"><ul className="work-panel-files">
          {!!conversation.cwd && <li className="work-panel-project"><button onClick={() => onOpenFile()} title={conversation.cwd}><ChevronRight /><span>{L('项目文件', '專案檔案', 'Project files')}</span></button><button className="work-panel-open-folder" onClick={onOpenFolder} title={L('打开项目文件夹', '開啟專案資料夾', 'Open project folder')} aria-label={L('打开项目文件夹', '開啟專案資料夾', 'Open project folder')}><FolderOpen /></button></li>}
          {model.references.map(reference => <li key={reference.id}><button title={reference.path || reference.url} onClick={() => reference.url ? onOpenExternal(reference.url) : onOpenFile(reference.path)}>{reference.kind === 'web' ? <Globe /> : reference.kind === 'attachment' ? <Paperclip /> : <File />}<span>{reference.name}</span></button></li>)}
        </ul>{!conversation.cwd && !model.references.length && <p className="work-panel-empty">{L('暂无参考', '暫無參考', 'No references yet')}</p>}</div>}
      </section>
    </>}
  </aside>;
}

// A keyed instance loads preferences before its first paint and cannot persist a
// previous conversation's collapsed state into the newly selected conversation.
export function WorkPanel(props: WorkPanelProps) { return <ConversationWorkPanel key={props.conversation.id} {...props} />; }
