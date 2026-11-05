// control-executor.test.mjs — fill engine v2 execution layer (contract §5/§7/§9).
//
// The suite is built on the shared dom-twin (`extension/test/support/dom-twin.mjs`,
// produced by the page-inspector task) plus real-page-shaped builders that follow
// docs/recon/bytedance-resume-edit.md:
//   - .ud__select 下拉：input[role=combobox] inside .ud__select__selector,
//     display value in .ud__select__selector__selectItem (input.value stays ""),
//     options .ud__select__list__item > __content inside .ud__select__dropdown,
//     virtualised by .rc-virtual-list-holder, popup stays in the DOM after close
//     (ud-slide-up-leave) so closing must be judged by visibility.
//   - start_end_time = two plain text inputs (YYYY-MM), "至今" is typed as text.
//   - award date = year picker input.ud__picker-input[placeholder="YYYY"].
//   - repeatable modules = [class*="applyFormModuleWrapper"], cards
//     [class*="apply-form-array-card__"], add button apply-form-array-card-add,
//     delete button apply-form-array-card-delete (must never be clicked).
//
// Run with:
//   node --test --test-isolation=none extension/test/control-executor.test.mjs
// (`node --test` without --test-isolation spawns children and EPERMs in this sandbox.)

import test from 'node:test';
import assert from 'node:assert/strict';

import { createBytedanceTwin, createDocument, h, queryAllDeep, ACTION_SELECTOR, CONTROL_SELECTOR } from './support/dom-twin.mjs';
import { inspectPage } from '../src/runtime/page-inspector.mjs';
import {
  executeAction,
  executeStep,
  getUndoLog,
  undoLastFill
} from '../src/runtime/control-executor.mjs';

// ---------------------------------------------------------------------------
// Harness: build a page on dom-twin and derive a PageModel from the live DOM.
// (The executor only needs controlId + selectorToken; the real inspector is
// exercised by page-inspector.test.mjs / fill-e2e.test.mjs.)
// ---------------------------------------------------------------------------

function createHarness() {
  const document = createDocument({
    title: 'FormPilot executor test',
    location: { origin: 'https://jobs.bytedance.com', pathname: '/experienced/resume/edit' }
  });
  const registrations = [];
  const sections = [];
  const actions = [];
  const eventLog = new Map();

  const register = (element, meta) => {
    registrations.push({ element, meta });
    return element;
  };

  const trackEvents = element => {
    const types = [];
    eventLog.set(element, types);
    for (const type of ['input', 'change', 'blur', 'focus', 'focusout', 'click']) {
      element.addEventListener(type, () => types.push(type));
    }
    return types;
  };

  const model = () => {
    // page-inspector contract: control-token-<n> indexes the control query AFTER
    // dropping file inputs (the attachment does not occupy a control slot).
    const raw = queryAllDeep(document, CONTROL_SELECTOR);
    const withoutFiles = raw.filter(element => !(element.localName === 'input' && String(element.type || '').toLowerCase() === 'file'));
    return {
      pageIdentity: { origin: document.location.origin, route: document.location.pathname, title: document.title },
      sections: sections.map(section => ({
        id: section.id,
        label: section.label,
        repeatable: Boolean(section.repeatable),
        itemCount: section.countItems ? section.countItems() : Number(section.itemCount ?? 0)
      })),
      controls: registrations.map(({ element, meta }) => {
        const index = withoutFiles.indexOf(element);
        return {
          controlId: meta.controlId,
          ...(index >= 0 ? { selectorToken: `control-token-${index}` } : {}),
          label: meta.label ?? '',
          role: meta.controlType === 'combobox' ? 'combobox' : 'textbox',
          controlType: meta.controlType,
          value: meta.controlType === 'checkbox' ? Boolean(element.checked) : String(element.value ?? ''),
          visible: true,
          disabled: false,
          readonly: Boolean(element.readOnly),
          ...(meta.sectionId ? { sectionId: meta.sectionId } : {}),
          ...(meta.fieldKey ? { fieldKey: meta.fieldKey } : {}),
          ...(meta.itemRole ? { itemRole: meta.itemRole } : {}),
          ...(meta.dateFormat ? { dateFormat: meta.dateFormat } : {}),
          ...(meta.itemIndex === undefined ? {} : { itemIndex: meta.itemIndex })
        };
      }),
      actions: actions.map(action => ({ ...action })),
      dialogs: []
    };
  };

  const contextFor = (extra = {}) => ({ pageModel: model(), inspectPage: () => model(), ...extra });

  return { document, register, trackEvents, sections, actions, model, contextFor, eventLog };
}

function addSection(harness, { id, label, repeatable = false, itemCount = 0, countItems }) {
  harness.sections.push({ id, label, repeatable, itemCount, ...(countItems ? { countItems } : {}) });
  return id;
}

// ---- real-page-shaped elements -------------------------------------------

function formilyText({ fieldName, labelText, value = '', placeholder = '', type = 'text', readOnly = false, multiline = false }) {
  const control = multiline
    ? h('textarea', { class: 'ud-scrollbar ud-typography-body-0', props: { value } })
    : h('input', {
      class: 'ud__native-input',
      attrs: { type, placeholder: placeholder || undefined },
      props: { value },
      ...(readOnly ? { attrs: { type, placeholder: placeholder || undefined, readonly: '' } } : {})
    });
  const wrapper = multiline
    ? control
    : h('div', { class: 'ud__input' }, [
      h('label', { class: 'ud__input-input-wrap' }, [
        h('div', { class: 'ud__input-input__placeholder__wrapper' }, [control])
      ])
    ]);
  return h('div', {
    class: 'ud-formily-item',
    attrs: { 'data-form-field-name': fieldName, 'data-form-field-i18n-name': labelText }
  }, [
    h('div', { class: 'ud-formily-item-label' }, [
      h('div', { class: 'ud-formily-item-label-content' }, [h('span', {}, [h('label', { text: labelText })])])
    ]),
    h('div', { class: 'ud-formily-item-control' }, [
      h('div', { class: 'ud-formily-item-control-content' }, [
        h('div', { class: 'ud-formily-item-control-content-component' }, [wrapper])
      ])
    ])
  ]);
}

function textInputFor(harness, { controlId, label = '', sectionId, fieldKey, value = '', readOnly = false, multiline = false }) {
  const field = formilyText({ fieldName: fieldKey || controlId, labelText: label || controlId, value, readOnly, multiline });
  const element = field.querySelector('input, textarea');
  harness.register(element, { controlId, controlType: multiline ? 'textarea' : 'text', label, sectionId, fieldKey });
  return { field, element };
}

/**
 * Real .ud__select structure + behaviour (open on click of the selector,
 * mousedown+click tolerated, popup kept in the DOM with a leave class when
 * closed, optional rc-virtual-list rendering window).
 */
function udSelect(harness, { controlId, labelText = '下拉', sectionId, fieldKey, displayText = '', displayValue = '', options = [], multi = false, virtual = 0 }) {
  const selectItem = h('div', { class: 'ud__select__selector__selectItem', text: displayText });
  const searchInput = h('input', {
    class: 'ud__select__selector__search__input ud__native-input',
    attrs: { role: 'combobox', type: 'search', ...(multi ? {} : { readonly: '' }) },
    props: { value: '' }
  });
  const selector = h('div', {
    class: 'ud__select__selector ud__select__selector-lg',
    attrs: { 'aria-expanded': 'false' }
  }, [
    h('div', { class: 'ud__select__selector__content' }, [
      selectItem,
      h('div', { class: 'ud__select__selector__search' }, [searchInput])
    ]),
    h('div', { class: 'ud__select__selector__arrow', text: '▾' })
  ]);
  const root = h('div', { class: 'ud__select select__1A5Um' }, [selector]);
  const field = h('div', {
    class: 'ud-formily-item',
    attrs: { 'data-form-field-name': fieldKey || controlId, 'data-form-field-i18n-name': labelText }
  }, [
    h('div', { class: 'ud-formily-item-label' }, [
      h('div', { class: 'ud-formily-item-label-content' }, [h('span', {}, [h('label', { text: labelText })])])
    ]),
    h('div', { class: 'ud-formily-item-control' }, [
      h('div', { class: 'ud-formily-item-control-content' }, [
        h('div', { class: 'ud-formily-item-control-content-component' }, [root])
      ])
    ])
  ]);

  let dropdown = null;
  let rendered = 0;
  let opened = false;

  const close = () => {
    if (!dropdown) return;
    opened = false;
    selector.setAttribute('aria-expanded', 'false');
    dropdown.classList.add('ud-slide-up-leave');
    dropdown.style.display = 'none';
  };
  const itemFor = spec => {
    const item = h('div', { class: 'ud__select__list__item', attrs: { 'data-value': spec.value } }, [
      h('div', { class: 'ud__select__list__item__content ud__textOverflow' }, [h('span', {}, [h('span', { text: spec.label })])]),
      h('div', { class: 'ud__select__list__item__check' })
    ]);
    item.addEventListener('click', () => {
      if (multi) {
        if (!root.querySelector(`[data-tag-value="${spec.value}"]`)) {
          const tag = h('span', { class: 'ud__tag ud__select__selector__tag', attrs: { 'data-tag-value': spec.value }, text: spec.label });
          selector.insertBefore(tag, selector.querySelector('.ud__select__selector__content'));
        }
        return;
      }
      selectItem.textContent = spec.label;
      selectItem.setAttribute('data-value', spec.value);
      selector.setAttribute('data-value', spec.value);
      close();
    });
    return item;
  };
  const renderBatch = (inner, holder) => {
    const batch = virtual > 0 ? virtual : options.length;
    const next = options.slice(rendered, rendered + batch).map(itemFor);
    for (const item of next) inner.appendChild(item);
    rendered += next.length;
    if (virtual > 0) holder.scrollTop = rendered * 40;
  };
  const open = () => {
    if (opened) return;
    opened = true;
    selector.setAttribute('aria-expanded', 'true');
    const inner = h('div', { class: 'rc-virtual-list-holder-inner' });
    const holder = h('div', { class: 'rc-virtual-list-holder', attrs: { style: 'max-height:240px;overflow-y:hidden' } }, [inner]);
    dropdown = h('div', { class: 'ud__select__dropdown ud__select__dropdown-placement-bottomLeft' }, [
      h('div', {}, [
        h('div', { class: 'ud__select__list' }, [
          h('div', { class: 'ud__select__list__menu' }, [
            h('div', { class: 'rc-virtual-list' }, [holder])
          ])
        ])
      ])
    ]);
    rendered = 0;
    renderBatch(inner, holder);
    if (virtual > 0) {
      holder.addEventListener('scroll', () => renderBatch(inner, holder));
    }
    root.appendChild(dropdown);
  };

  selector.addEventListener('click', () => {
    if (opened) { close(); return; }
    open();
  });
  selector.addEventListener('mousedown', () => {});
  harness.document.addEventListener('click', event => {
    if (!opened) return;
    const target = event.target;
    if (target === selector || selector.contains(target)) return;
    if (dropdown && dropdown.contains(target)) return;
    close();
  });
  harness.document.addEventListener('keydown', event => {
    if (event.key === 'Escape') close();
  });

  harness.register(searchInput, { controlId, controlType: 'combobox', label: labelText, sectionId, fieldKey });
  return { field, root, selector, selectItem, searchInput, isOpen: () => opened };
}

function dateRangeFields(harness, { fieldKey = 'start_end_time', labelText = '起止时间', sectionId } = {}) {
  const start = h('input', { class: 'ud__native-input', attrs: { type: 'text' }, props: { value: '' } });
  const end = h('input', { class: 'ud__native-input', attrs: { type: 'text' }, props: { value: '' } });
  const field = h('div', {
    class: 'ud-formily-item',
    attrs: { 'data-form-field-name': fieldKey, 'data-form-field-i18n-name': labelText }
  }, [
    h('div', { class: 'ud-formily-item-label' }, [
      h('div', { class: 'ud-formily-item-label-content' }, [h('span', {}, [h('label', { text: labelText })])])
    ]),
    h('div', { class: 'ud-formily-item-control' }, [
      h('div', { class: 'ud-formily-item-control-content' }, [
        h('div', { class: 'ud-formily-item-control-content-component' }, [
          h('div', { class: 'throne-biz-date-range-picker-wrapper' }, [
            h('div', { class: 'throne-biz-date-range-picker-input' }, [start]),
            h('div', { class: 'throne-biz-date-range-picker-rangeInput-seperator', text: '至' }),
            h('div', { class: 'throne-biz-date-range-picker-input' }, [end])
          ])
        ])
      ])
    ])
  ]);
  harness.register(start, { controlId: `${fieldKey}-start`, controlType: 'text', label: '开始时间', sectionId, fieldKey: 'start' });
  harness.register(end, { controlId: `${fieldKey}-end`, controlType: 'text', label: '结束时间', sectionId, fieldKey: 'end' });
  return { field, start, end };
}

function yearPicker(harness, { controlId = 'award-date', labelText = '获奖时间', sectionId } = {}) {
  const input = h('input', { class: 'ud__picker-input ud__native-input', attrs: { placeholder: 'YYYY', size: '12' }, props: { value: '' } });
  const field = h('div', {
    class: 'ud-formily-item',
    attrs: { 'data-form-field-name': 'date', 'data-form-field-i18n-name': labelText }
  }, [
    h('div', { class: 'ud-formily-item-label' }, [
      h('div', { class: 'ud-formily-item-label-content' }, [h('span', {}, [h('label', { text: labelText })])])
    ]),
    h('div', { class: 'ud-formily-item-control' }, [
      h('div', { class: 'ud-formily-item-control-content' }, [
        h('div', { class: 'ud-formily-item-control-content-component' }, [
          h('div', { class: 'ud__picker ud__picker--size-lg' }, [
            h('div', { class: 'ud__picker-dateInput ud__picker-inputWrapper' }, [
              h('div', { class: 'ud__picker-inputWrapper-inner' }, [input])
            ])
          ])
        ])
      ])
    ])
  ]);
  harness.register(input, { controlId, controlType: 'text', label: labelText, sectionId, fieldKey: 'date' });
  return { field, input };
}

/** Real repeatable module: wrapper > title + card list + add button. */
function moduleWithCards(harness, { sectionId, title, buildCard }) {
  const list = h('div', { class: 'apply-form-array-card-list' });
  const counters = { add: 0, delete: 0 };
  const addButton = h('button', { class: 'ud__button apply-form-array-card-add__1AbCd', attrs: { type: 'button' }, text: '添加' });
  const module = h('div', { class: 'applyFormModuleWrapper-windows applyFormModuleWrapper__2JZaE' }, [
    h('div', { class: 'applyFormModuleWrapper-title' }, [h('span', { class: 'applyFormModuleWrapper-text', text: title })]),
    h('div', { class: 'applyFormModuleWrapper-content' }, [list, addButton])
  ]);
  addButton.addEventListener('click', () => {
    counters.add += 1;
    list.appendChild(buildCard(list.children.length));
  });
  const countItems = () => queryAllDeep(module, '[class*="apply-form-array-card__"]').length;
  addSection(harness, { id: sectionId, label: title, repeatable: true, countItems });
  harness.actions.push({ actionId: `add-${sectionId}`, kind: 'add-item', sectionId, label: '添加' });
  return { module, list, addButton, counters, countItems };
}

/** One real card with a delete button (which the executor must never click). */
function cardWithDelete(harness, { counters, buildContent }) {
  const card = h('div', { class: 'apply-form-array-card__3QF2H' }, [
    h('div', { class: 'apply-form-array-card-content__eZqzM' }, buildContent()),
    h('div', { class: 'apply-form-array-card-operate__zskMQ' }, [
      h('button', { class: 'ud__button apply-form-array-card-delete__1RIY6', attrs: { type: 'button' } }, [
        h('span', { class: 'universe-icon', text: '✕' })
      ])
    ])
  ]);
  const deleteButton = card.querySelector('[class*="apply-form-array-card-delete"]');
  deleteButton.addEventListener('click', () => { counters.delete += 1; });
  return card;
}

const stepFor = (controlId, value, extra = {}) => ({
  stepId: `step-${controlId}`,
  kind: 'fill',
  controlId,
  value,
  sourcePath: ['resume'],
  fieldKey: extra.fieldKey ?? controlId,
  sectionKey: extra.sectionKey ?? 'basic',
  confidence: 0.95,
  ...extra
});

// ---------------------------------------------------------------------------
// Text input (React/formily controlled)
// ---------------------------------------------------------------------------

test('text fill uses the native value setter, dispatches input/change/blur and verifies', async () => {
  const harness = createHarness();
  addSection(harness, { id: 'section-basic', label: '基本信息' });
  const { field, element } = textInputFor(harness, { controlId: 'name', label: '姓名', sectionId: 'section-basic', fieldKey: 'name' });
  harness.document.body.appendChild(field);
  const events = harness.trackEvents(element);

  const result = await executeStep(harness.document, stepFor('name', '刘炳梁'), harness.contextFor());
  assert.equal(result.status, 'verified');
  assert.equal(result.changed, true);
  assert.equal(result.before, '');
  assert.equal(result.after, '刘炳梁');
  assert.equal(element.value, '刘炳梁');
  assert.ok(events.includes('input'), 'input event must fire (React state update)');
  assert.ok(events.includes('change'));
  assert.ok(events.includes('blur'), 'blur must be delivered so the page validates the field');
});

test('text fill retries once (clear + rewrite) and fails with a reason when the page keeps reverting', async () => {
  const harness = createHarness();
  addSection(harness, { id: 'section-basic', label: '基本信息' });

  const retry = textInputFor(harness, { controlId: 'retry', label: '学校名称', fieldKey: 'school' });
  let reverted = false;
  retry.element.addEventListener('input', () => {
    if (!reverted && retry.element.value !== '') { reverted = true; retry.element.value = ''; }
  });
  harness.document.body.appendChild(retry.field);

  const retried = await executeStep(harness.document, stepFor('retry', '北京某高校'), harness.contextFor());
  assert.equal(retried.status, 'verified');
  assert.equal(retry.element.value, '北京某高校');

  const stubborn = textInputFor(harness, { controlId: 'stubborn', label: '专业', fieldKey: 'field_of_study' });
  stubborn.element.addEventListener('input', () => { stubborn.element.value = ''; });
  harness.document.body.appendChild(stubborn.field);
  const failed = await executeStep(harness.document, stepFor('stubborn', '数据科学'), harness.contextFor());
  assert.equal(failed.status, 'failed');
  assert.match(failed.reason, /value-mismatch/);
  assert.match(failed.reason, /数据科学/);
});

test('already-correct values are skipped (idempotent) without touching the page', async () => {
  const harness = createHarness();
  addSection(harness, { id: 'section-basic', label: '基本信息' });
  const { field, element } = textInputFor(harness, { controlId: 'name', label: '姓名', fieldKey: 'name', value: '刘**（已脱敏）' });
  harness.document.body.appendChild(field);
  const events = harness.trackEvents(element);

  const result = await executeStep(harness.document, stepFor('name', '刘**（已脱敏）'), harness.contextFor());
  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'already-correct');
  assert.equal(result.changed, false);
  assert.deepEqual(events, []);
});

test('fill-empty reports a conflict instead of overwriting; overwrite mode writes', async () => {
  const harness = createHarness();
  addSection(harness, { id: 'section-basic', label: '基本信息' });
  const { field, element } = textInputFor(harness, { controlId: 'name', label: '姓名', fieldKey: 'name', value: '林知远' });
  harness.document.body.appendChild(field);

  const conflict = await executeStep(harness.document, stepFor('name', '刘**（已脱敏）'), harness.contextFor());
  assert.equal(conflict.status, 'conflict');
  assert.match(conflict.reason, /existing-value-differs/);
  assert.equal(element.value, '林知远');

  const overwritten = await executeStep(harness.document, stepFor('name', '刘**（已脱敏）'), harness.contextFor({ mode: 'overwrite' }));
  assert.equal(overwritten.status, 'verified');
  assert.equal(element.value, '刘**（已脱敏）');
});

test('textarea fill works the same way', async () => {
  const harness = createHarness();
  addSection(harness, { id: 'section-summary', label: '自我评价' });
  const { field, element } = textInputFor(harness, { controlId: 'summary', label: '自我评价', fieldKey: 'self_evaluation', multiline: true });
  harness.document.body.appendChild(field);
  const result = await executeStep(harness.document, stepFor('summary', '注重工程质量。'), harness.contextFor());
  assert.equal(result.status, 'verified');
  assert.equal(element.value, '注重工程质量。');
});

// ---------------------------------------------------------------------------
// Real .ud__select combobox
// ---------------------------------------------------------------------------

function degreeSelect(harness, extra = {}) {
  const select = udSelect(harness, {
    controlId: 'degree',
    labelText: '学历',
    sectionId: 'section-education',
    fieldKey: 'degree',
    options: [
      { value: 'phd', label: '博士' }, { value: 'mba', label: 'MBA' }, { value: 'master', label: '硕士' },
      { value: 'bachelor', label: '本科' }, { value: 'college', label: '大专' }, { value: 'high', label: '高中' }
    ],
    ...extra
  });
  harness.document.body.appendChild(select.field);
  return select;
}

test('real ud__select: opens via mousedown+click, matches the option, verifies .selectItem and closes by visibility', async () => {
  const harness = createHarness();
  addSection(harness, { id: 'section-education', label: '教育经历', repeatable: true, itemCount: 1 });
  const select = degreeSelect(harness);

  const result = await executeStep(harness.document, stepFor('degree', '硕士', { kind: 'select' }), harness.contextFor());
  assert.equal(result.status, 'verified', result.reason ?? JSON.stringify(result));
  assert.equal(result.after, '硕士');
  assert.equal(select.selectItem.textContent, '硕士');
  assert.equal(select.selectItem.getAttribute('data-value'), 'master');
  assert.equal(select.searchInput.value, '', 'search input value must stay empty (real page quirk)');
  assert.equal(select.isOpen(), false);
  // The dropdown element intentionally stays in the DOM after closing; the
  // executor must judge closure by visibility, not by existence.
  const dropdown = harness.document.querySelector('.ud__select__dropdown');
  assert.ok(dropdown, 'closed dropdown remains in the DOM on the real page');
  assert.equal(dropdown.style.display, 'none');
  assert.ok(dropdown.classList.contains('ud-slide-up-leave'));
});

test('real ud__select option matching: trim/case, contains, data-value and missing option', async () => {
  const cases = [
    { target: ' 硕士 ', value: 'master' },
    { target: 'master', value: 'master' },
    { target: '博', value: 'phd' }
  ];
  for (const item of cases) {
    const harness = createHarness();
    addSection(harness, { id: 'section-education', label: '教育经历', repeatable: true, itemCount: 1 });
    const select = degreeSelect(harness);
    const result = await executeStep(harness.document, stepFor('degree', item.target, { kind: 'select' }), harness.contextFor());
    assert.equal(result.status, 'verified', `target ${JSON.stringify(item.target)}: ${result.reason ?? ''}`);
    assert.equal(select.selectItem.getAttribute('data-value'), item.value);
    assert.equal(select.isOpen(), false);
  }

  const harness = createHarness();
  addSection(harness, { id: 'section-education', label: '教育经历', repeatable: true, itemCount: 1 });
  const select = degreeSelect(harness);
  const missing = await executeStep(harness.document, stepFor('degree', '初中', { kind: 'select' }), harness.contextFor());
  assert.equal(missing.status, 'failed');
  assert.match(missing.reason, /option-not-found/);
  assert.match(missing.reason, /可选|本科/);
  assert.equal(select.isOpen(), false, 'popup must be closed after a failed option match');
});

test('real ud__select virtual list: scrolls .rc-virtual-list-holder until the option renders', async () => {
  const harness = createHarness();
  addSection(harness, { id: 'section-basic', label: '基本信息' });
  const options = Array.from({ length: 30 }, (_, index) => ({ value: `city-${index}`, label: `城市${index}` }));
  const select = udSelect(harness, { controlId: 'city', labelText: '期望工作地点', fieldKey: 'preferred_city_list', options, virtual: 10 });
  harness.document.body.appendChild(select.field);
  assert.equal(harness.document.querySelectorAll('.ud__select__list__item').length, 0, 'nothing rendered before open');

  const result = await executeStep(harness.document, stepFor('city', '城市25', { kind: 'select' }), harness.contextFor());
  assert.equal(result.status, 'verified', result.reason ?? '');
  assert.equal(select.selectItem.textContent, '城市25');
  assert.equal(select.isOpen(), false);
});

test('real ud__select multi-select adds a tag and verifies it', async () => {
  const harness = createHarness();
  addSection(harness, { id: 'section-basic', label: '基本信息' });
  const select = udSelect(harness, {
    controlId: 'city',
    labelText: '期望工作地点',
    fieldKey: 'preferred_city_list',
    multi: true,
    options: [{ value: 'shenzhen', label: '深圳' }, { value: 'hangzhou', label: '杭州' }]
  });
  harness.document.body.appendChild(select.field);
  const result = await executeStep(harness.document, stepFor('city', '杭州', { kind: 'select' }), harness.contextFor());
  assert.equal(result.status, 'verified');
  const tags = [...harness.document.querySelectorAll('[class*="ud__select__selector__tag"]')].map(tag => tag.textContent);
  assert.deepEqual(tags, ['杭州']);
  assert.equal(select.isOpen(), false, 'multi-select popup must be force-closed');
});

test('real ud__select that never opens its popup fails with a reason after polling', async () => {
  const harness = createHarness();
  addSection(harness, { id: 'section-education', label: '教育经历', repeatable: true, itemCount: 1 });
  const select = degreeSelect(harness);
  // Replace the interactive selector with an inert look-alike (keeps the
  // combobox input inside so the model token still resolves).
  const inert = h('div', { class: 'ud__select__selector', attrs: { 'aria-expanded': 'false' } }, [select.selectItem, select.searchInput]);
  select.root.replaceChild(inert, select.selector);
  const result = await executeStep(harness.document, stepFor('degree', '硕士', { kind: 'select' }), harness.contextFor());
  assert.equal(result.status, 'failed');
  assert.match(result.reason, /option-list-not-opened/);
});

// ---------------------------------------------------------------------------
// Dates / ongoing / year picker
// ---------------------------------------------------------------------------

test('start_end_time: two plain text inputs typed as YYYY-MM and verified', async () => {
  const harness = createHarness();
  addSection(harness, { id: 'section-education', label: '教育经历', repeatable: true, itemCount: 1 });
  const range = dateRangeFields(harness, { sectionId: 'section-education' });
  harness.document.body.appendChild(range.field);

  const start = await executeStep(harness.document, stepFor('start_end_time-start', '2023-9', { fieldKey: 'start', sectionKey: 'education' }), harness.contextFor());
  assert.equal(start.status, 'verified');
  assert.equal(range.start.value, '2023-09');

  const end = await executeStep(harness.document, stepFor('start_end_time-end', '2027-07', { fieldKey: 'end', sectionKey: 'education' }), harness.contextFor());
  assert.equal(end.status, 'verified');
  assert.equal(range.end.value, '2027-07');
});

test('ongoing "至今" is typed into the end-date text input (real page behaviour)', async () => {
  const harness = createHarness();
  addSection(harness, { id: 'section-education', label: '教育经历', repeatable: true, itemCount: 1 });
  const range = dateRangeFields(harness, { sectionId: 'section-education' });
  harness.document.body.appendChild(range.field);
  const result = await executeStep(harness.document, stepFor('start_end_time-end', '至今', { fieldKey: 'end' }), harness.contextFor());
  assert.equal(result.status, 'verified');
  assert.equal(range.end.value, '至今');
});

test('readonly date field is manual (no calendar guessing)', async () => {
  const harness = createHarness();
  addSection(harness, { id: 'section-award', label: '获奖', repeatable: true, itemCount: 1 });
  const readonly = textInputFor(harness, { controlId: 'readonlyDate', label: '时间', fieldKey: 'date', readOnly: true });
  harness.document.body.appendChild(readonly.field);
  const result = await executeStep(harness.document, stepFor('readonlyDate', '2024-05', { fieldKey: 'date' }), harness.contextFor());
  assert.equal(result.status, 'manual');
  assert.match(result.reason, /readonly-date-needs-manual-picker/);
  assert.equal(readonly.element.value, '');
});

test('award year picker truncates YYYY-MM to YYYY and verifies', async () => {
  const harness = createHarness();
  addSection(harness, { id: 'section-award', label: '获奖', repeatable: true, itemCount: 1 });
  const picker = yearPicker(harness);
  harness.document.body.appendChild(picker.field);
  const result = await executeStep(harness.document, stepFor('award-date', '2024-05', { fieldKey: 'date', sectionKey: 'award' }), harness.contextFor());
  assert.equal(result.status, 'verified');
  assert.equal(picker.input.value, '2024');
});

test('date input that rejects the typed value becomes manual, not failed', async () => {
  const harness = createHarness();
  addSection(harness, { id: 'section-education', label: '教育经历', repeatable: true, itemCount: 1 });
  const { field, element } = textInputFor(harness, { controlId: 'startReject', label: '开始时间', fieldKey: 'start' });
  harness.document.body.appendChild(field);
  element.addEventListener('input', () => { element.value = ''; });
  const result = await executeStep(harness.document, stepFor('startReject', '2023-09', { fieldKey: 'start' }), harness.contextFor());
  assert.equal(result.status, 'manual');
  assert.match(result.reason, /date-requires-manual-picker/);
});

// ---------------------------------------------------------------------------
// add-item on the real array-card modules
// ---------------------------------------------------------------------------

test('add-item clicks the module "添加" button, waits for card count growth and never touches save/delete', async () => {
  const harness = createHarness();
  const work = moduleWithCards(harness, {
    sectionId: 'section-work',
    title: '工作经历',
    buildCard: () => cardWithDelete(harness, {
      counters: work.counters,
      buildContent: () => [formilyText({ fieldName: 'service', labelText: '公司名称' })]
    })
  });
  const education = moduleWithCards(harness, {
    sectionId: 'section-education',
    title: '教育经历',
    buildCard: () => cardWithDelete(harness, {
      counters: education.counters,
      buildContent: () => [formilyText({ fieldName: 'school', labelText: '学校名称' })]
    })
  });
  // Both modules already have 1 card, and both add buttons share the label "添加".
  work.list.appendChild(cardWithDelete(harness, { counters: work.counters, buildContent: () => [formilyText({ fieldName: 'service', labelText: '公司名称' })] }));
  education.list.appendChild(cardWithDelete(harness, { counters: education.counters, buildContent: () => [formilyText({ fieldName: 'school', labelText: '学校名称' })] }));
  harness.document.body.appendChild(work.module);
  harness.document.body.appendChild(education.module);
  const save = h('button', { class: 'atsx-btn atsx-btn-primary atsx-btn-lg', attrs: { type: 'button' }, text: '保存' });
  harness.document.body.appendChild(save);

  const beforeWork = work.countItems();
  const beforeEducation = education.countItems();
  const result = await executeAction(harness.document, {
    actionId: 'add-section-education',
    kind: 'add-item',
    sectionId: 'section-education',
    label: '添加'
  }, harness.contextFor());
  assert.equal(result.status, 'verified', result.reason ?? '');
  assert.equal(result.changed, true);
  assert.equal(education.countItems(), beforeEducation + 1, `education cards must grow by one: ${JSON.stringify(result)}`);
  assert.equal(work.countItems(), beforeWork, 'the other module (same "添加" label) must not be touched');
  assert.equal(work.counters.add, 0, 'wrong module add button must not be clicked');
  assert.equal(work.counters.delete, 0);
  assert.equal(education.counters.delete, 0);
});

test('add-item on a button that does nothing times out with failed', async () => {
  const harness = createHarness();
  const section = moduleWithCards(harness, { sectionId: 'section-work', title: '工作经历', buildCard: () => h('div') });
  harness.document.body.appendChild(section.module);
  const noop = h('button', { class: 'apply-form-array-card-add__noop', attrs: { type: 'button' }, text: '添加' });
  section.addButton.parentElement.replaceChild(noop, section.addButton);
  const result = await executeAction(harness.document, { actionId: 'add-section-work', kind: 'add-item', sectionId: 'section-work', label: '添加' }, harness.contextFor());
  assert.equal(result.status, 'failed');
  assert.match(result.reason, /add-item-timeout/);
});

test('save / delete / cancel buttons are never clicked and forbidden action labels are rejected', async () => {
  const harness = createHarness();
  const section = moduleWithCards(harness, { sectionId: 'section-work', title: '工作经历', buildCard: () => h('div') });
  harness.document.body.appendChild(section.module);
  const save = h('button', { class: 'atsx-btn atsx-btn-primary atsx-btn-lg', attrs: { type: 'button' }, text: '保存' });
  const cancel = h('button', { class: 'atsx-btn atsx-btn-default atsx-btn-lg', attrs: { type: 'button' }, text: '取消' });
  let saveClicks = 0;
  let cancelClicks = 0;
  save.addEventListener('click', () => { saveClicks += 1; });
  cancel.addEventListener('click', () => { cancelClicks += 1; });
  harness.document.body.append(save, cancel);

  const saveAction = await executeAction(harness.document, { actionId: 'save', kind: 'add-item', label: '保存' }, harness.contextFor());
  assert.equal(saveAction.status, 'failed');
  assert.match(saveAction.reason, /action-element-missing|forbidden-action/);

  const cancelAction = await executeAction(harness.document, { actionId: 'cancel', kind: 'add-item', label: '取消' }, harness.contextFor());
  assert.equal(cancelAction.status, 'failed');
  assert.equal(saveClicks, 0);
  assert.equal(cancelClicks, 0);
});

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------

test('steps/actions cannot smuggle a selector or script', async () => {
  const harness = createHarness();
  addSection(harness, { id: 'section-basic', label: '基本信息' });
  const { field, element } = textInputFor(harness, { controlId: 'name', label: '姓名', fieldKey: 'name' });
  harness.document.body.appendChild(field);
  const selectorStep = await executeStep(harness.document, { ...stepFor('name', '刘**（已脱敏）'), selector: '#name-input' }, harness.contextFor());
  assert.equal(selectorStep.status, 'failed');
  assert.match(selectorStep.reason, /forbidden-property/);
  assert.equal(element.value, '');

  const scriptAction = await executeAction(harness.document, { actionId: 'add-section-basic', kind: 'add-item', script: 'alert(1)' }, harness.contextFor());
  assert.equal(scriptAction.status, 'failed');
  assert.match(scriptAction.reason, /forbidden-property/);
});

test('unknown control ids fail instead of falling back to a selector search', async () => {
  const harness = createHarness();
  addSection(harness, { id: 'section-basic', label: '基本信息' });
  harness.document.body.appendChild(textInputFor(harness, { controlId: 'name', label: '姓名', fieldKey: 'name' }).field);
  const result = await executeStep(harness.document, stepFor('does-not-exist', 'x'), harness.contextFor());
  assert.equal(result.status, 'failed');
  assert.match(result.reason, /control-not-found/);
});

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

test('undoLastFill restores text and combobox writes in reverse order and stays serializable', async () => {
  const harness = createHarness();
  addSection(harness, { id: 'section-basic', label: '基本信息' });
  const { field, element } = textInputFor(harness, { controlId: 'name', label: '姓名', fieldKey: 'name' });
  harness.document.body.appendChild(field);
  const select = degreeSelect(harness);

  // Preselect 本科 so the undo has an old value to restore. Existing values are
  // protected in fill-empty mode, so this round uses overwrite mode on purpose.
  select.selectItem.textContent = '本科';
  select.selectItem.setAttribute('data-value', 'bachelor');

  const context = harness.contextFor({ mode: 'overwrite' });
  await executeStep(harness.document, stepFor('name', '刘**（已脱敏）'), context);
  await executeStep(harness.document, stepFor('degree', '硕士', { kind: 'select' }), context);
  assert.equal(element.value, '刘**（已脱敏）');
  assert.equal(select.selectItem.textContent, '硕士');

  const log = getUndoLog(harness.document);
  assert.equal(log.length, 2);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(log)), 'undo log must be serializable');
  assert.ok(!('element' in log[0]), 'serialized entries must not leak DOM references');

  const undone = undoLastFill(harness.document);
  assert.equal(undone.undone, 2);
  assert.equal(undone.changed, true);
  assert.equal(element.value, '');
  assert.equal(select.selectItem.textContent, '本科', 'combobox display restored to the previous label');
  assert.deepEqual(getUndoLog(harness.document), []);
});

// ---------------------------------------------------------------------------
// Integration with the real-machine dom-twin: createBytedanceTwin()
// (.ud__select, date-range text inputs, year picker, array cards + add/delete).
// Control tokens = filtered (file excluded) index; action tokens = raw index.
// ---------------------------------------------------------------------------

function createTwinModel(twin) {
  const document = twin.document;
  const raw = twin.rawControlElements ? twin.rawControlElements() : queryAllDeep(document, CONTROL_SELECTOR);
  const withoutFiles = raw.filter(element => !(element.localName === 'input' && String(element.type || '').toLowerCase() === 'file'));
  const actionRaw = queryAllDeep(document, ACTION_SELECTOR);
  const titles = twin.moduleTitles();
  const moduleKeys = twin.modules();

  const control = (controlId, element, extra = {}) => ({
    controlId,
    selectorToken: `control-token-${withoutFiles.indexOf(element)}`,
    label: element.closest?.('[data-form-field-name]')?.getAttribute('data-form-field-i18n-name') ?? '',
    role: 'textbox',
    controlType: extra.controlType ?? 'text',
    value: String(element.value ?? ''),
    visible: true,
    disabled: false,
    readonly: false,
    ...(extra.sectionId ? { sectionId: extra.sectionId } : {}),
    ...(extra.fieldKey ? { fieldKey: extra.fieldKey } : {}),
    ...(extra.itemRole ? { itemRole: extra.itemRole } : {}),
    ...(extra.dateFormat ? { dateFormat: extra.dateFormat } : {})
  });

  const controls = [];
  controls.push(control('name', document.querySelector('[data-form-field-name="name"] input'), { sectionId: 'section-basic', fieldKey: 'name' }));
  controls.push(control('degree', document.querySelector('[data-form-field-name="degree"] input[role="combobox"]'), {
    controlType: 'combobox', sectionId: 'section-education', fieldKey: 'degree'
  }));
  const dateInputs = [...document.querySelectorAll('[data-form-field-name="start_end_time"] input')];
  controls.push(control('education-start', dateInputs[0], { sectionId: 'section-education', fieldKey: 'start_end_time', itemRole: 'start', dateFormat: 'YYYY-MM' }));
  controls.push(control('education-end', dateInputs[1], { sectionId: 'section-education', fieldKey: 'start_end_time', itemRole: 'end', dateFormat: 'YYYY-MM' }));
  controls.push(control('award-date', document.querySelector('[data-form-field-name="date"] input'), { sectionId: 'section-award', fieldKey: 'date', dateFormat: 'YYYY' }));

  return {
    pageIdentity: { origin: document.location.origin, route: document.location.pathname, title: document.title },
    sections: moduleKeys.map(key => ({
      id: `section-${key}`,
      label: titles[key],
      repeatable: true,
      itemCount: twin.cards(key).length
    })),
    controls,
    actions: moduleKeys.filter(key => twin.addButton(key)).map(key => {
      const button = twin.addButton(key);
      return {
        actionId: `add-item:${key}`,
        kind: 'add-item',
        sectionId: `section-${key}`,
        sectionKey: key,
        label: String(button.textContent ?? '').trim(),
        selectorToken: `action-token-${actionRaw.indexOf(button)}`
      };
    }),
    dialogs: []
  };
}

const twinContext = (twin, extra = {}) => ({
  pageModel: createTwinModel(twin),
  inspectPage: () => createTwinModel(twin),
  ...extra
});

test('real-machine twin: React text fill + .ud__select select + year truncation verify, save is never clicked', async () => {
  const twin = createBytedanceTwin();
  const overwrite = { mode: 'overwrite' };

  const name = await executeStep(twin.document, stepFor('name', '刘炳梁', { fieldKey: 'name' }), twinContext(twin, overwrite));
  assert.equal(name.status, 'verified', name.reason ?? '');
  assert.equal(twin.document.querySelector('[data-form-field-name="name"] input').value, '刘炳梁');

  const degree = await executeStep(twin.document, stepFor('degree', '硕士', { kind: 'select', fieldKey: 'degree' }), twinContext(twin, overwrite));
  assert.equal(degree.status, 'verified', degree.reason ?? '');
  assert.equal(twin.document.querySelector('[data-form-field-name="degree"] [class*="selectItem"]').textContent, '硕士');

  const ongoing = await executeStep(twin.document, stepFor('education-end', '至今', { fieldKey: 'end' }), twinContext(twin, overwrite));
  assert.equal(ongoing.status, 'verified', ongoing.reason ?? '');
  assert.equal([...twin.document.querySelectorAll('[data-form-field-name="start_end_time"] input')][1].value, '至今');

  const award = await executeStep(twin.document, stepFor('award-date', '2024-05', { fieldKey: 'date' }), twinContext(twin, overwrite));
  assert.equal(award.status, 'verified', award.reason ?? '');
  assert.equal(twin.document.querySelector('[data-form-field-name="date"] input').value, '2024');

  assert.equal(twin.submitCount(), 0, 'save/cancel must never be clicked');
});

test('real-machine twin: add-item resolves the right module via action token and grows only that module', async () => {
  const twin = createBytedanceTwin();
  const beforeProject = twin.cards('project').length;
  const beforeEducation = twin.cards('education').length;
  const result = await executeAction(twin.document, {
    actionId: 'add-item:project',
    kind: 'add-item',
    sectionId: 'section-project',
    sectionKey: 'project',
    label: '添加',
    selectorToken: `action-token-${queryAllDeep(twin.document, ACTION_SELECTOR).indexOf(twin.addButton('project'))}`
  }, twinContext(twin));
  assert.equal(result.status, 'verified', result.reason ?? '');
  assert.equal(result.changed, true);
  assert.equal(twin.cards('project').length, beforeProject + 1);
  assert.equal(twin.cards('education').length, beforeEducation);
  assert.equal(twin.submitCount(), 0);
});

test('real-machine twin + page-inspector: fill / ud__select / add-item round trip with zero submits', async () => {
  const twin = createBytedanceTwin();
  const inspect = () => inspectPage(twin.document).pageModel;
  const context = () => ({ pageModel: inspect(), inspectPage: inspect, mode: 'overwrite' });

  const nameControl = inspect().controls.find(control => control.fieldKey === 'name');
  const degreeControl = inspect().controls.find(control => control.fieldKey === 'degree');
  const projectAdd = inspect().actions.find(action => action.sectionKey === 'project');
  assert.ok(nameControl && degreeControl && projectAdd, 'inspector must expose name/degree controls and the project add action');

  const name = await executeStep(twin.document, {
    stepId: 't-name', kind: 'fill', controlId: nameControl.controlId, value: '刘炳梁',
    fieldKey: 'name', sectionKey: 'basic', sourcePath: ['resume', 'basic', 'name'], confidence: 0.95
  }, context());
  assert.equal(name.status, 'verified', name.reason ?? '');
  assert.equal(twin.document.querySelector('[data-form-field-name="name"] input').value, '刘炳梁');

  const degree = await executeStep(twin.document, {
    stepId: 't-degree', kind: 'select', controlId: degreeControl.controlId, value: '硕士',
    fieldKey: 'degree', sectionKey: 'education', sourcePath: ['resume', 'education', 'degree'], confidence: 0.95
  }, context());
  assert.equal(degree.status, 'verified', degree.reason ?? '');
  assert.equal(twin.document.querySelector('[data-form-field-name="degree"] [class*="selectItem"]').textContent, '硕士');

  const beforeCards = twin.cards('project').length;
  const add = await executeAction(twin.document, projectAdd, context());
  assert.equal(add.status, 'verified', add.reason ?? '');
  assert.equal(twin.cards('project').length, beforeCards + 1);
  assert.equal(twin.submitCount(), 0, 'never click 保存 / 取消');
});

test('stale plan steps are refused instead of writing into a different field (wrong-field protection)', async () => {
  const twin = createBytedanceTwin();
  const inspect = () => inspectPage(twin.document).pageModel;
  const pageModel = inspect();
  const awardDesc = pageModel.controls.find(control => control.sectionKey === 'award' && control.fieldKey === 'desc');
  assert.ok(awardDesc, 'award desc control must exist');

  // Simulate a plan built before an add-item shifted controlIds: same controlId,
  // but the step metadata says the project section.
  const stale = await executeStep(twin.document, {
    stepId: 'stale-section', kind: 'fill', controlId: awardDesc.controlId, value: '错位写入',
    fieldKey: 'desc', sectionKey: 'project', itemIndex: 8, sourcePath: ['resume'], confidence: 0.95
  }, { pageModel: inspect(), mode: 'overwrite' });
  assert.equal(stale.status, 'failed');
  assert.match(stale.reason, /step-control-mismatch/);
  assert.equal(twin.cards('award')[0].querySelector('textarea').value, '', 'no cross-section write allowed');

  const staleFingerprint = await executeStep(twin.document, {
    stepId: 'stale-fingerprint', kind: 'fill', controlId: awardDesc.controlId, value: '错位写入',
    fieldKey: 'desc', sectionKey: 'award', pageFingerprint: 'page-stale', sourcePath: ['resume'], confidence: 0.95
  }, { pageModel: inspect(), mode: 'overwrite' });
  assert.equal(staleFingerprint.status, 'failed');
  assert.match(staleFingerprint.reason, /structure-changed/);
});
