import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { adoptCarriedPlayer } from './storage';

adoptCarriedPlayer();

// Fit the game to the part of the screen that's actually visible. Some browsers (newer iPhone
// Safari) count the space under their own toolbar as part of the page, which hid the bottom of
// the board and the Enter button. Zooming in doesn't count: that's the player's choice.
function fitToScreen() {
  const vv = window.visualViewport;
  const visible = vv ? vv.height * vv.scale : window.innerHeight;
  document.documentElement.style.setProperty('--app-h', `${Math.round(Math.min(window.innerHeight, visible))}px`);
}
fitToScreen();
window.visualViewport?.addEventListener('resize', fitToScreen);
window.addEventListener('resize', fitToScreen);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
