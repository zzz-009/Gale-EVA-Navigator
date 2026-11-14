import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'leaflet/dist/leaflet.css';
import './style.css';
import { App } from './App';
import { DeviceView } from './DeviceView';

const view = new URLSearchParams(window.location.search).get('view');
createRoot(document.getElementById('root')!).render(<StrictMode>{view === 'hud' || view === 'wrist' ? <DeviceView view={view} /> : <App />}</StrictMode>);
