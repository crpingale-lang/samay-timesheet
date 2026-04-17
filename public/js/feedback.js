const FEEDBACK_SCHEMAS = {
  manager_feedback: {
    type: 'manager_feedback',
    label: 'Managers Feedback',
    buttonLabel: 'Feedback on managers and firm culture',
    intro: 'Anonymous feedback from articled assistants on workload, guidance, management behavior, culture, and overall experience.',
    sections: [
      {
        title: 'Workload & Hours',
        description: 'Capture pressure around deadlines, task allocation, and work-life strain.',
        questions: [
          { id: 'wl1', type: 'star', label: 'How fairly is work distributed among articled assistants?', lo: 'Very unfair', hi: 'Very fair' },
          { id: 'wl2', type: 'choice', label: 'How often are you required to work beyond standard hours without prior notice?', options: ['Almost never', 'Once a month', 'Weekly', 'Multiple times/week', 'Daily'] },
          { id: 'wl3', type: 'pill', label: 'During peak season, what support do you receive?', multi: true, options: ['Extended deadlines', 'Meal support', 'Additional staff', 'Compensatory off', 'None at all'] },
          { id: 'wl4', type: 'star', label: 'Are you given adequate time to complete assignments with quality?', lo: 'Never', hi: 'Always' },
          { id: 'wl5', type: 'text', label: 'Describe a situation where workload felt unmanageable. What would have helped?' }
        ]
      },
      {
        title: 'Guidance & Learning',
        description: 'Measure the support and learning environment around you.',
        questions: [
          { id: 'gi1', type: 'star', label: 'How well do seniors explain the purpose and context of tasks they assign?', lo: 'Rarely', hi: 'Always' },
          { id: 'gi2', type: 'choice', label: 'How often does the firm conduct internal training sessions for articled assistants?', options: ['Weekly', 'Monthly', 'Once a quarter', 'Rarely', 'Never'] },
          { id: 'gi3', type: 'star', label: 'How accessible and approachable are managers when you need guidance on a task?', lo: 'Not at all', hi: 'Always accessible' },
          { id: 'gi4', type: 'text', label: 'Is there a specific topic you needed guidance on but could not find support for within the firm?' }
        ]
      },
      {
        title: 'Management Behaviour',
        description: 'Capture communication quality, feedback fairness, and leadership behavior.',
        questions: [
          { id: 'mb1', type: 'star', label: 'How respectfully do partners and seniors communicate with you?', lo: 'Disrespectfully', hi: 'Very respectfully' },
          { id: 'mb2', type: 'pill', label: 'Which of these have you personally experienced or witnessed?', multi: true, options: ['Shouting / raised voice', 'Unreasonable criticism', 'Being ignored in meetings', 'Favouritism in work allocation', 'Credit taken for your work', 'Belittled in front of clients', 'None of these'] },
          { id: 'mb3', type: 'choice', label: 'When you ask a question or raise a concern, how does your supervisor respond?', options: ['Always constructively', 'Usually well', 'Sometimes dismissive', 'Often dismissive', 'Never constructively'] },
          { id: 'mb4', type: 'star', label: 'How fair and transparent is the performance feedback you receive?', lo: 'Not at all', hi: 'Very fair' },
          { id: 'mb5', type: 'text', label: 'Describe a management behavior that has negatively affected your motivation or wellbeing.' }
        ]
      },
      {
        title: 'Culture & Environment',
        description: 'Check whether the workplace feels safe, respectful, and learning-oriented.',
        questions: [
          { id: 'cu1', type: 'star', label: 'How safe do you feel raising concerns or disagreeing with a senior without fear of backlash?', lo: 'Not safe at all', hi: 'Completely safe' },
          { id: 'cu2', type: 'pill', label: 'Which words best describe the current culture of the firm?', multi: true, options: ['Supportive', 'Stressful', 'Collaborative', 'Competitive', 'Transparent', 'Political', 'Learning-focused', 'Dismissive', 'Inclusive', 'Hierarchical'] },
          { id: 'cu3', type: 'choice', label: 'How often do seniors acknowledge your contribution or good work?', options: ['Very regularly', 'Occasionally', 'Rarely', 'Almost never', 'Never'] },
          { id: 'cu4', type: 'star', label: 'How valued do you feel as a future professional, not just as labour?', lo: 'Not valued', hi: 'Genuinely valued' },
          { id: 'cu5', type: 'text', label: 'What one cultural change would make you recommend this firm to the next batch?' }
        ]
      },
      {
        title: 'Overall Experience',
        description: 'Capture the final sentiment and retention risk.',
        questions: [
          { id: 'ov1', type: 'nps', label: 'How likely are you to refer a friend to do their articleship here? (0 = never, 10 = definitely)' },
          { id: 'ov2', type: 'pill', label: 'Are you considering leaving before completing your articleship?', multi: false, options: ['No, I am committed', 'I have thought about it', 'Actively exploring options', 'Already decided to leave'] },
          { id: 'ov3', type: 'pill', label: 'If you stay, what is the primary reason?', multi: false, options: ['Learning quality', 'ICAI consequences', 'No better option nearby', 'Peer relationships', 'Hoping things improve', 'Financial need'] },
          { id: 'ov4', type: 'star', label: 'Overall, how would you rate your articleship experience so far?', lo: 'Very poor', hi: 'Excellent' },
          { id: 'ov5', type: 'text', label: "What should the firm's leadership know that they probably don't?" }
        ]
      }
    ]
  },
  article_feedback: {
    type: 'article_feedback',
    label: 'Articles Feedback',
    buttonLabel: 'Feedback on articled assistants',
    intro: 'Anonymous feedback from managers and partners on the quality, reliability, and learning posture of articled assistants.',
    sections: [
      {
        title: 'Professionalism & Delivery',
        description: 'Assess how work is delivered and how reliably tasks are handled.',
        questions: [
          { id: 'ap1', type: 'star', label: 'How professional and responsive is the articled assistant in daily work?', lo: 'Not professional', hi: 'Highly professional' },
          { id: 'ap2', type: 'choice', label: 'How often do deadlines get missed without proactive communication?', options: ['Almost never', 'Occasionally', 'Sometimes', 'Often', 'Very often'] },
          { id: 'ap3', type: 'pill', label: 'What strengths do you most often observe?', multi: true, options: ['Accuracy', 'Responsiveness', 'Curiosity', 'Client communication', 'Ownership', 'Documentation quality', 'Teamwork'] },
          { id: 'ap4', type: 'text', label: 'What recurring issue most affects delivery quality?' }
        ]
      },
      {
        title: 'Learning & Growth',
        description: 'Capture the learning attitude and openness to feedback.',
        questions: [
          { id: 'ag1', type: 'star', label: 'How receptive is the assistant to feedback and correction?', lo: 'Not receptive', hi: 'Very receptive' },
          { id: 'ag2', type: 'choice', label: 'How would you rate their learning speed?', options: ['Very slow', 'Slow', 'Average', 'Fast', 'Very fast'] },
          { id: 'ag3', type: 'pill', label: 'Which areas need the most support?', multi: true, options: ['Technical knowledge', 'Excel / tools', 'Email / communication', 'Client readiness', 'Planning', 'Documentation'] },
          { id: 'ag4', type: 'text', label: 'What should be done to accelerate their growth?' }
        ]
      },
      {
        title: 'Team Behaviour',
        description: 'Check collaboration, responsiveness, and conduct inside the team.',
        questions: [
          { id: 'ab1', type: 'star', label: 'How well do they work with seniors and peers?', lo: 'Poorly', hi: 'Extremely well' },
          { id: 'ab2', type: 'choice', label: 'How responsive are they when the team needs a quick turnaround?', options: ['Never', 'Rarely', 'Sometimes', 'Usually', 'Always'] },
          { id: 'ab3', type: 'pill', label: 'What team traits do they show consistently?', multi: true, options: ['Helpfulness', 'Respect', 'Punctuality', 'Humility', 'Confidence', 'Initiative'] },
          { id: 'ab4', type: 'text', label: 'What one concern would you want leadership to know?' }
        ]
      },
      {
        title: 'Overall',
        description: 'Final view on the assistant and future action.',
        questions: [
          { id: 'ao1', type: 'nps', label: 'How likely are you to recommend reassigning work to this assistant? (0 = not likely, 10 = definitely)' },
          { id: 'ao2', type: 'star', label: 'Overall, how would you rate this articled assistant right now?', lo: 'Very poor', hi: 'Excellent' },
          { id: 'ao3', type: 'text', label: 'What should leadership know that is not obvious from daily work?' }
        ]
      }
    ]
  }
};

const FEEDBACK_TYPE_ORDER = ['manager_feedback', 'article_feedback'];
const FEEDBACK_STATE = {
  banner: {},
  modalType: '',
  sectionIndex: 0,
  answers: {},
  validationErrors: {},
  reportTab: 'manager_feedback',
  reportData: {}
};

feedbackInjectStyles();

function feedbackInjectStyles() {
  if (document.getElementById('feedback-helper-styles')) return;
  const style = document.createElement('style');
  style.id = 'feedback-helper-styles';
  style.textContent = `
    .pill-wrap,.nps-row{display:flex;flex-wrap:wrap;gap:8px}
    .pill{border:1px solid var(--border);background:#fff;color:var(--text);border-radius:999px;padding:9px 14px;cursor:pointer;transition:background .15s ease,border-color .15s ease,color .15s ease,transform .15s ease}
    .pill:hover{transform:translateY(-1px);background:#f8fafc}
    .pill.on{background:var(--primary-bg);border-color:var(--primary-light);color:var(--primary-dark);font-weight:600}
    .q-textarea{width:100%;min-height:100px;border:1px solid var(--border);border-radius:14px;padding:12px 14px;background:#fff;resize:vertical;outline:none;line-height:1.6}
    .q-textarea:focus{border-color:var(--primary);box-shadow:0 0 0 3px rgba(67,56,202,.10)}
    .q-text-hint{margin-top:8px;font-size:12px;line-height:1.45;color:var(--text-muted)}
    .q-error{margin-top:8px;font-size:12px;line-height:1.45;color:#b91c1c}
    .nps-btn{min-width:42px;height:42px;border-radius:12px;border:1px solid var(--border);background:#fff;color:var(--text);transition:background .15s ease,border-color .15s ease,color .15s ease,transform .15s ease}
    .nps-btn:hover{transform:translateY(-1px);background:#f8fafc}
    .nps-btn.on{background:var(--primary-bg);border-color:var(--primary-light);color:var(--primary-dark);font-weight:700}
    .scale-ends,.nps-ends{display:flex;justify-content:space-between;gap:12px;margin-top:8px;color:var(--text-muted);font-size:12px}
    .prog-wrap{margin-bottom:14px}
    .prog-meta{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:6px}
    .prog-label{font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em}
    .prog-pct{font-size:12px;color:var(--primary);font-weight:600}
    .prog-bar{height:6px;background:#e2e8f0;border-radius:999px;overflow:hidden}
    .prog-fill{height:100%;background:var(--primary);border-radius:inherit;transition:width .25s ease}
    .sec-header{margin-bottom:16px}
    .sec-tag{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;background:var(--primary-bg);color:var(--primary-dark);font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;margin-bottom:10px}
    .sec-title{font-size:18px;font-weight:700;letter-spacing:-.03em;margin-bottom:6px}
    .sec-desc{font-size:13px;color:var(--text-muted);line-height:1.6}
    .qblock{padding:16px 0;border-top:1px solid var(--border)}
    .qblock:first-of-type{border-top:none;padding-top:0}
    .q-label{font-size:14px;font-weight:600;line-height:1.5;margin-bottom:10px}
    .question-hint{font-size:12px;color:var(--text-muted);margin-bottom:8px}
    .metricgrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:16px}
    .metric{background:var(--bg);border:1px solid var(--border);border-radius:16px;padding:14px}
    .metric b{display:block;font-size:28px;letter-spacing:-.04em;color:var(--primary)}
    .metric span{display:block;margin-top:4px;font-size:12px;color:var(--text-muted);line-height:1.45}
    .score-row{display:flex;align-items:center;gap:10px;margin:10px 0}
    .score-row label{width:260px;flex:0 0 auto;font-size:13px;color:var(--text-muted);line-height:1.35}
    .score-track{flex:1;height:10px;border-radius:999px;background:#e2e8f0;overflow:hidden}
    .score-fill{height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--primary),var(--primary-light));width:0}
    .score-val{width:44px;text-align:right;font-size:13px;font-weight:700}
    .tag-cloud{display:flex;flex-wrap:wrap;gap:8px}
    .tag{display:inline-flex;align-items:center;gap:8px;background:#fff;border:1px solid var(--border);border-radius:999px;padding:7px 12px;font-size:12px}
    .tag-count{min-width:22px;padding:2px 6px;border-radius:999px;background:var(--primary);color:#fff;text-align:center;font-size:11px;font-weight:700}
    .empty{padding:20px 10px;color:var(--text-muted);text-align:center}
  `;
  document.head.appendChild(style);
}

function feedbackEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function feedbackNormalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function feedbackAllowedTypes(user = getUser()) {
  const role = feedbackNormalizeRole(user?.role);
  if (role === 'article') return ['manager_feedback'];
  if (role === 'manager' || role === 'partner') return ['article_feedback'];
  return [];
}

function feedbackPrimaryType(user = getUser()) {
  return feedbackAllowedTypes(user)[0] || '';
}

function feedbackTypeLabel(type) {
  return FEEDBACK_SCHEMAS[type]?.label || 'Feedback';
}

function feedbackCurrentSchema(type = FEEDBACK_STATE.modalType) {
  return FEEDBACK_SCHEMAS[type] || null;
}

function feedbackWordCount(value) {
  const words = String(value || '').trim().match(/\S+/g);
  return words ? words.length : 0;
}

function feedbackTextValidationMessage(value) {
  const count = feedbackWordCount(value);
  if (!count) return 'This field is required. Please enter at least 20 words.';
  if (count < 20) return `Please enter at least 20 words. You have ${count}.`;
  return '';
}

function feedbackTextQuestions(schema = feedbackCurrentSchema()) {
  if (!schema) return [];
  return schema.sections.flatMap(section => section.questions.filter(question => question.type === 'text'));
}

function feedbackValidationMessageMap(errors = []) {
  return Object.fromEntries(errors.map(error => [error.id, error.message]));
}

function feedbackSetTextValidation(questionId, message) {
  const input = document.getElementById(`feedback-text-${questionId}`);
  const errorEl = document.getElementById(`feedback-error-${questionId}`);
  if (input) {
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
  }
  if (errorEl) {
    errorEl.textContent = message || '';
    errorEl.style.display = message ? 'block' : 'none';
  }
}

function feedbackApplyValidationErrors(errors = []) {
  FEEDBACK_STATE.validationErrors = feedbackValidationMessageMap(errors);
  feedbackTextQuestions().forEach(question => {
    feedbackSetTextValidation(question.id, FEEDBACK_STATE.validationErrors[question.id] || '');
  });
}

function feedbackValidateTextQuestions(items = []) {
  const questions = items.flatMap(item => (Array.isArray(item?.questions) ? item.questions : [item]));
  return questions
    .filter(question => question && question.type === 'text')
    .map(question => {
      const message = feedbackTextValidationMessage(FEEDBACK_STATE.answers[question.id]);
      return message ? { id: question.id, message } : null;
    })
    .filter(Boolean);
}

function feedbackEnsureModal() {
  if (document.getElementById('feedback-modal')) return;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <div class="modal-overlay" id="feedback-modal">
      <div class="modal" style="max-width:920px;width:min(92vw,920px);">
        <div class="modal-header">
          <div class="modal-header-copy">
            <div class="modal-kicker">Anonymous feedback</div>
            <div class="modal-title" id="feedback-modal-title">Feedback</div>
            <div class="modal-subtitle" id="feedback-modal-subtitle"></div>
          </div>
          <button class="modal-close" type="button" onclick="closeModal('feedback-modal')" aria-label="Close feedback modal">&times;</button>
        </div>
        <div class="modal-body" id="feedback-modal-body"></div>
      </div>
    </div>`;
  document.body.appendChild(wrapper.firstElementChild);
}

function feedbackRenderQuestion(question) {
  const value = FEEDBACK_STATE.answers[question.id];
  let body = '';
  if (question.type === 'star') {
    body = `
    <div class="star-row" role="group" aria-label="${feedbackEscape(question.label)}">
        ${[1, 2, 3, 4, 5].map(n => `
          <button class="btn ${value >= n ? 'btn-primary' : 'btn-ghost'} btn-sm" type="button" onclick="feedbackAnswer('${question.id}', ${n})" style="min-width:42px;">★</button>
        `).join('')}
      </div>
      <div class="scale-ends"><span>${feedbackEscape(question.lo || 'Low')}</span><span>${feedbackEscape(question.hi || 'High')}</span></div>
    `;
  } else if (question.type === 'choice') {
    body = `<div class="pill-wrap">${question.options.map(option => `
      <button class="pill${value === option ? ' on' : ''}" type="button" onclick="feedbackAnswer('${question.id}', '${String(option).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')">${feedbackEscape(option)}</button>
    `).join('')}</div>`;
  } else if (question.type === 'pill') {
    const selected = Array.isArray(value) ? value : [];
    body = `
      ${question.multi ? '<div class="question-hint">Select all that apply</div>' : ''}
      <div class="pill-wrap">
        ${question.options.map(option => `
          <button class="pill${selected.includes(option) || value === option ? ' on' : ''}" type="button" onclick="${question.multi ? `feedbackToggle('${question.id}', '${String(option).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')` : `feedbackAnswer('${question.id}', '${String(option).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')`}">${feedbackEscape(option)}</button>
        `).join('')}
      </div>
    `;
  } else if (question.type === 'text') {
    const error = FEEDBACK_STATE.validationErrors[question.id] || '';
    body = `
      <textarea class="q-textarea" id="feedback-text-${question.id}" placeholder="Write your response here..." required aria-required="true" aria-invalid="${error ? 'true' : 'false'}" aria-describedby="feedback-error-${question.id}" oninput="feedbackTextAnswer('${question.id}', this.value, this)">${feedbackEscape(value || '')}</textarea>
      <div class="q-text-hint">Required. Minimum 20 words.</div>
      <div class="q-error" id="feedback-error-${question.id}"${error ? '' : ' style="display:none;"'}>${feedbackEscape(error)}</div>
    `;
  } else if (question.type === 'nps') {
    body = `
      <div class="nps-row">
        ${Array.from({ length: 11 }, (_, i) => `
          <button class="nps-btn${value === i ? ' on' : ''}" type="button" onclick="feedbackAnswer('${question.id}', ${i})">${i}</button>
        `).join('')}
      </div>
      <div class="nps-ends"><span>Not likely</span><span>Extremely likely</span></div>
    `;
  }

  return `
    <div class="qblock">
      <div class="q-label">${feedbackEscape(question.label)}</div>
      ${body}
    </div>
  `;
}

function feedbackRenderSection(type) {
  const schema = feedbackCurrentSchema(type);
  if (!schema) return '';
  const section = schema.sections[FEEDBACK_STATE.sectionIndex];
  const progress = schema.sections.length > 1
    ? Math.round((FEEDBACK_STATE.sectionIndex / (schema.sections.length - 1)) * 100)
    : 100;

  return `
    <div class="prog-wrap">
      <div class="prog-meta">
        <span class="prog-label">${schema.buttonLabel}</span>
        <span class="prog-pct">${FEEDBACK_STATE.sectionIndex + 1} / ${schema.sections.length}</span>
      </div>
      <div class="prog-bar"><div class="prog-fill" style="width:${progress}%"></div></div>
    </div>
    <div class="sec-header">
      <div class="sec-tag">Anonymous survey</div>
      <div class="sec-title">${feedbackEscape(section.title)}</div>
      <div class="sec-desc">${feedbackEscape(section.description)}</div>
    </div>
    ${section.questions.map(feedbackRenderQuestion).join('')}
    <div class="nav-row">
      <button class="btn" type="button" onclick="feedbackPrev()">${FEEDBACK_STATE.sectionIndex === 0 ? 'Cancel' : 'Previous section'}</button>
      <span class="nav-step">${FEEDBACK_STATE.sectionIndex + 1} of ${schema.sections.length}</span>
      <button class="btn btn-primary" type="button" onclick="feedbackNext()">${FEEDBACK_STATE.sectionIndex === schema.sections.length - 1 ? 'Submit feedback' : 'Next section'}</button>
    </div>
  `;
}

function feedbackRenderBanner(status = {}) {
  const host = document.getElementById('feedback-banner');
  if (!host) return;
  const type = feedbackPrimaryType();
  if (!type) {
    host.innerHTML = '';
    host.style.display = 'none';
    return;
  }

  const submitted = Array.isArray(status.submitted_types) && status.submitted_types.includes(type);
  host.style.display = '';
  host.innerHTML = `
    <div class="alert ${submitted ? 'alert-success' : 'alert-info'}" style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;">
      <div style="min-width:0;">
        <div style="font-weight:700;margin-bottom:4px;">${submitted ? 'Feedback submitted' : feedbackTypeLabel(type)}</div>
        <div style="font-size:13px;line-height:1.6;">
          ${submitted
            ? 'Your anonymous feedback has already been sent. Authorized reviewers will only see the de-identified report.'
            : FEEDBACK_SCHEMAS[type].intro}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-shrink:0;">
        <span class="badge ${submitted ? 'badge-approved' : 'badge-pending_manager'}">${submitted ? 'Submitted' : 'Pending'}</span>
        <button class="btn btn-primary btn-sm" type="button" onclick="feedbackOpenForm('${type}')">${submitted ? 'View status' : 'Submit feedback'}</button>
      </div>
    </div>
  `;
}

async function feedbackLoadStatus() {
  const type = feedbackPrimaryType();
  if (!type) return null;
  try {
    const status = await apiFetch('/feedback/status');
    FEEDBACK_STATE.banner = status || {};
    feedbackRenderBanner(status || {});
    return status;
  } catch (error) {
    console.warn('Unable to load feedback status', error);
    feedbackRenderBanner({});
    return null;
  }
}

function feedbackOpenForm(type = feedbackPrimaryType()) {
  const schema = feedbackCurrentSchema(type);
  if (!schema) return;
  FEEDBACK_STATE.modalType = type;
  FEEDBACK_STATE.sectionIndex = 0;
  FEEDBACK_STATE.answers = {};
  FEEDBACK_STATE.validationErrors = {};
  feedbackEnsureModal();
  feedbackRenderModal();
  openModal('feedback-modal');
}

function feedbackRenderModal() {
  const schema = feedbackCurrentSchema();
  if (!schema) return;
  const title = document.getElementById('feedback-modal-title');
  const subtitle = document.getElementById('feedback-modal-subtitle');
  const body = document.getElementById('feedback-modal-body');
  if (!title || !subtitle || !body) return;
  title.textContent = schema.label;
  subtitle.textContent = schema.intro;
  body.innerHTML = feedbackRenderSection(schema.type);
}

function feedbackAnswer(id, value) {
  FEEDBACK_STATE.answers[id] = value;
  feedbackRenderModal();
}

function feedbackTextAnswer(id, value) {
  FEEDBACK_STATE.answers[id] = value;
  const currentError = FEEDBACK_STATE.validationErrors[id];
  if (currentError) {
    feedbackSetTextValidation(id, feedbackTextValidationMessage(value));
  }
}

function feedbackToggle(id, value) {
  const current = Array.isArray(FEEDBACK_STATE.answers[id]) ? [...FEEDBACK_STATE.answers[id]] : [];
  const index = current.indexOf(value);
  if (index >= 0) current.splice(index, 1);
  else current.push(value);
  FEEDBACK_STATE.answers[id] = current;
  feedbackRenderModal();
}

function feedbackPrev() {
  if (FEEDBACK_STATE.sectionIndex === 0) {
    closeModal('feedback-modal');
    return;
  }
  FEEDBACK_STATE.sectionIndex -= 1;
  feedbackRenderModal();
}

async function feedbackNext() {
  const schema = feedbackCurrentSchema();
  if (!schema) return;
  const currentSection = schema.sections[FEEDBACK_STATE.sectionIndex];
  const sectionErrors = feedbackValidateTextQuestions(currentSection ? [currentSection] : []);
  if (sectionErrors.length) {
    feedbackApplyValidationErrors(sectionErrors);
    const firstInvalid = document.getElementById(`feedback-text-${sectionErrors[0].id}`);
    firstInvalid?.focus();
    firstInvalid?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    toast('Please complete the required text responses.', 'error');
    return;
  }
  if (FEEDBACK_STATE.sectionIndex < schema.sections.length - 1) {
    FEEDBACK_STATE.sectionIndex += 1;
    feedbackApplyValidationErrors([]);
    feedbackRenderModal();
    return;
  }

  const submissionErrors = feedbackValidateTextQuestions(schema.sections);
  if (submissionErrors.length) {
    feedbackApplyValidationErrors(submissionErrors);
    const firstInvalid = document.getElementById(`feedback-text-${submissionErrors[0].id}`);
    firstInvalid?.focus();
    firstInvalid?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    toast('Please complete the required text responses.', 'error');
    return;
  }

  try {
    await apiFetch('/feedback/submit', {
      method: 'POST',
      body: {
        feedback_type: schema.type,
        answers: FEEDBACK_STATE.answers
      }
    });
    toast('Feedback submitted successfully', 'success');
    closeModal('feedback-modal');
    await feedbackLoadStatus();
  } catch (error) {
    toast(error.message || 'Unable to submit feedback', 'error');
  }
}

function feedbackSelectedRange() {
  const from = document.getElementById('filter-from')?.value || '';
  const to = document.getElementById('filter-to')?.value || '';
  return { from, to };
}

function feedbackNormalizeValue(value) {
  return String(value || '').trim();
}

function feedbackAggregateResponses(schema, responses = []) {
  const counts = {};
  const starValues = [];
  const textResponses = [];

  schema.sections.forEach(section => {
    section.questions.forEach(question => {
      if (question.type === 'star') {
        const values = responses.map(row => parseFloat(row.answers?.[question.id])).filter(value => Number.isFinite(value) && value > 0);
        if (values.length) {
          starValues.push({
            id: question.id,
            label: question.label,
            average: values.reduce((sum, value) => sum + value, 0) / values.length,
            count: values.length
          });
        }
      } else if (question.type === 'choice' || question.type === 'pill' || question.type === 'nps') {
        const map = new Map();
        responses.forEach(row => {
          const raw = row.answers?.[question.id];
          const items = Array.isArray(raw) ? raw : raw === undefined || raw === null || raw === '' ? [] : [raw];
          items.forEach(item => {
            const normalized = feedbackNormalizeValue(item);
            if (!normalized) return;
            map.set(normalized, (map.get(normalized) || 0) + 1);
          });
        });
        if (map.size) {
          counts[question.id] = {
            label: question.label,
            items: [...map.entries()].sort((a, b) => b[1] - a[1])
          };
        }
      } else if (question.type === 'text') {
        const comments = responses
          .map(row => feedbackNormalizeValue(row.answers?.[question.id]))
          .filter(value => value.length > 0);
        if (comments.length) {
          textResponses.push({
            id: question.id,
            label: question.label,
            items: comments
          });
        }
      }
    });
  });

  const overallStars = starValues.reduce((sum, item) => sum + item.average, 0);
  return {
    totalResponses: responses.length,
    averageStarScore: starValues.length ? overallStars / starValues.length : 0,
    starValues,
    counts,
    textResponses
  };
}

function feedbackRenderTagCloud(items = []) {
  if (!items.length) return '<div class="empty">No responses yet.</div>';
  return `<div class="tag-cloud">${items.map(([label, count]) => `<span class="tag">${feedbackEscape(label)} <span class="tag-count">${count}</span></span>`).join('')}</div>`;
}

function feedbackRenderReport(type, payload = {}) {
  const schema = feedbackCurrentSchema(type);
  const responses = Array.isArray(payload.responses) ? payload.responses : [];
  if (!schema) return '<div class="empty">No feedback schema available.</div>';
  if (!responses.length) {
    return `<div class="empty">No ${feedbackEscape(schema.label.toLowerCase())} submitted yet.</div>`;
  }

  const aggregate = feedbackAggregateResponses(schema, responses);
  const averageScore = aggregate.averageStarScore ? aggregate.averageStarScore.toFixed(1) : '0.0';
  const starSummary = aggregate.starValues.map(item => {
    const pct = Math.round((item.average / 5) * 100);
    return `
      <div class="score-row">
        <label>${feedbackEscape(item.label)}</label>
        <div class="score-track"><div class="score-fill" style="width:${pct}%"></div></div>
        <div class="score-val">${item.average.toFixed(1)}</div>
      </div>
    `;
  }).join('');
  const countSummary = Object.values(aggregate.counts).map(item => `
    <div style="margin-bottom:18px;">
      <div class="panel-title">${feedbackEscape(item.label)}</div>
      <div class="tag-cloud">${item.items.map(([label, count]) => `<span class="tag">${feedbackEscape(label)} <span class="count">${count}</span></span>`).join('')}</div>
    </div>
  `).join('');
  const comments = aggregate.textResponses.map(item => `
    <div style="margin-bottom:18px;">
      <div class="panel-title">${feedbackEscape(item.label)}</div>
      ${item.items.map(comment => `<div class="comment"><p>${feedbackEscape(comment)}</p></div>`).join('')}
    </div>
  `).join('');

  return `
    <div class="metricgrid" style="margin-bottom:16px;">
      <div class="metric"><b>${responses.length}</b><span>Anonymous responses</span></div>
      <div class="metric"><b>${averageScore}</b><span>Average star score</span></div>
      <div class="metric"><b>${aggregate.starValues.length}</b><span>Star questions scored</span></div>
      <div class="metric"><b>${aggregate.textResponses.length}</b><span>Open response prompts</span></div>
    </div>
    <div class="panel-title">Question averages</div>
    ${starSummary || '<div class="empty">No rating questions answered yet.</div>'}
    <div class="panel-title" style="margin-top:18px;">Top selections</div>
    ${countSummary || '<div class="empty">No categorical answers yet.</div>'}
    <div class="panel-title" style="margin-top:18px;">Open responses</div>
    ${comments || '<div class="empty">No open responses yet.</div>'}
  `;
}

async function feedbackLoadReport(type = FEEDBACK_STATE.reportTab) {
  const schema = feedbackCurrentSchema(type);
  if (!schema) return;
  const { from, to } = feedbackSelectedRange();
  const query = new URLSearchParams({ type: schema.type });
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  const body = document.getElementById('feedback-report-body');
  const syncEl = document.getElementById('feedback-report-sync');
  if (body) {
    body.innerHTML = '<div class="empty">Loading feedback...</div>';
  }
  if (syncEl) {
    syncEl.textContent = 'Refreshing...';
    syncEl.className = 'report-sync loading';
  }
  try {
    const payload = await apiFetch(`/feedback/reports?${query.toString()}`);
    FEEDBACK_STATE.reportData[type] = payload;
    if (body) {
      body.innerHTML = feedbackRenderReport(type, payload);
    }
    if (syncEl) {
      syncEl.textContent = `Updated ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
      syncEl.className = 'report-sync success';
    }
    return payload;
  } catch (error) {
    if (body) {
      body.innerHTML = `<div class="empty">${feedbackEscape(error.message || 'Unable to load feedback report')}</div>`;
    }
    if (syncEl) {
      syncEl.textContent = 'Load failed';
      syncEl.className = 'report-sync error';
    }
    return null;
  }
}

function feedbackRenderReportTabs() {
  const host = document.getElementById('feedback-report-tabs');
  if (!host) return;
  const user = getUser();
  const selectedTypes = FEEDBACK_TYPE_ORDER.filter(type => feedbackAllowedTypes(user).includes(type) || hasPermission('feedback.view'));
  if (!selectedTypes.length) {
    host.innerHTML = '';
    return;
  }
  host.innerHTML = selectedTypes.map((type, index) => `
    <button class="tab${FEEDBACK_STATE.reportTab === type ? ' active' : ''}" type="button" onclick="feedbackSwitchReportTab('${type}', this)">${feedbackEscape(feedbackTypeLabel(type))}</button>
  `).join('');
}

function feedbackSwitchReportTab(type, btn) {
  FEEDBACK_STATE.reportTab = type;
  const tabs = document.querySelectorAll('#feedback-report-tabs .tab');
  tabs.forEach(tab => tab.classList.remove('active'));
  if (btn) btn.classList.add('active');
  feedbackLoadReport(type);
}

function feedbackInitDashboard() {
  feedbackLoadStatus();
}

async function feedbackInitReports() {
  if (!document.getElementById('feedback-section')) return;
  if (!hasPermission('feedback.view')) {
    const section = document.getElementById('feedback-section');
    if (section) section.style.display = 'none';
    return;
  }
  feedbackRenderReportTabs();
  FEEDBACK_STATE.reportTab = feedbackCurrentSchema(FEEDBACK_STATE.reportTab) ? FEEDBACK_STATE.reportTab : 'manager_feedback';
  await feedbackLoadReport(FEEDBACK_STATE.reportTab);
}

window.FEEDBACK_SCHEMAS = FEEDBACK_SCHEMAS;
window.feedbackAllowedTypes = feedbackAllowedTypes;
window.feedbackPrimaryType = feedbackPrimaryType;
window.feedbackTypeLabel = feedbackTypeLabel;
window.feedbackOpenForm = feedbackOpenForm;
window.feedbackAnswer = feedbackAnswer;
window.feedbackToggle = feedbackToggle;
window.feedbackPrev = feedbackPrev;
window.feedbackNext = feedbackNext;
window.feedbackLoadStatus = feedbackLoadStatus;
window.feedbackRenderBanner = feedbackRenderBanner;
window.feedbackInitDashboard = feedbackInitDashboard;
window.feedbackInitReports = feedbackInitReports;
window.feedbackSwitchReportTab = feedbackSwitchReportTab;
window.feedbackLoadReport = feedbackLoadReport;
