// Isolated renderer regression for copied output and wrapped text. No real Grok data.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
// Optionally validate the actual renderer shipped inside an extracted app.asar.
const rendererRoot = process.argv[2] ? path.resolve(process.argv[2]) : root;
app.disableHardwareAcceleration();
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'grokdesk-output-block-')));
let win;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const script = code => win.webContents.executeJavaScript(code);
async function until(code, message) {
  for (let index = 0; index < 100; index++) { if (await script(code)) return; await pause(50); }
  throw new Error(message);
}
async function capture(name) {
  const directory = path.join(root, 'artifacts', 'verification');
  fs.mkdirSync(directory, { recursive: true });
  await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }).catch(() => {});
  await pause(100);
  fs.writeFileSync(path.join(directory, name), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
}
const opening = '正文在输出卡片之前，内联 `smallInline()` 保持原样。';
const ending = '正文在输出卡片之后，这句话必须继续显示。';
const longChinese = '这是一段需要随窗口宽度自动换行的中文内容，并且不能改变复制后的原始文本。'.repeat(9);
const longToken = 'LongUnbrokenToken_' + 'Ab9'.repeat(300);
const bodies = [
  `第一段普通文本\n  保留两个前导空格\n\n${longChinese}\n${longToken}`,
  '第二块 text 输出\n    缩进四个空格\n下一行',
  '第三块 txt 输出\n\t制表符缩进\n\n最后一行',
  '第四块 plaintext 输出\n    This is readable prose, not source code.',
  `function report() {\n  const title = "课程总结";\n\n  const key = "${longToken}";\n  return title + key;\n}`,
];
const languages = ['', 'text', 'txt', 'plaintext', 'javascript'];
const content = opening + '\n\n' + bodies.map((body, index) => '```' + languages[index] + '\n' + body + '\n```').join('\n\n') + '\n\n' + ending;
const canonical = value => value.endsWith('\n') ? value.slice(0, -1) : value;
async function assertBlocks(scope, expectedBodies = bodies) {
  await until(`document.querySelectorAll(${JSON.stringify(scope + ' .output-block')}).length === ${expectedBodies.length}`, 'Fenced output blocks did not render');
  const rendered = await script(`Array.from(document.querySelectorAll(${JSON.stringify(scope + ' .output-block')})).map(block => { const code=block.querySelector('.output-block-body pre > code'), p=block.closest('.markdown').querySelector('p'), range=document.createRange(); if (code) range.selectNodeContents(code); const nodes=[block,block.querySelector('.output-block-body'),block.querySelector('pre'),code].filter(Boolean); return { kind:block.dataset.kind, text:code?.textContent, font:code?getComputedStyle(code).fontFamily:null, proseFont:getComputedStyle(p).fontFamily, copyCount:block.querySelectorAll('.output-block-copy').length, horizontalOverflow:nodes.some(node=>node.scrollWidth > node.clientWidth + 1), rectangles:code?Array.from(range.getClientRects()).filter(rect=>rect.width>0&&rect.height>0).length:0 }; })`);
  assert.deepEqual(rendered.map(block => block.kind), ['text', 'text', 'text', 'text', 'code']);
  for (let index = 0; index < rendered.length; index++) {
    const block = rendered[index];
    assert.equal(canonical(block.text), expectedBodies[index], `Block ${index + 1} lost whitespace or content`);
    assert.equal(block.copyCount, 1, `Block ${index + 1} did not have its own copy control`);
    assert.equal(block.horizontalOverflow, false, `Block ${index + 1} overflowed horizontally`);
    if (block.kind === 'text') assert.equal(block.font, block.proseFont, `Plaintext block ${index + 1} did not use the prose font`);
    else { assert.notEqual(block.font, block.proseFont, 'Code block lost its monospace font'); assert.match(block.font, /mono|consolas|courier|cascadia/i); }
  }
  assert.ok(rendered[0].rectangles > rendered[0].text.split('\n').length + 3, 'Long Chinese and unbroken text was clipped instead of visually wrapped');
  assert.ok(rendered[4].rectangles > rendered[4].text.split('\n').length + 3, 'Long code line did not wrap');
  const prose = await script(`Array.from(document.querySelectorAll(${JSON.stringify(scope + ' .markdown > p')})).map(node=>node.textContent)`);
  assert.ok(prose.some(text => text.startsWith('正文在输出卡片之前')), 'Opening prose disappeared');
  assert.ok(prose.includes(ending), 'Closing prose disappeared');
  assert.equal(await script(`document.querySelector(${JSON.stringify(scope + ' .markdown > p code')})?.textContent`), 'smallInline()', 'Inline code was turned into a fenced output card');
  assert.equal(await script(`document.documentElement.scrollWidth > innerWidth`), false, 'Output blocks made the window overflow');
  return rendered;
}
async function copyBlock(scope, index, expected) {
  const before = await script(`window.grokdeskTest.calls().filter(call=>call.name==='writeClipboard').length`);
  await script(`document.querySelectorAll(${JSON.stringify(scope + ' .output-block-copy')})[${index}].click()`);
  await until(`window.grokdeskTest.calls().filter(call=>call.name==='writeClipboard').length === ${before + 1}`, `Block ${index + 1} did not copy independently`);
  assert.equal(await script(`window.grokdeskTest.calls().filter(call=>call.name==='writeClipboard').at(-1).text`), expected, `Block ${index + 1} copy included labels, other blocks, or altered whitespace`);
}
async function scrollFirst(scope) {
  await script(`document.querySelector(${JSON.stringify(scope + ' .output-block')}).scrollIntoView({ block:'start' })`);
  await pause(100);
}
async function verifyStreaming(scope, update, copiedLabel) {
  const first = '流式输出第一行';
  await update('流式说明。\n\n```text\n' + first);
  await until(`document.querySelectorAll(${JSON.stringify(scope + ' .output-block')}).length === 1 && document.querySelector(${JSON.stringify(scope + ' .output-block code')})?.textContent === ${JSON.stringify(first)}`, 'Unclosed streamed fence did not render immediately');
  const firstHeight = await script(`document.querySelector(${JSON.stringify(scope + ' .output-block')}).getBoundingClientRect().height`);
  await copyBlock(scope, 0, first);
  await until(`document.querySelector(${JSON.stringify(scope + ' .output-block-copy span')})?.textContent === ${JSON.stringify(copiedLabel)}`, 'Streaming copy did not acknowledge the copied version');

  const latest = first + '\n  新片段保留两个前导空格\n\n' + longChinese + '\n' + longToken;
  await update('流式说明。\n\n```text\n' + latest);
  await until(`document.querySelector(${JSON.stringify(scope + ' .output-block code')})?.textContent === ${JSON.stringify(latest)}`, 'Streaming update did not grow the existing output card');
  await until(`document.querySelector(${JSON.stringify(scope + ' .output-block-copy span')})?.textContent !== ${JSON.stringify(copiedLabel)}`, 'Previous copied state remained after new streamed content');
  assert.ok(await script(`document.querySelector(${JSON.stringify(scope + ' .output-block')}).getBoundingClientRect().height`) > firstHeight + 40, 'Streaming text did not increase the card height');
  await copyBlock(scope, 0, latest);

  const final = latest + '\n\t最后一个流式片段';
  await update('流式说明。\n\n```text\n' + final);
  await until(`document.querySelector(${JSON.stringify(scope + ' .output-block code')})?.textContent === ${JSON.stringify(final)}`, 'Latest unclosed stream segment was stale');
  await until(`document.querySelector(${JSON.stringify(scope + ' .output-block-copy span')})?.textContent !== ${JSON.stringify(copiedLabel)}`, 'Second stream update retained stale copied feedback');
  await copyBlock(scope, 0, final);
  await update('流式说明。\n\n```text\n' + final + '\n```\n\n流式输出结束。');
  await until(`document.querySelector(${JSON.stringify(scope + ' .markdown')})?.textContent.includes('流式输出结束。')`, 'Closing streamed fence lost following prose');
  assert.equal(await script(`document.querySelectorAll(${JSON.stringify(scope + ' .output-block')}).length`), 1, 'Closing fence duplicated the streamed output card');
  assert.equal(await script(`document.querySelector(${JSON.stringify(scope + ' .output-block code')}).textContent`), final, 'Closing fence changed the copied payload');
}

app.whenReady().then(async () => {
  try {
    win = new BrowserWindow({ show: false, width: 1440, height: 960, webPreferences: { preload: path.join(__dirname, 'renderer-fixture.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    const errors = [];
    win.webContents.on('console-message', (...args) => { const details=args[1]; if (typeof details==='object' && details.level==='error') errors.push(details.message); });
    await win.loadFile(path.join(rendererRoot, 'renderer-dist', 'index.html'));
    await win.webContents.insertCSS('*, *::before, *::after { transition:none !important; animation:none !important; }');
    await until(`!!document.querySelector('textarea.composer-text')`, 'Renderer fixture did not mount');
    const createdAt = new Date().toISOString();
    await script(`window.grokdesk.updateConversation('conversation', ${JSON.stringify({ title: '文本与代码输出换行验证', messages: [{ id: 'outputs', role: 'assistant', content, createdAt }] })})`);
    await script(`window.grokdesk.updateSettings({ theme:'light' })`);
    const buildScope = '.conversation-workspace';
    const build = await assertBlocks(buildScope);
    await copyBlock(buildScope, 0, build[0].text);
    await copyBlock(buildScope, 2, build[2].text);
    await copyBlock(buildScope, 4, build[4].text);
    await scrollFirst(buildScope);
    await capture('output-block-build-light.png');

    win.setContentSize(960, 640); await pause(220);
    await script(`window.grokdesk.updateSettings({ theme:'midnight' })`);
    await assertBlocks(buildScope);
    await script(`document.querySelector('button[aria-label="收起工作进度"]')?.click()`);
    await pause(80);
    await scrollFirst(buildScope);
    await capture('output-block-build-dark-compact.png');

    await script(`window.grokdeskTest.setWeb(${JSON.stringify({ connection: 'connected', loading: false, capabilities: { send: true, stop: false, attachments: true }, profiles: [{ id: 'browser', label: 'Grok test browser' }], activeProfileId: 'browser', messages: [{ id: 'web-outputs', role: 'assistant', content }] })})`);
    await script(`window.grokdesk.updateSettings({ language:'en-US' })`);
    await script(`Array.from(document.querySelectorAll('.mode-switch button')).find(button=>button.textContent.includes('Chat')).click()`);
    await until(`!!document.querySelector('.web-chat:not([hidden]) .output-block')`, 'Chat output cards did not render');
    const chatScope = '.web-chat';
    const chat = await assertBlocks(chatScope);
    await copyBlock(chatScope, 1, chat[1].text);
    await copyBlock(chatScope, 3, chat[3].text);
    await copyBlock(chatScope, 0, chat[0].text);
    await copyBlock(chatScope, 4, chat[4].text);
    const labels = await script(`Array.from(document.querySelectorAll('.web-chat .output-block-copy')).map(button=>button.getAttribute('aria-label')||button.title||button.textContent)`);
    assert.ok(labels.every(label=>!!label?.trim()), 'Copy controls were not labeled');
    assert.ok(labels.every(label=>!/复制|已复制/.test(label)), 'English chat showed Chinese copy controls');
    await scrollFirst(chatScope);
    await capture('output-block-chat-dark-compact.png');
    await script(`document.querySelectorAll('.web-chat .output-block')[4].scrollIntoView({ block:'start' })`);
    await pause(100);
    await capture('output-block-code-dark-compact.png');
    await verifyStreaming(chatScope, next => script(`window.grokdeskTest.setWeb(${JSON.stringify({ messages: [{ id: 'web-outputs', role: 'assistant', content: next }] })})`), 'Copied');
    await script(`window.grokdesk.updateSettings({ language:'zh-CN' })`);
    await script(`Array.from(document.querySelectorAll('.mode-switch button')).find(button=>button.textContent === 'Build').click()`);
    await verifyStreaming(buildScope, next => script(`window.grokdesk.updateConversation('conversation', ${JSON.stringify({ messages: [{ id: 'outputs', role: 'assistant', content: next, createdAt }] })})`), '已复制');
    assert.equal(errors.length, 0, errors.join('\n'));

    // A readable example for visual review, separate from the long-line stress cases.
    const naturalProse = [
      '画面是一片风暴刚刚退去的山间湖泊。远山仍笼罩在深蓝与灰紫色的云层里，湿润的岩石和低垂的松枝留有雨痕。湖面还未完全平静，细小的波纹把天光切成柔软的碎片。',
      '厚重的云幕在天际裂开一道狭长的缝隙，温暖而克制的金色光线落向水面。光从远处缓缓铺开，照亮薄雾的边缘，也让近处的草叶透出清亮的绿色。',
      '构图保持开阔与安静：远处的山脊形成起伏的轮廓，湖岸从画面左下方延伸向光源。风暴留下的压迫感尚未散去，新的希望已经在明暗交界处出现。',
      '采用细腻的电影感写实风格，自然的光影层次，低饱和的冷色与柔和暖光相互映衬。画面不出现人物、建筑或文字，只保留风、水、薄雾和刚刚苏醒的大地。',
    ].join('\n\n');
    const preview = '下面这份提示词把全曲的过程凝聚在风暴将尽、光线初现的一瞬间：\n\n```text\n' + naturalProse + '\n```';
    await script(`window.grokdesk.updateSettings({ theme:'light', language:'zh-CN' })`);
    await script(`window.grokdeskTest.setWeb(${JSON.stringify({ messages: [{ id: 'prose-preview', role: 'assistant', content: preview }] })})`);
    await script(`Array.from(document.querySelectorAll('.mode-switch button')).find(button=>button.textContent.includes('聊天')).click()`);
    win.setContentSize(1100, 1000); await pause(250);
    await until(`document.querySelector('.web-chat .output-block code')?.textContent.includes('画面是一片风暴刚刚退去的山间湖泊')`, 'Readable output preview did not settle');
    await script(`document.querySelector('.web-chat-scroll').scrollTop = 0`);
    await capture('output-block-prose-preview.png');
    console.log('Output block smoke passed: prose/code fonts, Chinese and unbroken-line wrapping, exact independent copying, preserved prose and indentation, live unclosed fences and copy-state reset in Build/Chat, compact dark layout and English labels.');
    win.destroy(); app.exit(0);
  } catch (error) { console.error(error); if (win && !win.isDestroyed()) { try { await capture('output-block-failure.png'); } catch {} win.destroy(); } app.exit(1); }
});
