(() => {
  const visible = element => !!element && element.getClientRects().length > 0;
  const all = selector => [...document.querySelectorAll(selector)];
  const isChatRoute = () => /^\/(?:$|(?:c|chat)(?:\/|$))/.test(new URL(location.href).pathname);
  const editor = () => isChatRoute() ? all('textarea, [contenteditable="true"][role="textbox"], .tiptap[contenteditable="true"]').find(visible) : undefined;
  const composer = input => {
    if (!input) return null;
    if (input.closest('form')) return input.closest('form');
    let element = input.parentElement;
    for (let depth = 0; element && depth < 4 && !element.matches('body, main, aside, nav'); depth++, element = element.parentElement) if (element.querySelector('input[type="file"], button[type="submit"], button[aria-label="Send message"], button[aria-label="发送"]')) return element;
    return input.parentElement;
  };
  const fileInput = () => composer(editor())?.querySelector('input[type="file"]');
  const label = element => [element.getAttribute('aria-label'), element.getAttribute('title'), element.getAttribute('data-testid'), element.textContent].filter(Boolean).join(' ').trim();
  const button = pattern => all('button, [role="button"]').find(element => visible(element) && pattern.test(label(element)));
  const stopButton = () => isChatRoute() ? button(/^(stop|stop generating|stop response|停止|停止生成|停止响应)(\s|$)|stop-button/i) : undefined;
  const sendButton = () => [...(composer(editor())?.querySelectorAll('button, [role="button"]') || [])].find(element => visible(element) && (/^(send|send message|submit|发送|傳送|提交)(\s|$)|send-button|submit-button/i.test(label(element)) || element.getAttribute('type') === 'submit'));
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  function account() {
    // Read only visible account UI. Never inspect cookies, storage, or auth responses.
    const footers = all('[data-sidebar="footer"] button[aria-haspopup="menu"]').filter(node => visible(node) && node.querySelector('span.rounded-full > img'));
    if (footers.length === 1) {
      const image = footers[0].querySelector('span.rounded-full > img');
      const nickname = footers[0].querySelector('span.truncate')?.textContent?.trim().replace(/\s+/g, ' ').slice(0, 120);
      if (nickname && visible(image)) return { nickname, avatarUrl: image.currentSrc || image.src };
    }
    const image = all('[data-testid="user-avatar"] img, [data-testid="account-avatar"] img, [data-testid="profile-avatar"] img, button[aria-label="Account menu"] img, button[aria-label="User menu"] img, button[aria-label="Profile"] img, button[aria-label="用户菜单"] img, button[aria-label="账户菜单"] img').find(visible);
    const explicitName = all('[data-testid="user-name"], [data-testid="account-name"], [data-testid="profile-name"]').find(visible)?.textContent?.trim();
    const container = image?.closest('button, [role="button"], [data-testid*="profile"]');
    const candidate = explicitName || container?.querySelector('[data-testid*="name"]')?.textContent?.trim() || container?.innerText?.trim() || image?.alt?.trim();
    const nickname = candidate?.replace(/\s+/g, ' ').slice(0, 120);
    if (!nickname || /^(avatar|profile|user|account|用户|头像|个人资料|grok|account menu|user menu)$/i.test(nickname)) return undefined;
    return { nickname, avatarUrl: image?.currentSrc || image?.src };
  }
  function messageMarkdown(body) {
    // Website code cards contain a title/copy toolbar outside their source. Keep
    // the source as one fenced chunk so its whitespace survives native rendering.
    const plainBlock = '[data-testid="text-block"], [data-testid="plain-text-block"]';
    const plainContent = '[data-testid="text-block-content"], [data-testid="plain-text-content"]';
    const codeCard = '[data-testid="code-block"], [data-testid="codeblock"], .code-block';
    const controls = 'button, [role="button"], input, select, textarea, svg, script, style, [aria-hidden="true"], [hidden], .line-number, .linenumber, .react-syntax-highlighter-line-number, [data-testid="line-number"]';
    const tag = node => (node.tagName || '').toLowerCase();
    const children = node => [...(node.childNodes || [])];
    const textNode = node => node.nodeType === 3;
    function toolbar(node) {
      if (textNode(node)) return false;
      if (node.matches?.('[data-testid="code-block-header"], [data-testid="code-header"], [data-testid="text-block-header"], .code-header')) return true;
      // Match a compact sibling toolbar, never a paragraph that happens to have
      // a button or the parent containing both the explanation and its code.
      if (!['div', 'header'].includes(tag(node)) || !node.querySelector?.('button, [role="button"]') || node.querySelector('pre, code, p, ul, ol, blockquote')) return false;
      return [...(node.parentElement?.children || [])].some(sibling => sibling !== node && (sibling.matches?.(`pre, ${plainContent}`) || sibling.querySelector?.(`pre, ${plainContent}`)));
    }
    function sourceText(node) {
      if (textNode(node)) return node.nodeValue ?? node.textContent ?? '';
      if (node.matches?.(controls) || toolbar(node)) return '';
      if (tag(node) === 'br') return '\n';
      const nodes = children(node);
      return nodes.length ? nodes.map(sourceText).join('') : node.textContent || '';
    }
    function plainText(node) {
      if (textNode(node) || ['pre', 'code'].includes(tag(node))) return sourceText(node);
      if (node.matches?.(controls) || toolbar(node)) return '';
      if (tag(node) === 'br') return '\n';
      const nodes = children(node);
      if (!nodes.length) return node.textContent || '';
      let content = '', pendingBreak = 0;
      for (const child of nodes) {
        const value = plainText(child);
        const boundary = tag(child) === 'p' ? 2 : ['div', 'section', 'article', 'li'].includes(tag(child)) ? 1 : 0;
        if (!value) { pendingBreak = Math.max(pendingBreak, boundary); continue; }
        const needed = Math.max(pendingBreak, boundary);
        if (content && needed) {
          const existing = (content.match(/\n*$/)?.[0].length || 0) + (value.match(/^\n*/)?.[0].length || 0);
          content += '\n'.repeat(Math.max(0, needed - existing));
        }
        content += value; pendingBreak = boundary;
      }
      return content;
    }
    function fence(source, language = 'text') {
      const runs = source.match(/`+/g) || [];
      const delimiter = '`'.repeat(runs.reduce((length, run) => Math.max(length, run.length + 1), 3));
      // The final LF belongs to Markdown syntax, not the source: always add it
      // so a source ending in one or more LF characters survives parsing intact.
      return `\n\n${delimiter}${language}\n${source}\n${delimiter}\n\n`;
    }
    function codeLanguage(code, container) {
      const language = code.getAttribute?.('data-language') || container.getAttribute?.('data-language') || /(?:^|\s)language-([\w.+#-]+)/.exec(code.getAttribute?.('class') || '')?.[1] || /(?:^|\s)language-([\w.+#-]+)/.exec(container.getAttribute?.('class') || '')?.[1];
      return language && /^[\w.+#-]{1,40}$/.test(language) ? language : 'text';
    }
    function render(node) {
      if (textNode(node)) return node.nodeValue ?? node.textContent ?? '';
      if (node.matches?.(controls) || toolbar(node)) return '';
      if (tag(node) === 'pre') {
        const code = node.querySelector?.('code') || node;
        return fence(sourceText(code), codeLanguage(code, node));
      }
      if (node.matches?.(plainBlock)) {
        const content = node.querySelector?.(plainContent) || node.querySelector?.('pre') || node;
        return fence(plainText(content), 'text');
      }
      if (node.matches?.(codeCard)) {
        const pre = node.querySelector?.('pre');
        if (pre) return render(pre);
        const code = node.querySelector?.('code');
        if (code) return fence(sourceText(code), codeLanguage(code, node));
      }
      if (node.matches?.(plainContent)) return fence(plainText(node), 'text');
      if (tag(node) === 'br') return '\n';
      const nodes = children(node);
      // Older/unknown page markup still gets the previous plain-text fallback.
      if (!nodes.length) return node.innerText || node.textContent || '';
      const content = nodes.map(render).join('');
      if (['p', 'div', 'section', 'article', 'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag(node))) return '\n\n' + content + '\n\n';
      return content;
    }
    return render(body).trim();
  }
  function snapshot() {
    let nodes = isChatRoute() ? all('[data-message-author-role], [data-role="user"], [data-role="assistant"], [data-testid="user-message"], [data-testid="assistant-message"], .message-bubble') : [];
    nodes = nodes.filter(node => visible(node) && !nodes.some(parent => parent !== node && parent.contains(node)));
    const messages = nodes.map((node, index) => {
      const marker = node.getAttribute('data-message-author-role') || node.getAttribute('data-role') || node.getAttribute('data-testid') || '';
      const role = /user/.test(marker) || node.matches('.message-bubble') && !!node.closest('[class*="items-end"], [class*="justify-end"]') ? 'user' : 'assistant';
      const body = node.querySelector('[class*="markdown"], [data-testid="message-content"]') || node;
      return { id: node.getAttribute('data-message-id') || node.id || node.parentElement?.id || 'message-' + index, role, content: messageMarkdown(body) };
    }).filter(message => message.content.trim());
    const history = [...new Map(all('a[href*="/c/"], a[href*="/chat/"]').filter(node => node.textContent.trim()).map(node => [node.href, { title: node.textContent.trim(), url: node.href }])).values()];
    return { url: location.href, title: document.title, loading: !!stopButton(), account: account(), messages, history, capabilities: { send: !!editor(), stop: !!stopButton(), attachments: !!fileInput() } };
  }
  let timer, disconnected = false;
  function sync() { if (disconnected) return; try { chrome.runtime.sendMessage({ type: 'grokdesk:snapshot', state: snapshot() }).catch(() => {}); } catch { disconnected = true; } }
  new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(sync, 220); }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'disabled', 'src'] });
  setInterval(sync, 5000); sync();
  let sending = false;
  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message?.type !== 'grokdesk:command') return;
    (async () => {
      const { command } = message;
      function verifyTarget(input) {
        if (!isChatRoute()) throw new Error('当前官网页面不支持聊天，请新建聊天或在本机浏览器继续。');
        if (location.href !== command.expectedUrl || command.expectedAccount && account()?.nickname !== command.expectedAccount) throw new Error('官网会话或账号已改变，请等待同步后重试。');
        if (input && (!input.isConnected || editor() !== input)) throw new Error('官网输入框已更新，请检查浏览器中的草稿。');
      }
      verifyTarget();
      if (command.action === 'stop') {
        const stop = stopButton(); if (!stop) throw new Error('官网当前没有可停止的回复'); stop.click(); sync(); return;
      }
      if (command.action !== 'send') throw new Error('无法识别此浏览器操作');
      if (sending || stopButton()) throw new Error('Grok 正在回复，请稍候或停止后重试');
      sending = true;
      try {
        const input = editor(); if (!input) throw new Error('未找到官网输入框，请完成登录或刷新官网');
        verifyTarget(input);
        const existing = input instanceof HTMLTextAreaElement ? input.value : input.innerText;
        if (existing.trim() && existing.trim() !== command.text.trim()) throw new Error('官网输入框已有不同草稿，请先在浏览器中处理后重试。');
        if (command.attachments?.length) {
          const uploadInput = fileInput(), container = composer(input);
          if (!uploadInput) throw new Error('官网未提供可连接的附件入口，请在浏览器上传文件');
          if (command.attachments.some(file => [...container.querySelectorAll('[data-testid*="attachment"], [data-upload-state], [data-upload-status]')].some(node => node.textContent.includes(file.name)))) throw new Error('官网已有同名附件，请在浏览器检查并发送，避免重复上传。');
          const transfer = new DataTransfer();
          for (const file of command.attachments) { const bytes = Uint8Array.from(atob(file.base64), char => char.charCodeAt(0)); transfer.items.add(new File([bytes], file.name, { type: file.mime })); }
          verifyTarget(input); uploadInput.files = transfer.files; uploadInput.dispatchEvent(new Event('change', { bubbles: true }));
          let uploaded = false;
          for (let i = 0; i < 100; i++) {
            await wait(300); verifyTarget(input);
            if (container.querySelector('[data-upload-state="error"], [data-upload-status="error"]')) throw new Error('官网附件上传失败，请在浏览器检查附件。');
            const complete = [...container.querySelectorAll('[data-upload-state="complete"], [data-upload-state="success"], [data-upload-status="success"], [data-status="uploaded"], [data-testid="attachment-preview"][data-state="ready"]')];
            const filenames = complete.map(node => node.getAttribute('data-filename') || node.querySelector('[data-testid="file-name"]')?.textContent?.trim() || node.textContent.trim());
            uploaded = command.attachments.every(file => { const index = filenames.indexOf(file.name); if (index < 0) return false; filenames.splice(index, 1); return true; });
            if (uploaded && !container.querySelector('[role="progressbar"], [aria-busy="true"], [data-upload-state="uploading"]')) break;
            uploaded = false;
          }
          if (!uploaded) throw new Error('附件已交给官网，但无法确认上传完成。请在浏览器核对附件并发送；消息没有自动发送。');
        }
        verifyTarget(input);
        input.focus();
        if (input instanceof HTMLTextAreaElement) { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, command.text); input.dispatchEvent(new Event('input', { bubbles: true })); }
        else { const selection = getSelection(), range = document.createRange(); range.selectNodeContents(input); selection.removeAllRanges(); selection.addRange(range); document.execCommand('insertText', false, command.text); input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: command.text })); }
        let send;
        for (let i = 0; i < 120; i++) { send = sendButton(); if (send && !send.disabled && send.getAttribute('aria-disabled') !== 'true') break; await wait(250); }
        if (!send || send.disabled || send.getAttribute('aria-disabled') === 'true') throw new Error('官网发送按钮尚未就绪；草稿已留在官网，请检查附件或额度。');
        verifyTarget(input); send.click();
        // Only acknowledge once the website accepted the draft or started responding.
        for (let i = 0; i < 50; i++) {
          await wait(200); const next = editor(), value = next instanceof HTMLTextAreaElement ? next.value : next?.innerText;
          if (stopButton() || next && !value?.trim()) { sync(); return; }
        }
        throw new Error('官网尚未确认发送，请在浏览器检查会话后再重试。');
      } finally { sending = false; }
    })().then(() => reply({ ok: true }), error => reply({ ok: false, error: error.message }));
    return true;
  });
})();
