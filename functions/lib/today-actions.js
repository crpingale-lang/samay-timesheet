const MAX_TODAY_ACTIONS = 5;

function normalizePermissions(permissions) {
  return new Set(Array.isArray(permissions) ? permissions.map(value => String(value || '').trim()).filter(Boolean) : []);
}

function isWeekend(dateValue) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateValue || ''));
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCDay() === 0 || date.getUTCDay() === 6;
}

function buildDayContext({ today, holiday_title: holidayTitle = '' } = {}) {
  const weekend = isWeekend(today);
  const holiday = String(holidayTitle || '').trim();
  return {
    date: String(today || ''),
    is_weekend: weekend,
    is_holiday: !!holiday,
    is_workday: !weekend && !holiday,
    label: holiday || (weekend ? 'Weekend' : 'Working day')
  };
}

function buildTodayActions(context = {}) {
  const permissions = normalizePermissions(context.permissions);
  const dayContext = context.day_context || buildDayContext(context);
  const actions = [];
  let sequence = 0;

  const add = (priority, action) => {
    const href = String(action.href || '');
    if (!href.startsWith('/') || href.startsWith('//')) return;
    actions.push({
      ...action,
      count: action.count == null ? null : (Number.isFinite(Number(action.count)) ? Number(action.count) : null),
      priority,
      sequence: sequence += 1
    });
  };

  const rejectedCount = Math.max(0, Number(context.rejected_count) || 0);
  if (rejectedCount && permissions.has('timesheets.edit_own')) {
    add(10, {
      id: 'fix-rejected-time',
      category: 'timesheet',
      tone: 'danger',
      title: 'Fix rejected time entries',
      description: `${rejectedCount} ${rejectedCount === 1 ? 'entry needs' : 'entries need'} correction before resubmission.`,
      count: rejectedCount,
      href: '/my-timesheets.html?status=rejected',
      action_label: 'Review entries'
    });
  }

  const attendance = context.attendance || {};
  const attendanceStatus = String(attendance.status || 'not_available');
  if (permissions.has('attendance.create_own') && attendanceStatus === 'checked_in') {
    add(15, {
      id: 'complete-checkout',
      category: 'attendance',
      tone: 'warning',
      title: 'Complete today\'s checkout',
      description: attendance.entry_time ? `You checked in at ${attendance.entry_time}. Record checkout when your workday ends.` : 'Attendance is still open for today.',
      count: null,
      href: '/attendance.html',
      action_label: 'Open attendance'
    });
  } else if (permissions.has('attendance.create_own') && dayContext.is_workday && attendanceStatus === 'not_checked_in') {
    add(18, {
      id: 'check-in',
      category: 'attendance',
      tone: 'primary',
      title: 'Check in for today',
      description: 'No attendance check-in is recorded for this working day.',
      count: null,
      href: '/attendance.html',
      action_label: 'Check in'
    });
  }

  const pendingApprovals = Math.max(0, Number(context.pending_approvals) || 0);
  if (pendingApprovals && permissions.has('approvals.approve_manager')) {
    add(20, {
      id: 'review-timesheets',
      category: 'approval',
      tone: 'warning',
      title: 'Review team timesheets',
      description: `${pendingApprovals} ${pendingApprovals === 1 ? 'submission is' : 'submissions are'} waiting for your decision.`,
      count: pendingApprovals,
      href: '/approvals.html',
      action_label: 'Open approvals'
    });
  }

  const correctionCount = Math.max(0, Number(context.pending_attendance_corrections) || 0);
  if (correctionCount && permissions.has('attendance.approve_corrections')) {
    add(25, {
      id: 'review-attendance-corrections',
      category: 'attendance',
      tone: 'warning',
      title: 'Review attendance corrections',
      description: `${correctionCount} ${correctionCount === 1 ? 'request needs' : 'requests need'} a decision.`,
      count: correctionCount,
      href: '/attendance.html#corrections-section',
      action_label: 'Review requests'
    });
  }

  const collaborationCount = Math.max(0, Number(context.collaboration_requests) || 0);
  if (collaborationCount && permissions.has('timesheets.view_own')) {
    add(30, {
      id: 'review-collaboration',
      category: 'timesheet',
      tone: 'info',
      title: 'Review shared time requests',
      description: `${collaborationCount} ${collaborationCount === 1 ? 'request is' : 'requests are'} waiting for you.`,
      count: collaborationCount,
      href: `/timesheet.html?date=${encodeURIComponent(dayContext.date)}&view=daily`,
      action_label: 'Review requests'
    });
  }

  const draftCount = Math.max(0, Number(context.draft_count) || 0);
  if (draftCount && permissions.has('timesheets.submit_own')) {
    add(40, {
      id: 'submit-drafts',
      category: 'timesheet',
      tone: 'primary',
      title: 'Submit draft time entries',
      description: `${draftCount} ${draftCount === 1 ? 'draft is' : 'drafts are'} saved but not submitted.`,
      count: draftCount,
      href: '/my-timesheets.html?status=draft',
      action_label: 'Open drafts'
    });
  }

  const udinReviewCount = Math.max(0, Number(context.pending_udin_reviews) || 0);
  if (udinReviewCount && permissions.has('udin.review')) {
    add(45, {
      id: 'review-udin',
      category: 'udin',
      tone: 'info',
      title: 'Review UDIN requests',
      description: `${udinReviewCount} ${udinReviewCount === 1 ? 'request is' : 'requests are'} pending review.`,
      count: udinReviewCount,
      href: '/udin.html?scope=review',
      action_label: 'Open UDIN review'
    });
  }

  const todayEntryCount = Math.max(0, Number(context.today_entry_count) || 0);
  if (!todayEntryCount && dayContext.is_workday && permissions.has('timesheets.create_own')) {
    add(50, {
      id: 'log-today',
      category: 'timesheet',
      tone: 'primary',
      title: 'Start today\'s time log',
      description: 'No time entry has been recorded for this working day.',
      count: null,
      href: `/timesheet.html?date=${encodeURIComponent(dayContext.date)}&view=daily`,
      action_label: 'Log time'
    });
  }

  if (!actions.length && permissions.has('timesheets.view_own')) {
    add(90, {
      id: 'review-today',
      category: 'timesheet',
      tone: 'success',
      title: dayContext.is_workday ? 'You are clear for now' : dayContext.label,
      description: dayContext.is_workday ? 'No open workflow exceptions need your attention.' : 'No working-day reminder is due. You can still review or record time if needed.',
      count: null,
      href: `/timesheet.html?date=${encodeURIComponent(dayContext.date)}&view=daily`,
      action_label: 'Review today'
    });
  }

  return actions
    .sort((left, right) => left.priority - right.priority || left.sequence - right.sequence)
    .slice(0, MAX_TODAY_ACTIONS)
    .map(({ priority, sequence: _sequence, ...action }) => action);
}

module.exports = {
  MAX_TODAY_ACTIONS,
  buildDayContext,
  buildTodayActions,
  isWeekend
};
