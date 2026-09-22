import ReactDOM from 'react-dom/client';
import App from './App';
import { platform } from './platform';
import './styles.css';

document.documentElement.dataset.platform = platform ?? 'web';
ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
