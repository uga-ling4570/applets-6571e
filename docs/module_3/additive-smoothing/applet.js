(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const vocabulary = ['language', 'speech', 'syntax', 'meaning'];
  const counts = [6, 3, 1, 0];
  let current;
  const number = value => Number(value.toFixed(4)).toString();
  const percentage = value => `${(value * 100).toFixed(2)}%`;

  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function renderChart(host, property) {
    host.replaceChildren();
    for (const row of current.rows) {
      const wrapper = node('div', undefined, 'smoothing-bar-row');
      const label = node('div', undefined, 'smoothing-bar-label');
      label.append(node('span', row.word), node('span', percentage(row[property])));
      const track = node('div', undefined, 'smoothing-bar-track');
      track.setAttribute('aria-hidden', 'true');
      const fill = node('span', undefined, 'smoothing-bar-fill');
      fill.style.width = `${row[property] * 100}%`;
      track.append(fill);
      wrapper.append(label, track);
      host.append(wrapper);
    }
  }

  function renderFormula() {
    const row = current.rows.find(item => item.word === $('word-selection').value);
    $('worked-formula').textContent = `P(${row.word} | study) = (${row.count} + ${number(current.alpha)}) / (${current.total} + ${number(current.alpha)} × ${current.vocabularySize}) = ${number(row.pseudoCount)} / ${number(current.denominator)} ≈ ${row.smoothed.toFixed(4)} (${percentage(row.smoothed)}).`;
    $('worked-reconstituted').textContent = `Reconstituted count for ${row.word} = N × Pα(${row.word} | study) = ${current.total} × (${number(row.pseudoCount)} / ${number(current.denominator)}) ≈ ${number(row.reconstitutedCount)} (original count: ${row.count}).`;
  }

  function render() {
    renderChart($('mle-chart'), 'mle');
    renderChart($('smoothed-chart'), 'smoothed');
    $('current-alpha').textContent = `Charts show α = ${number(current.alpha)}${current.alpha === 0 ? ' (MLE)' : current.alpha === 1 ? ' (Laplace smoothing)' : ''}.`;
    $('observed-total').textContent = current.total;
    $('vocabulary-size').textContent = current.vocabularySize;
    $('denominator').textContent = `${current.total} + ${number(current.alpha)} × ${current.vocabularySize} = ${number(current.denominator)}`;
    const meaning = current.rows.find(row => row.word === 'meaning');
    $('distribution-insight').textContent = current.alpha === 0
      ? 'Meaning has count 0, so its MLE probability is 0%. Increase α to give this unseen pair a positive probability.'
      : `Meaning now has probability ${percentage(meaning.smoothed)} despite its zero observed count. Increasing α pulls every probability toward 25%; low-frequency observed words can increase too.`;
    const body = $('distribution-rows');
    body.replaceChildren();
    for (const row of current.rows) {
      const tr = node('tr');
      const heading = node('th', row.word);
      heading.scope = 'row';
      tr.append(heading);
      for (const value of [row.count, number(row.pseudoCount), percentage(row.mle), percentage(row.smoothed), number(row.reconstitutedCount)]) tr.append(node('td', value));
      body.append(tr);
    }
    $('table-count-total').textContent = current.total;
    $('table-pseudo-total').textContent = number(current.denominator);
    $('table-mle-total').textContent = percentage(current.rows.reduce((sum, row) => sum + row.mle, 0));
    $('table-smoothed-total').textContent = percentage(current.rows.reduce((sum, row) => sum + row.smoothed, 0));
    $('table-reconstituted-total').textContent = current.total;
    document.querySelectorAll('[data-alpha]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.alpha) === current.alpha)));
    renderFormula();
  }

  function applyAlpha(value, { announce = false, updateNumber = false } = {}) {
    const raw = String(value).trim();
    const alpha = raw === '' ? NaN : Number(raw);
    let error = '';
    if (!Number.isFinite(alpha)) error = 'Enter an α value from 0 to 10. The charts retain the last valid value.';
    else if (alpha < 0 || alpha > 10) error = 'α must be from 0 to 10. The charts retain the last valid value.';
    else if (Math.abs(alpha * 10 - Math.round(alpha * 10)) > 1e-9) error = 'Use α in steps of 0.1. The charts retain the last valid value.';
    if (error) {
      if ($('error').textContent !== error) $('error').textContent = error;
      $('alpha').setAttribute('aria-invalid', 'true');
      $('parameter-status').textContent = '';
      return false;
    }
    $('error').textContent = '';
    $('alpha').setAttribute('aria-invalid', 'false');
    if (updateNumber) $('alpha').value = number(alpha);
    $('alpha-slider').value = alpha;
    current = window.SmoothingCore.distribution(vocabulary, counts, alpha);
    render();
    if (announce) $('parameter-status').textContent = `α is ${number(alpha)}. Probabilities updated; their sum is 100%.`;
    return true;
  }

  $('alpha').addEventListener('input', () => applyAlpha($('alpha').value));
  $('alpha').addEventListener('change', () => applyAlpha($('alpha').value, { announce: true }));
  $('alpha-slider').addEventListener('input', () => applyAlpha($('alpha-slider').value, { updateNumber: true }));
  $('alpha-slider').addEventListener('change', () => applyAlpha($('alpha-slider').value, { announce: true, updateNumber: true }));
  document.querySelectorAll('[data-alpha]').forEach(button => button.addEventListener('click', () => applyAlpha(button.dataset.alpha, { announce: true, updateNumber: true })));
  $('word-selection').addEventListener('change', renderFormula);

  const explanations = {
    1: 'Each of V candidate counts receives α, so the sum of the new counts is N + αV. For example, when α = 1, adding one to each candidate adds 4 pseudo-counts in total, changing the denominator from 10 to 14.',
    2: 'When α dominates the observed counts, each probability approaches α / (αV) = 1/V. With four candidates that is 25% each. A finite α moves the distribution toward uniformity; it does not make these unequal counts exactly equal.'
  };

  function resetQuestion(id, focus = false) {
    const form = $(`quiz-${id}`);
    form.reset();
    form.querySelectorAll('input').forEach(input => { input.disabled = false; });
    $(`quiz-${id}-group`).setAttribute('aria-invalid', 'false');
    $(`quiz-${id}-check`).hidden = false;
    $(`quiz-${id}-retry`).hidden = true;
    $(`quiz-${id}-feedback`).textContent = '';
    if (focus) form.querySelector('input').focus();
  }

  for (const id of [1, 2]) {
    const form = $(`quiz-${id}`);
    const group = $(`quiz-${id}-group`);
    form.addEventListener('change', () => {
      if (group.getAttribute('aria-invalid') === 'true') {
        group.setAttribute('aria-invalid', 'false');
        $(`quiz-${id}-feedback`).textContent = '';
      }
    });
    form.addEventListener('submit', event => {
      event.preventDefault();
      const selected = form.querySelector('input:checked');
      const feedback = $(`quiz-${id}-feedback`);
      if (!selected) {
        group.setAttribute('aria-invalid', 'true');
        feedback.textContent = 'Choose an answer before checking.';
        form.querySelector('input').focus();
        return;
      }
      group.setAttribute('aria-invalid', 'false');
      feedback.textContent = `${selected.value === 'correct' ? 'Correct.' : 'Not quite.'} ${explanations[id]}`;
      form.querySelectorAll('input').forEach(input => { input.disabled = true; });
      $(`quiz-${id}-check`).hidden = true;
      $(`quiz-${id}-retry`).hidden = false;
      $(`quiz-${id}-retry`).focus();
    });
    $(`quiz-${id}-retry`).addEventListener('click', () => resetQuestion(id, true));
  }

  $('reset').addEventListener('click', () => {
    $('word-selection').value = vocabulary[0];
    resetQuestion(1);
    resetQuestion(2);
    applyAlpha('0', { updateNumber: true });
    $('parameter-status').textContent = 'Activity reset. α is 0 and both practice questions are unanswered.';
    $('alpha').focus();
  });
  applyAlpha('0', { updateNumber: true });
})();
