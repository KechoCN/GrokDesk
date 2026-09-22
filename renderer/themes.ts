export const themeOptions = [
  { id: 'system', label: '跟随系统', description: 'System', dark: false, colors: ['#f8f8f8', '#ececec', '#303030'] },
  { id: 'light', label: '素白', description: 'Classic Light', dark: false, colors: ['#f8f8f8', '#f0f0f0', '#262626'] },
  { id: 'dark', label: '墨黑', description: 'Classic Dark', dark: true, colors: ['#242629', '#2c2f33', '#eceef1'] },
  { id: 'lagoon', label: '晴湾', description: 'Lagoon · 清透海蓝', dark: false, colors: ['#f3f8fa', '#e4eff3', '#167491'] },
  { id: 'midnight', label: '星夜', description: 'Midnight · 静谧靛蓝', dark: true, colors: ['#242d43', '#2c3750', '#bac5ff'] },
  { id: 'forest', label: '苔林', description: 'Forest · 深绿暖金', dark: true, colors: ['#26372f', '#304339', '#ccdda9'] },
  { id: 'rose', label: '蔷薇', description: 'Rose · 温润纸白', dark: false, colors: ['#fbf6f2', '#f3e8e3', '#9e5869'] },
] as const;

export function resolveTheme(theme: string, systemDark: boolean) {
  const selected = theme === 'system' ? systemDark ? 'dark' : 'light' : theme;
  const option = themeOptions.find(item => item.id === selected) ?? themeOptions[1];
  return { dark: option.dark, className: ['light', 'dark'].includes(option.id) ? `theme-zai-${option.id}` : `theme-${option.id}` };
}
