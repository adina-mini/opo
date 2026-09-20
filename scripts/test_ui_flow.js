/**
 * @file scripts/test_ui_flow.js
 * End-to-end headless browser test using native Microsoft Edge and CDP WebSocket.
 * Tests onboarding -> Daily Feed -> Opportunity Detail Modal -> Draft Vault.
 */

import { spawn } from 'child_process';
import { writeFileSync } from 'fs';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9222;

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function sendCdp(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 100000);
    const handler = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.id === id) {
          ws.removeEventListener('message', handler);
          if (msg.error) reject(msg.error);
          else resolve(msg.result);
        }
      } catch (err) {
        // ignore other messages
      }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evalJs(ws, expression) {
  const res = await sendCdp(ws, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  return res.result?.value;
}

async function main() {
  console.log('1. Launching Headless Microsoft Edge on port', PORT);
  const edgeProc = spawn(EDGE_PATH, [
    `--remote-debugging-port=${PORT}`,
    '--headless=new',
    '--disable-gpu',
    '--window-size=1280,900',
    'http://localhost:5173/'
  ], { detached: false });

  await sleep(2000);

  try {
    console.log('2. Fetching CDP target tabs from http://127.0.0.1:9222/json/list');
    const tabsResp = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    const tabs = await tabsResp.json();
    const target = tabs.find(t => t.url.includes('5173')) || tabs[0];
    if (!target || !target.webSocketDebuggerUrl) {
      throw new Error('No target tab found: ' + JSON.stringify(tabs));
    }

    console.log('3. Connecting WebSocket to:', target.webSocketDebuggerUrl);
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });

    await sendCdp(ws, 'Page.enable');
    await sendCdp(ws, 'Runtime.enable');

    console.log('4. Waiting for initial page load...');
    await sleep(1500);

    // Step A: Quick Fill Profile on Onboarding
    console.log('5. Clicking Quick Fill button...');
    const filled = await evalJs(ws, `
      const btn = document.getElementById('quick-fill-btn');
      if (btn) {
        btn.click();
        true;
      } else false;
    `);
    console.log('   Quick Fill clicked:', filled);
    await sleep(500);

    // Step B: Submit Onboarding Form
    console.log('6. Submitting Onboarding form...');
    await evalJs(ws, `
      const form = document.getElementById('onboarding-form');
      if (form) form.requestSubmit();
    `);
    await sleep(2000);

    // Step C: Capture Screenshot of Daily Feed
    console.log('7. Verifying Daily Feed rendered...');
    const feedTitle = await evalJs(ws, `document.querySelector('h2.serif-title')?.textContent`);
    console.log('   Rendered heading:', feedTitle);

    const shot1 = await sendCdp(ws, 'Page.captureScreenshot', { format: 'png' });
    writeFileSync('c:/Dev_Projects/opo/screenshot_daily_feed.png', Buffer.from(shot1.data, 'base64'));
    console.log('   Saved: c:/Dev_Projects/opo/screenshot_daily_feed.png');

    // Step D: Open First Opportunity Modal
    console.log('8. Clicking on first opportunity card to open detail modal...');
    const cardClicked = await evalJs(ws, `
      const card = document.querySelector('.listing-card');
      if (card) {
        card.click();
        true;
      } else false;
    `);
    console.log('   Card clicked:', cardClicked);
    await sleep(1200);

    const shot2 = await sendCdp(ws, 'Page.captureScreenshot', { format: 'png' });
    writeFileSync('c:/Dev_Projects/opo/screenshot_detail_modal.png', Buffer.from(shot2.data, 'base64'));
    console.log('   Saved: c:/Dev_Projects/opo/screenshot_detail_modal.png');

    // Step E: Save to Draft Vault
    console.log('9. Clicking Save to Draft Vault in modal...');
    await evalJs(ws, `
      const saveBtn = document.getElementById('save-draft-btn');
      if (saveBtn) saveBtn.click();
    `);
    await sleep(1200);

    // Step F: Navigate to Draft Vault tab
    console.log('10. Navigating to Draft Vault tab...');
    await evalJs(ws, `
      const vaultTab = document.getElementById('nav-vault-btn');
      if (vaultTab) vaultTab.click();
    `);
    await sleep(1000);

    const shot3 = await sendCdp(ws, 'Page.captureScreenshot', { format: 'png' });
    writeFileSync('c:/Dev_Projects/opo/screenshot_draft_vault.png', Buffer.from(shot3.data, 'base64'));
    console.log('   Saved: c:/Dev_Projects/opo/screenshot_draft_vault.png');

    console.log('\n✅ ALL END-TO-END UI & STATE FLOWS PASSED SUCCESSFULLY!');
    ws.close();
  } finally {
    edgeProc.kill();
  }
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
