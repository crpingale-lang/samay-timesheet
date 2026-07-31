const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'public', 'timesheet.html'), 'utf8');
const match = page.match(/function updateModalGuidance\(\) \{[\s\S]*?\r?\n\}\r?\n\r?\nfunction validateModalTimeline/);
assert(match, 'updateModalGuidance could not be extracted');

const elements = new Map([
  ['modal-entry-id', { value: '' }],
  ['modal-start-time', { value: '' }],
  ['modal-end-time', { value: '' }],
  ['modal-hours', { value: '' }],
  ['modal-status', { textContent: 'Draft' }],
  ['modal-schedule-note', { textContent: '' }],
  ['modal-status-note', { textContent: '' }],
  ['save-entry-btn', { textContent: '', disabled: false }],
  ['submit-entry-btn', { textContent: '', disabled: false }],
  ['delete-entry-btn', { textContent: '', disabled: false }]
]);
const sandbox = {
  document: { getElementById: id => elements.get(id) },
  modalEntryMode: 'time',
  entrySaveInFlight: false
};
vm.createContext(sandbox);
vm.runInContext(match[0].replace(/\r?\n\r?\nfunction validateModalTimeline$/, ''), sandbox);

function button(id) {
  return elements.get(id);
}

sandbox.updateModalGuidance();
assert.equal(button('save-entry-btn').disabled, false, 'new draft save must start enabled');
assert.equal(button('submit-entry-btn').disabled, false, 'Save & Add Another must start enabled');
assert.equal(button('delete-entry-btn').disabled, true, 'unsaved entries cannot be deleted');

sandbox.entrySaveInFlight = true;
sandbox.updateModalGuidance();
assert.equal(button('save-entry-btn').disabled, true, 'save must lock during a request');
assert.equal(button('submit-entry-btn').disabled, true, 'secondary save must lock during a request');
assert.equal(button('delete-entry-btn').disabled, true, 'delete must lock during a request');

sandbox.entrySaveInFlight = false;
sandbox.updateModalGuidance();
assert.equal(button('save-entry-btn').disabled, false, 'save must recover after request completion');
assert.equal(button('submit-entry-btn').disabled, false, 'secondary save must recover after request completion');

elements.get('modal-entry-id').value = 'entry-1';
elements.get('modal-status').textContent = 'Approved';
sandbox.updateModalGuidance();
assert.equal(button('save-entry-btn').disabled, true, 'approved entries must remain locked');
assert.equal(button('submit-entry-btn').disabled, true, 'approved entries cannot be resubmitted');
assert.equal(button('delete-entry-btn').disabled, true, 'approved entries cannot be deleted');

elements.get('modal-status').textContent = 'Draft';
sandbox.updateModalGuidance();
assert.equal(button('save-entry-btn').disabled, false, 'saved drafts remain editable');
assert.equal(button('submit-entry-btn').disabled, false, 'saved drafts remain submittable');
assert.equal(button('delete-entry-btn').disabled, false, 'saved drafts remain deletable');

assert(!page.includes("document.getElementById('save-entry-btn').disabled = true"), 'save state must have one owner');
assert(/finally\s*\{\s*entrySaveInFlight = false;\s*updateModalGuidance\(\);/s.test(page), 'finally must restore the button state');

process.stdout.write('Entry save button state flow passed.\n');
