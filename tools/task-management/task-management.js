// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
// eslint-disable-next-line import/no-unresolved
import { LitElement, html, nothing } from 'da-lit';

// Super Lite components (sl-button, etc.)
import 'https://da.live/nx/public/sl/components.js';

// Application styles (adopted into the shadow root)
import loadStyle from '../../scripts/utils/styles.js';

const styles = await loadStyle(import.meta.url);

/* ── SVG icons (Lit templates) ──────────────────────────────────────── */

const iconSuccess = () => html`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32" fill="none">
    <circle cx="12" cy="12" r="11" fill="#12805c"></circle>
    <path d="M7 12.5l3 3 7-7" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
  </svg>`;

const iconFailure = () => html`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32" fill="none">
    <circle cx="12" cy="12" r="11" fill="#d7373f"></circle>
    <path d="M8 8l8 8M16 8l-8 8" stroke="#fff" stroke-width="2" stroke-linecap="round"></path>
  </svg>`;

/* Small action icons (15px). Each icon is ONE self-contained <svg> template —
   the inner <path> nodes must live in the SAME html`` as the <svg> so they are
   parsed in the SVG namespace. A separate html`` path fragment renders as an
   inert HTMLUnknownElement and shows nothing. */
const ACTION_ICONS = {
  play: () => html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l14 8-14 8z" fill="currentColor" stroke="none"></path></svg>`,
  check: () => html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"></path></svg>`,
  close: () => html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"></path></svg>`,
  external: () => html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"></path><path d="M20 4l-9 9"></path><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"></path></svg>`,
  clock: () => html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg>`,
  refresh: () => html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"></path><path d="M21 3v5h-5"></path></svg>`,
  info: () => html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 11v5"></path><path d="M12 8h.01"></path></svg>`,
  comment: () => html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"></path></svg>`,
};

/* ── Placeholders config ─────────────────────────────────────────────── */

function buildPlaceholdersUrl() {
  return '/config/placeholders.json';
}

// Shared key/value reader for /config/placeholders.json
async function fetchPlaceholderLookup(org, repo) {
  const url = buildPlaceholdersUrl(org, repo);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Placeholders fetch failed: ${resp.status}`);
  const json = await resp.json();

  const lookup = {};
  (json.data || []).forEach((row) => {
    if (row.key) lookup[row.key.toLowerCase()] = row.value || '';
  });
  return lookup;
}

async function fetchPlaceholders(org, repo) {
  const lookup = await fetchPlaceholderLookup(org, repo);

  let rawPayload = lookup['external-service-payload'] || '';
  if (rawPayload.startsWith("'") && rawPayload.endsWith("'")) {
    rawPayload = rawPayload.slice(1, -1);
  }

  return {
    externalServiceUrl: lookup['external-service-url'] || '',
    externalServicePayload: rawPayload,
  };
}

// Static Workfront API paths, appended to the configured instance URL.
const WORKFRONT_API_VERSION = 'v19.0';
const WORKFRONT_API_BASE = `/attask/api/${WORKFRONT_API_VERSION}`;
const WORKFRONT_USER_PATH = `${WORKFRONT_API_BASE}/user/search`;
const WORKFRONT_TASKS_SEARCH_PATH = `${WORKFRONT_API_BASE}/task/search`;
const WORKFRONT_TASK_ACTION_PATH = `${WORKFRONT_API_BASE}/task`;
const WORKFRONT_NOTE_PATH = `${WORKFRONT_API_BASE}/note`;
const WORKFRONT_NOTE_SEARCH_PATH = `${WORKFRONT_NOTE_PATH}/search`;
const COMMENT_MAX_LENGTH = 2000;
const AIO_WF_ACTION_ENDPOINT = 'https://675172-referencedemopartner-stage.adobeioruntime.net/api/v1/web/ref-demo-api-gateway/wf-actions';

// Workfront endpoints derived from a single "workfront-instance-url"
// (e.g. https://aemshowcase2.my.workfront.com). URLs are only built when it is set.
async function fetchWorkfrontConfig(org, repo) {
  const lookup = await fetchPlaceholderLookup(org, repo);
  const instance = (lookup['workfront-instance-url'] || '').replace(/\/+$/, '');
  if (!instance) {
    return {
      instance: '', tasksUrl: '', actionUrl: '', experienceOrg: '', solutionOrg: '',
    };
  }

  let instanceSlug = '';
  try {
    instanceSlug = new URL(instance).hostname.split('.')[0] || '';
  } catch (e) {
    instanceSlug = '';
  }

  const experienceOrg = (lookup['workfront-experience-org'] || instanceSlug || '').replace(/^@/, '');
  const solutionOrg = lookup['workfront-experience-solution-org'] || (experienceOrg ? `so:${experienceOrg}-Production` : '');

  return {
    instance,
    tasksUrl: `${instance}${WORKFRONT_TASKS_SEARCH_PATH}`,
    actionUrl: `${instance}${WORKFRONT_TASK_ACTION_PATH}`,
    experienceOrg,
    solutionOrg,
  };
}

function buildWorkfrontProjectUiUrl(config, projectId) {
  if (!config?.experienceOrg || !config?.solutionOrg || !projectId) return '';
  return `https://experience.adobe.com/#/@${config.experienceOrg}/${config.solutionOrg}/workfront/project/${projectId}/tasks`;
}

function buildWorkfrontTaskUiUrl(config, taskId) {
  if (!config?.experienceOrg || !config?.solutionOrg || !taskId) return '';
  return `https://experience.adobe.com/#/@${config.experienceOrg}/${config.solutionOrg}/workfront/task/${taskId}`;
}

// Resolve a Workfront user ID from an email address.
async function fetchWorkfrontUserId(instance, email, token) {
  const target = new URL(AIO_WF_ACTION_ENDPOINT);
  target.searchParams.set('url', `${instance}${WORKFRONT_USER_PATH}`);
  target.searchParams.set('emailAddr', email);
  target.searchParams.set('fields', 'ID,name');
  target.searchParams.set('method', 'GET');

  const resp = await fetch(target.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`Workfront user lookup failed: ${resp.status}`);

  const json = await resp.json();
  const user = (json.data || [])[0];
  return user ? user.ID : '';
}

async function fetchWorkfrontUsers(instance, token) {
  const users = new Map();
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const target = new URL(AIO_WF_ACTION_ENDPOINT);
    target.searchParams.set('url', `${instance}${WORKFRONT_USER_PATH}`);
    target.searchParams.set('method', 'GET');
    target.searchParams.set('isActive', 'true');
    target.searchParams.set('fields', 'ID,name,emailAddr');
    target.searchParams.set('name_Sort', 'asc');
    target.searchParams.set('$$LIMIT', String(pageSize));
    target.searchParams.set('$$FIRST', String(offset));
    const resp = await fetch(target.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) throw new Error(`Workfront users fetch failed: ${resp.status}`);
    const json = await resp.json();
    if (json.error || !Array.isArray(json.data)) {
      throw new Error(json.error?.message || 'Invalid Workfront users response.');
    }
    const previousSize = users.size;
    json.data.forEach((user) => {
      if (user.ID) users.set(user.ID, user);
    });
    if (json.data.length < pageSize) break;
    if (users.size === previousSize) {
      throw new Error('Workfront user pagination did not advance. Check the gateway filters.');
    }
  }
  return [...users.values()].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

async function reassignWorkfrontTask(instance, taskId, userId, token) {
  const target = new URL(AIO_WF_ACTION_ENDPOINT);
  target.searchParams.set('url', `${instance}${WORKFRONT_TASK_ACTION_PATH}/${taskId}`);
  target.searchParams.set('method', 'PUT');
  target.searchParams.set('assignedToID', userId);
  target.searchParams.set('fields', 'ID,assignedToID');
  const resp = await fetch(target.toString(), {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`Workfront reassignment failed: ${resp.status}`);
  const json = await resp.json();
  if (json.error || json.data?.assignedToID !== userId) {
    throw new Error(json.error?.message || 'Workfront did not confirm the new assignee.');
  }
}

/* ── Workfront tasks ─────────────────────────────────────────────────── */

// Fields requested for each task in the Workfront task/search call.
const WORKFRONT_TASK_FIELDS = [
  'ID', 'name', 'status', 'percentComplete', 'priority', 'priorityColor', 'condition',
  'plannedStartDate', 'plannedCompletionDate', 'commitDate', 'canStart', 'isReady',
  'isStatusComplete', 'hasDocuments', 'hasNotes', 'hasMessages',
  'workRequired', 'taskNumber', 'URL', 'project:name', 'projectID', 'assignedTo:name', 'assignedToID', 'objCode',
].join(',');

// Workfront dates look like "2026-08-07T09:00:00:000-0700" — show just the date part.
function formatTaskDate(value) {
  if (!value) return '';
  const iso = String(value).slice(0, 10);
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function parseTaskDateToMs(value) {
  if (!value) return 0;
  const ms = Date.parse(String(value).slice(0, 10));
  return Number.isNaN(ms) ? 0 : ms;
}

function getTaskSortDateMs(task) {
  return parseTaskDateToMs(task.plannedStartDate)
    || parseTaskDateToMs(task.plannedCompletionDate)
    || parseTaskDateToMs(task.commitDate);
}

function toNumberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

const STATUS_LABELS = {
  NEW: 'New',
  INP: 'In Progress',
  CPL: 'Complete',
  REJ: 'Rejected',
};

function getStatusLabel(status) {
  const s = (status || '').toUpperCase();
  return STATUS_LABELS[s] || status || '';
}

function getStatusSortRank(status) {
  const s = (status || '').toUpperCase();
  if (s === 'NEW') return 0;
  if (s === 'INP') return 1;
  if (s === 'CPL') return 3;
  if (s === 'REJ') return 4;
  return 2;
}

async function fetchWorkfrontTasks(url, assignedToId, token, config = {}) {
  const target = new URL(AIO_WF_ACTION_ENDPOINT);
  target.searchParams.set('url', url);
  target.searchParams.set('method', 'GET');
  target.searchParams.set('fields', WORKFRONT_TASK_FIELDS);
  if (assignedToId) target.searchParams.set('assignedToID', assignedToId);

  const resp = await fetch(target.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`Workfront tasks fetch failed: ${resp.status}`);

  const json = await resp.json();
  const rows = json.data || [];
  const tasks = rows.map((row) => ({
    ...row,
    id: row.ID,
    projectId: row.projectID || row.project?.ID || '',
    status: (row.status || '').toUpperCase(),
    statusLabel: getStatusLabel(row.status),
    taskUiUrl: buildWorkfrontTaskUiUrl(config, row.ID) || row.URL || '',
    projectUiUrl: buildWorkfrontProjectUiUrl(config, row.projectID || row.project?.ID || ''),
  }));

  tasks.sort((a, b) => {
    const byDate = getTaskSortDateMs(b) - getTaskSortDateMs(a);
    if (byDate !== 0) return byDate;
    const byStatus = getStatusSortRank(a.status) - getStatusSortRank(b.status);
    if (byStatus !== 0) return byStatus;
    return toNumberOrZero(b.taskNumber) - toNumberOrZero(a.taskNumber);
  });

  return tasks;
}

async function updateWorkfrontTask(url, task, action, token) {
  // Route through the AIO gateway (same as fetchWorkfrontTasks) to avoid CORS.
  const target = new URL(AIO_WF_ACTION_ENDPOINT);
  target.searchParams.set('method', 'PUT');

  if (action.wfAction) {
    // Workfront "work action" (e.g. acceptWork = "Work On It"). This is what the
    // native UI sends — a plain status write is a no-op for a NEW assigned task.
    target.searchParams.set('url', url);
    target.searchParams.set('action', action.wfAction);
    target.searchParams.set('id', task.id);
  } else {
    // Fallback: direct status write (used until the work-action name is known).
    target.searchParams.set('url', `${url}/${task.id}`);
    target.searchParams.set('status', action.key);
  }

  const resp = await fetch(target.toString(), {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Workfront update failed: ${resp.status} – ${body}`);
  }
  return resp.json();
}

/* ── Workfront task comments (Notes) ─────────────────────────────────── */

async function fetchTaskComments(instance, taskId, token) {
  const target = new URL(AIO_WF_ACTION_ENDPOINT);
  target.searchParams.set('url', `${instance}${WORKFRONT_NOTE_SEARCH_PATH}`);
  target.searchParams.set('method', 'GET');
  target.searchParams.set('noteObjCode', 'TASK');
  target.searchParams.set('objID', taskId);
  target.searchParams.set('fields', 'noteText,entryDate,owner:name');
  target.searchParams.set('entryDate_Sort', 'desc');
  target.searchParams.set('$$LIMIT', '50');

  const resp = await fetch(target.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`Workfront comments fetch failed: ${resp.status}`);

  const json = await resp.json();
  return (json.data || []).map((n) => ({
    id: n.ID,
    text: n.noteText || '',
    date: n.entryDate || '',
    author: n.owner?.name || '',
  }));
}

async function addTaskComment(instance, taskId, text, token, mentionedUsers = []) {
  const target = new URL(AIO_WF_ACTION_ENDPOINT);
  target.searchParams.set('url', `${instance}${WORKFRONT_NOTE_PATH}`);
  target.searchParams.set('method', 'POST');
  if (mentionedUsers.length) {
    target.searchParams.set('updates', JSON.stringify({
      noteObjCode: 'TASK',
      objID: taskId,
      noteText: text,
      tags: mentionedUsers.map((user) => ({
        objID: user.ID,
        objObjCode: 'USER',
        userID: user.ID,
      })),
    }));
  } else {
    target.searchParams.set('noteObjCode', 'TASK');
    target.searchParams.set('objID', taskId);
    target.searchParams.set('noteText', text);
  }

  const resp = await fetch(target.toString(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Workfront comment failed: ${resp.status} – ${body}`);
  }
  const json = await resp.json();
  if (json.error || !json.data?.ID) {
    throw new Error(json.error?.message || 'Workfront did not confirm the comment was created.');
  }
  return json;
}

/* ── User profile ────────────────────────────────────────────────────── */

async function fetchUserProfile(token) {
  try {
    const resp = await fetch('https://ims-na1.adobelogin.com/ims/profile/v1', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return { userName: '', userEmail: '' };
    const profile = await resp.json();
    return {
      userName: profile.displayName || profile.name || '',
      userEmail: profile.email || '',
    };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[task-management] Failed to fetch user profile:', e);
    return { userName: '', userEmail: '' };
  }
}

/* ── Resolve org / repo from DA SDK context ──────────────────────────── */

function resolveOrgRepo(context) {
  if (context.org && context.repo) {
    return { org: context.org, repo: context.repo, path: context.path || '/' };
  }

  const url = context.url || context.location || context.href || '';
  const hashPath = url.includes('#') ? url.split('#')[1] : '';
  const segments = (hashPath || '').split('/').filter(Boolean);
  if (segments.length >= 2) {
    return { org: segments[0], repo: segments[1], path: `/${segments.slice(2).join('/')}` };
  }

  const values = Object.values(context).filter((v) => typeof v === 'string');
  const slashVal = values.find((v) => v.split('/').filter(Boolean).length >= 2);
  if (slashVal) {
    const parts = slashVal.split('/').filter(Boolean);
    return { org: parts[0], repo: parts[1], path: `/${parts.slice(2).join('/')}` };
  }

  throw new Error(`Could not resolve org/repo from context: ${JSON.stringify(context)}`);
}

function buildAemPageUrl(org, repo, path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `https://main--${repo}--${org}.aem.live${normalizedPath}`;
}

const REVIEW_PROGRESS_SEQUENCE = [
  'Fetching page details…',
  'Collecting user details…',
  'Creating project in Workfront…',
  'Creating review task…',
  'Assigning it to the user…',
  'Nearly completed…',
];

const REVIEW_SLOW_HINT = 'About to finish... just a few more seconds...';

/* ── External service call ───────────────────────────────────────────── */

async function invokeExternalService(token, context, onProgress = () => {}) {
  onProgress('Fetching page details…');
  // eslint-disable-next-line no-console
  console.log('[task-management] DA SDK context →', JSON.stringify(context, null, 2));

  const { org, repo, path } = resolveOrgRepo(context);
  // eslint-disable-next-line no-console
  console.log('[task-management] Resolved →', { org, repo, path });

  onProgress('Collecting user details…');
  const [profile, config] = await Promise.all([
    fetchUserProfile(token),
    fetchPlaceholders(org, repo).catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[task-management] Placeholders fetch failed:', err);
      return { externalServiceUrl: '', externalServicePayload: '' };
    }),
  ]);

  const resolvedUrl = config.externalServiceUrl;
  if (!resolvedUrl) {
    throw new Error(
      'External service URL is not configured. Add an "external-service-url" entry to /config/placeholders.json.',
    );
  }

  let resolvedPayload;
  if (config.externalServicePayload) {
    try {
      resolvedPayload = JSON.parse(config.externalServicePayload);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[task-management] Failed to parse custom payload, using default:', e);
    }
  }

  if (!resolvedPayload) {
    resolvedPayload = {
      org,
      repo,
      path,
      'user-name': profile.userName,
      'user-email': profile.userEmail,
    };
  }

  resolvedPayload.aemPageUrl = buildAemPageUrl(org, repo, path);

  onProgress('Creating project in Workfront…');
  // eslint-disable-next-line no-console
  console.log('[task-management] Calling service →', resolvedUrl);

  const resp = await fetch(resolvedUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(resolvedPayload),
  });

  if (!resp.ok) {
    const errorBody = await resp.text();
    throw new Error(`External service error: ${resp.status} – ${errorBody}`);
  }

  onProgress('Creating review task…');
  const result = await resp.json();
  onProgress('Assigning it to the user…');
  onProgress('Nearly completed…');
  return result;
}

// Every task always shows the same set of action buttons; each one is disabled
// when the transition is not valid from the task's current status (e.g. a task
// already in progress shows Start disabled, a completed task shows Complete
// disabled). Keeps the button layout stable across statuses.
const TASK_ACTIONS = [
  // wfAction = Workfront work-action verb (from the native "Work On It" call).
  // Start is confirmed (acceptWork); Complete/Reject verbs are TBD — capture the
  // "Mark as Done" / reject requests and fill them in to switch off the fallback.
  { key: 'INP', label: 'Start', icon: 'play', wfAction: 'acceptWork' },
  { key: 'CPL', label: 'Complete', icon: 'check' },
  { key: 'REJ', label: 'Reject', icon: 'close', variant: 'secondary' },
];

// Statuses from which each action is still available. Anything else → disabled.
const ACTION_ENABLED_FROM = {
  INP: ['NEW'], // can only Start a NEW task
  CPL: ['NEW', 'INP'], // can Complete while new or in progress
  REJ: ['NEW', 'INP'], // can Reject while new or in progress
};

function isActionDisabled(status, actionKey) {
  const from = ACTION_ENABLED_FROM[actionKey] || [];
  return !from.includes((status || '').toUpperCase());
}

// True when the task is past its due date and not yet complete.
function isTaskOverdue(task) {
  const raw = task.plannedCompletionDate || task.commitDate;
  if (!raw || task.status === 'CPL') return false;
  const due = new Date(String(raw).slice(0, 10));
  if (Number.isNaN(due.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today;
}

// "40% · 6/16h" style progress label (hours derived from workRequired minutes).
function taskProgressLabel(task) {
  const pct = Math.round(task.percentComplete || 0);
  const plannedH = task.workRequired ? Math.round(task.workRequired / 60) : 0;
  if (!plannedH) return `${pct}%`;
  const doneH = Math.round(plannedH * (pct / 100));
  return `${pct}% · ${doneH}/${plannedH}h`;
}

/* ── Lit component ───────────────────────────────────────────────────── */

class RefDemoTaskManagement extends LitElement {
  static properties = {
    token: { attribute: false },
    context: { attribute: false },
    onClose: { attribute: false },
    _allowed: { state: true }, // undefined while gating, then boolean
    _tab: { state: true }, // 'service' | 'tasks'
    // Service tab
    _view: { state: true }, // 'confirm' | 'loading' | 'result'
    _isSuccess: { state: true },
    _message: { state: true },
    _loadingMessage: { state: true },
    _serviceUrl: { state: true },
    // Tasks tab
    _tasksState: { state: true }, // 'idle' | 'loading' | 'loaded' | 'error'
    _tasks: { state: true },
    _tasksError: { state: true },
    _busyTaskId: { state: true },
    _taskQuery: { state: true },
    // Task comments
    _commentsTaskId: { state: true }, // task whose comment thread is open
    _comments: { state: true }, // { [taskId]: { state, items, error } }
    _commentDraft: { state: true },
    _commentPosting: { state: true },
    _commentError: { state: true },
    _commentNotice: { state: true },
    _workfrontUsers: { state: true },
    _usersState: { state: true },
    _usersError: { state: true },
    _mentionedUsers: { state: true },
    _assigneeId: { state: true },
    _assigneeSearch: { state: true },
    _tagSearch: { state: true },
  };

  constructor() {
    super();
    this._tab = 'tasks';
    this._view = 'confirm';
    [this._loadingMessage] = REVIEW_PROGRESS_SEQUENCE;
    this._tasksState = 'idle';
    this._tasks = [];
    this._taskQuery = '';
    this._comments = {};
    this._commentDraft = '';
    this._commentPosting = false;
    this._workfrontUsers = [];
    this._usersState = 'idle';
    this._mentionedUsers = [];
    this._assigneeId = '';
    this._assigneeSearch = undefined;
    this._tagSearch = '';
    this._progressIndex = 0;
    this._progressTicker = null;
    this._slowHintTimer = null;
    this._slowHintShown = false;
  }

  setLoadingMessage(message) {
    this._loadingMessage = message;
  }

  advanceProgressTo(index) {
    const bounded = Math.max(0, Math.min(index, REVIEW_PROGRESS_SEQUENCE.length - 1));
    if (bounded <= this._progressIndex) return;
    this._progressIndex = bounded;
    this.setLoadingMessage(REVIEW_PROGRESS_SEQUENCE[this._progressIndex]);
  }

  handleServiceProgress(message) {
    const idx = REVIEW_PROGRESS_SEQUENCE.indexOf(message);
    if (idx !== -1) this.advanceProgressTo(idx);
  }

  startProgressSequence() {
    this.stopProgressSequence();
    this._progressIndex = 0;
    this._slowHintShown = false;
    this.setLoadingMessage(REVIEW_PROGRESS_SEQUENCE[0]);

    this._progressTicker = window.setInterval(() => {
      if (this._view !== 'loading') return;
      if (this._progressIndex < REVIEW_PROGRESS_SEQUENCE.length - 1) {
        this.advanceProgressTo(this._progressIndex + 1);
      }
    }, 2000);

    this._slowHintTimer = window.setTimeout(() => {
      if (this._view !== 'loading') return;
      if (this._progressIndex >= REVIEW_PROGRESS_SEQUENCE.length - 2 && !this._slowHintShown) {
        this._slowHintShown = true;
        this.setLoadingMessage(REVIEW_SLOW_HINT);
      }
    }, 12000);
  }

  stopProgressSequence() {
    if (this._progressTicker) {
      clearInterval(this._progressTicker);
      this._progressTicker = null;
    }
    if (this._slowHintTimer) {
      clearTimeout(this._slowHintTimer);
      this._slowHintTimer = null;
    }
  }

  get filteredTasks() {
    const q = (this._taskQuery || '').trim().toLowerCase();
    if (!q) return this._tasks;
    return this._tasks.filter((t) => {
      const name = (t.name || '').toLowerCase();
      const project = (t.project?.name || '').toLowerCase();
      return name.includes(q) || project.includes(q);
    });
  }

  get taskStats() {
    const inProgress = this._tasks.filter((t) => t.status === 'INP').length;
    const dueThisWeek = this._tasks.filter((t) => {
      const raw = t.plannedCompletionDate || t.commitDate;
      if (!raw || t.status === 'CPL') return false;
      const due = new Date(String(raw).slice(0, 10));
      if (Number.isNaN(due.getTime())) return false;
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      return due >= start && due <= end;
    }).length;
    return { total: this._tasks.length, inProgress, dueThisWeek };
  }

  // eslint-disable-next-line class-methods-use-this
  openTask(task) {
    const targetUrl = task.taskUiUrl || task.URL;
    if (targetUrl) window.open(targetUrl, '_blank', 'noopener');
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [styles];
    this.gateUser();
    this.loadServiceUrl();
  }

  async gateUser() {
    const profile = await fetchUserProfile(this.token);
    this._allowed = typeof profile.userEmail === 'string'
      && profile.userEmail.toLowerCase().endsWith('@adobe.com');
    // Tasks is the default tab — kick off its load once access is granted.
    if (this._allowed && this._tab === 'tasks' && this._tasksState === 'idle') {
      this.loadTasks();
    }
  }

  async loadServiceUrl() {
    try {
      const { org, repo } = resolveOrgRepo(this.context);
      const cfg = await fetchPlaceholders(org, repo);
      this._serviceUrl = cfg.externalServiceUrl;
    } catch (e) {
      this._serviceUrl = '';
    }
  }

  /* ── Service tab ── */

  async run() {
    this._view = 'loading';
    this.startProgressSequence();
    try {
      await invokeExternalService(
        this.token,
        this.context,
        (message) => this.handleServiceProgress(message),
      );
      this.advanceProgressTo(REVIEW_PROGRESS_SEQUENCE.length - 1);
      this.setLoadingMessage('Done.');
      this._isSuccess = true;
      this._message = 'Done. Review request submitted.';
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[task-management] Error:', err);
      this._isSuccess = false;
      this._message = err.message || 'Review request failed. Please try again.';
    } finally {
      this.stopProgressSequence();
    }
    this._view = 'result';
  }

  close() {
    if (this.onClose) this.onClose();
  }

  /* ── Tasks tab ── */

  selectTab(tab) {
    this._tab = tab;
    if (tab === 'tasks' && this._tasksState === 'idle') this.loadTasks();
  }

  async loadTasks() {
    if (this._commentPosting) return;
    this._tasksState = 'loading';
    this._tasksError = undefined;
    try {
      const { org, repo } = resolveOrgRepo(this.context);
      const profile = await fetchUserProfile(this.token);
      const cfg = await fetchWorkfrontConfig(org, repo);
      if (!cfg.instance) {
        throw new Error('Workfront instance URL is not configured. Add a "workfront-instance-url" entry to /config/placeholders.json.');
      }
      const userId = await fetchWorkfrontUserId(cfg.instance, profile.userEmail, this.token);
      if (!userId) throw new Error(`No Workfront user found for ${profile.userEmail}.`);
      this._tasks = await fetchWorkfrontTasks(cfg.tasksUrl, userId, this.token, cfg);
      this._tasksState = 'loaded';
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[task-management] Tasks error:', err);
      this._tasksError = err.message || 'Failed to load tasks.';
      this._tasksState = 'error';
    }
  }

  async runTaskAction(task, action) {
    if (this._commentPosting) return;
    this._busyTaskId = task.id;
    this._tasksError = undefined;
    try {
      const { org, repo } = resolveOrgRepo(this.context);
      const cfg = await fetchWorkfrontConfig(org, repo);
      if (!cfg.actionUrl) {
        throw new Error('Workfront instance URL is not configured. Add a "workfront-instance-url" entry to /config/placeholders.json.');
      }
      await updateWorkfrontTask(cfg.actionUrl, task, action, this.token);
      // "Work On It" (acceptWork) only accepts the work; follow it with a status
      // write to move the task to In Progress so it shows just the Complete action.
      if (action.wfAction === 'acceptWork') {
        await updateWorkfrontTask(cfg.actionUrl, task, { key: 'INP' }, this.token);
      }
      await this.loadTasks(); // refresh after a successful transition
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[task-management] Task action error:', err);
      this._tasksError = err.message || 'Failed to update task.';
      this._tasksState = 'error';
    } finally {
      this._busyTaskId = undefined;
    }
  }

  /* ── Task comments ── */

  async getWorkfrontInstance() {
    const { org, repo } = resolveOrgRepo(this.context);
    const cfg = await fetchWorkfrontConfig(org, repo);
    if (!cfg.instance) {
      throw new Error('Workfront instance URL is not configured. Add a "workfront-instance-url" entry to /config/placeholders.json.');
    }
    return cfg.instance;
  }

  setTaskComments(taskId, value) {
    this._comments = { ...this._comments, [taskId]: value };
  }

  toggleComments(task) {
    if (this._commentPosting) return;
    if (this._commentsTaskId === task.id) {
      this._commentsTaskId = undefined;
      return;
    }
    this._commentsTaskId = task.id;
    this._commentDraft = '';
    this._commentError = undefined;
    this._commentNotice = '';
    this._mentionedUsers = [];
    this._assigneeId = task.assignedToID || '';
    this._assigneeSearch = undefined;
    this._tagSearch = '';
    this.loadComments(task.id);
    this.loadWorkfrontUsers();
  }

  async loadWorkfrontUsers() {
    if (this._usersState === 'loading' || this._usersState === 'loaded') return;
    this._usersState = 'loading';
    this._usersError = '';
    try {
      const instance = await this.getWorkfrontInstance();
      this._workfrontUsers = await fetchWorkfrontUsers(instance, this.token);
      this._usersState = 'loaded';
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[task-management] Users error:', err);
      this._usersError = err.message || 'Failed to load Workfront users.';
      this._usersState = 'error';
    }
  }

  addMention(userId) {
    const user = this._workfrontUsers.find((item) => item.ID === userId);
    if (!user || this._mentionedUsers.some((item) => item.ID === userId)) return;
    const mention = `@${user.name || user.emailAddr || user.ID}`;
    const prefix = this._commentDraft.trimEnd();
    const draft = `${prefix}${prefix ? ' ' : ''}${mention} `;
    if (draft.length > COMMENT_MAX_LENGTH) {
      this._commentError = `Comments cannot exceed ${COMMENT_MAX_LENGTH} characters.`;
      return;
    }
    this._commentDraft = draft;
    this._mentionedUsers = [...this._mentionedUsers, user];
    this._commentError = undefined;
  }

  async loadComments(taskId) {
    const prev = this._comments[taskId];
    this.setTaskComments(taskId, { state: 'loading', items: prev?.items || [] });
    try {
      const instance = await this.getWorkfrontInstance();
      const items = await fetchTaskComments(instance, taskId, this.token);
      this.setTaskComments(taskId, { state: 'loaded', items });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[task-management] Comments error:', err);
      this.setTaskComments(taskId, {
        state: 'error',
        items: prev?.items || [],
        error: err.message || 'Failed to load comments.',
      });
    }
  }

  async postComment(task) {
    const text = (this._commentDraft || '').trim();
    if (this._commentPosting) return;
    if (!text || text.length > COMMENT_MAX_LENGTH) {
      this._commentError = `Enter a comment of 1 to ${COMMENT_MAX_LENGTH} characters.`;
      return;
    }
    const currentTask = this._tasks.find((item) => item.id === task.id) || task;
    if (!this.isAssigneeSelectionValid(currentTask)) {
      this._commentError = 'Select a Workfront user from the suggestions or keep the current assignment.';
      return;
    }
    const reassign = !!this._assigneeId && this._assigneeId !== currentTask.assignedToID;
    const assignee = this._workfrontUsers.find((user) => user.ID === this._assigneeId);
    if (reassign && !assignee) {
      this._commentError = 'Select an available Workfront user before assigning.';
      return;
    }
    const mentions = this._mentionedUsers.filter((user) => text.includes(
      `@${user.name || user.emailAddr || user.ID}`,
    ));
    this._commentPosting = true;
    this._commentError = undefined;
    this._commentNotice = '';
    let assigned = false;
    try {
      const instance = await this.getWorkfrontInstance();
      if (reassign) {
        await reassignWorkfrontTask(instance, task.id, assignee.ID, this.token);
        assigned = true;
        this._tasks = this._tasks.map((item) => (item.id === task.id
          ? { ...item, assignedToID: assignee.ID, assignedTo: { name: assignee.name } }
          : item));
        this._assigneeSearch = undefined;
      }
      await addTaskComment(instance, task.id, text, this.token, mentions);
      this._commentDraft = '';
      this._mentionedUsers = [];
      this._commentNotice = assigned
        ? 'Task reassigned and comment posted. Refresh tasks to update your assigned list.'
        : 'Comment posted.';
      this._tasks = this._tasks.map((t) => (t.id === task.id ? { ...t, hasNotes: true } : t));
      await this.loadComments(task.id);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[task-management] Post comment error:', err);
      const message = err.message || 'Failed to post comment.';
      this._commentError = assigned
        ? `Task reassigned, but the comment was not confirmed. ${message} Check Workfront before retrying.`
        : message;
    } finally {
      this._commentPosting = false;
    }
  }

  /* ── Renderers ── */

  renderConfirm() {
    return html`
      <div class="task-management-panel">
        <p class="task-management-message">
          Send this page for review?
          <span class="info-tip" tabindex="0" role="button" aria-label="Endpoint configuration info">
            ${ACTION_ICONS.info()}
            <span class="info-tip-bubble" role="tooltip">Submission endpoint can be configured in the placeholders file with key : external-service-url</span>
          </span>
        </p>
        <div class="task-management-actions">
          <sl-button class="secondary" @click=${this.close}>No</sl-button>
          <sl-button ?disabled=${!this._serviceUrl} @click=${this.run}>Yes</sl-button>
        </div>
      </div>`;
  }

  renderResult() {
    return html`
      <div class="task-management-panel">
        <div class="task-management-result">
          <div class="task-management-icon">${this._isSuccess ? iconSuccess() : iconFailure()}</div>
          <p class="task-management-label">${this._isSuccess ? 'Success' : 'Failed'}</p>
          <p class="task-management-detail">${this._message}</p>
        </div>
        <div class="task-management-actions">
          <sl-button @click=${this.close}>Close</sl-button>
        </div>
      </div>`;
  }

  renderNoAccess() {
    return html`
      <div class="task-management-panel">
        <div class="task-management-result">
          <div class="task-management-icon">${iconFailure()}</div>
          <p class="task-management-label">Access denied</p>
          <p class="task-management-detail">You do not have permission to run this extension. Please contact an Adobe administrator if you believe this is a mistake.</p>
        </div>
        <div class="task-management-actions">
          <sl-button @click=${this.close}>Close</sl-button>
        </div>
      </div>`;
  }

  renderService() {
    switch (this._view) {
      case 'loading':
        return html`
          <div class="task-management-panel">
            <div class="task-management-loading">
              <div class="spinner" aria-hidden="true"></div>
              <p class="task-management-message">${this._loadingMessage}</p>
            </div>
          </div>`;
      case 'result':
        return this.renderResult();
      case 'confirm':
      default:
        return this.renderConfirm();
    }
  }

  renderTask(task) {
    const busy = this._busyTaskId === task.id;
    const project = task.project?.name;
    const taskUrl = task.taskUiUrl || task.URL;
    const projectUrl = task.projectUiUrl;
    let projectContent = nothing;
    if (project) {
      projectContent = projectUrl
        ? html`<a class="task-project-link task-project" href=${projectUrl} target="_blank" rel="noopener noreferrer" title=${project}>${project}</a>`
        : html`<span class="task-project" title=${project}>${project}</span>`;
    }
    const due = formatTaskDate(task.plannedCompletionDate || task.commitDate);
    const overdue = isTaskOverdue(task);
    const pct = Math.round(task.percentComplete || 0);
    const statusClass = (task.status || '').toLowerCase();
    const commentsOpen = this._commentsTaskId === task.id;
    return html`
      <li class="task">
        <div class="task-head">
          ${taskUrl
    ? html`<a class="task-name-link" href=${taskUrl} target="_blank" rel="noopener noreferrer" title=${task.name}><span class="task-name">${task.name}</span></a>`
    : html`<p class="task-name" title=${task.name}>${task.name}</p>`}
          <div class="task-actions">
            ${busy
    ? html`<div class="spinner" aria-hidden="true"></div>`
    : html`
              ${TASK_ACTIONS.map((a) => {
    const disabled = isActionDisabled(task.status, a.key);
    return html`
                <button
                  class="icon-btn ${a.variant || 'primary'}"
                  title=${disabled ? `${a.label} (unavailable)` : a.label}
                  aria-label=${a.label}
                  ?disabled=${disabled}
                  @click=${() => { if (!disabled) this.runTaskAction(task, a); }}>${ACTION_ICONS[a.icon]()}</button>`;
  })}`}
            <button
              class="icon-btn comment-btn ${commentsOpen ? 'active' : ''} ${task.hasNotes ? 'has-comments' : ''}"
              title=${task.hasNotes ? 'Comments' : 'Add comment'}
              aria-label="Comments"
              aria-expanded=${commentsOpen ? 'true' : 'false'}
              @click=${() => this.toggleComments(task)}>${ACTION_ICONS.comment()}</button>
          </div>
        </div>
        <div class="task-sub">
          ${projectContent}
          <span class="task-status status-${statusClass}">${task.statusLabel || task.status || '—'}</span>
        </div>
        <div class="task-foot">
          <div class="task-progress">
            <div class="progress-track">
              <div class="progress-fill ${pct >= 100 ? 'complete' : ''}" style="width:${pct}%"></div>
            </div>
            <span class="progress-label">${taskProgressLabel(task)}</span>
          </div>
          ${due ? html`<span class="task-due ${overdue ? 'overdue' : ''}">${overdue ? ACTION_ICONS.clock() : nothing}${due}</span>` : nothing}
        </div>
        ${commentsOpen ? this.renderComments(task) : nothing}
      </li>`;
  }

  userPickerLabel(user) {
    const label = `${user.name || user.ID}${user.emailAddr ? ` (${user.emailAddr})` : ''}`;
    const duplicate = this._workfrontUsers.some((item) => item.ID !== user.ID
      && item.name === user.name && item.emailAddr === user.emailAddr);
    return duplicate ? `${label} [${user.ID}]` : label;
  }

  // eslint-disable-next-line class-methods-use-this
  keepAssignmentLabel(task) {
    return `${task.assignedTo?.name || 'Current assignee'} (keep assignment)`;
  }

  isAssigneeSelectionValid(task) {
    if (this._assigneeSearch === undefined) return true;
    if (this._assigneeId === (task.assignedToID || '')) {
      return this._assigneeSearch === this.keepAssignmentLabel(task);
    }
    return this._workfrontUsers.some((user) => user.ID === this._assigneeId
      && this.userPickerLabel(user) === this._assigneeSearch);
  }

  renderUserPicker(task, kind) {
    const tagging = kind === 'tag';
    const label = tagging ? 'Tag a user' : 'Assign to';
    const listId = `${kind}-users-${task.id}`;
    const selected = this._workfrontUsers.find((user) => user.ID === this._assigneeId);
    const value = tagging ? this._tagSearch : this._assigneeSearch
      ?? (this._assigneeId === (task.assignedToID || '') || !selected
        ? this.keepAssignmentLabel(task) : this.userPickerLabel(selected));
    const users = this._workfrontUsers.filter((user) => (tagging
      ? !this._mentionedUsers.some((item) => item.ID === user.ID)
      : user.ID !== task.assignedToID));
    return html`
      <label class="comment-user-field">
        ${label}
        <input type="text" list=${listId} aria-label=${label}
          autocomplete="off" placeholder="Search name or email…"
          .value=${value}
          ?disabled=${this._usersState !== 'loaded' || this._commentPosting}
          @input=${(e) => {
    const query = e.target.value;
    const user = users.find((item) => this.userPickerLabel(item) === query);
    if (tagging) {
      this._tagSearch = query;
      if (user) {
        this.addMention(user.ID);
        this._tagSearch = '';
        e.target.value = '';
      }
    } else {
      this._assigneeSearch = query;
      if (user) this._assigneeId = user.ID;
      else if (query === this.keepAssignmentLabel(task)) {
        this._assigneeId = task.assignedToID || '';
      }
    }
  }}
          @keydown=${(e) => { if (e.key === 'Enter') e.preventDefault(); }} />
        <datalist id=${listId}>
          ${tagging ? nothing : html`<option value=${this.keepAssignmentLabel(task)}></option>`}
          ${users.map((user) => html`<option value=${this.userPickerLabel(user)}></option>`)}
        </datalist>
      </label>`;
  }

  renderComments(task) {
    const thread = this._comments[task.id] || { state: 'loading', items: [] };
    const draft = this._commentDraft || '';
    const canPost = !!draft.trim() && draft.trim().length <= COMMENT_MAX_LENGTH
      && !this._commentPosting && this.isAssigneeSelectionValid(task);
    const reassign = !!this._assigneeId && this._assigneeId !== task.assignedToID;
    const submitLabel = reassign ? 'Assign & Post' : 'Post';
    let list;
    if (thread.state === 'loading' && !thread.items.length) {
      list = html`<div class="comments-loading"><div class="spinner" aria-hidden="true"></div></div>`;
    } else if (thread.state === 'error') {
      list = html`<p class="comments-error" role="alert">${thread.error}</p>`;
    } else if (!thread.items.length) {
      list = html`<p class="comments-empty">No comments yet.</p>`;
    } else {
      list = html`
        <ul class="comment-list">
          ${thread.items.map((c) => html`
            <li class="comment">
              <div class="comment-meta">
                <span class="comment-author">${c.author || 'Unknown'}</span>
                <span class="comment-date">${formatTaskDate(c.date)}</span>
              </div>
              <p class="comment-text">${c.text}</p>
            </li>`)}
        </ul>`;
    }
    return html`
      <div class="task-comments">
        ${list}
        <form class="comment-form" @submit=${(e) => { e.preventDefault(); this.postComment(task); }}>
          <textarea
            class="comment-input"
            rows="2"
            maxlength=${COMMENT_MAX_LENGTH}
            placeholder="Add a comment…"
            aria-label="Add a comment"
            .value=${draft}
            ?disabled=${this._commentPosting}
            @input=${(e) => { this._commentDraft = e.target.value; }}
            @keydown=${(e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      this.postComment(task);
    }
  }}></textarea>
          ${this._commentError ? html`<p class="comments-error" role="alert">${this._commentError}</p>` : nothing}
          ${this._commentNotice
    ? html`<p class="comment-notice" role="status">${this._commentNotice}</p>` : nothing}
          ${this._usersState === 'loading'
    ? html`<p class="comments-empty" role="status">Loading Workfront users…</p>` : nothing}
          ${this._usersState === 'error' ? html`
            <p class="comments-error" role="alert">${this._usersError}</p>
            <button type="button" @click=${this.loadWorkfrontUsers}>Retry loading users</button>
          ` : nothing}
          <div class="comment-user-fields">
            ${this.renderUserPicker(task, 'tag')}
            ${this.renderUserPicker(task, 'assign')}
          </div>
          ${this._mentionedUsers.length ? html`
            <div class="comment-mentions" aria-label="Tagged users">
              ${this._mentionedUsers.map((user) => html`
                <button type="button" ?disabled=${this._commentPosting}
                  aria-label=${`Remove tag for ${user.name || user.ID}`}
                  @click=${() => {
    this._mentionedUsers = this._mentionedUsers.filter((item) => item.ID !== user.ID);
  }}>${user.name || user.ID} (remove tag)</button>`)}
            </div>` : nothing}
          <div class="comment-form-actions">
            <button type="submit" class="comment-submit" ?disabled=${!canPost}>
              ${this._commentPosting ? 'Posting…' : submitLabel}
            </button>
          </div>
        </form>
      </div>`;
  }

  renderTasks() {
    switch (this._tasksState) {
      case 'loading':
        return html`
          <div class="task-management-panel">
            <div class="task-management-loading">
              <div class="spinner" aria-hidden="true"></div>
              <p class="task-management-message">Loading tasks…</p>
            </div>
          </div>`;
      case 'error':
        return html`
          <div class="task-management-panel">
            <div class="task-management-result">
              <div class="task-management-icon">${iconFailure()}</div>
              <p class="task-management-detail">${this._tasksError}</p>
            </div>
            <div class="task-management-actions">
              <sl-button @click=${this.loadTasks}>Retry</sl-button>
            </div>
          </div>`;
      case 'loaded': {
        if (!this._tasks.length) {
          return html`<div class="task-management-panel"><p class="task-management-message">No tasks assigned to you.</p></div>`;
        }
        const tasks = this.filteredTasks;
        const stats = this.taskStats;
        return html`
          <div class="tasks-view">
            <div class="tasks-toolbar">
              <button class="icon-btn refresh-btn" title="Refresh tasks" aria-label="Refresh tasks" @click=${this.loadTasks}>${ACTION_ICONS.refresh()}</button>
            </div>
            <div class="task-stats">
              <div class="stat"><span class="stat-label" title="Assigned to you">Assigned to you</span><span class="stat-value">${stats.total}</span></div>
              <div class="stat"><span class="stat-label" title="In progress">In progress</span><span class="stat-value">${stats.inProgress}</span></div>
              <div class="stat"><span class="stat-label" title="Due this week">Due this week</span><span class="stat-value">${stats.dueThisWeek}</span></div>
            </div>
            <input
              class="task-search"
              type="search"
              placeholder="Search tasks…"
              .value=${this._taskQuery}
              @input=${(e) => { this._taskQuery = e.target.value; }} />
            ${tasks.length
    ? html`<ul class="task-list">${tasks.map((t) => this.renderTask(t))}</ul>`
    : html`<p class="task-management-message">No tasks match “${this._taskQuery}”.</p>`}
          </div>`;
      }
      default:
        return nothing;
    }
  }

  renderTab(id, label) {
    const active = this._tab === id;
    return html`
      <button
        role="tab"
        aria-selected=${active}
        class="tab ${active ? 'active' : ''}"
        @click=${() => this.selectTab(id)}>${label}</button>`;
  }

  render() {
    if (this._allowed === undefined) return nothing; // gate not resolved yet
    if (!this._allowed) return this.renderNoAccess();

    return html`
      <div class="tabs" role="tablist">
        ${this.renderTab('tasks', 'Tasks')}
        ${this.renderTab('service', 'Request Approval')}
      </div>
      <div class="tab-panel" role="tabpanel">
        ${this._tab === 'service' ? this.renderService() : this.renderTasks()}
      </div>`;
  }
}

customElements.define('refdemo-task-management', RefDemoTaskManagement);

/* ── Init ────────────────────────────────────────────────────────────── */

(async function init() {
  const { context, token, actions } = await DA_SDK;

  const cmp = document.createElement('refdemo-task-management');
  cmp.token = token;
  cmp.context = context;
  cmp.onClose = () => actions.closeLibrary();

  document.body.append(cmp);
}());
