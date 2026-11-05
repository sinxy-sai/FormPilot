// FormPilot 真机页面结构采集脚本（只读，不修改页面）。
//
// 用法：
//   1. 在浏览器里打开简历编辑页面并等它完全加载。
//   2. 按 F12 打开 DevTools，切到「控制台 / Console」。
//   3. 如果控制台顶部有 frame 选择器，先确认在包含简历表单的那个 frame（通常是 top）。
//   4. 把本文件全部内容粘贴进控制台，回车。
//   5. 结果会自动复制到剪贴板，同时保存在 window.__formpilotPageExport。
//      把它粘贴保存为项目里的 examples/bytedance-live-page.json，交给 FormPilot 分析。
//
// 隐私说明：默认把输入框的真实内容替换成 { length, sample }（只留前 4 个字符），
// 不会导出完整手机号/身份证号/邮箱。标签、选项、按钮文字、结构信息会完整导出。
// 需要完整值时把 REDACT_VALUES 改成 false。
(() => {
  const REDACT_VALUES = true;
  const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const clip = (value, size = 160) => { const item = text(value); return item.length > size ? `${item.slice(0, size)}…` : item; };
  const attr = (element, name) => (element?.getAttribute?.(name) ?? null);
  const isVisible = element => {
    if (!element) return false;
    for (let current = element; current; current = current.parentElement) {
      if (current.hasAttribute?.('hidden') || current.getAttribute?.('aria-hidden') === 'true') return false;
      const style = getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const safeValue = element => {
    const raw = element.type === 'checkbox' || element.type === 'radio' ? undefined : String(element.value ?? '');
    if (raw === undefined) return { checked: Boolean(element.checked) };
    if (!REDACT_VALUES) return { value: raw };
    return { length: raw.length, sample: raw.slice(0, 4), empty: raw.length === 0 };
  };
  const labelText = element => {
    const sources = [];
    const associated = element.labels?.[0];
    if (associated) {
      const clone = associated.cloneNode(true);
      for (const control of clone.querySelectorAll?.('input,textarea,select,button,[role="combobox"]') || []) control.remove();
      sources.push({ source: 'label', text: text(clone.textContent) });
    }
    const labelledBy = text(attr(element, 'aria-labelledby'));
    if (labelledBy) sources.push({ source: 'aria-labelledby', text: labelledBy.split(/\s+/).map(id => text(document.getElementById(id)?.textContent)).filter(Boolean).join(' ') });
    if (attr(element, 'aria-label')) sources.push({ source: 'aria-label', text: clip(attr(element, 'aria-label')) });
    if (attr(element, 'placeholder')) sources.push({ source: 'placeholder', text: clip(attr(element, 'placeholder')) });
    // 兄弟层级的字段标签（表格式布局：左边 label div，右边控件）
    for (let current = element, depth = 0; current && depth < 4; current = current.parentElement, depth += 1) {
      const row = current.parentElement;
      if (!row) break;
      const siblings = [...row.children].filter(child => child !== current && !child.contains(element));
      const candidate = siblings.find(child => text(child.textContent) && !child.querySelector?.('input,textarea,select,[role="combobox"]'));
      if (candidate) { sources.push({ source: `sibling-${depth}`, text: clip(candidate.textContent, 80) }); break; }
    }
    for (let current = element.parentElement, depth = 0; current && depth < 3; current = current.parentElement, depth += 1) {
      const holder = current.querySelector?.(':scope > label, :scope > .resumeEditForm-fieldLabel, :scope > [class*="fieldLabel"], :scope > [class*="label"]');
      if (holder && !holder.contains(element)) { sources.push({ source: `holder-${depth}`, text: clip(holder.textContent, 80) }); break; }
    }
    return sources;
  };
  const sectionOf = element => {
    for (let current = element; current && current !== document.body; current = current.parentElement) {
      const tag = current.tagName?.toLowerCase();
      const repeat = current.hasAttribute?.('data-repeat-item') || /\brepeat/i.test(String(current.className ?? ''));
      const heading = current.querySelector?.(':scope > h1,:scope > h2,:scope > h3,:scope > h4,:scope > legend,:scope > [class*="partTtile"],:scope > [class*="itemTtile"],:scope > [class*="title"]');
      const headingText = text(heading?.textContent);
      const className = String(current.className ?? '');
      if (tag === 'section' || tag === 'fieldset' || regexSection(className) || repeat) {
        return { tag, id: current.id || null, className: clip(className, 120), heading: clip(headingText, 80), repeat, path: pathOf(current) };
      }
    }
    return null;
  };
  const regexSection = className => /(?:^|\s)(?:resumeEditForm-part|resume.*Section|.*-part\b|form-section)/i.test(className);
  const pathOf = element => {
    const parts = [];
    for (let current = element; current && current !== document.body; current = current.parentElement) {
      const tag = current.tagName?.toLowerCase();
      const index = [...(current.parentElement?.children ?? [])].filter(child => child.tagName === current.tagName).indexOf(current);
      parts.unshift(`${tag}${current.id ? `#${current.id}` : ''}[${index}]`);
    }
    return parts.join(' > ');
  };
  const dataAttributes = element => {
    const output = {};
    for (const attribute of element.attributes || []) {
      if (!attribute.name.startsWith('data-')) continue;
      output[attribute.name] = clip(attribute.value, 120);
    }
    return output;
  };

  const selector = 'input, textarea, select, [role="combobox"], [contenteditable="true"]';
  const controls = [...document.querySelectorAll(selector)].map((element, index) => ({
    index,
    tag: element.tagName.toLowerCase(),
    type: element.type ?? null,
    role: attr(element, 'role'),
    inputMode: attr(element, 'inputmode'),
    id: element.id || null,
    name: attr(element, 'name'),
    className: clip(element.className, 160),
    placeholder: attr(element, 'placeholder'),
    ariaLabel: attr(element, 'aria-label'),
    ariaLabelledby: attr(element, 'aria-labelledby'),
    ariaHaspopup: attr(element, 'aria-haspopup'),
    ariaExpanded: attr(element, 'aria-expanded'),
    ariaRequired: attr(element, 'aria-required'),
    ariaValuetext: attr(element, 'aria-valuetext'),
    autocomplete: attr(element, 'autocomplete'),
    readOnly: Boolean(element.readOnly ?? element.readonly),
    disabled: Boolean(element.disabled),
    required: Boolean(element.required),
    visible: isVisible(element),
    rect: (() => { const rect = element.getBoundingClientRect(); return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }; })(),
    labels: labelText(element),
    section: sectionOf(element),
    dataAttributes: dataAttributes(element),
    ...safeValue(element),
    // 自定义下拉当前展示的文案（触发元素和值不是同一个节点时很有用）
    displayText: (attr(element, 'role') === 'combobox' || element.tagName === 'DIV') ? clip(element.textContent, 60) : null,
    options: element.tagName?.toLowerCase() === 'select' ? [...element.options].map(option => ({ value: option.value, text: text(option.textContent) })) : null
  }));

  const sections = [...document.querySelectorAll('section, fieldset, [data-repeat-item], [class*="part"], [class*="section"]')]
    .map(element => ({
      tag: element.tagName.toLowerCase(),
      id: element.id || null,
      className: clip(element.className, 140),
      heading: clip(element.querySelector?.(':scope > h1,:scope > h2,:scope > h3,:scope > h4,:scope > legend,:scope > [class*="title"],:scope > [class*="Ttile"]')?.textContent, 80),
      repeat: element.hasAttribute?.('data-repeat-item') || null,
      controlCount: element.querySelectorAll?.(selector).length ?? 0,
      buttons: [...(element.querySelectorAll?.('button, a[role="button"], [data-add]') ?? [])].map(button => ({ text: clip(button.textContent, 40), className: clip(button.className, 80), dataAttributes: dataAttributes(button) })).filter(button => button.text),
      path: pathOf(element)
    }))
    .filter(section => section.controlCount > 0 || section.heading);

  const buttons = [...document.querySelectorAll('button, a[role="button"], input[type="button"], input[type="submit"]')]
    .filter(button => isVisible(button))
    .map(button => ({ text: clip(button.textContent, 40) || attr(button, 'value'), className: clip(button.className, 100), type: attr(button, 'type'), dataAttributes: dataAttributes(button), disabled: Boolean(button.disabled) }))
    .filter(button => button.text);

  const report = {
    url: location.href,
    title: document.title,
    capturedAt: new Date().toISOString(),
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
    counts: { controls: controls.length, sections: sections.length, buttons: buttons.length, iframes: document.querySelectorAll('iframe').length },
    controls,
    sections,
    buttons,
    iframes: [...document.querySelectorAll('iframe')].map(frame => ({ src: frame.src, id: frame.id || null, className: clip(frame.className, 80) })),
    // 关键：页面用了哪些表单库/框架，便于判断控件类型
    frameworkHints: {
      classes: [...new Set([...document.querySelectorAll('[class]')].slice(0, 4000).map(element => String(element.className)).join(' ').split(/\s+/).filter(Boolean))].filter(name => /formily|ant-|arco|semi|form|select|picker|resume/i.test(name)).slice(0, 120),
      hasReact: Boolean(document.querySelector('[data-reactroot], #root, [id*="react"]')),
      scriptHosts: [...document.scripts].map(script => script.src).filter(Boolean).slice(0, 20)
    }
  };

  window.__formpilotPageExport = report;
  const json = JSON.stringify(report, null, 2);
  try { copy(json); console.log('%cFormPilot: 已复制页面结构 JSON 到剪贴板', 'color:#325ab4;font-weight:600'); } catch { console.log('FormPilot: 自动复制失败，请从 window.__formpilotPageExport 手动复制'); }
  console.log(`FormPilot: 控件 ${controls.length} 个 / 分区 ${sections.length} 个 / 按钮 ${buttons.length} 个`);
  return report;
})();
