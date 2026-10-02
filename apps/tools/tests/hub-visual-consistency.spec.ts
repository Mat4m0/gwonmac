import { expect, test } from '@playwright/test';

test('template folders use loaded folder glyphs, not image URLs (HUB-089)', async ({ page }) => {
  await page.goto('/?hub');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  const search=page.locator('.hub-search input');
  await search.fill('build library'); await search.press('Enter');
  await page.locator('[data-id="game-templates"]').click();
  await expect(page.locator('[data-id^="folder:"]')).not.toHaveCount(0);
  await expect(page.locator('[data-id^="folder:"] .hub-icon img')).toHaveCount(0);
  await expect(page.locator('[data-id^="folder:"] .hub-icon[data-kind="folder"]')).not.toHaveCount(0);
});

test('the footer uses glyph keycaps and rows share a 40 px anatomy (HUB-146, HUB-150)', async ({ page }) => {
  await page.goto('/?hub');
  await expect(page.locator('#app')).toHaveAttribute('data-ready','true');
  await expect(page.locator('.hub-legend')).toContainText('⎋');
  await expect(page.locator('.hub-footer kbd:not(.ui-kbd)')).toHaveCount(0);
  const search=page.locator('.hub-search input');
  for (const query of ['', 'acc']) {
    await search.fill(query);
    const rows=await page.locator('.hub-row').evaluateAll(elements=>elements.map(el=>({height:el.getBoundingClientRect().height,icon:el.querySelector('.hub-icon')?.getBoundingClientRect().x,cue:el.querySelector('.hub-row-type')?.getBoundingClientRect().right})));
    expect(rows.length).toBeGreaterThan(0);
    for(const row of rows)expect(row.height).toBe(40);
    expect(new Set(rows.map(row=>row.icon)).size).toBe(1);
    expect(new Set(rows.map(row=>row.cue)).size).toBe(1);
  }
  await search.fill('settings');await search.press('Enter');await page.getByRole('button',{name:'Shortcuts',exact:true}).click();
  await expect(page.locator('#hub kbd').first()).toBeVisible();await expect(page.locator('#hub kbd:not(.ui-kbd)')).toHaveCount(0);
});

test('Price basis keeps one label and one row with focus after changes (HUB-149)', async ({ page }) => {
  await page.setViewportSize({width:800,height:600}); await page.goto('/?hub');
  await page.locator('.hub-search input').fill('5 zkeys in ecto');
  const picker=page.getByRole('combobox',{name:'Price basis'});
  await expect(page.locator('.hub-rate-controls label')).toContainText('Price basis');
  await picker.click();await expect(picker).toBeFocused();await expect(page.locator('#hub')).toBeVisible();await page.keyboard.press('Tab');
  for(const value of ['wtb','wts']){
    await picker.focus(); await picker.selectOption(value); await expect(picker).toBeFocused();
    await expect(page.locator('.hub-row[aria-selected=true]')).toHaveAttribute('data-id','market:result');
  }
  const boxes=await page.locator('.hub-rate-controls label,.hub-rate-controls button').evaluateAll(els=>els.map(el=>el.getBoundingClientRect().y+el.getBoundingClientRect().height/2));
  expect(Math.abs(boxes[0]!-boxes[1]!)).toBeLessThanOrEqual(1);
});

test('row focus uses the shared 2 px ring (HUB-148)', async ({page})=>{
  await page.goto('/?hub'); await expect(page.locator('#app')).toHaveAttribute('data-ready','true');
  await page.locator('.hub-row').first().evaluate(el=>{el.setAttribute('tabindex','0');(el as HTMLElement).focus();});
  await expect(page.locator('.hub-row').first()).toHaveCSS('outline-width','2px');
  for(const selector of ['.hub-close','.hub-lock']) {await page.locator(selector).focus();await expect(page.locator(selector)).toHaveCSS('outline-width','2px');}
});

test('calculator sides share one type role and preserve item capitalization (HUB-157)', async({page})=>{
  await page.goto('/?hub'); await page.locator('.hub-search input').fill('10 ectos in p');
  await expect(page.locator('.hub-conversion')).toBeVisible();
  const sizes=await page.locator('.hub-conversion-input,.hub-conversion .hub-title').evaluateAll(els=>els.map(el=>getComputedStyle(el).fontSize));
  expect(new Set(sizes).size).toBe(1);
  await expect(page.locator('.hub-currency-from')).toHaveCSS('text-transform','none');
});

test('Maps uses the Settings owner and disables children without rewriting saved values (HUB-107)', async({page})=>{
  await page.goto('/?hub'); await expect(page.locator('#app')).toHaveAttribute('data-ready','true');
  await page.locator('.hub-search input').fill('maps'); await page.locator('.hub-search input').press('Enter');
  await expect(page.locator('.hub-settings-body h2')).toHaveText('Maps');
  await expect(page.getByRole('checkbox',{name:'Elite skills',exact:true})).toBeVisible();
  const grid=page.getByRole('checkbox',{name:'Exploration grid'});await grid.uncheck();
  await expect(page.getByRole('slider',{name:'Grid opacity'})).toBeDisabled();
  const ranges=page.getByRole('checkbox',{name:'Compass ranges',exact:true});await ranges.uncheck();
  await expect(page.getByRole('checkbox',{name:'Earshot range',exact:true})).toBeDisabled();
  expect(await page.evaluate(()=>window.gwToolsSettings().compassRangeEarshotEnabled)).toBe(true);
  await grid.check(); await expect(page.getByRole('slider',{name:'Grid opacity'})).toBeEnabled();
});


test('Text size doubles interface titles without zooming the game (HUB-116, D-16)', async({page})=>{
  await page.goto('/?hub'); await expect(page.locator('#app')).toHaveAttribute('data-ready','true');
  const before=await page.locator('.hub-panel').boundingBox();
  const search=page.locator('.hub-search input');await search.fill('text size');await search.press('Enter');
  const slider=page.getByRole('slider',{name:'Text size'});await slider.fill('200');await slider.dispatchEvent('change');
  await expect(slider).toHaveValue('200');
  const navOverflow=await page.locator('.hub-settings nav button').evaluateAll(els=>els.map(el=>el.scrollWidth-el.clientWidth));expect(navOverflow.every(value=>value<=1)).toBe(true);
  await page.keyboard.press('Meta+r');
  await expect(page.locator('.hub-title').first()).toHaveCSS('font-size','28px');
  const after=await page.locator('.hub-panel').boundingBox();expect(after).toEqual(before);
  expect(await page.evaluate(()=>({zoom:getComputedStyle(document.documentElement).zoom,scale:window.gwToolsSettings().uiTextSize}))).toEqual({zoom:'1',scale:200});
  const overflow=await page.locator('.hub-row').evaluateAll(els=>els.map(el=>el.scrollWidth-el.clientWidth));expect(overflow.every(value=>value<=1)).toBe(true);
});


test('command examples return to real Home and select only the argument (HUB-153)',async({page})=>{
  await page.goto('/?hub');await expect(page.locator('#app')).toHaveAttribute('data-ready','true');
  const search=page.locator('.hub-search input');await search.fill('commands');await search.press('Enter');
  await page.locator('.hub-row').filter({hasText:'travel <place>'}).click();
  await expect(search).toHaveValue('travel ');await expect(page.locator('#hub')).toHaveAttribute('data-page','home');
  await expect(page.locator('.hub-breadcrumbs')).toHaveText('Home');
  expect(await search.evaluate(el=>[(el as HTMLInputElement).selectionStart,(el as HTMLInputElement).selectionEnd])).toEqual([7,7]);
  await search.press('x');await expect(search).toHaveValue('travel x');
  await expect(page.locator('#app')).not.toHaveAttribute('data-action',/Travel/);
});

test('Home pins use compact builds while explicit search keeps full bars (HUB-187)',async({page})=>{
  await page.goto('/?hub');await expect(page.locator('#app')).toHaveAttribute('data-ready','true');
  const search=page.locator('.hub-search input');await search.fill('build smiter');
  await search.press('Meta+j');await page.getByRole('menuitem',{name:'Pin to Hub',exact:true}).click();
  await page.keyboard.press('Meta+r');await search.fill('');
  const row=page.locator('.hub-build-compact');await expect(row).toHaveCount(1);
  expect((await row.boundingBox())!.height).toBe(40);await expect(row.locator('.hub-skill-bar')).toBeHidden();
  await search.fill('build smiter');await expect(page.locator('.hub-build-row .hub-skill-bar')).toBeVisible();
});


test('Home, Travel and Characters use one search box and glyph (HUB-145)',async({page})=>{
  await page.goto('/?hub');await expect(page.locator('#app')).toHaveAttribute('data-ready','true');
  const search=page.locator('.hub-search input');
  const baseline=await page.locator('.hub-search').boundingBox();expect(baseline!.height).toBe(48);
  const glyph=await page.locator('.hub-search svg').innerHTML();
  for(const key of ['Meta+t','Meta+e']){
    await page.keyboard.press(key);
    const box=page.locator('.hub-view .ui-hub-search');await expect(box).toBeVisible();
    expect(await box.boundingBox()).toEqual(baseline);
    expect(await box.locator('svg').innerHTML()).toBe(glyph);
    await expect(box.locator('input')).toHaveCSS('font-size','18px');
    await page.keyboard.press('Meta+r');await expect(search).toBeVisible();
  }
});


test('currency display groups digits and names its copy target with canonical art (HUB-157)',async({page})=>{
  await page.goto('/?hub');const search=page.locator('.hub-search input');await search.fill('1p in g');
  await expect(page.locator('.hub-primary')).toContainText('Copy 1,000 gold');
  expect(await page.locator('.hub-primary-art').getAttribute('src')).toBe(await page.locator('.hub-conversion-art-to').getAttribute('src'));
  await search.fill('250e in stacks e');await expect(page.locator('.hub-conversion .hub-title')).toHaveText('1 stack ecto');
});


test('Home, Travel and Characters share selection fill and a leading rail (HUB-148)',async({page})=>{
  await page.goto('/?hub');await expect(page.locator('#app')).toHaveAttribute('data-ready','true');
  const baseline=await page.locator('.hub-row[aria-selected=true]').evaluate(el=>({fill:getComputedStyle(el).backgroundColor,shadow:getComputedStyle(el).boxShadow,rail:getComputedStyle(el,'::before').backgroundColor}));
  for(const [key,selector] of [['Meta+t','.travel-recent[data-active]'],['Meta+e','.character-switch-row[data-selected=true]']] as const){
    await page.keyboard.press(key);
    const item=page.locator(selector).first();await expect(item).toBeVisible();
    expect(await item.evaluate(el=>({fill:getComputedStyle(el).backgroundColor,shadow:getComputedStyle(el).boxShadow,rail:getComputedStyle(el,'::before').backgroundColor}))).toEqual(baseline);
    await page.keyboard.press('Meta+r');
  }
});

test('recent destination overflow has an edge cue and top-aligned content (HUB-155)',async({page})=>{
  await page.goto('/?hub');await expect(page.locator('#app')).toHaveAttribute('data-ready','true');await page.keyboard.press('Meta+t');
  const list=page.locator('.travel-history .travel-recent-grid');await expect(list).toBeVisible();
  expect(await list.evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);
  await expect(list).not.toHaveCSS('mask-image','none');
  await expect(page.locator('.travel-history .travel-recent').first()).toHaveCSS('justify-content','flex-start');
});

test('command action glyphs differ from child cues and person actions (HUB-156)',async({page})=>{
  await page.goto('/?hub');await expect(page.locator('#app')).toHaveAttribute('data-ready','true');
  const kinds=await page.locator('[data-id="character"] .hub-icon,[data-id="accounts"] .hub-icon').evaluateAll(els=>els.map(el=>(el as HTMLElement).dataset.kind));
  expect(kinds).toEqual(['character','accounts']);
  const search=page.locator('.hub-search input');await search.fill('romi');await search.press('Enter');
  expect(await page.locator('[data-id="person:whisper"] .hub-icon').getAttribute('data-kind')).toBe('whispers');
  expect(await page.locator('[data-id="person:travel"] .hub-icon').getAttribute('data-kind')).toBe('travel');
  expect(await page.locator('[data-id="person:invite"] .hub-icon').getAttribute('data-kind')).toBe('invite');
});


test('game context is separate and Characters has one visible heading (HUB-158)',async({page})=>{
  await page.goto('/?hub');await expect(page.locator('#app')).toHaveAttribute('data-ready','true');
  await expect(page.locator('.hub-context')).toContainText("Lion's Arch");
  await expect(page.locator('.hub-context')).toHaveCSS('border-left-width','1px');
  await page.keyboard.press('Meta+e');await expect(page.locator('.hub-caption')).toHaveText('Characters');
  await expect(page.locator('.character-switch-head h2')).toBeHidden();
  await expect(page.getByRole('button',{name:'Character Switch settings',exact:true})).toBeVisible();
});

test('Settings nav and preference pins use row anatomy and intrinsic controls (HUB-151)',async({page})=>{
  await page.goto('/?hub');await expect(page.locator('#app')).toHaveAttribute('data-ready','true');
  const search=page.locator('.hub-search input');await search.press('Meta+j');await page.getByRole('menuitem',{name:'Pin to Hub',exact:true}).click();
  await search.fill('hub preferences');await search.press('Enter');
  await expect(page.locator('.hub-preference-option .hub-icon')).toBeVisible();
  expect((await page.locator('.hub-preference-option').boundingBox())!.height).toBe(40);
  await page.keyboard.press('Meta+r');await search.fill('settings');await search.press('Enter');
  await page.getByRole('button',{name:'Appearance',exact:true}).click();
  const nav=page.locator('.hub-settings nav [aria-current=true]');
  expect(await nav.evaluate(el=>getComputedStyle(el,'::before').width)).toBe('2px');
  const reset=page.getByRole('button',{name:'Reset Hub position',exact:true});
  expect((await reset.boundingBox())!.width).toBeLessThan(200);
});

test('visible Hub text uses one token ramp and readable line heights (HUB-147)',async({page})=>{
  await page.goto('/?hub');await expect(page.locator('#app')).toHaveAttribute('data-ready','true');
  const search=page.locator('.hub-search input');
  for(const query of ['', 'kam', '10 ectos in p', 'zzzq', 'commands', 'titles', 'build library', 'team gom afk', 'settings', 'hub preferences', '@travel', '@characters', '@actions']){
    await page.keyboard.press('Meta+r');
    if(query==='@travel')await page.keyboard.press('Meta+t');
    else if(query==='@characters')await page.keyboard.press('Meta+e');
    else if(query==='@actions')await search.press('Meta+j');
    else {await search.fill(query);if(['commands','titles','build library','settings','hub preferences'].includes(query))await search.press('Enter');else if(query==='team gom afk')await search.press('ArrowRight');}
    const invalid=await page.locator('#hub').evaluate(root=>{
      const invalid:string[]=[];const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node:Node|null;
      while((node=walker.nextNode())){
        const el=node.parentElement;if(!el||!node.textContent?.trim()||el.closest('.ui-sr-only,[aria-hidden=true]')||!el.checkVisibility())continue;
        const style=getComputedStyle(el),size=parseFloat(style.fontSize),line=parseFloat(style.lineHeight);
        if(![12,14,16,18,20].includes(size)||Number.isFinite(line)&&line<size)invalid.push(`${node.textContent?.trim()}: ${size}/${line}`);
      }return invalid;
    });expect(invalid).toEqual([]);
  }
});

test('hints, price basis and team selection keep the result list steady (HUB-105)',async({page})=>{
  await page.goto('/?hub');await expect(page.locator('#app')).toHaveAttribute('data-ready','true');
  const search=page.locator('.hub-search input');
  const tops:number[]=[];
  for(const query of ['k','trade','1p in a','10 ecto in p']){
    await search.fill(query);await expect(page.locator('.hub-group').first()).toBeVisible();
    // A source can replace a heading between locating it and measuring a detached handle.
    tops.push(await page.evaluate(()=>document.querySelector('.hub-group')!.getBoundingClientRect().y));
  }
  expect(Math.max(...tops)-Math.min(...tops)).toBeLessThanOrEqual(1);
  await expect(page.locator('.hub-conversion .hub-rate-controls')).toBeVisible();
  await search.fill('m');
  await expect(page.locator('.hub-row[data-id^="team:"]')).not.toHaveCount(0);
  await expect(page.locator('.hub-build-row')).not.toHaveCount(0);
  const rows=page.locator('.hub-row');await expect(rows).not.toHaveCount(0);
  const heights:number[]=[];
  for(let index=0;index<await rows.count();index++){
    heights.push(await page.locator('.hub-results').evaluate(el=>el.getBoundingClientRect().height));
    await search.press('ArrowDown');
  }
  expect(Math.max(...heights)-Math.min(...heights)).toBeLessThanOrEqual(1);
});

test('every view keeps the same frame and search box across styles, fonts and opacity (VIS-14)',async({page})=>{
  test.setTimeout(120_000);
  await page.goto('/?hub');await expect(page.locator('#app')).toHaveAttribute('data-ready','true');
  const search=page.locator('.hub-search input');
  const frame=await page.locator('.hub-panel').boundingBox(),field=await page.locator('.hub-search').boundingBox();
  expect(frame!.width).toBe(780);expect(frame!.height).toBe(590);
  for(const uiStyle of ['guild-wars','obsidian'] as const)for(const uiFont of ['guild-wars','inter','system','avenir','georgia','palatino'] as const)for(const uiPanelOpacity of [94,65]){
    await page.evaluate(value=>window.gwApplyFixtureAppearance?.(value),{uiStyle,uiFont,uiPanelOpacity});
    for(const query of ['', 'kam', '10 ectos in p', 'zzzq', 'commands', 'titles', 'build library', 'team gom afk', 'settings', 'hub preferences', '@travel', '@characters', '@actions']){
      await page.keyboard.press('Meta+r');
      if(query==='@travel')await page.keyboard.press('Meta+t');
      else if(query==='@characters')await page.keyboard.press('Meta+e');
      else if(query==='@actions')await search.press('Meta+j');
      else {await search.fill(query);if(['commands','titles','build library','settings','hub preferences'].includes(query))await search.press('Enter');else if(query==='team gom afk')await search.press('ArrowRight');}
      expect(await page.locator('.hub-panel').boundingBox(),`${uiStyle}/${uiFont}/${uiPanelOpacity}/${query}`).toEqual(frame);
      const visible=page.locator('.ui-hub-search:visible');
      if(await visible.count())expect(await visible.boundingBox(),`${uiStyle}/${uiFont}/${uiPanelOpacity}/${query}`).toEqual(field);
    }
  }
});

test('a four-key shortcut fits the shared cue slot at both text sizes (HUB-150)',async({page})=>{
  await page.goto('/?hub');await expect(page.locator('#app')).toHaveAttribute('data-ready','true');
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('hub-fixture-settings',{detail:{shortcutOverrides:{'travel.open':{key:'t',option:true,shift:true}}}})));
  for(const uiTextSize of [100,200]){
    await page.evaluate(uiTextSize=>window.gwApplyFixtureAppearance?.({uiStyle:'guild-wars',uiPanelOpacity:94,uiTextSize}),uiTextSize);
    const cue=page.locator('[data-id="travel"] .hub-row-type');await expect(cue.locator('kbd')).toHaveCount(4);
    const bounds=await cue.evaluate(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,childLeft:Math.min(...[...el.children].map(child=>child.getBoundingClientRect().left)),childRight:Math.max(...[...el.children].map(child=>child.getBoundingClientRect().right))}));
    expect(bounds.childRight).toBeLessThanOrEqual(bounds.right+1);expect(bounds.childLeft).toBeGreaterThanOrEqual(bounds.left-1);
  }
});
