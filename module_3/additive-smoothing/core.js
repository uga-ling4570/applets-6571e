/* Additive smoothing for one context over an explicit, fixed prediction vocabulary. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SmoothingCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const vocabulary = Object.freeze(['language', 'speech', 'syntax', 'meaning']);
  const defaultContext = 'study';
  const presets = Object.freeze([
    Object.freeze({
      id: defaultContext,
      context: defaultContext,
      label: 'After study',
      counts: Object.freeze([6, 3, 1, 0]),
    }),
  ]);

  function validateVocabulary(words) {
    if (!Array.isArray(words) || !words.length ||
        Array.from(words).some(word => typeof word !== 'string' || !word.trim())) {
      throw new TypeError('Use a non-empty vocabulary of non-empty word labels.');
    }
    if (new Set(words).size !== words.length) {
      throw new RangeError('Each word must appear only once in the vocabulary.');
    }
  }

  function readCounts(words, counts) {
    const known = new Set(words);
    let values;
    if (Array.isArray(counts)) {
      if (counts.length !== words.length) {
        throw new RangeError('The counts array must have one entry per vocabulary word.');
      }
      values = Array.from(counts);
    } else if (counts instanceof Map) {
      for (const word of counts.keys()) {
        if (!known.has(word)) throw new RangeError('Counts contain a word outside the fixed vocabulary.');
      }
      values = words.map(word => counts.has(word) ? counts.get(word) : 0);
    } else if (counts !== null && typeof counts === 'object' &&
               (Object.getPrototypeOf(counts) === Object.prototype || Object.getPrototypeOf(counts) === null)) {
      for (const word of Reflect.ownKeys(counts)) {
        if (!known.has(word)) throw new RangeError('Counts contain a word outside the fixed vocabulary.');
      }
      values = words.map(word => Object.prototype.hasOwnProperty.call(counts, word) ? counts[word] : 0);
    } else {
      throw new TypeError('Use a counts array, a Map, or a plain object keyed by vocabulary word.');
    }
    if (values.some(count => !Number.isSafeInteger(count) || count < 0)) {
      throw new RangeError('Counts must be non-negative safe integers.');
    }
    return values;
  }

  /**
   * Counts belong to one prediction context, not the whole corpus. Missing Map/object
   * entries are zero counts inside the fixed vocabulary; outside words are rejected.
   * An unobserved context has no MLE. Its smoothed distribution is uniform only for
   * alpha > 0; with alpha = 0 both probabilities are undefined (represented by null).
   */
  function distribution(words, counts, alpha) {
    validateVocabulary(words);
    if (!Number.isFinite(alpha) || alpha < 0) {
      throw new RangeError('Alpha must be a finite number greater than or equal to zero.');
    }
    const values = readCounts(words, counts);
    const total = values.reduce((sum, count) => sum + count, 0);
    if (!Number.isSafeInteger(total)) {
      throw new RangeError('The total count is too large to represent exactly.');
    }
    const vocabularySize = words.length;
    const denominator = total + alpha * vocabularySize;
    if (!Number.isFinite(denominator)) {
      throw new RangeError('Alpha is too large to calculate a finite denominator.');
    }
    const mleDefined = total > 0;
    const rows = words.map((word, index) => {
      const count = values[index];
      const pseudoCount = count + alpha;
      const mle = mleDefined ? count / total : null;
      const smoothed = denominator > 0 ? pseudoCount / denominator : null;
      const delta = mle !== null && smoothed !== null ? smoothed - mle : null;
      // Express the smoothed probability on the original context's count scale.
      const reconstitutedCount = smoothed === null ? null : total * smoothed;
      return {word, count, pseudoCount, mle, smoothed, delta, reconstitutedCount};
    });
    return {rows, total, vocabularySize, alpha, denominator, mleDefined};
  }

  return {vocabulary, defaultContext, presets, distribution};
});
