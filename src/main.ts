import catalogData from '../config/catalog.json';
import compositionData from '../config/composition.json';
import compositionTiming from '../config/composition-timing.json';
import { parseCatalog } from './catalog.ts';
import {parseCompositionPackage} from './composition-package.ts';
import {parseCompositionTiming, projectCompositionPackage} from './composition-time.ts';
import { ExplorerPlayer } from './player.ts';
import { mountExplorer } from './ui.ts';
import './style.css';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('The app container is missing.');
const player = new ExplorerPlayer();
const composition = projectCompositionPackage(parseCompositionPackage(compositionData), parseCompositionTiming(compositionTiming));
mountExplorer(root, player, parseCatalog(catalogData), composition);
window.addEventListener('pagehide', () => player.dispose(), {once: true});
