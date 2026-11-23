const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const core = require('../docs/module_3/additive-smoothing/core.js');
const words = ['language', 'speech', 'syntax', 'meaning'];
const counts = [6, 3, 1, 0];
const close = (actual, expected, tolerance = 1e-12) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);

test('the default context presents the fixed four-word prediction vocabulary', () => {
  assert.deepEqual(core.vocabulary, words);
  assert.equal(core.defaultContext, 'study');
  assert.deepEqual(core.presets[0].counts, counts);
  assert.equal(core.presets[0].context, 'study');
});

test('alpha zero reproduces the MLE and preserves the zero-count candidate', () => {
  const result = core.distribution(words, counts, 0);
  assert.equal(result.total, 10);
  assert.equal(result.vocabularySize, 4);
  assert.equal(result.denominator, 10);
  assert.equal(result.mleDefined, true);
  assert.deepEqual(result.rows.map(row => row.word), words);
  assert.deepEqual(result.rows.map(row => row.mle), [0.6, 0.3, 0.1, 0]);
  assert.deepEqual(result.rows.map(row => row.smoothed), [0.6, 0.3, 0.1, 0]);
  assert.deepEqual(result.rows.map(row => row.reconstitutedCount), counts);
  assert.ok(result.rows.every(row => row.delta === 0 && row.pseudoCount === row.count));
});

test('Laplace smoothing adds one to every event and V to the context total', () => {
  const result = core.distribution(words, counts, 1);
  assert.equal(result.denominator, 14);
  assert.deepEqual(result.rows.map(row => row.pseudoCount), [7, 4, 2, 1]);
  [7 / 14, 4 / 14, 2 / 14, 1 / 14].forEach((p, i) => close(result.rows[i].smoothed, p));
  // An observed, below-uniform event can gain probability too.
  assert.ok(result.rows[2].delta > 0);
  assert.ok(result.rows[0].delta < 0);
  assert.ok(result.rows[3].smoothed > 0);
});

test('reconstituted Laplace counts use the original ten-token scale, not the inflated fourteen-token scale', () => {
  const result = core.distribution(words, counts, 1);
  [5, 20 / 7, 10 / 7, 5 / 7].forEach((count, i) => close(result.rows[i].reconstitutedCount, count));
  close(result.rows.reduce((sum, row) => sum + row.reconstitutedCount, 0), 10);
  assert.notEqual(result.rows[3].reconstitutedCount, result.rows[3].pseudoCount);
});

test('reconstituted counts preserve the original context total at all 101 legal UI alpha values', () => {
  for (const data of [counts, [2, 1, 0, 0], [8, 0, 0, 0]]) {
    const observedTotal = data.reduce((sum, count) => sum + count, 0);
    for (let step = 0; step <= 100; step++) {
      const result = core.distribution(words, data, step / 10);
      close(result.rows.reduce((sum, row) => sum + row.reconstitutedCount, 0), observedTotal);
      assert.ok(result.rows.every(row => row.reconstitutedCount >= 0));
    }
  }
});

test('probabilities sum to one across sparse contexts and smoothing strengths', () => {
  for (const data of [[6, 3, 1, 0], [0, 1, 0, 0], [0, 0, 0, 0], [2, 2, 2, 2]]) {
    for (const alpha of [0.01, 0.1, 0.5, 1, 10, 100]) {
      const result = core.distribution(words, data, alpha);
      close(result.rows.reduce((sum, row) => sum + row.smoothed, 0), 1);
      assert.ok(result.rows.every(row => row.smoothed > 0 && row.smoothed <= 1));
    }
  }
});

test('increasing alpha draws each probability toward uniform without reordering the vocabulary', () => {
  let distances = counts.map(count => Math.abs(count / 10 - 0.25));
  for (const alpha of [0.1, 0.5, 1, 10, 1000]) {
    const result = core.distribution(words, counts, alpha);
    assert.deepEqual(result.rows.map(row => row.word), words);
    result.rows.forEach((row, i) => {
      const distance = Math.abs(row.smoothed - 0.25);
      assert.ok(distance <= distances[i]);
      distances[i] = distance;
    });
    assert.ok(result.rows.every((row, i, rows) => i === 0 || rows[i - 1].smoothed >= row.smoothed));
  }
});

test('omitted Map/object entries are zero counts, while V remains the full fixed vocabulary', () => {
  for (const data of [new Map([['speech', 3], ['language', 6], ['syntax', 1]]),
                      {speech: 3, syntax: 1, language: 6}]) {
    const result = core.distribution(words, data, 1);
    assert.equal(result.vocabularySize, 4);
    assert.equal(result.denominator, 14);
    assert.equal(result.rows[3].count, 0);
    close(result.rows[3].smoothed, 1 / 14);
  }
});

test('an unseen context has undefined MLE; positive alpha alone gives a uniform distribution', () => {
  const unsmoothed = core.distribution(words, {}, 0);
  assert.equal(unsmoothed.total, 0);
  assert.equal(unsmoothed.denominator, 0);
  assert.equal(unsmoothed.mleDefined, false);
  assert.ok(unsmoothed.rows.every(row => row.mle === null && row.smoothed === null && row.delta === null && row.reconstitutedCount === null));
  for (const alpha of [0.1, 1, 10]) {
    const result = core.distribution(words, {}, alpha);
    assert.equal(result.mleDefined, false);
    assert.ok(result.rows.every(row => row.mle === null && row.delta === null && row.smoothed === 0.25));
    assert.ok(result.rows.every(row => row.reconstitutedCount === 0));
  }
});

test('a single-word prediction vocabulary is valid, including an unseen context', () => {
  assert.equal(core.distribution(['word'], [4], 0).rows[0].smoothed, 1);
  assert.equal(core.distribution(['word'], [0], 0.5).rows[0].smoothed, 1);
});

test('calculating distributions never mutates array, Map or object inputs', () => {
  const frozenWords = Object.freeze(words.slice());
  const frozenCounts = Object.freeze(counts.slice());
  const objectCounts = Object.freeze({language: 6, speech: 3, syntax: 1});
  const mapCounts = new Map(Object.entries(objectCounts));
  for (const data of [frozenCounts, objectCounts, mapCounts]) {
    const before = data instanceof Map ? [...data] : JSON.stringify(data);
    const result = core.distribution(frozenWords, data, 0.5);
    result.rows[0].count = 999;
    assert.deepEqual(data instanceof Map ? [...data] : JSON.stringify(data), before);
    assert.deepEqual(frozenWords, words);
  }
});

test('invalid vocabularies are rejected', () => {
  for (const invalid of [null, 'word', [], [''], ['  '], ['word', 'word'], ['word', 3], Array(1)]) {
    assert.throws(() => core.distribution(invalid, {}, 1));
  }
});

test('invalid counts and words outside the fixed vocabulary are rejected', () => {
  for (const invalid of [null, undefined, '6,3,1,0', [], [6, 3, 1], [6, 3, 1, 0, 0],
                         [6, -1, 1, 0], [6, 0.5, 1, 0], [6, NaN, 1, 0],
                         [6, Infinity, 1, 0], [6, '3', 1, 0], Array(4),
                         {language: -1}, {language: undefined}, {unlisted: 0},
                         new Map([['unlisted', 1]]), new Date()]) {
    assert.throws(() => core.distribution(words, invalid, 1));
  }
  assert.throws(() => core.distribution(words, {[Symbol('word')]: 1}, 1));
  assert.throws(() => core.distribution(words, [Number.MAX_SAFE_INTEGER, 1, 0, 0], 1));
});

test('invalid alpha values and unrepresentable arithmetic are rejected', () => {
  for (const alpha of [-1, NaN, Infinity, -Infinity, null, undefined, '1']) {
    assert.throws(() => core.distribution(words, counts, alpha));
  }
  assert.throws(() => core.distribution(words, counts, Number.MAX_VALUE), /denominator/);
});

test('the same core exposes SmoothingCore in a browser without CommonJS', () => {
  const browser = vm.createContext({});
  vm.runInContext(readFileSync(require.resolve('../docs/module_3/additive-smoothing/core.js'), 'utf8'), browser);
  assert.equal(typeof browser.SmoothingCore.distribution, 'function');
  const result = browser.SmoothingCore.distribution(words, counts, 1);
  close(result.rows[3].smoothed, 1 / 14);
});
