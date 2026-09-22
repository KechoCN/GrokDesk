const { contextBridge, ipcRenderer, webUtils } = require('electron');
const methods = ['bootstrap','newConversation','selectConversation','updateConversation','deleteConversation','closeConversation','addWorkspace','createWorkspace','updateWorkspace','chooseAttachments','attachFiles','contextCatalog','removeAttachment','readClipboard','writeClipboard','send','cancel','setConfig','respondPermission','terminalInput','terminalResize','terminalSnapshot','updateSettings','reconnect','usage','exportConversation','openFolder','openExternal','window'];
const api = Object.fromEntries(methods.map(name => [name, (...args) => ipcRenderer.invoke('grokdesk:' + name, ...args)]));
api.platform = process.platform;
api.version = process.argv.find(argument => argument.startsWith('--grokdesk-version='))?.slice('--grokdesk-version='.length) || '0.1.0';
for (const name of ['account', 'engineConfig', 'saveEngineConfig', 'openEngineConfig', 'attachClipboard', 'attachData', 'previewFiles', 'readPreview', 'webMount', 'webAction', 'webStatus', 'webSend', 'webSetup', 'setConversationWorkspace', 'authStatus', 'authStart', 'authCancel', 'authExternal', 'authSubmitCode']) api[name] = (...args) => ipcRenderer.invoke('grokdesk:' + name, ...args);
api.getFilePath = file => webUtils.getPathForFile(file);
api.onEvent = listener => {
  const handler = (_event, data) => listener(data);
  ipcRenderer.on('grokdesk:event', handler);
  return () => ipcRenderer.removeListener('grokdesk:event', handler);
};
contextBridge.exposeInMainWorld('grokdesk', api);
