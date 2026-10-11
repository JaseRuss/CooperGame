import './style.css';
import { Game } from './core/Game';
import { PrisonGame } from './prison/PrisonGame';
import { JailbreakGame } from './siege/JailbreakGame';
import { PRISON, JAILBREAK } from './core/config';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.style.position = 'relative';
if (PRISON) new PrisonGame(app);
else if (JAILBREAK) new JailbreakGame(app);
else new Game(app);
