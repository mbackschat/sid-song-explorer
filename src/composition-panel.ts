import type {PlaybackCompositionPackage} from './composition-time.ts';

type Passage = PlaybackCompositionPackage['passages'][number];
type Part = PlaybackCompositionPackage['parts'][number];
type Instrument = PlaybackCompositionPackage['instruments'][number];
export type CompositionSpan = {startSeconds: number; endSeconds: number; voice: number};
export type CompositionSelection = {id: string; title: string; startSeconds: number; endSeconds: number; voices: number[]};
type Occurrence = {
  id: string;
  passage: Passage;
  part: Part;
  instrument: Instrument;
  spans: CompositionSpan[];
  dependencies: Passage['dependencies'];
};
type SelectedOccurrence = Occurrence & {comparison: Occurrence | null};
export type CompositionView = {occurrences: Occurrence[]; selected: SelectedOccurrence | null; passage: Passage | null};
type PanelState = {package: PlaybackCompositionPackage | null; timeSeconds: number; voice: number | null; disabled: boolean; intervention?: boolean};
type PanelActions = {onHear: (selection: CompositionSelection) => void; onSelectionChange: () => void};

export function phrasePlaybackRange(selection: Pick<CompositionSelection, 'startSeconds' | 'endSeconds'>, playbackLimit: number, minimumContextSeconds = 0) {
  const end = Math.min(playbackLimit, Math.max(selection.endSeconds, selection.startSeconds + minimumContextSeconds));
  return {start: Math.max(0, Math.min(selection.startSeconds, end - minimumContextSeconds)), end};
}

export function buildCompositionView(pkg: PlaybackCompositionPackage, timeSeconds: number, voice: number | null, selectionId?: string | null): CompositionView {
  const occurrences: Occurrence[] = [];
  for (const passage of pkg.passages) {
    const groups = new Map<string, Occurrence>();
    for (const event of passage.events) {
      const part = pkg.parts.find(candidate => candidate.id === event.partId)!;
      const instrument = pkg.instruments.find(candidate => candidate.id === event.instrumentId)!;
      const id = `${passage.id}:${part.id}:${instrument.id}`;
      let occurrence = groups.get(id);
      if (!occurrence) {
        occurrence = {id, passage, part, instrument, spans: [], dependencies: passage.dependencies.filter(dependency => dependency.partIds.includes(part.id))};
        groups.set(id, occurrence);
      }
      const startSeconds = Math.max(passage.startSeconds, event.startSeconds);
      const endSeconds = Math.min(passage.endSeconds, event.endSeconds);
      if (endSeconds <= startSeconds) continue;
      for (const allocation of pkg.allocations.filter(candidate => candidate.partId === part.id)) {
        occurrence.spans.push({startSeconds, endSeconds, voice: (allocation.chip - 1) * 3 + allocation.voice});
      }
    }
    occurrences.push(...groups.values());
  }
  const occurrence = selectionId === undefined
    ? occurrences.find(candidate => voice !== null && candidate.spans.some(span => span.voice === voice && timeSeconds >= span.startSeconds && timeSeconds < span.endSeconds))
    : occurrences.find(candidate => candidate.id === selectionId);
  const passage = occurrence?.passage ?? pkg.passages.find(candidate => timeSeconds >= candidate.startSeconds && timeSeconds < candidate.endSeconds) ?? null;
  if (!occurrence) return {occurrences, selected: null, passage};
  const related = occurrence.passage.recurrence?.partIds.includes(occurrence.part.id)
    ? occurrence.passage.recurrence.of
    : pkg.passages.find(candidate => candidate.recurrence?.of === occurrence.passage.id && candidate.recurrence.partIds.includes(occurrence.part.id))?.id;
  const comparison = occurrences.find(candidate => candidate.passage.id === related && candidate.part.id === occurrence.part.id && candidate.instrument.id === occurrence.instrument.id) ?? null;
  return {occurrences, selected: {...occurrence, comparison}, passage};
}

function occurrenceSelection(occurrence: Occurrence): CompositionSelection {
  return {
    id: occurrence.id,
    title: `${occurrence.part.title} · ${occurrence.passage.title}`,
    startSeconds: Math.min(...occurrence.spans.map(span => span.startSeconds)),
    endSeconds: Math.max(...occurrence.spans.map(span => span.endSeconds)),
    voices: [...new Set(occurrence.spans.map(span => span.voice))].sort((left, right) => left - right),
  };
}

const phraseLabel = (title: string) => title.charAt(0).toLowerCase() + title.slice(1);
const timestamp = (seconds: number) => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(2).padStart(5, '0')}`;
const sourceUrl = (pkg: Pick<PlaybackCompositionPackage, 'source'>, sourcePath: string) => `${pkg.source.repository}/blob/${pkg.source.revision}/${sourcePath}`;

export function mountCompositionPanel(container: HTMLElement, actions: PanelActions) {
  let state: PanelState = {package: null, timeSeconds: 0, voice: null, disabled: false};
  let selectionId: string | null | undefined;
  let view: CompositionView | null = null;
  let renderKey = '';
  let renderedButtons = new Map<string, HTMLButtonElement>();
  const document = container.ownerDocument;
  container.className = 'composition-panel';
  container.hidden = true;
  const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text: string, className = '') => {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const link = (text: string, path: string) => {
    const anchor = element('a', text);
    anchor.href = sourceUrl(state.package!, path);
    anchor.target = '_blank';
    anchor.rel = 'noreferrer';
    return anchor;
  };
  const button = (label: string, action: () => void, pressed?: boolean) => {
    const node = element('button', label, 'small quiet');
    node.type = 'button';
    node.disabled = state.disabled;
    node.setAttribute('data-composition-control', label);
    renderedButtons.set(label, node);
    if (pressed !== undefined) node.setAttribute('aria-pressed', String(pressed));
    node.addEventListener('click', () => { if (!state.disabled) action(); });
    return node;
  };
  const selectOccurrence = (occurrence: Occurrence) => {
    selectionId = occurrence.id;
    render();
    actions.onSelectionChange();
  };
  const hearOccurrence = (occurrence: Occurrence) => {
    selectOccurrence(occurrence);
    actions.onHear(occurrenceSelection(occurrence));
  };
  const render = () => {
    const pkg = state.package;
    container.hidden = pkg === null;
    if (!pkg) { view = null; renderKey = ''; container.replaceChildren(); return; }
    view = buildCompositionView(pkg, state.timeSeconds, state.voice, selectionId);
    const key = `${pkg.id}|${view.passage?.id}|${view.selected?.id}|${state.disabled}|${Boolean(state.intervention)}`;
    if (key === renderKey) return;
    renderKey = key;
    const focusedControl = document.activeElement?.getAttribute('data-composition-control');
    renderedButtons = new Map();
    const heading = element('div', '', 'composition-heading');
    heading.append(element('h3', 'Arrangement & sounds'), element('span', 'Selected passages', 'badge'));
    const scope = element('p', pkg.coverage.description, 'composition-scope');
    const phrases = element('nav', '', 'composition-phrases');
    phrases.setAttribute('aria-label', 'Musical phrases');
    for (const passage of pkg.passages) {
      const matching = view.occurrences.filter(occurrence => occurrence.passage.id === passage.id);
      const forVoice = matching.filter(occurrence => occurrence.spans.some(span => span.voice === state.voice));
      const duration = (occurrence: Occurrence) => occurrence.spans.reduce((total, span) => total + span.endSeconds - span.startSeconds, 0);
      const target = (forVoice.length ? forVoice : matching).reduce<Occurrence | undefined>((longest, occurrence) => !longest || duration(occurrence) > duration(longest) ? occurrence : longest, undefined);
      const hear = button(`Hear ${phraseLabel(passage.title)}`, () => {
        if (target) selectOccurrence(target);
        actions.onHear({id: passage.id, title: passage.title, startSeconds: passage.startSeconds, endSeconds: passage.endSeconds, voices: target ? occurrenceSelection(target).voices : []});
      }, view.passage?.id === passage.id);
      hear.title = `${timestamp(passage.startSeconds)}–${timestamp(passage.endSeconds)} · ${passage.evidenceLevel}`;
      phrases.append(hear);
    }
    const body = element('div', '', 'composition-selection');
    const selected = view.selected;
    if (view.passage) {
      const partChoices = element('div', '', 'composition-parts');
      partChoices.setAttribute('role', 'group');
      partChoices.setAttribute('aria-label', 'Parts and programs in this phrase');
      for (const occurrence of view.occurrences.filter(candidate => candidate.passage.id === view!.passage!.id)) {
        partChoices.append(button(`${occurrence.part.title} · ${occurrence.instrument.title}`, () => selectOccurrence(occurrence), occurrence.id === selected?.id));
      }
      body.append(partChoices);
    }
    if (selected) {
      body.append(element('h4', selected.instrument.title));
      const voices = occurrenceSelection(selected).voices.map(voice => `V${voice}`).join(' / ');
      body.append(element('p', `${selected.part.evidenceLevel} role · ${selected.part.title} · ${selected.part.role} · ${voices}`, 'composition-role'));
      body.append(element('p', `${selected.passage.evidenceLevel} · ${selected.passage.description}`, 'composition-description'));
      const details = element('details', '', 'composition-program-details');
      details.append(element('summary', 'Program behavior & dependencies'));
      details.append(element('p', `${selected.instrument.evidenceLevel} source program state · ${selected.instrument.description}`, 'composition-description'));
      const behavior = element('ul', '', 'composition-behavior');
      for (const statement of selected.instrument.behavior) behavior.append(element('li', statement));
      details.append(behavior);
      for (const dependency of selected.dependencies) {
        const description = element('p', `${dependency.evidenceLevel} · ${dependency.description} `, 'composition-dependency');
        description.append(link('Evidence ↗', dependency.sourcePath));
        details.append(description);
      }
      const listening = element('div', '', 'composition-listening');
      listening.append(button('Hear selected part in context', () => hearOccurrence(selected)));
      if (selected.comparison) {
        const comparison = selected.comparison;
        listening.append(button(`Compare ${phraseLabel(comparison.passage.title)}`, () => hearOccurrence(comparison)));
        const recurrence = selected.passage.recurrence ?? comparison.passage.recurrence;
        if (recurrence) body.append(element('p', recurrence.description, 'composition-comparison'));
      }
      body.append(listening);
      const evidence = element('div', '', 'composition-sources');
      evidence.append(link('Program evidence ↗', selected.instrument.sourcePath), link('Part evidence ↗', selected.part.sourcePath), link('Phrase evidence ↗', selected.passage.sourcePath));
      details.append(evidence);
      body.append(details);
    } else {
      body.append(element('p', 'No mapped part or program at this moment. Choose a phrase or select a mapped voice; other regions retain generic inspection.', 'composition-empty'));
    }
    const limit = element('p', 'Bands mark source execution intervals within these passages, not audible tails or isolated stems.', 'composition-limit');
    if (state.intervention) limit.textContent += ' Voice intervention active; authored listening explanations describe the full mix.';
    container.replaceChildren(heading, scope, phrases, body, limit);
    if (focusedControl) renderedButtons.get(focusedControl)?.focus();
  };
  return {
    update(next: PanelState) {
      if (next.package !== state.package) { selectionId = undefined; renderKey = ''; }
      state = next;
      render();
    },
    selectAt(timeSeconds: number, voice: number | null, mode: 'hold' | 'follow' = 'hold') {
      state = {...state, timeSeconds, voice};
      selectionId = mode === 'follow' || !state.package ? undefined : buildCompositionView(state.package, timeSeconds, voice).selected?.id ?? null;
      render();
    },
    follow() { selectionId = undefined; render(); },
    selection(): (CompositionSelection & {spans: CompositionSpan[]}) | null {
      return view?.selected ? {...occurrenceSelection(view.selected), spans: view.selected.spans} : null;
    },
  };
}
