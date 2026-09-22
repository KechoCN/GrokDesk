import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { unified } from 'unified';
import remarkParse from 'remark-parse';

const source = fs.readFileSync(new URL('../electron/browser-extension/content.js', import.meta.url), 'utf8');

// Exercise the extension in a tiny DOM with controllable navigation/upload state.
// These checks do not claim compatibility with any live Grok DOM or signed-in account.
class Element {
  constructor(attributes = {}, text = '', visible = true) { this.attributes = attributes; this.textContent = text; this.innerText = text; this.visible = visible; this.disabled = false; this.isConnected = true; this.children = []; this.lookups = {}; this.ancestors = {}; this.clicks = 0; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  getClientRects() { return this.visible ? [{}] : []; }
  querySelector(selector) { return this.lookups[selector] ?? null; }
  querySelectorAll(selector) { const value = this.querySelector(selector); return Array.isArray(value) ? value : value ? [value] : []; }
  closest(selector) { return this.ancestors[selector] ?? null; }
  contains(element) { return this.children.includes(element); }
  matches(selector) { return selector === '.message-bubble' && this.attributes.class === 'message-bubble'; }
  focus() {}
  dispatchEvent() { return true; }
  click() { this.clicks++; this.onClick?.(); }
}
class Textarea extends Element { get value() { return this._value ?? ''; } set value(value) { this._value = value; } }

// A small structural DOM for message extraction, kept separate from the controls
// fixture above so that tests exercise text nodes, nested syntax spans and UI chrome.
class TextNode {
  constructor(value) { this.nodeType = 3; this.nodeName = '#text'; this.nodeValue = value; this.parentElement = this.parentNode = null; }
  get textContent() { return this.nodeValue; }
  set textContent(value) { this.nodeValue = value; }
  cloneNode() { return new TextNode(this.nodeValue); }
  replaceWith(node) { replaceNode(this, node); }
  remove() { replaceNode(this); }
}
function replaceNode(original, next) {
  const parent = original.parentNode;
  if (!parent) return;
  const index = parent.childNodes.indexOf(original);
  if (index < 0) return;
  parent.childNodes.splice(index, 1, ...(next ? [next] : []));
  if (next) next.parentElement = next.parentNode = parent;
  original.parentElement = original.parentNode = null;
}
function matchesSimple(node, selector) {
  if (node.nodeType !== 1) return false;
  const not = [...selector.matchAll(/:not\(([^()]*)\)/g)];
  if (not.some(match => node.matches(match[1]))) return false;
  selector = selector.replace(/:not\([^()]*\)/g, '').replace(/^:scope/, '*');
  const attributes = [...selector.matchAll(/\[([^\]=*~^$|\s]+)(?:\s*([*~^$|]?=)\s*["']?([^\]"']*)["']?)?\]/g)];
  for (const [, name, operator, expected] of attributes) {
    const actual = node.getAttribute(name);
    if (actual === null) return false;
    if (operator === '=' && actual !== expected) return false;
    if (operator === '*=' && !actual.includes(expected)) return false;
    if (operator === '^=' && !actual.startsWith(expected)) return false;
    if (operator === '$=' && !actual.endsWith(expected)) return false;
    if (operator === '~=' && !actual.split(/\s+/).includes(expected)) return false;
  }
  selector = selector.replace(/\[[^\]]*\]/g, '');
  const tag = selector.match(/^[a-zA-Z][\w-]*/)?.[0];
  if (tag && node.tagName.toLowerCase() !== tag.toLowerCase()) return false;
  if ([...selector.matchAll(/\.([\w-]+)/g)].some(match => !node.classList.contains(match[1]))) return false;
  const id = selector.match(/#([\w-]+)/)?.[1];
  return !id || node.id === id;
}
function matchesSelector(node, selector) {
  return selector.split(',').some(option => {
    const parts = option.trim().split(/\s+(?![^\[]*\])/);
    let current = node;
    if (!matchesSimple(current, parts.pop())) return false;
    while (parts.length) {
      let direct = parts.at(-1) === '>';
      if (direct) parts.pop();
      const parentSelector = parts.pop();
      current = current.parentElement;
      if (!direct) while (current && !matchesSimple(current, parentSelector)) current = current.parentElement;
      if (!current || !matchesSimple(current, parentSelector)) return false;
    }
    return true;
  });
}
class TreeElement extends Element {
  constructor(tag, attributes = {}, children = []) {
    super(attributes); this.nodeType = 1; this.nodeName = this.tagName = tag.toUpperCase(); this.childNodes = []; this.parentElement = this.parentNode = null;
    for (const child of children.flat()) this.appendChild(typeof child === 'string' ? new TextNode(child) : child);
  }
  get textContent() { return this.childNodes ? this.childNodes.map(node => node.textContent).join('') : this._text ?? ''; }
  set textContent(value) { this._text = value; if (this.childNodes) { this.childNodes = []; if (value) this.appendChild(new TextNode(value)); } }
  get innerText() {
    if (!this.childNodes) return this._text ?? '';
    if (['PRE', 'CODE'].includes(this.tagName)) return this.textContent;
    return this.childNodes.map(node => { const value = node.nodeType === 3 ? node.textContent : node.innerText; return ['DIV', 'P', 'PRE', 'SECTION', 'LI'].includes(node.tagName) ? value + '\n' : node.tagName === 'BR' ? '\n' : value; }).join('');
  }
  set innerText(value) { this.textContent = value; }
  get children() { return (this.childNodes ?? []).filter(node => node.nodeType === 1); }
  set children(_value) {}
  get id() { return this.attributes.id ?? ''; }
  get className() { return this.attributes.class ?? ''; }
  get classList() { const classes = this.className.split(/\s+/).filter(Boolean); return { contains: value => classes.includes(value), [Symbol.iterator]: () => classes[Symbol.iterator]() }; }
  appendChild(node) { this.childNodes.push(node); node.parentElement = node.parentNode = this; return node; }
  contains(node) { return this === node || this.childNodes.some(child => child === node || child.nodeType === 1 && child.contains(node)); }
  matches(selector) { return matchesSelector(this, selector); }
  closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
  querySelectorAll(selector) { const found = []; const walk = node => { for (const child of node.children) { if (child.matches(selector)) found.push(child); walk(child); } }; walk(this); return found; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  cloneNode(deep = false) { return new TreeElement(this.tagName, { ...this.attributes }, deep ? this.childNodes.map(child => child.cloneNode(true)) : []); }
  replaceWith(node) { replaceNode(this, node); }
  remove() { replaceNode(this); }
}
const tree = (tag, attributes, ...children) => new TreeElement(tag, attributes, children);

function harness({ initialDraft = '', initialUrl = 'https://grok.com/c/first', tiptap = false, messages = [], avatar, name, footerButtons = [], otherMenus = [], fileInput, completedUploads = [], unrelatedSend, disabledSend = false, responding = false, onWait } = {}) {
  const input = tiptap ? new Element({ contenteditable: 'true', role: 'textbox', class: 'tiptap' }, initialDraft) : new Textarea();
  if (!tiptap) input.value = initialDraft;
  const submit = new Element({ 'aria-label': 'Send message', type: 'submit' }); submit.disabled = disabledSend;
  const stop = new Element({ 'aria-label': 'Stop generating' });
  const snapshots = [], sentFiles = [];
  const state = { input, submit, stop, responding, location: { href: initialUrl } };
  const form = new Element(); form.children = [input, submit];
  input.ancestors.form = form; input.parentElement = form; submit.ancestors.form = form;
  form.querySelector = selector => selector === 'input[type="file"]' ? fileInput ?? null : null;
  form.querySelectorAll = selector => selector.includes('data-upload-state="complete"') ? completedUploads : selector === 'button, [role="button"]' ? [submit] : [];
  submit.onClick = () => { if (state.input instanceof Textarea) state.input.value = ''; else state.input.innerText = state.input.textContent = ''; };
  if (fileInput) fileInput.dispatchEvent = () => { sentFiles.push(...(fileInput.files || [])); return true; };
  let listener;
  const document = {
    title: 'Grok', documentElement: new Element(),
    querySelectorAll(selector) {
      if (selector === '[data-sidebar="footer"] button[aria-haspopup="menu"]') return footerButtons;
      if (selector.includes('textarea')) return [state.input];
      if (selector === 'button, [role="button"]') return [...(unrelatedSend ? [unrelatedSend] : []), submit, ...footerButtons, ...otherMenus, ...(state.responding ? [stop] : [])];
      if (selector === 'button[type="submit"]') return [submit];
      if (selector.includes('data-message-author-role')) return messages;
      if (selector.includes('user-name')) return name ? [name] : [];
      if (selector.includes('avatar') || selector.includes('profile') || selector.includes('aside img')) return avatar && (selector.includes('aside img') || selector.includes('nav img') || avatar.attributes['data-testid'] === 'avatar') ? [avatar] : [];
      return [];
    },
    querySelector(selector) { return selector === 'input[type="file"]' ? fileInput ?? null : null; },
    createTextNode(value) { return new TextNode(value); },
    createRange() { return { selectNodeContents() {} }; },
    execCommand(command, _showUi, value) { assert.equal(command, 'insertText'); state.input.innerText = state.input.textContent = value; return true; },
  };
  const context = {
    document, location: state.location, HTMLTextAreaElement: Textarea, HTMLElement: Element, HTMLInputElement: Element,
    MutationObserver: class { observe() {} },
    setInterval() {}, clearTimeout() {}, setTimeout(fn, ms) { onWait?.(ms, state); queueMicrotask(fn); return 1; },
    chrome: { runtime: { sendMessage(message) { snapshots.push(message.state); return Promise.resolve({ ok: true }); }, onMessage: { addListener(fn) { listener = fn; } } } },
    Event: class { constructor(type, options) { Object.assign(this, { type }, options); } },
    InputEvent: class {},
    DataTransfer: class { constructor() { this.files = []; this.items = { add: file => this.files.push(file) }; } },
    File: class { constructor(bytes, filename, options) { this.name = filename; this.bytes = bytes; this.type = options.type; } },
    getSelection() { return { removeAllRanges() {}, addRange() {} }; },
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    Uint8Array, atob, URL, console,
  };
  vm.runInNewContext(source, context);
  return { ...state, snapshots, sentFiles, command(command) { return new Promise(resolve => listener({ type: 'grokdesk:command', command: { id: 'test-command', expectedUrl: initialUrl, text: 'Desktop request', ...command } }, {}, resolve)); } };
}

function footerAccount(nickname = 'Website nickname', avatarUrl = 'https://grok.com/avatar.png') {
  const button = new Element({ 'aria-haspopup': 'menu' });
  const image = new Element(); image.src = avatarUrl; image.currentSrc = avatarUrl;
  const name = new Element({ class: 'truncate' }, nickname);
  button.lookups['span.rounded-full > img'] = image;
  button.lookups['span.truncate'] = name;
  return button;
}

test('browser send preserves a different website draft and rejects during a response', async () => {
  const draft = harness({ initialDraft: 'Website draft' });
  assert.equal((await draft.command({ action: 'send' })).ok, false);
  assert.equal(draft.input.value, 'Website draft');
  assert.equal(draft.submit.clicks, 0);
  const running = harness({ responding: true });
  assert.equal((await running.command({ action: 'send' })).ok, false);
  assert.equal(running.submit.clicks, 0);
});

test('browser send accepts one request and rejects a simultaneous duplicate', async () => {
  const page = harness();
  const first = page.command({ action: 'send' });
  const second = page.command({ action: 'send' });
  assert.equal((await first).ok, true);
  assert.equal((await second).ok, false);
  assert.equal(page.submit.clicks, 1);
});

test('a conversation change during the send-button wait cannot send in the new chat', async () => {
  const page = harness({ disabledSend: true, onWait(ms, state) {
    if (ms !== 250) return;
    state.location.href = 'https://grok.com/c/different';
    state.input.isConnected = false;
    state.input = new Textarea(); state.input.value = 'Different conversation draft';
    state.submit.disabled = false;
  } });
  assert.equal((await page.command({ action: 'send' })).ok, false);
  assert.equal(page.submit.clicks, 0);
});

test('an account change during the send-button wait cannot send in the new account', async () => {
  const name = new Element({ 'data-testid': 'user-name' }, 'Alice');
  const page = harness({ name, disabledSend: true, onWait(ms, state) { if (ms === 250) { name.textContent = 'Bob'; state.submit.disabled = false; } } });
  assert.equal((await page.command({ action: 'send', expectedAccount: 'Alice' })).ok, false);
  assert.equal(page.submit.clicks, 0);
});

test('sending clicks the composer button rather than an unrelated visible Send control', async () => {
  const unrelatedSend = new Element({ 'aria-label': 'Send message' });
  const page = harness({ unrelatedSend });
  assert.equal((await page.command({ action: 'send' })).ok, true);
  assert.equal(unrelatedSend.clicks, 0);
  assert.equal(page.submit.clicks, 1);
});

test('message snapshots exclude hidden conversation elements', () => {
  const shown = new Element({ 'data-message-author-role': 'user' }, 'Visible conversation');
  const hidden = new Element({ 'data-message-author-role': 'assistant' }, 'Hidden old conversation', false);
  const page = harness({ messages: [shown, hidden] });
  assert.deepEqual(Array.from(page.snapshots[0].messages, item => item.content), ['Visible conversation']);
});

test('an arbitrary sidebar image must not become the synced account', () => {
  const image = new Element({}, ''); image.alt = 'Project icon'; image.src = 'https://grok.com/project-icon.png';
  const page = harness({ avatar: image });
  assert.equal(page.snapshots[0].account, undefined);
});

test('an explicit visible account name is synchronized', () => {
  const name = new Element({ 'data-testid': 'user-name' }, 'Website nickname');
  const page = harness({ name });
  assert.equal(page.snapshots[0].account?.nickname, 'Website nickname');
});

test('unconfirmed attachments do not trigger an automatic message send', async () => {
  const fileInput = new Element({ type: 'file' });
  const page = harness({ fileInput });
  const result = await page.command({ action: 'send', attachments: [{ name: 'report.txt', mime: 'text/plain', base64: Buffer.from('report').toString('base64') }] });
  assert.equal(result.ok, false);
  assert.equal(page.sentFiles.length, 1, 'The fixture must exercise a real upload attempt');
  assert.equal(page.submit.clicks, 0);
});

test('partial filename matches cannot acknowledge two uploaded attachments', async () => {
  const fileInput = new Element({ type: 'file' });
  const uploaded = new Element({ 'data-upload-state': 'complete', 'data-filename': 'report.txt.bak' }, 'report.txt.bak');
  const page = harness({ fileInput, completedUploads: [uploaded] });
  const attachments = ['report.txt', 'report.txt.bak'].map(name => ({ name, mime: 'text/plain', base64: Buffer.from('report').toString('base64') }));
  assert.equal((await page.command({ action: 'send', attachments })).ok, false);
  assert.equal(page.submit.clicks, 0);
});

test('a fully acknowledged attachment is sent with its prompt', async () => {
  const fileInput = new Element({ type: 'file' });
  const uploaded = new Element({ 'data-upload-state': 'complete', 'data-filename': 'report.txt' }, 'report.txt');
  const page = harness({ fileInput, completedUploads: [uploaded] });
  const attachments = [{ name: 'report.txt', mime: 'text/plain', base64: Buffer.from('report').toString('base64') }];
  assert.equal((await page.command({ action: 'send', attachments })).ok, true);
  assert.equal(page.sentFiles.length, 1);
  assert.equal(page.submit.clicks, 1);
});

test('Tiptap editors on non-chat pages cannot send or upload', async () => {
  for (const pathname of ['/imagine', '/imagine/post/image-id', '/library', '/profile', '/checkout', '/chatty', '/caution']) {
    const fileInput = new Element({ type: 'file' });
    const uploaded = new Element({ 'data-upload-state': 'complete', 'data-filename': 'picture.png' }, 'picture.png');
    const message = new Element({ 'data-message-author-role': 'user' }, 'Not a chat message');
    const page = harness({ initialUrl: 'https://grok.com' + pathname, tiptap: true, fileInput, completedUploads: [uploaded], messages: [message] });
    assert.equal(page.snapshots[0].capabilities.send, false, pathname + ' advertised chat send');
    assert.equal(page.snapshots[0].capabilities.attachments, false, pathname + ' advertised chat upload');
    assert.equal(page.snapshots[0].messages.length, 0, pathname + ' exposed non-chat messages');
    assert.equal((await page.command({ action: 'send' })).ok, false, pathname + ' accepted a message');
    assert.equal((await page.command({ action: 'send', attachments: [{ name: 'picture.png', mime: 'image/png', base64: 'aW1hZ2U=' }] })).ok, false, pathname + ' accepted an upload');
    assert.equal(page.input.innerText, '', pathname + ' mutated the editor');
    assert.equal(page.sentFiles.length, 0, pathname + ' uploaded a file');
    assert.equal(page.submit.clicks, 0, pathname + ' clicked a send control');
  }
});

test('an Imagine generation Stop control is not exposed or clicked as chat stop', async () => {
  const page = harness({ initialUrl: 'https://grok.com/imagine/post/image-id', tiptap: true, responding: true });
  assert.equal(page.snapshots[0].loading, false);
  assert.equal(page.snapshots[0].capabilities.stop, false);
  assert.equal((await page.command({ action: 'stop' })).ok, false);
  assert.equal(page.stop.clicks, 0);
});

test('Tiptap editors remain usable on explicitly allowed chat routes', async () => {
  for (const pathname of ['/', '/?ref=desktop#chat', '/c', '/c/first', '/chat', '/chat/first']) {
    const page = harness({ initialUrl: 'https://grok.com' + pathname, tiptap: true });
    assert.equal(page.snapshots[0].capabilities.send, true, pathname + ' did not expose its chat editor');
    assert.equal((await page.command({ action: 'send' })).ok, true, pathname + ' could not send');
    assert.equal(page.submit.clicks, 1, pathname + ' did not submit exactly once');
  }
});

test('the unique website sidebar-footer menu synchronizes its visible name and avatar', () => {
  const page = harness({ footerButtons: [footerAccount('官网昵称', 'https://grok.com/profile-avatar.png')] });
  assert.equal(page.snapshots[0].account?.nickname, '官网昵称');
  assert.equal(page.snapshots[0].account?.avatarUrl, 'https://grok.com/profile-avatar.png');
});

test('matching menu children outside the footer cannot become the synced account', () => {
  const page = harness({ otherMenus: [footerAccount('Not the current account')] });
  assert.equal(page.snapshots[0].account, undefined);
});

test('multiple footer account candidates are not guessed', () => {
  const page = harness({ footerButtons: [footerAccount('Alice'), footerAccount('Bob')] });
  assert.equal(page.snapshots[0].account, undefined);
});

test('an empty footer nickname or missing avatar is not treated as an identified account', () => {
  const nameless = harness({ footerButtons: [footerAccount('   ')] });
  assert.equal(nameless.snapshots[0].account, undefined);
  const button = footerAccount(); delete button.lookups['span.rounded-full > img'];
  const missingAvatar = harness({ footerButtons: [button] });
  assert.equal(missingAvatar.snapshots[0].account, undefined);
});

function serializedMessage(...children) {
  const body = tree('div', { class: 'markdown' }, ...children);
  const message = tree('article', { 'data-message-author-role': 'assistant', 'data-message-id': 'website-answer' }, body);
  const page = harness({ messages: [message] });
  assert.equal(page.snapshots[0]?.messages.length, 1, 'The structural DOM message was not extracted');
  return page.snapshots[0].messages[0].content;
}
function codeBlocks(markdown) {
  return Array.from(markdown.matchAll(/(?:^|\n)(`{3,})([^\n]*)\n([\s\S]*?)\n\1(?=\n|$)/g), match => ({ fence: match[1], language: match[2], content: match[3] }));
}
const parsedCodeValues = markdown => unified().use(remarkParse).parse(markdown).children.filter(node => node.type === 'code').map(node => node.value);

test('code-card chrome stays out of the fenced code while surrounding narration stays in order', () => {
  const markdown = serializedMessage(
    tree('p', {}, 'Before the example.'),
    tree('div', { 'data-testid': 'code-block' },
      tree('div', { class: 'code-header' }, tree('span', {}, 'Example title'), tree('button', {}, 'Copy code')),
      tree('pre', {}, tree('code', { class: 'language-python' }, 'print("hello")'))),
    tree('p', {}, 'After the example.'));
  const blocks = codeBlocks(markdown);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].language, 'python');
  assert.equal(blocks[0].content, 'print("hello")');
  assert.ok(markdown.indexOf('Before the example.') < markdown.indexOf('```'));
  assert.ok(markdown.lastIndexOf('```') < markdown.indexOf('After the example.'));
  assert.equal(markdown.includes('Example title'), false);
  assert.equal(markdown.includes('Copy code'), false);
});

test('nested syntax spans preserve code indentation, tabs, leading and internal blank lines', () => {
  const code = tree('code', { class: 'language-python' },
    '\n', tree('span', { class: 'token-keyword' }, 'def'), ' example():\n',
    tree('span', {}, '\t', tree('span', { class: 'token-keyword' }, 'if'), ' True:\n'),
    '\t\tprint(', tree('span', { class: 'token-string' }, '"kept"'), ')\n\n',
    '    return 0');
  const expected = '\ndef example():\n\tif True:\n\t\tprint("kept")\n\n    return 0';
  assert.equal(code.textContent, expected, 'The fixture changed whitespace before serialization');
  const blocks = codeBlocks(serializedMessage(tree('pre', {}, code)));
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].content, expected);
});

test('a preformatted block with no language receives a text fence', () => {
  const blocks = codeBlocks(serializedMessage(tree('pre', {}, '  indented text\n\tsecond line\n\nlast line')));
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].language, 'text');
  assert.equal(blocks[0].content, '  indented text\n\tsecond line\n\nlast line');
});

test('code containing a triple-backtick fence is wrapped in a longer Markdown fence', () => {
  const value = 'const source = `\n```\ninside\n```\n`;';
  const blocks = codeBlocks(serializedMessage(tree('pre', {}, tree('code', { class: 'language-javascript' }, value))));
  assert.equal(blocks.length, 1);
  assert.ok(blocks[0].fence.length > 3);
  assert.equal(blocks[0].language, 'javascript');
  assert.equal(blocks[0].content, value);
});

test('explicit plain-text cards use their content node and exclude their controls', () => {
  for (const [testId, contentId] of [['text-block', 'text-block-content'], ['plain-text-block', 'plain-text-content']]) {
    const value = '  literal line\n\tkeep this\n\nend';
    const markdown = serializedMessage(tree('section', { 'data-testid': testId },
      tree('div', { class: 'text-header' }, tree('span', {}, 'Text output'), tree('button', {}, 'Copy')),
      tree('div', { 'data-testid': contentId }, value)));
    const blocks = codeBlocks(markdown);
    assert.equal(blocks.length, 1, testId);
    assert.equal(blocks[0].language, 'text', testId);
    assert.equal(blocks[0].content, value, testId);
    assert.equal(markdown.includes('Text output'), false, testId);
    assert.equal(markdown.includes('Copy'), false, testId);
  }
});

test('multiple blocks keep their order among the surrounding paragraphs', () => {
  const markdown = serializedMessage(
    tree('p', {}, 'First explanation'),
    tree('pre', {}, tree('code', { class: 'language-js' }, 'first();')),
    tree('p', {}, 'Between the blocks'),
    tree('pre', {}, 'second block'),
    tree('p', {}, 'Final explanation'));
  const blocks = codeBlocks(markdown);
  assert.deepEqual(blocks.map(block => [block.language, block.content]), [['js', 'first();'], ['text', 'second block']]);
  const positions = ['First explanation', 'first();', 'Between the blocks', 'second block', 'Final explanation'].map(value => markdown.indexOf(value));
  assert.ok(positions.every((position, index) => position >= 0 && (!index || position > positions[index - 1])));
});

test('ordinary narration and inline code are not converted into fenced blocks', () => {
  const markdown = serializedMessage(tree('p', {}, 'Call ', tree('code', {}, 'example()'), ' to continue.'), tree('p', {}, 'This is a normal paragraph.'));
  assert.equal(codeBlocks(markdown).length, 0);
  assert.ok(markdown.includes('Call '));
  assert.ok(markdown.includes('example()'));
  assert.ok(markdown.includes('This is a normal paragraph.'));
});

test('fenced source retains every original trailing LF after real Markdown parsing', () => {
  for (const value of ['', 'source', 'source\n', 'source\n\n\n', '\t  source\n  \n']) {
    const code = serializedMessage(tree('pre', {}, tree('code', { class: 'language-js' }, value)));
    assert.deepEqual(parsedCodeValues(code), [value], 'Code source changed: ' + JSON.stringify(value));
    const plain = serializedMessage(tree('div', { 'data-testid': 'text-block' }, tree('div', { 'data-testid': 'text-block-content' }, value)));
    assert.deepEqual(parsedCodeValues(plain), [value], 'Plain source changed: ' + JSON.stringify(value));
  }
});

test('plain-text cards preserve p and div boundaries and inline text through Markdown parsing', () => {
  const paragraphCard = serializedMessage(tree('div', { 'data-testid': 'text-block' },
    tree('p', {}, 'First ', tree('code', {}, 'inline()'), ' paragraph'),
    tree('p', {}, '  Second paragraph')));
  assert.deepEqual(parsedCodeValues(paragraphCard), ['First inline() paragraph\n\n  Second paragraph']);
  const lineCard = serializedMessage(tree('section', { 'data-testid': 'plain-text-block' },
    tree('div', { 'data-testid': 'plain-text-content' },
      tree('div', {}, 'line one'),
      tree('div', {}, '\tline two', tree('br'), 'line three'),
      tree('p', {}, 'Final paragraph'))));
  assert.deepEqual(parsedCodeValues(lineCard), ['line one\n\tline two\nline three\n\nFinal paragraph']);
});

test('paragraph-aware plain-text extraction leaves pre and code source untouched', () => {
  const code = tree('code', { class: 'language-text' }, tree('div', {}, 'one'), tree('div', {}, 'two\n'));
  const expected = code.textContent;
  assert.deepEqual(parsedCodeValues(serializedMessage(tree('pre', {}, code))), [expected]);
  const pre = tree('pre', {}, tree('div', {}, 'one'), tree('div', {}, 'two\n'));
  assert.deepEqual(parsedCodeValues(serializedMessage(tree('div', { 'data-testid': 'plain-text-block' }, pre))), [pre.textContent]);
});
