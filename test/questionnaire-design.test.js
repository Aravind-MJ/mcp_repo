import assert from 'node:assert/strict';
import test from 'node:test';
import { Script } from 'node:vm';
import { renderQuestionnaire } from '../src/questionnaire/ui.js';

function definition(overrides = {}) {
  return {
    questionnaire_id:'A'.repeat(24), revision:1, status:'open', title:'An intentional questionnaire',
    description:'First paragraph.\n\nSecond paragraph.',
    questions:[{id:'direction',type:'single_choice',title:'Choose a direction',required:true,options:[{value:'change',label:'Change'},{value:'keep',label:'Keep'}],children:[{id:'detail',type:'long_text',title:'What should change?',required:true,show_when:['change']}]}],
    settings:{accent_color:'#6d5dfc',show_progress:true,submit_label:'Send feedback',completion_message:'Feedback received.'},
    ...overrides,
  };
}

test('questionnaire details use self-contained Catppuccin surfaces and motion-safe navigation', () => {
  const html=renderQuestionnaire(definition(),'design-test-nonce');
  for(const hex of ['#1e1e2e','#181825','#cdd6f4','#cba6f7','#b4befe','#a6e3a1','#f38ba8'])assert.ok(html.toLowerCase().includes(hex),`Catppuccin ${hex}`);
  assert.match(html,/Next unanswered/);
  assert.match(html,/<details\b/);
  assert.match(html,/prefers-reduced-motion/);
  assert.match(html,/animation:\s*none/);
  assert.equal((html.match(/<h1\b/g)||[]).length,1);
  assert.doesNotMatch(html,/<(?:script[^>]*src|link[^>]*rel="stylesheet")|@import|fonts\.google/);
  assert.match(html,/aria-label="Question navigation"/);
  assert.match(html,/data-parent-question="direction"/);
  assert.match(html,/response_scope/);
  for(const script of html.matchAll(/<script nonce="design-test-nonce">([\s\S]*?)<\/script>/g)) new Script(script[1]);
});

test('new details layout preserves closed state and disabled-progress settings', () => {
  const closed=renderQuestionnaire(definition({status:'closed'}),'design-test-nonce');
  assert.match(closed,/This questionnaire is closed/);
  assert.doesNotMatch(closed,/<button[^>]*id="submit-response"/);
  const settings={...definition().settings,show_progress:false};
  const noProgress=renderQuestionnaire(definition({settings}),'design-test-nonce');
  assert.doesNotMatch(noProgress,/role="progressbar"/);
  assert.match(noProgress,/Send feedback/);
});
