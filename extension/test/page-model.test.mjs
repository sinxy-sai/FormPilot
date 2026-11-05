import test from 'node:test';
import assert from 'node:assert/strict';
import { createPageModel, normalizeControlModel, fingerprintPageModel, isSamePageModel } from '../src/core/page-model.mjs';

test('normalizes controls and requires a stable control id', () => {
  assert.throws(() => normalizeControlModel({ label: 'Name' }), /controlId/);
  assert.deepEqual(normalizeControlModel({ controlId: 'f1', label: '姓名', type: 'text', options: [1, 'A'], readOnly: true }), {
    controlId: 'f1', selectorToken: undefined, label: '姓名', role: '', controlType: 'text', options: ['1', 'A'], visible: true, disabled: false, readonly: true
  });
});

test('creates a page model and fingerprint that excludes values and capture time', () => {
  const first = createPageModel({ pageIdentity: { origin: 'https://example.test', route: '/apply' }, capturedAt: 'a', controls: [{ controlId: 'f1', label: 'Name', controlType: 'text', value: 'Alice' }] });
  const second = createPageModel({ pageIdentity: { origin: 'https://example.test', route: '/apply' }, capturedAt: 'b', controls: [{ controlId: 'f1', label: 'Name', controlType: 'text', value: 'Bob' }] });
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(isSamePageModel(first, second), true);
});

test('fingerprint changes when page structure changes', () => {
  const one = createPageModel({ pageIdentity: { origin: 'https://example.test', route: '/apply' }, controls: [{ controlId: 'f1', label: 'Name', controlType: 'text' }] });
  const two = createPageModel({ pageIdentity: { origin: 'https://example.test', route: '/apply' }, controls: [{ controlId: 'f1', label: 'Name', controlType: 'text' }, { controlId: 'f2', label: 'Email', controlType: 'text' }] });
  assert.notEqual(fingerprintPageModel(one), fingerprintPageModel(two));
  assert.equal(isSamePageModel(one, two), false);
});

test('指纹忽略下拉选项（自定义下拉只有点开时才渲染选项，不能因此判定页面变化）', () => {
  const base = {
    pageIdentity: { origin: 'https://example.test', route: '/apply' },
    sections: [{ id: 'section-project', label: '项目经历', key: 'project', itemCount: 1 }],
    controls: [
      { controlId: 'c1', selectorToken: 'control-token-0', label: '项目名称', role: 'textbox', controlType: 'text', value: 'A', sectionId: 'section-project', sectionKey: 'project', itemIndex: 0, fieldKey: 'name' },
      { controlId: 'c2', selectorToken: 'control-token-1', label: '学历', role: 'combobox', controlType: 'combobox', value: '本科', sectionId: 'section-project', sectionKey: 'project', itemIndex: 0, fieldKey: 'degree' }
    ]
  };
  const closed = createPageModel(base);
  const opened = createPageModel({ ...base, controls: base.controls.map(control => control.controlType === 'combobox' ? { ...control, options: ['本科', '硕士', '博士'] } : control) });
  assert.equal(closed.fingerprint, opened.fingerprint, '打开下拉不应改变指纹');

  // 真正的结构变化仍然要改变指纹
  const addedCard = createPageModel({ ...base, sections: [{ id: 'section-project', label: '项目经历', key: 'project', itemCount: 2 }] });
  assert.notEqual(closed.fingerprint, addedCard.fingerprint, '新增条目必须改变指纹');
  const hidden = createPageModel({ ...base, controls: base.controls.map(control => control.controlId === 'c1' ? { ...control, visible: false } : control) });
  assert.notEqual(closed.fingerprint, hidden.fingerprint, '可见性变化必须改变指纹');
});
