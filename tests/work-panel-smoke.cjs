// Fixture-only work panel checks. No real account, task, browser or workspace is touched.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
app.disableHardwareAcceleration();
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'grokdesk-work-panel-')));
let win;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const script = code => win.webContents.executeJavaScript(code);
async function until(code, message) {
  for (let index = 0; index < 100; index++) { if (await script(code)) return; await pause(50); }
  throw new Error(message);
}
async function click(label) { await script(`document.querySelector('button[aria-label=${JSON.stringify(label)}]').click()`); await pause(80); }
async function section(name) { await script(`Array.from(document.querySelectorAll('.work-panel-section-toggle')).find(button => button.firstElementChild?.textContent === ${JSON.stringify(name)}).click()`); await pause(80); }
async function capture(name) {
  const output = path.join(root, 'artifacts', 'verification');
  fs.mkdirSync(output, { recursive: true });
  await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }).catch(() => {});
  await pause(100);
  fs.writeFileSync(path.join(output, name), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
}
async function assertPanelBounds({ stacked = false } = {}) {
  const bounds = await script(`(() => {
    const panel = document.querySelector('.work-panel').getBoundingClientRect();
    const region = document.querySelector('.conversation-workspace').getBoundingClientRect();
    const timeline = document.querySelector('.conversation-workspace').firstElementChild.getBoundingClientRect();
    const composer = document.querySelector('textarea.composer-text').getBoundingClientRect();
    const asObject = r => ({ left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height });
    return { panel:asObject(panel), region:asObject(region), timeline:asObject(timeline), composer:asObject(composer), width:innerWidth, height:innerHeight, direction:getComputedStyle(document.querySelector('.conversation-workspace')).flexDirection, overflow:document.documentElement.scrollWidth > innerWidth };
  })()`);
  assert.equal(bounds.overflow, false, 'Window content overflowed horizontally');
  assert.ok(bounds.panel.left >= bounds.region.left && bounds.panel.right <= bounds.region.right, 'Work panel escaped conversation bounds');
  assert.ok(bounds.panel.top >= bounds.region.top && bounds.panel.bottom <= bounds.region.bottom + 1, 'Work panel escaped the vertical conversation bounds');
  assert.ok(bounds.panel.bottom <= bounds.composer.top, 'Work panel overlapped the composer');
  assert.ok(bounds.timeline.height >= 80, 'Work panel left no readable space for the conversation');
  if (stacked) {
    assert.equal(bounds.direction, 'column', 'Narrow conversation did not activate its container query');
    assert.ok(bounds.panel.bottom <= bounds.timeline.top, 'Stacked work panel overlapped conversation text');
  } else {
    assert.equal(bounds.direction, 'row');
    assert.ok(bounds.timeline.right <= bounds.panel.left, 'Wide work panel overlapped conversation text');
  }
}

app.whenReady().then(async () => {
  try {
    win = new BrowserWindow({ show: false, width: 1440, height: 960, webPreferences: { preload: path.join(__dirname, 'renderer-fixture.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    const errors = [];
    win.webContents.on('console-message', (...args) => { const details = args[1]; if (typeof details === 'object' && details.level === 'error') errors.push(details.message); });
    await win.loadFile(path.join(root, 'renderer-dist', 'index.html'));
    await win.webContents.insertCSS('*, *::before, *::after { transition:none !important; animation:none !important; }');
    await until(`!!document.querySelector('textarea.composer-text')`, 'Composer did not mount');
    assert.equal(await script(`!!document.querySelector('.work-panel')`), false, 'Empty task showed a work panel');
    const createdAt = new Date().toISOString();
    const planEntries = [
      { content: '检查现有项目与参考文件', status: 'completed' },
      { content: '生成报告并更新项目文档', status: 'in_progress' },
      { content: '验证产物和预览效果', status: 'pending' },
    ];
    const artifactPath = 'D:\\Example\\结果报告.md';
    const attachmentPath = 'D:\\Snapshots\\设计参考.md';
    const messages = [
      { id: 'request', role: 'user', content: '请按设计参考完善工作台，生成结果报告。', createdAt, attachments: [{ id: 'reference', name: '设计参考.md', path: attachmentPath, kind: 'text', mime: 'text/markdown', size: 40 }] },
      { id: 'plan', role: 'system', title: '计划', content: planEntries.map(entry => `[${entry.status}] ${entry.content}`).join('\n'), planEntries, createdAt },
      { id: 'output', role: 'tool', title: '写入结果报告', content: '报告已写入。', toolId: 'write-report', toolKind: 'edit', status: 'completed', locations: [{ path: artifactPath }], artifacts: [{ path: artifactPath }], createdAt },
      { id: 'reply', role: 'assistant', content: '已完成项目检查并生成结果报告，正在验证界面与交互。', createdAt },
    ];
    await script(`window.grokdesk.updateConversation('conversation', ${JSON.stringify({ title: '完善 GrokDesk 工作台', phase: 'running', messages })})`);
    await script(`window.grokdesk.updateSettings({ theme:'light' })`);
    await until(`document.querySelector('.work-panel-tasks')?.children.length === 3`, 'Structured task list did not appear');
    assert.equal(await script(`document.querySelector('.conversation-workspace').firstElementChild.textContent.includes('[completed]')`), false, 'Raw protocol plan duplicated the work panel in the timeline');
    assert.equal(await script(`document.querySelector('.work-panel-count').textContent`), '1/3', 'Progress did not match the structured plan');
    assert.equal(await script(`document.querySelectorAll('.work-task-icon.is-complete').length`), 1);
    assert.equal(await script(`document.querySelectorAll('.work-task-icon.is-running').length`), 1);
    assert.equal(await script(`document.querySelectorAll('#work-artifacts-conversation li').length`), 1);
    assert.equal(await script(`document.querySelectorAll('#work-references-conversation li').length`), 2);
    await assertPanelBounds();
    await capture('work-panel-light-wide.png');

    await section('产物');
    assert.equal(await script(`!!document.querySelector('#work-artifacts-conversation')`), false, 'Artifacts section failed to collapse');
    await section('参考');
    assert.equal(await script(`!!document.querySelector('#work-references-conversation')`), false, 'References section failed to collapse');
    await section('任务清单');
    assert.equal(await script(`!!document.querySelector('.work-panel-tasks')`), false, 'Task section failed to collapse');
    await section('任务清单'); await section('产物'); await section('参考');
    await click('收起工作进度');
    assert.equal(await script(`document.querySelector('.work-panel').classList.contains('is-collapsed')`), true);
    await script(`window.grokdesk.updateConversation('conversation', { phase:'ready' })`);
    assert.equal(await script(`document.querySelector('.work-panel').classList.contains('is-collapsed')`), true, 'Phase update reset the collapsed state');
    assert.equal(await script(`JSON.parse(localStorage.getItem('grokdesk-work-panel:conversation')).collapsed`), true);

    // Exercise the same component with another saved conversation, then switch back.
    await script(`(() => { const first = window.grokdeskTest.state().conversations[0]; const second = { ...first, id:'second', title:'另一个工作任务', messages:[{ id:'other-reply', role:'assistant', content:'另一个独立任务。', createdAt:${JSON.stringify(createdAt)} }] }; window.grokdeskTest.setConversations([first, second], 'second'); })()`);
    await until(`document.querySelector('.work-panel')?.dataset.conversationId === 'second'`, 'Second conversation did not mount');
    assert.equal(await script(`document.querySelector('.work-panel').classList.contains('is-collapsed')`), false, 'First task collapse leaked into a second task');
    await script(`window.grokdesk.selectConversation('conversation')`);
    await until(`document.querySelector('.work-panel')?.dataset.conversationId === 'conversation'`, 'Original conversation did not remount');
    assert.equal(await script(`document.querySelector('.work-panel').classList.contains('is-collapsed')`), true, 'Collapsed preference did not survive conversation switching');
    await click('展开工作进度');
    assert.equal(await script(`document.querySelector('.work-panel-count').textContent`), '1/3', 'Ending a turn invented completed tasks');
    assert.equal(await script(`document.querySelectorAll('.work-task-icon.is-running').length`), 0, 'Finished turn continued animating an unconfirmed task');

    await script(`Array.from(document.querySelectorAll('#work-artifacts-conversation button')).find(button => button.title === ${JSON.stringify(artifactPath)}).click()`);
    await until(`Array.from(document.querySelectorAll('.preview-panel span[title]')).some(node => node.title === ${JSON.stringify(artifactPath)})`, 'Artifact click did not open the requested preview');
    await until(`document.querySelector('.file-preview-content h1')?.textContent === 'Preview fixture'`, 'Artifact preview was not rendered');
    await assertPanelBounds({ stacked: true });
    await click('关闭预览');
    await script(`Array.from(document.querySelectorAll('#work-references-conversation button')).find(button => button.title === ${JSON.stringify(attachmentPath)}).click()`);
    await until(`Array.from(document.querySelectorAll('.preview-panel span[title]')).some(node => node.title === ${JSON.stringify(attachmentPath)})`, 'Attachment reference did not open its preview');
    await click('关闭预览');

    await script(`window.grokdesk.updateSettings({ theme:'midnight' })`);
    await until(`document.documentElement.classList.contains('theme-midnight')`, 'Dark theme was not applied');
    assert.equal(await script(`getComputedStyle(document.querySelector('.work-panel')).backgroundColor`), 'rgb(52, 65, 92)', 'Work panel ignored the selected theme');
    await assertPanelBounds();
    await capture('work-panel-dark-wide.png');
    win.setContentSize(960, 640); await pause(250);
    await assertPanelBounds({ stacked: true });
    await capture('work-panel-dark-compact.png');
    await click('收起工作进度');
    await assertPanelBounds({ stacked: true });
    await capture('work-panel-dark-collapsed.png');
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('Work panel smoke passed: real plan progress, artifacts and references, independent collapse state, exact file previews, container queries and themed compact bounds.');
    win.destroy(); app.exit(0);
  } catch (error) { console.error(error); if (win && !win.isDestroyed()) { try { await capture('work-panel-failure.png'); } catch {} win.destroy(); } app.exit(1); }
});
