import './style.css';
import { Game } from './core/Game';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.style.position = 'relative';
new Game(app);
