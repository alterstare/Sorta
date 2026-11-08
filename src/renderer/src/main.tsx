import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import Tooltip from './components/Tooltip'
import './styles.css'
import { startExitAnimations } from './exitAnimations'

startExitAnimations()

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <Tooltip />
  </React.StrictMode>
)
