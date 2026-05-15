import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { BillingApp } from './billing/BillingApp.tsx'

const isBilling = new URLSearchParams(window.location.search).has('billing');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isBilling ? <BillingApp /> : <App />}
  </StrictMode>,
)
