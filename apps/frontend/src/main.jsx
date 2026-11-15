import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './auth/AuthContext.jsx';
import './styles.css';

const savedTheme = localStorage.getItem('obriy-theme');
const initialTheme = savedTheme === 'light' || savedTheme === 'dark'
  ? savedTheme
  : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
document.documentElement.dataset.theme = initialTheme;
document.documentElement.style.colorScheme = initialTheme;

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
