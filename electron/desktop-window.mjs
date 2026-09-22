import path from 'node:path';

/** Keep OS window controls native where their behaviour is platform specific. */
export function desktopWindowOptions(platform, resources) {
  const common = { width: 1400, height: 900, minWidth: 960, minHeight: 640, show: false, backgroundColor: '#f5f5f4', title: 'GrokDesk' };
  if (platform === 'darwin') return { ...common, frame: true, titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 11 } };
  if (platform === 'linux') return { ...common, frame: true, autoHideMenuBar: true, icon: path.join(resources, 'Assets', 'grok-mobile.png') };
  return { ...common, frame: false, icon: path.join(resources, 'Assets', 'GrokDesk.ico') };
}

export function desktopMenuTemplate(platform) {
  if (platform !== 'darwin') return null;
  return [
    { role: 'appMenu' },
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ];
}
