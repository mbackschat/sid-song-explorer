import catalogData from '../config/catalog.json';
import { parseCatalog } from './catalog.ts';
import { ExplorerPlayer } from './player.ts';
import { mountExplorer } from './ui.ts';
import './style.css';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('The app container is missing.');
const player = new ExplorerPlayer();
mountExplorer(root, player, parseCatalog(catalogData));
window.addEventListener('pagehide', () => player.dispose(), {once: true});
