import './style.css';
import { Game } from './core/Game';
import { PrisonGame } from './prison/PrisonGame';
import { PRISON } from './core/config';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.style.position = 'relative';
if (PRISON) new PrisonGame(app);
else new Game(app);
