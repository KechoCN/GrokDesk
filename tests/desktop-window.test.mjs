import test from 'node:test';
import assert from 'node:assert/strict';
import { desktopWindowOptions, desktopMenuTemplate } from '../electron/desktop-window.mjs';

test('each desktop uses its intended native window controls and icon', () => {
  const windows = desktopWindowOptions('win32', '/resources');
  const mac = desktopWindowOptions('darwin', '/resources');
  const linux = desktopWindowOptions('linux', '/resources');
  assert.equal(windows.frame, false);
  assert.ok(windows.icon.endsWith('GrokDesk.ico'));
  assert.equal(mac.frame, true);
  assert.equal(mac.titleBarStyle, 'hiddenInset');
  assert.equal(linux.frame, true);
  assert.ok(linux.icon.endsWith('.png'));
  assert.equal(linux.titleBarStyle, undefined);
});

test('macOS exposes native editing, application and window menus', () => {
  const roles = desktopMenuTemplate('darwin').map(item => item.role);
  for (const role of ['appMenu', 'editMenu', 'windowMenu']) assert.ok(roles.includes(role));
  assert.equal(desktopMenuTemplate('win32'), null);
  assert.equal(desktopMenuTemplate('linux'), null);
});
