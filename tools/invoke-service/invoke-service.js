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

/* Small action icons (16px, currentColor) */
const SVG = (paths) => html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const ACTION_ICONS = {
  play: () => SVG(html`<path d="M6 4l14 8-14 8z" fill="currentColor" stroke="none"></path>`),
  check: () => SVG(html`<path d="M5 12.5l4.5 4.5L19 7"></path>`),
  close: () => SVG(html`<path d="M6 6l12 12M18 6L6 18"></path>`),
  external: () => SVG(html`<path d="M14 4h6v6"></path><path d="M20 4l-9 9"></path><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"></path>`),
  clock: () => SVG(html`<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path>`),
};

/* ── Placeholders config ─────────────────────────────────────────────── */

function buildPlaceholdersUrl(org, repo) {
  return `https://main--${repo}--${org}.aem.live/config/placeholders.json`;
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
const WORKFRONT_TASKS_PATH = `${WORKFRONT_API_BASE}/task/search`;
const WORKFRONT_TASK_ACTION_PATH = `${WORKFRONT_API_BASE}/task`;
const AIO_WF_ACTION_ENDPOINT = 'https://675172-referencedemopartner-stage.adobeioruntime.net/api/v1/web/ref-demo-api-gateway/wf-actions';

// Workfront endpoints derived from a single "workfront-instance-url"
// (e.g. https://aemshowcase2.my.workfront.com). URLs are only built when it is set.
async function fetchWorkfrontConfig(org, repo) {
  const lookup = await fetchPlaceholderLookup(org, repo);
  const instance = (lookup['workfront-instance-url'] || '').replace(/\/+$/, '');
  if (!instance) return { instance: '', tasksUrl: '', actionUrl: '' };
  return {
    instance,
    tasksUrl: `${instance}${WORKFRONT_TASKS_PATH}`,
    actionUrl: `${instance}${WORKFRONT_TASK_ACTION_PATH}`,
  };
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

/* ── Workfront tasks ─────────────────────────────────────────────────── */

// Fields requested for each task in the Workfront task/search call.
const WORKFRONT_TASK_FIELDS = [
  'ID', 'name', 'status', 'percentComplete', 'priority', 'priorityColor', 'condition',
  'plannedStartDate', 'plannedCompletionDate', 'commitDate', 'canStart', 'isReady',
  'isStatusComplete', 'hasDocuments', 'hasNotes', 'hasMessages',
  'workRequired', 'actualWorkRequiredDouble',
  'taskNumber', 'URL', 'project:name', 'assignedTo:name', 'assignedToID', 'objCode',
].join(',');

// Workfront dates look like "2026-08-07T09:00:00:000-0700" — show just the date part.
function formatTaskDate(value) {
  if (!value) return '';
  const iso = String(value).slice(0, 10);
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

async function fetchWorkfrontTasks(url, assignedToId, token) {
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
  return rows.map((row) => ({
    ...row,
    id: row.ID,
    status: (row.status || '').toUpperCase(),
    statusLabel: row.status || '',
  }));
}

async function updateWorkfrontTask(url, taskId, actionKey) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId, action: actionKey }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Workfront update failed: ${resp.status} – ${body}`);
  }
  return resp.json();
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
    console.warn('[invoke-service] Failed to fetch user profile:', e);
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

/* ── External service call ───────────────────────────────────────────── */

async function invokeExternalService(token, context) {
  // eslint-disable-next-line no-console
  console.log('[invoke-service] DA SDK context →', JSON.stringify(context, null, 2));

  const { org, repo, path } = resolveOrgRepo(context);
  // eslint-disable-next-line no-console
  console.log('[invoke-service] Resolved →', { org, repo, path });

  const [profile, config] = await Promise.all([
    fetchUserProfile(token),
    fetchPlaceholders(org, repo).catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[invoke-service] Placeholders fetch failed:', err);
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
      console.warn('[invoke-service] Failed to parse custom payload, using default:', e);
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

  // eslint-disable-next-line no-console
  console.log('[invoke-service] Calling service →', resolvedUrl);

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

  return resp.json();
}

// Which actions are offered per Workfront status code.
const STATUS_ACTIONS = {
  NEW: [
    { key: 'INP', label: 'Start', icon: 'play' },
    { key: 'CPL', label: 'Complete', icon: 'check' },
    { key: 'REJ', label: 'Reject', icon: 'close', variant: 'secondary' },
  ],
  INP: [
    { key: 'CPL', label: 'Complete', icon: 'check' },
    { key: 'REJ', label: 'Reject', icon: 'close', variant: 'secondary' },
  ],
  CPL: [],
  REJ: [],
};

function actionsForStatus(status) {
  return STATUS_ACTIONS[(status || '').toUpperCase()]
    || [{ key: 'CPL', label: 'Complete', icon: 'check' }, { key: 'REJ', label: 'Reject', icon: 'close', variant: 'secondary' }];
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

class RefDemoInvokeService extends LitElement {
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
    // Tasks tab
    _tasksState: { state: true }, // 'idle' | 'loading' | 'loaded' | 'error'
    _tasks: { state: true },
    _tasksError: { state: true },
    _busyTaskId: { state: true },
    _taskQuery: { state: true },
  };

  constructor() {
    super();
    this._tab = 'service';
    this._view = 'confirm';
    this._tasksState = 'idle';
    this._tasks = [];
    this._taskQuery = '';
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
    if (task.URL) window.open(task.URL, '_blank', 'noopener');
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [styles];
    this.gateUser();
  }

  async gateUser() {
    const profile = await fetchUserProfile(this.token);
    this._allowed = typeof profile.userEmail === 'string'
      && profile.userEmail.toLowerCase().endsWith('@adobe.com');
  }

  /* ── Service tab ── */

  async run() {
    this._view = 'loading';
    try {
      await invokeExternalService(this.token, this.context);
      this._isSuccess = true;
      this._message = 'The external service executed successfully.';
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[invoke-service] Error:', err);
      this._isSuccess = false;
      this._message = err.message || 'An unexpected error occurred.';
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
      this._tasks = await fetchWorkfrontTasks(cfg.tasksUrl, userId, this.token);
      this._tasksState = 'loaded';
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[invoke-service] Tasks error:', err);
      this._tasksError = err.message || 'Failed to load tasks.';
      this._tasksState = 'error';
    }
  }

  async runTaskAction(task, action) {
    this._busyTaskId = task.id;
    this._tasksError = undefined;
    try {
      const { org, repo } = resolveOrgRepo(this.context);
      const cfg = await fetchWorkfrontConfig(org, repo);
      if (!cfg.actionUrl) {
        throw new Error('Workfront instance URL is not configured. Add a "workfront-instance-url" entry to /config/placeholders.json.');
      }
      await updateWorkfrontTask(cfg.actionUrl, task.id, action.key);
      await this.loadTasks(); // refresh after a successful transition
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[invoke-service] Task action error:', err);
      this._tasksError = err.message || 'Failed to update task.';
      this._tasksState = 'error';
    } finally {
      this._busyTaskId = undefined;
    }
  }

  /* ── Renderers ── */

  renderConfirm() {
    return html`
      <div class="invoke-service-panel">
        <p class="invoke-service-message">Invoke the external service for this document?</p>
        <div class="invoke-service-actions">
          <sl-button class="secondary" @click=${this.close}>Cancel</sl-button>
          <sl-button @click=${this.run}>Confirm</sl-button>
        </div>
      </div>`;
  }

  renderResult() {
    return html`
      <div class="invoke-service-panel">
        <div class="invoke-service-result">
          <div class="invoke-service-icon">${this._isSuccess ? iconSuccess() : iconFailure()}</div>
          <p class="invoke-service-label">${this._isSuccess ? 'Success' : 'Failed'}</p>
          <p class="invoke-service-detail">${this._message}</p>
        </div>
        <div class="invoke-service-actions">
          <sl-button @click=${this.close}>Close</sl-button>
        </div>
      </div>`;
  }

  renderNoAccess() {
    return html`
      <div class="invoke-service-panel">
        <div class="invoke-service-result">
          <div class="invoke-service-icon">${iconFailure()}</div>
          <p class="invoke-service-label">Access denied</p>
          <p class="invoke-service-detail">You do not have permission to run this extension. Please contact an Adobe administrator if you believe this is a mistake.</p>
        </div>
        <div class="invoke-service-actions">
          <sl-button @click=${this.close}>Close</sl-button>
        </div>
      </div>`;
  }

  renderService() {
    switch (this._view) {
      case 'loading':
        return html`
          <div class="invoke-service-panel">
            <div class="invoke-service-loading">
              <div class="spinner" aria-hidden="true"></div>
              <p class="invoke-service-message">Executing external service…</p>
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
    const actions = actionsForStatus(task.status);
    const busy = this._busyTaskId === task.id;
    const project = task.project?.name;
    const due = formatTaskDate(task.plannedCompletionDate || task.commitDate);
    const overdue = isTaskOverdue(task);
    const pct = Math.round(task.percentComplete || 0);
    const statusClass = (task.status || '').toLowerCase();
    return html`
      <li class="task">
        <div class="task-head">
          <p class="task-name" title=${task.name}>${task.name}</p>
          <div class="task-actions">
            ${busy
    ? html`<div class="spinner" aria-hidden="true"></div>`
    : html`
              ${actions.map((a) => html`
                <button
                  class="icon-btn ${a.variant || 'primary'}"
                  title=${a.label}
                  aria-label=${a.label}
                  @click=${() => this.runTaskAction(task, a)}>${ACTION_ICONS[a.icon]()}</button>`)}
              ${task.URL ? html`
                <button class="icon-btn" title="Open in Workfront" aria-label="Open in Workfront" @click=${() => this.openTask(task)}>${ACTION_ICONS.external()}</button>` : nothing}`}
          </div>
        </div>
        <div class="task-sub">
          ${project ? html`<span class="task-project" title=${project}>${project}</span><span class="dot">·</span>` : nothing}
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
      </li>`;
  }

  renderTasks() {
    switch (this._tasksState) {
      case 'loading':
        return html`
          <div class="invoke-service-panel">
            <div class="invoke-service-loading">
              <div class="spinner" aria-hidden="true"></div>
              <p class="invoke-service-message">Loading tasks…</p>
            </div>
          </div>`;
      case 'error':
        return html`
          <div class="invoke-service-panel">
            <div class="invoke-service-result">
              <div class="invoke-service-icon">${iconFailure()}</div>
              <p class="invoke-service-detail">${this._tasksError}</p>
            </div>
            <div class="invoke-service-actions">
              <sl-button @click=${this.loadTasks}>Retry</sl-button>
            </div>
          </div>`;
      case 'loaded': {
        if (!this._tasks.length) {
          return html`<div class="invoke-service-panel"><p class="invoke-service-message">No tasks assigned to you.</p></div>`;
        }
        const tasks = this.filteredTasks;
        const stats = this.taskStats;
        return html`
          <div class="tasks-view">
            <div class="task-stats">
              <div class="stat"><span class="stat-label">Assigned to you</span><span class="stat-value">${stats.total}</span></div>
              <div class="stat"><span class="stat-label">In progress</span><span class="stat-value">${stats.inProgress}</span></div>
              <div class="stat"><span class="stat-label">Due this week</span><span class="stat-value">${stats.dueThisWeek}</span></div>
            </div>
            <input
              class="task-search"
              type="search"
              placeholder="Search tasks…"
              .value=${this._taskQuery}
              @input=${(e) => { this._taskQuery = e.target.value; }} />
            ${tasks.length
    ? html`<ul class="task-list">${tasks.map((t) => this.renderTask(t))}</ul>`
    : html`<p class="invoke-service-message">No tasks match “${this._taskQuery}”.</p>`}
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
        ${this.renderTab('service', 'Service')}
        ${this.renderTab('tasks', 'Tasks')}
      </div>
      <div class="tab-panel" role="tabpanel">
        ${this._tab === 'service' ? this.renderService() : this.renderTasks()}
      </div>`;
  }
}

customElements.define('refdemo-invoke-service', RefDemoInvokeService);

/* ── Init ────────────────────────────────────────────────────────────── */

(async function init() {
  const { context, token, actions } = await DA_SDK;

  const cmp = document.createElement('refdemo-invoke-service');
  cmp.token = token;
  cmp.context = context;
  cmp.onClose = () => actions.closeLibrary();

  document.body.append(cmp);
}());
