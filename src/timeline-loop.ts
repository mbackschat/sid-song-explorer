export type LoopRange = {start: number; end: number};
export type LoopMarkers = {start: number | null; end: number | null};

type Viewport = {start: number; end: number};
type Boundary = 'start' | 'end';
type Edit = {
  boundary: Boundary;
  original: LoopMarkers;
  range: LoopMarkers;
  viewport: Viewport;
  limit: number;
  minimumLength: number;
  pointerId: number | null;
  pointerOffset: number;
};

function sameRange(left: LoopMarkers | null, right: LoopMarkers | null): boolean {
  return left === right || (left !== null && right !== null && left.start === right.start && left.end === right.end);
}

function minimumLength(markers: LoopMarkers): number {
  return markers.start !== null && markers.end !== null ? Math.min(0.01, markers.end - markers.start) : 0.01;
}

function boundaryBounds(markers: LoopMarkers, boundary: Boundary, minimum: number, limit: number) {
  return {
    minimum: boundary === 'end' && markers.start !== null ? markers.start + minimum : 0,
    maximum: boundary === 'start' && markers.end !== null ? markers.end - minimum : limit,
  };
}

function validMarkers(markers: LoopMarkers | null, limit: number): markers is LoopMarkers {
  if (!markers || !Number.isFinite(limit) || limit < 0) return false;
  const validBoundary = (value: number | null) => value === null || (Number.isFinite(value) && value >= 0 && value <= limit);
  return (markers.start !== null || markers.end !== null)
    && validBoundary(markers.start) && validBoundary(markers.end)
    && (markers.start === null || markers.end === null || markers.end > markers.start);
}

export function mountTimelineLoop(root: HTMLElement, actions: {
  onPreview: () => void;
  onCommit: (loop: LoopMarkers) => void;
  formatTime: (seconds: number) => string;
}) {
  const document = root.ownerDocument;
  const bracket = document.createElement('div');
  bracket.className = 'timeline-loop-bracket';
  bracket.setAttribute('aria-hidden', 'true');
  root.classList.add('timeline-loop');
  function createHandle(boundary: Boundary) {
    const handle = document.createElement('button');
    handle.className = `timeline-loop-handle timeline-loop-${boundary}`;
    handle.dataset.boundary = boundary;
    handle.type = 'button';
    handle.textContent = boundary === 'start' ? 'A' : 'B';
    handle.setAttribute('role', 'slider');
    handle.setAttribute('aria-label', `Loop ${boundary} (${handle.textContent})`);
    handle.setAttribute('aria-orientation', 'horizontal');
    return handle;
  }
  const handles = {start: createHandle('start'), end: createHandle('end')};
  root.append(bracket, handles.start, handles.end);

  let currentLoop: LoopMarkers | null = null;
  let currentViewport: Viewport = {start: 0, end: 1};
  let currentLimit = 0;
  let disabled = true;
  let edit: Edit | null = null;

  function render() {
    const range = edit?.range ?? currentLoop;
    const viewport = edit?.viewport ?? currentViewport;
    root.hidden = range === null;
    root.dataset.dragging = String(edit !== null);
    for (const boundary of ['start', 'end'] as const) handles[boundary].disabled = disabled || range?.[boundary] === null;
    if (!range) {
      for (const flag of ['compact', 'startEdge', 'endEdge', 'staggered']) root.dataset[flag] = 'false';
      bracket.hidden = true;
      handles.start.hidden = true;
      handles.end.hidden = true;
      return;
    }
    const fraction = (time: number) => (time - viewport.start) / (viewport.end - viewport.start);
    const start = range.start === null ? null : fraction(range.start);
    const end = range.end === null ? null : fraction(range.end);
    const width = root.getBoundingClientRect().width;
    const startVisible = start !== null && start >= 0 && start <= 1;
    const endVisible = end !== null && end >= 0 && end <= 1;
    const compact = start !== null && end !== null && (end - start) * width < 40;
    const startEdge = start !== null && startVisible && start * width < 20;
    const endEdge = end !== null && endVisible && (1 - end) * width < 20;
    root.dataset.compact = String(compact);
    root.dataset.startEdge = String(startEdge);
    root.dataset.endEdge = String(endEdge);
    root.dataset.staggered = String(compact && (startEdge || endEdge));
    bracket.hidden = start === null || end === null || end < 0 || start > 1;
    bracket.style.left = `${start === null ? 0 : Math.max(0, Math.min(1, start)) * 100}%`;
    bracket.style.width = `${start === null || end === null ? 0 : Math.max(0, Math.min(1, end) - Math.max(0, start)) * 100}%`;
    bracket.dataset.startVisible = String(startVisible);
    bracket.dataset.endVisible = String(endVisible);
    const minimum = edit?.minimumLength ?? minimumLength(range);
    for (const boundary of ['start', 'end'] as const) {
      const handle = handles[boundary];
      handle.hidden = boundary === 'start' ? !startVisible : !endVisible;
      const value = range[boundary];
      if (value === null) continue;
      const bounds = boundaryBounds(range, boundary, minimum, currentLimit);
      handle.style.left = `${fraction(value) * 100}%`;
      handle.setAttribute('aria-valuemin', String(bounds.minimum));
      handle.setAttribute('aria-valuemax', String(bounds.maximum));
      handle.setAttribute('aria-valuenow', String(value));
      handle.setAttribute('aria-valuetext', actions.formatTime(value));
      handle.title = `Loop ${boundary}: ${actions.formatTime(value)}`;
    }
  }

  function releaseEdit(): Edit | null {
    const previous = edit;
    edit = null;
    if (previous && previous.pointerId !== null) {
      const handle = handles[previous.boundary];
      if (handle.hasPointerCapture(previous.pointerId)) handle.releasePointerCapture(previous.pointerId);
    }
    return previous;
  }

  function cancel(notify = true) {
    if (!releaseEdit()) return;
    render();
    if (notify) actions.onPreview();
  }

  function begin(boundary: Boundary, pointerId: number | null): boolean {
    if (disabled || !currentLoop || currentLoop[boundary] === null || edit) return false;
    edit = {
      boundary,
      original: {...currentLoop},
      range: {...currentLoop},
      viewport: {...currentViewport},
      limit: currentLimit,
      minimumLength: minimumLength(currentLoop),
      pointerId,
      pointerOffset: 0,
    };
    return true;
  }

  function preview(value: number) {
    if (!edit) return;
    const bounds = boundaryBounds(edit.range, edit.boundary, edit.minimumLength, edit.limit);
    const next = Math.max(bounds.minimum, Math.min(bounds.maximum, value));
    if (next === edit.range[edit.boundary]) return;
    edit.range[edit.boundary] = next;
    render();
    actions.onPreview();
  }

  function timeAt(clientX: number): number | null {
    if (!edit) return null;
    const rect = root.getBoundingClientRect();
    if (rect.width <= 0 || !Number.isFinite(clientX)) return null;
    return edit.viewport.start + (clientX - rect.left) / rect.width * (edit.viewport.end - edit.viewport.start);
  }

  function movePointer(event: PointerEvent) {
    if (edit?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const time = timeAt(event.clientX);
    if (time !== null) preview(time - edit.pointerOffset);
  }

  function commit() {
    const previous = releaseEdit();
    if (!previous) return;
    const changed = !sameRange(previous.original, previous.range);
    if (changed) currentLoop = {...previous.range};
    render();
    if (changed) actions.onCommit({...previous.range});
    actions.onPreview();
  }

  for (const boundary of ['start', 'end'] as const) {
    const handle = handles[boundary];
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !event.isPrimary || !begin(boundary, event.pointerId)) return;
      const time = timeAt(event.clientX);
      if (time === null) { cancel(false); return; }
      edit!.pointerOffset = time - edit!.original[boundary]!;
      event.preventDefault();
      event.stopPropagation();
      handle.focus();
      handle.setPointerCapture(event.pointerId);
      render();
      actions.onPreview();
    });
    handle.addEventListener('pointermove', movePointer);
    handle.addEventListener('pointerup', event => {
      if (edit?.pointerId !== event.pointerId) return;
      movePointer(event);
      commit();
    });
    for (const eventName of ['pointercancel', 'lostpointercapture'] as const) {
      handle.addEventListener(eventName, event => {
        if (edit?.pointerId !== event.pointerId) return;
        event.stopPropagation();
        cancel();
      });
    }
    handle.addEventListener('keydown', event => {
      if (event.key === 'Escape' && edit) {
        event.preventDefault();
        event.stopPropagation();
        cancel();
        return;
      }
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (edit && (edit.pointerId !== null || edit.boundary !== boundary)) return;
      if (!edit && !begin(boundary, null)) return;
      event.preventDefault();
      event.stopPropagation();
      preview(edit!.range[boundary]! + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 1 : 0.1));
    });
    handle.addEventListener('keyup', event => {
      if (edit?.pointerId !== null || edit.boundary !== boundary || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
      event.preventDefault();
      event.stopPropagation();
      commit();
    });
    handle.addEventListener('blur', () => { if (edit?.pointerId === null && edit.boundary === boundary) cancel(); });
    handle.addEventListener('click', event => event.stopPropagation());
  }

  render();
  return {
    update(loop: LoopMarkers | null, viewport: Viewport, limit: number, nextDisabled: boolean) {
      const validViewport = Number.isFinite(viewport.start) && Number.isFinite(viewport.end) && viewport.end > viewport.start;
      const nextLoop = validViewport && validMarkers(loop, limit) ? loop : null;
      if (edit && (nextDisabled || !sameRange(nextLoop, edit.original) || limit !== edit.limit)) cancel(false);
      currentLoop = nextLoop === null ? null : {...nextLoop};
      if (validViewport) currentViewport = {...viewport};
      currentLimit = limit;
      disabled = nextDisabled || nextLoop === null;
      render();
    },
    draft: (): LoopMarkers | null => edit ? {...edit.range} : null,
    viewport: (): Viewport | null => edit ? {...edit.viewport} : null,
    cancel: () => cancel(),
  };
}
