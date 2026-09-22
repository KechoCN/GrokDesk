import ReactDOM from 'react-dom/client';
import App from './App';
import { platform } from './platform';
import './styles.css';

document.documentElement.dataset.platform = platform ?? 'web';

async function start() {
  if (platform === 'linux') {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      // Keep static labels from first laying out with missing-glyph fallback
      // on Linux desktops that have no system CJK font.
      const fonts = await Promise.race([
        document.fonts.load('14px "GrokDesk Noto Sans SC"', '项目对话搜索任务已就绪'),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Font load timed out after 5 seconds')), 5000); }),
      ]);
      if (!fonts.length || fonts.some(font => font.status !== 'loaded')) throw new Error('Bundled CJK font is unavailable');
    } catch (error) {
      console.warn('GrokDesk: bundled Linux CJK font failed to load; continuing with system fonts.', error);
    } finally {
      clearTimeout(timeout);
    }
  }
  ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
}

void start();
