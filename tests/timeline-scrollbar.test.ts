import test from 'node:test';
import assert from 'node:assert/strict';
import { timelineScrollbarGeometry, timelineViewportStart } from '../src/timeline-scrollbar.ts';

test('the thumb represents the visible fraction of the whole tune', () => {
  assert.deepEqual(timelineScrollbarGeometry(200, 20, 20), {
    disabled: false, thumbFraction: 0.1, leftFraction: 0.1, maximumStart: 180,
  });
  assert.equal(timelineViewportStart(200, 20, 0), 0);
  assert.equal(timelineViewportStart(200, 20, 0.5), 90);
  assert.equal(timelineViewportStart(200, 20, 1), 180);
});

test('zoom and wider viewports change the proportional thumb without changing time coordinates', () => {
  assert.equal(timelineScrollbarGeometry(200, 10, 20).thumbFraction, 0.05);
  assert.equal(timelineScrollbarGeometry(200, 40, 20).thumbFraction, 0.2);
  assert.equal(timelineScrollbarGeometry(200, 40, 20).leftFraction, 0.1);
  assert.equal(timelineViewportStart(200, 40, 1), 160);
});

test('follow windows clamp thumb placement while preserving their nominal span', () => {
  assert.deepEqual(timelineScrollbarGeometry(200, 20, -10), {
    disabled: false, thumbFraction: 0.1, leftFraction: 0, maximumStart: 180,
  });
  assert.deepEqual(timelineScrollbarGeometry(200, 20, 190), {
    disabled: false, thumbFraction: 0.1, leftFraction: 0.9, maximumStart: 180,
  });
  assert.equal(timelineViewportStart(200, 20, -0.5), 0);
  assert.equal(timelineViewportStart(200, 20, 1.5), 180);
});

test('unknown empty and fully visible tunes use a disabled full thumb', () => {
  for (const [total, span] of [[null, 20], [0, 20], [200, 200], [200, 240]] as const) {
    assert.deepEqual(timelineScrollbarGeometry(total, span, 20), {
      disabled: true, thumbFraction: 1, leftFraction: 0, maximumStart: 0,
    });
    assert.equal(timelineViewportStart(total, span, 0.75), 0);
  }
});

test('thumb placement and usable-track dragging agree at interior and boundary starts', () => {
  for (const start of [0, 12.5, 90, 180]) {
    const geometry = timelineScrollbarGeometry(200, 20, start);
    const usableTrackProgress = geometry.leftFraction / (1 - geometry.thumbFraction);
    assert.ok(Math.abs(timelineViewportStart(200, 20, usableTrackProgress) - start) < 1e-10);
  }
});

test('invalid duration span position and drag progress are rejected explicitly', () => {
  for (const total of [-1, NaN, Infinity, -Infinity]) {
    assert.throws(() => timelineScrollbarGeometry(total, 20, 0), /total|duration/i);
    assert.throws(() => timelineViewportStart(total, 20, 0), /total|duration/i);
  }
  for (const span of [0, -1, NaN, Infinity, -Infinity]) {
    assert.throws(() => timelineScrollbarGeometry(200, span, 0), /span/i);
    assert.throws(() => timelineViewportStart(200, span, 0), /span/i);
  }
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.throws(() => timelineScrollbarGeometry(null, 20, value), /start|position/i);
    assert.throws(() => timelineViewportStart(null, 20, value), /progress/i);
  }
});
