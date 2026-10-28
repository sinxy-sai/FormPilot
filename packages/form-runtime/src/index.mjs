export function inspectForm(document) {
  return [...document.querySelectorAll('input, textarea, select')].map((element, index) => ({
    index,
    selector: selectorFor(element, index),
    label: getLabel(element),
    type: element.type || 'text',
    name: element.name || '',
    value: element.value || '',
  }));
}

export function applyFillPlan(document, plan) {
  const changes = [];
  for (const item of plan) {
    if (!item.selector || item.value == null || item.confidence === 0) continue;
    const element = document.querySelector(item.selector);
    if (!element) continue;
    changes.push({ selector: item.selector, previousValue: element.value });
    if (element.tagName?.toLowerCase() === 'select') {
      const option = [...(element.options || [])].find((candidate) => candidate.value === String(item.value) || candidate.text === String(item.value));
      if (!option) continue;
      element.value = option.value;
    } else {
      element.value = String(item.value);
    }
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return changes;
}

export function undoFillPlan(document, changes) {
  for (const change of changes) {
    const element = document.querySelector(change.selector);
    if (!element) continue;
    element.value = change.previousValue;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

function getLabel(element) {
  return element.labels?.[0]?.textContent?.trim() || element.getAttribute('aria-label') || element.getAttribute('placeholder') || element.name || '';
}

function selectorFor(element, index) {
  if (element.id) return `#${CSS.escape(element.id)}`;
  if (element.name) return `${element.tagName.toLowerCase()}[name="${CSS.escape(element.name)}"]`;
  return `${element.tagName.toLowerCase()}:nth-of-type(${index + 1})`;
}
