const INDIA_OFFSET_MS = 330 * 60 * 1000;
const MAX_AUTO_CAPTURE_MS = 24 * 60 * 60 * 1000;

function parseTimestamp(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function localDateParts(timestamp) {
  const date = new Date(timestamp + INDIA_OFFSET_MS);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes()
  };
}

function isoDate(parts) {
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function hhmm(parts) {
  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

function timeToMinutes(value) {
  if (!/^\d{2}:\d{2}$/.test(String(value || ''))) return null;
  const [hours, minutes] = String(value).split(':').map(Number);
  if (hours > 23 || minutes > 59) return null;
  return (hours * 60) + minutes;
}

function hasOverlap(startTime, endTime, entries = []) {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  if (start == null || end == null || end <= start) return false;
  return entries.some(entry => {
    const existingStart = timeToMinutes(entry.start_time);
    const existingEnd = timeToMinutes(entry.end_time);
    if (existingStart == null || existingEnd == null) return false;
    return start < existingEnd && existingStart < end;
  });
}

function roundedHours(milliseconds) {
  return Math.max(0.01, Number((milliseconds / 3600000).toFixed(4)));
}

function splitAcrossIndiaDates(startedAtMs, stoppedAtMs) {
  const segments = [];
  let cursor = startedAtMs + INDIA_OFFSET_MS;
  const end = stoppedAtMs + INDIA_OFFSET_MS;

  while (cursor < end) {
    const local = new Date(cursor);
    const nextMidnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1);
    const segmentEnd = Math.min(nextMidnight, end);
    segments.push({
      entry_date: isoDate(localDateParts(cursor - INDIA_OFFSET_MS)),
      milliseconds: segmentEnd - cursor
    });
    cursor = segmentEnd;
  }

  return segments;
}

function buildDraftEntries(session, stoppedAt, existingByDate = {}) {
  const startedAtMs = parseTimestamp(session?.started_at);
  const stoppedAtMs = parseTimestamp(stoppedAt);
  if (startedAtMs == null || stoppedAtMs == null || stoppedAtMs <= startedAtMs) {
    throw new Error('Timer timestamps are invalid');
  }

  const elapsedMs = stoppedAtMs - startedAtMs;
  const elapsedSeconds = Math.max(1, Math.round(elapsedMs / 1000));
  const base = {
    client_id: session.client_id || null,
    task_type: session.task_type,
    description: session.description || '',
    work_classification: session.work_classification || 'client_work',
    billable: (session.work_classification || 'client_work') === 'client_work' ? 1 : 0,
    status: 'draft'
  };

  if (elapsedMs > MAX_AUTO_CAPTURE_MS) {
    return {
      entries: [],
      elapsed_seconds: elapsedSeconds,
      warning: 'This timer ran for more than 24 hours, so Samay stopped it without creating an assumed draft. Please add the corrected time manually.'
    };
  }

  const startParts = localDateParts(startedAtMs);
  const stopParts = localDateParts(stoppedAtMs);
  const startDate = isoDate(startParts);
  const stopDate = isoDate(stopParts);

  if (startDate === stopDate) {
    const startTime = hhmm(startParts);
    const endTime = hhmm(stopParts);
    const minuteWindowIsValid = timeToMinutes(endTime) > timeToMinutes(startTime);
    const overlaps = minuteWindowIsValid && hasOverlap(startTime, endTime, existingByDate[startDate] || []);

    if (minuteWindowIsValid && !overlaps) {
      return {
        entries: [{
          ...base,
          entry_date: startDate,
          start_time: startTime,
          end_time: endTime,
          hours: Number(((timeToMinutes(endTime) - timeToMinutes(startTime)) / 60).toFixed(4))
        }],
        elapsed_seconds: elapsedSeconds,
        warning: ''
      };
    }

    return {
      entries: [{
        ...base,
        entry_date: startDate,
        start_time: null,
        end_time: null,
        hours: roundedHours(elapsedMs)
      }],
      elapsed_seconds: elapsedSeconds,
      warning: overlaps
        ? 'The captured time overlaps an existing entry. Samay saved the duration as a draft without a start/end window so you can review it safely.'
        : 'The timer was shorter than one complete displayed minute. Samay saved the exact duration as a draft for review.'
    };
  }

  const entries = splitAcrossIndiaDates(startedAtMs, stoppedAtMs).map(segment => ({
    ...base,
    entry_date: segment.entry_date,
    start_time: null,
    end_time: null,
    hours: roundedHours(segment.milliseconds)
  }));

  return {
    entries,
    elapsed_seconds: elapsedSeconds,
    warning: 'This timer crossed midnight. Samay split the duration into separate daily drafts for review.'
  };
}

function normalizeTimerInput(body = {}) {
  const rawClientId = body.client_id;
  const clientId = ['string', 'number'].includes(typeof rawClientId)
    ? String(rawClientId).trim().slice(0, 128)
    : '';
  const classification = String(body.work_classification || 'client_work').trim();
  const allowedSources = new Set(['web', 'chrome_pip', 'pwa']);
  const source = String(body.source || 'web').trim().toLowerCase();
  return {
    client_id: clientId || null,
    task_type: String(body.task_type || '').trim().slice(0, 160),
    description: String(body.description || '').trim().slice(0, 2000),
    work_classification: classification.slice(0, 80),
    source: allowedSources.has(source) ? source : 'web'
  };
}

function groupEntriesByDate(entries = []) {
  return entries.reduce((grouped, entry) => {
    const date = String(entry.entry_date || '');
    if (!grouped[date]) grouped[date] = [];
    grouped[date].push(entry);
    return grouped;
  }, {});
}

module.exports = {
  MAX_AUTO_CAPTURE_MS,
  buildDraftEntries,
  groupEntriesByDate,
  hasOverlap,
  normalizeTimerInput,
  parseTimestamp
};
