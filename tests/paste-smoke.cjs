// Synthetic clipboard events only: never reads or overwrites the system clipboard.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const rendererArgument = process.argv.find(argument => argument.startsWith('--renderer='));
const renderer = rendererArgument ? rendererArgument.slice('--renderer='.length) : path.join(root, 'renderer-dist', 'index.html');
app.disableHardwareAcceleration();
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'grokdesk-paste-ui-')));
let win, stage = 'startup';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const script = code => win.webContents.executeJavaScript(code);
const buildField = 'textarea.composer-text';
async function until(code, message) {
  for (let index = 0; index < 100; index++) { if (await script(code)) return; await pause(40); }
  throw new Error(message);
}
async function calls(name) { return script(`window.grokdeskTest.calls().filter(call=>call.name===${JSON.stringify(name)})`); }
async function setDraft(value, selector = buildField) {
  await script(`(() => { const field=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,${JSON.stringify(value)}); field.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await pause(40);
}
async function paste({ text, html, format, file, start, end, selector = buildField } = {}) {
  // Resolve on the first paint after paste. This never waits for attachClipboard.
  return script(`new Promise(resolve=>{ const field=document.querySelector(${JSON.stringify(selector)}), data=new DataTransfer(); const options=${JSON.stringify({ text, html, format, file, start, end })}; if(options.text!==undefined)data.setData('text/plain',options.text); if(options.html!==undefined)data.setData('text/html',options.html); if(options.format)data.setData(options.format.type,options.format.value); if(options.file)data.items.add(new File([options.file.bytes],options.file.name,{type:options.file.type})); field.focus(); if(options.start!==undefined)field.setSelectionRange(options.start,options.end??options.start); const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}); field.dispatchEvent(event); requestAnimationFrame(()=>resolve({prevented:event.defaultPrevented,value:field.value,readOnly:field.readOnly,disabled:field.disabled,start:field.selectionStart,end:field.selectionEnd})); })`);
}
async function capture(name) {
  const directory = path.join(root, 'artifacts', 'verification'); fs.mkdirSync(directory, { recursive:true });
  await win.webContents.capturePage(undefined, { stayHidden:true, stayAwake:true }).catch(()=>{}); await pause(70);
  fs.writeFileSync(path.join(directory,name),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
}
async function assertTextPaste(options, expected, message) {
  const before = (await calls('attachClipboard')).length;
  const result = await paste(options);
  assert.equal(result.value, expected, `${message}: text was not inserted by the first paint`);
  assert.equal(result.readOnly, false, `${message}: paste locked the input`);
  assert.equal(result.disabled, false, `${message}: paste disabled the input`);
  assert.equal((await calls('attachClipboard')).length, before, `${message}: ordinary text invoked native file probing`);
  assert.equal(await script(`window.grokdeskTest.pendingClipboard()`), 0, `${message}: ordinary text created a pending native clipboard request`);
  await pause(30);
  assert.equal(await script(`document.querySelector(${JSON.stringify(options.selector || buildField)}).value`), expected, `${message}: text was duplicated after asynchronous work`);
  return result;
}

app.whenReady().then(async()=>{
  try {
    win=new BrowserWindow({show:false,width:1100,height:820,webPreferences:{preload:path.join(__dirname,'renderer-fixture.cjs'),contextIsolation:true,sandbox:true,backgroundThrottling:false}});
    const errors=[];
    win.webContents.on('console-message',(...args)=>{const details=args[1];if(typeof details==='object'&&details.level==='error')errors.push(details.message);});
    await win.loadFile(renderer);
    await win.webContents.insertCSS('*,*::before,*::after{transition:none!important;animation:none!important;}');
    await until(`!!document.querySelector(${JSON.stringify(buildField)})`,'Build composer did not mount');

    stage='native provider rejects ordinary rich text';
    await script(`window.grokdeskTest.clipboardBehavior('reject')`);
    await setDraft('前缀待替换后缀');
    const chinese='中文第一行\n第二行，保留标点。';
    const replaced=await assertTextPaste({text:chinese.replace('\n','\r\n'),html:'<strong>中文第一行</strong><p>第二行，保留标点。</p>',start:2,end:5},'前缀'+chinese+'后缀','Chinese CRLF multiline selection replacement');
    assert.equal(replaced.start,2+chinese.length);assert.equal(replaced.end,replaced.start);
    await assertTextPaste({text:'\r\n继续粘贴'},'前缀'+chinese+'\n继续粘贴后缀','Paste after normalized CRLF caret');

    stage='native provider hangs but consecutive text pastes stay independent';
    await script(`window.grokdeskTest.clipboardBehavior('hang')`);
    await setDraft('');
    let expected='';
    for(const text of ['连续粘贴一','\n连续粘贴二','\n最后一段']) {expected+=text;await assertTextPaste({text},expected,'Consecutive text paste');}
    await setDraft('');
    await assertTextPaste({text:'D:\\示例目录\\只是文字路径.txt'},'D:\\示例目录\\只是文字路径.txt','Plain text Windows path');

    stage='native provider would report an image handled but plain text wins';
    await script(`window.grokdeskTest.clipboardBehavior('normal');window.grokdeskTest.nativeClipboard(true)`);
    await setDraft('');
    await assertTextPaste({text:'复制的是这段文字',html:'<p>复制的是这段文字</p>'},'复制的是这段文字','Rich text with a native bitmap alternative');

    stage='connecting accepts text while attachments remain disabled';
    await script(`window.grokdeskTest.setPhase('connecting')`);await pause(50);
    await assertTextPaste({text:'\n连接过程中继续编辑'},'复制的是这段文字\n连接过程中继续编辑','Connecting phase text paste');
    const beforeConnectingFiles=(await calls('attachFiles')).length;
    await paste({file:{name:'connecting.pdf',type:'application/pdf',bytes:'%PDF mock'}});
    assert.equal((await calls('attachFiles')).length,beforeConnectingFiles,'Connecting phase accepted a file attachment');
    stage='running rejects edits';
    await script(`window.grokdeskTest.setPhase('running')`);await pause(50);
    const runningDraft=await script(`document.querySelector(${JSON.stringify(buildField)}).value`);
    const running=await paste({text:'不应插入'});
    assert.equal(running.readOnly,true);assert.equal(running.value,runningDraft,'Running task accepted pasted text');
    await script(`window.grokdeskTest.setPhase('ready');window.grokdeskTest.nativeClipboard(false)`);await pause(50);

    stage='real file paths still use file attachment API without duplicate text';
    await setDraft('保留草稿');
    const fileBefore=(await calls('attachFiles')).length;
    await paste({text:'D:\\Example\\clipboard-document.pdf',file:{name:'clipboard-document.pdf',type:'application/pdf',bytes:'%PDF bytes'}});
    await until(`window.grokdeskTest.calls().filter(call=>call.name==='attachFiles').length===${fileBefore+1}`,'File clipboard path was not attached');
    assert.deepEqual((await calls('attachFiles')).at(-1).paths,['D:\\Example\\clipboard-document.pdf']);
    assert.equal(await script(`document.querySelector(${JSON.stringify(buildField)}).value`),'保留草稿','File path was also inserted as text');

    stage='browser image bytes survive a failed native provider';
    await script(`window.grokdeskTest.clipboardBehavior('reject')`);
    const imageBefore=(await calls('attachData')).length;
    await paste({text:'image fallback must not duplicate text',file:{name:'clipboard-image.png',type:'image/png',bytes:'image bytes'}});
    await until(`window.grokdeskTest.calls().filter(call=>call.name==='attachData').length===${imageBefore+1}`,'Browser image was lost when native clipboard rejected');
    assert.deepEqual((await calls('attachData')).at(-1).files,[{name:'clipboard-image.png',mime:'image/png',size:11}]);
    assert.equal(await script(`document.querySelector(${JSON.stringify(buildField)}).value`),'保留草稿');

    stage='explicit file formats preserve native probing and consume text once';
    await script(`window.grokdeskTest.clipboardBehavior('normal');window.grokdeskTest.nativeClipboard(true)`);
    for(const format of [{type:'application/x-moz-file',value:'fixture-file'},{type:'CF_HDROP',value:'fixture-file'},{type:'text/uri-list',value:'file:///D:/Example/native-file.pdf'}]) {
      const before=(await calls('attachClipboard')).length;
      await paste({text:'native file description',format});
      await until(`window.grokdeskTest.calls().filter(call=>call.name==='attachClipboard').length===${before+1}`,'Explicit file format bypassed native file handling');
      await until(`!document.querySelector(${JSON.stringify(buildField)}).readOnly`,'Explicit file paste did not unlock the composer');
      assert.equal(await script(`document.querySelector(${JSON.stringify(buildField)}).value`),'保留草稿','Native file description was inserted as duplicate text');
    }
    const emptyBefore=(await calls('attachClipboard')).length;
    await paste();
    await until(`window.grokdeskTest.calls().filter(call=>call.name==='attachClipboard').length===${emptyBefore+1}`,'Empty native clipboard event was not probed');
    await until(`!document.querySelector(${JSON.stringify(buildField)}).readOnly`,'Empty clipboard handling did not unlock composer');
    assert.equal(await script(`document.querySelector(${JSON.stringify(buildField)}).value`),'保留草稿');

    stage='explicit native failure falls back to captured text';
    await script(`window.grokdeskTest.clipboardBehavior('reject')`);
    await paste({text:'\n附件探测失败后保留的文字',format:{type:'FileNameW',value:'fixture'},start:4,end:4});
    await until(`document.querySelector(${JSON.stringify(buildField)}).value==='保留草稿\\n附件探测失败后保留的文字'`,'Rejected native file detection discarded captured text');
    await until(`!document.querySelector(${JSON.stringify(buildField)}).readOnly`,'Fallback text left input locked');

    stage='pending native file detection can finish without inserting its text';
    const beforePending=await script(`document.querySelector(${JSON.stringify(buildField)}).value`);
    await script(`window.grokdeskTest.clipboardBehavior('hang');window.grokdeskTest.nativeClipboard(true)`);
    await paste({text:'native pending file metadata',format:{type:'application/x-moz-file',value:'fixture'}});
    await until(`window.grokdeskTest.pendingClipboard()===1`,'Hanging native fixture was not exercised');
    await script(`window.grokdeskTest.releaseClipboard();window.grokdeskTest.clipboardBehavior('normal')`);
    await until(`!document.querySelector(${JSON.stringify(buildField)}).readOnly`,'Resolved native file paste left composer locked');
    assert.equal(await script(`document.querySelector(${JSON.stringify(buildField)}).value`),beforePending);
    await capture('paste-build-text-and-files.png');

    stage='Chat leaves ordinary text paste to the browser';
    await script(`window.grokdeskTest.setWeb({connection:'connected',loading:false,capabilities:{send:true,stop:false,attachments:true},profiles:[{id:'test',label:'Grok test'}],activeProfileId:'test'});Array.from(document.querySelectorAll('.mode-switch button')).find(button=>button.textContent.includes('聊天')).click()`);
    await until(`!!document.querySelector('.web-chat:not([hidden]) textarea')`,'Chat input did not mount');
    const chatSelector='.web-chat textarea';
    await setDraft('Chat 草稿',chatSelector);
    const chatNativeBefore=(await calls('attachClipboard')).length;
    const chatText=await paste({selector:chatSelector,text:'中文\n第二行',html:'<p>中文</p><p>第二行</p>',start:5,end:7});
    assert.equal(chatText.prevented,false,'Chat prevented ordinary browser text paste');
    assert.equal(chatText.value,'Chat 草稿','Chat applied a second custom insertion for ordinary text');
    assert.equal(chatText.disabled,false);
    assert.equal((await calls('attachClipboard')).length,chatNativeBefore,'Chat text invoked Build native file probing');
    stage='Chat intercepts only actual file paste for attachments';
    const chatImage=await paste({selector:chatSelector,text:'must not duplicate attachment caption',file:{name:'chat-pasted-image.png',type:'image/png',bytes:'chat image'}});
    assert.equal(chatImage.prevented,true,'Chat did not intercept a real image file');
    await until(`document.querySelector('.web-attachments')?.textContent.includes('chat-pasted-image.png')`,'Chat image paste did not stage attachment');
    assert.equal(await script(`document.querySelector('.web-chat textarea').value`),'Chat 草稿','Chat attachment also inserted its caption as text');
    assert.equal((await calls('attachClipboard')).length,chatNativeBefore,'Chat attachment used the Build native clipboard API');
    await capture('paste-chat-file-and-text.png');
    assert.equal(errors.length,0,errors.join('\n'));
    console.log('Paste smoke passed: immediate text during reject/hang/handled native states, selection/multiline/HTML/paths/consecutive pastes, phase guards, native-file/image fallbacks, no duplicate text and Chat default text handling.');
    win.destroy();app.exit(0);
  } catch(error) {console.error(`Paste smoke failed at ${stage}:`,error);if(win&&!win.isDestroyed()){try{await capture('paste-failure.png');}catch{}win.destroy();}app.exit(1);}
});
