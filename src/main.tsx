import React from 'react';
import ReactDOM from 'react-dom/client';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { AuthGate } from './components/AuthGate';
import { theme } from './theme.styles';
import './global.styles.css';
import './summary.styles.css';
import './conversation.styles.css';
import './auth.styles.css';
import 'leaflet/dist/leaflet.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><ThemeProvider theme={theme}><CssBaseline /><AuthGate /></ThemeProvider></React.StrictMode>,
);
