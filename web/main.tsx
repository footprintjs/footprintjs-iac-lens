import { createRoot } from 'react-dom/client';
import { IacLens } from './App.tsx';
import '@xyflow/react/dist/style.css';
import './styles.css';
import './standalone.css';

const root = document.getElementById('root');
if (!root) throw new Error('IaC Lens requires a root element');
createRoot(root).render(<IacLens/>);
