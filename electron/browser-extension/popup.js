chrome.runtime.sendMessage({ type: 'grokdesk:status' }).then(state => { document.getElementById('status').textContent = state.connected ? '已连接 GrokDesk' : '等待 GrokDesk 启动'; });
document.getElementById('open').addEventListener('click', () => chrome.tabs.create({ url: 'https://grok.com/' }));
