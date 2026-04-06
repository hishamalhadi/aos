/**
 * Node type registry — maps n8n node types to visual definitions.
 *
 * Each entry defines how a node type appears in the editor:
 * icon, color, configurable fields, default parameters.
 */
import type { NodeTypeDefinition } from './types';

// ── Node type registry ──

export const NODE_TYPES: Record<string, NodeTypeDefinition> = {
  // ── Triggers ──

  'n8n-nodes-base.scheduleTrigger': {
    n8nType: 'n8n-nodes-base.scheduleTrigger',
    label: 'Schedule',
    category: 'trigger',
    icon: 'clock',
    color: '#D9730D',
    description: 'Run on a time-based schedule (cron)',
    fields: [
      {
        key: 'rule.interval[0].expression',
        label: 'Cron Expression',
        type: 'cron',
        placeholder: '0 8 * * *',
        defaultValue: '0 8 * * *',
        required: true,
      },
    ],
    defaultParameters: {
      rule: { interval: [{ field: 'cronExpression', expression: '0 8 * * *' }] },
    },
    handles: { inputs: 0, outputs: 1 },
  },

  'n8n-nodes-base.webhook': {
    n8nType: 'n8n-nodes-base.webhook',
    label: 'Webhook',
    category: 'trigger',
    icon: 'webhook',
    color: '#D9730D',
    description: 'Receive data via HTTP webhook',
    fields: [
      { key: 'path', label: 'Path', type: 'text', placeholder: 'my-webhook', required: true },
      { key: 'httpMethod', label: 'Method', type: 'select', options: [
        { label: 'POST', value: 'POST' }, { label: 'GET', value: 'GET' },
      ]},
    ],
    defaultParameters: { path: 'webhook', httpMethod: 'POST', responseMode: 'onReceived' },
    handles: { inputs: 0, outputs: 1 },
  },

  // ── Actions ──

  'n8n-nodes-base.telegram': {
    n8nType: 'n8n-nodes-base.telegram',
    label: 'Telegram',
    category: 'action',
    icon: 'send',
    color: '#0088CC',
    description: 'Send a message via Telegram bot',
    fields: [
      { key: 'chatId', label: 'Chat ID', type: 'text', required: true },
      { key: 'text', label: 'Message', type: 'textarea', required: true },
    ],
    defaultParameters: { chatId: '', text: '', additionalFields: {} },
    credentialType: 'telegramApi',
    handles: { inputs: 1, outputs: 1 },
  },

  'n8n-nodes-base.gmail': {
    n8nType: 'n8n-nodes-base.gmail',
    label: 'Gmail',
    category: 'action',
    icon: 'mail',
    color: '#EA4335',
    description: 'Read, send, or search Gmail messages',
    fields: [
      { key: 'operation', label: 'Operation', type: 'select', options: [
        { label: 'Get All', value: 'getAll' }, { label: 'Send', value: 'send' },
        { label: 'Reply', value: 'reply' },
      ]},
      { key: 'limit', label: 'Limit', type: 'number', defaultValue: 10 },
    ],
    defaultParameters: { operation: 'getAll', returnAll: false, limit: 10 },
    credentialType: 'gmailOAuth2',
    handles: { inputs: 1, outputs: 1 },
  },

  'n8n-nodes-base.googleCalendar': {
    n8nType: 'n8n-nodes-base.googleCalendar',
    label: 'Google Calendar',
    category: 'action',
    icon: 'calendar',
    color: '#4285F4',
    description: 'Read or create Google Calendar events',
    fields: [
      { key: 'operation', label: 'Operation', type: 'select', options: [
        { label: 'Get All', value: 'getAll' }, { label: 'Create', value: 'create' },
      ]},
    ],
    defaultParameters: { operation: 'getAll', returnAll: false, limit: 20 },
    credentialType: 'googleCalendarOAuth2Api',
    handles: { inputs: 1, outputs: 1 },
  },

  'n8n-nodes-base.googleSheets': {
    n8nType: 'n8n-nodes-base.googleSheets',
    label: 'Google Sheets',
    category: 'action',
    icon: 'sheet',
    color: '#0F9D58',
    description: 'Read or append data to Google Sheets',
    fields: [
      { key: 'operation', label: 'Operation', type: 'select', options: [
        { label: 'Append', value: 'append' }, { label: 'Read', value: 'read' },
      ]},
    ],
    defaultParameters: { operation: 'append' },
    credentialType: 'googleSheetsOAuth2Api',
    handles: { inputs: 1, outputs: 1 },
  },

  'n8n-nodes-base.httpRequest': {
    n8nType: 'n8n-nodes-base.httpRequest',
    label: 'HTTP Request',
    category: 'action',
    icon: 'globe',
    color: '#6B6560',
    description: 'Make an HTTP request to any URL',
    fields: [
      { key: 'method', label: 'Method', type: 'select', options: [
        { label: 'GET', value: 'GET' }, { label: 'POST', value: 'POST' },
        { label: 'PUT', value: 'PUT' }, { label: 'DELETE', value: 'DELETE' },
      ]},
      { key: 'url', label: 'URL', type: 'text', placeholder: 'https://...', required: true },
    ],
    defaultParameters: { method: 'GET', url: '', options: {} },
    handles: { inputs: 1, outputs: 1 },
  },

  // ── Logic ──

  'n8n-nodes-base.if': {
    n8nType: 'n8n-nodes-base.if',
    label: 'If',
    category: 'logic',
    icon: 'git-branch',
    color: '#BF5AF2',
    description: 'Branch based on a condition',
    fields: [],
    defaultParameters: { conditions: { options: { caseSensitive: true } } },
    handles: { inputs: 1, outputs: 2 },
  },

  'n8n-nodes-base.code': {
    n8nType: 'n8n-nodes-base.code',
    label: 'Code',
    category: 'logic',
    icon: 'code',
    color: '#BF5AF2',
    description: 'Run custom JavaScript code',
    fields: [
      { key: 'jsCode', label: 'JavaScript', type: 'textarea', required: true },
    ],
    defaultParameters: { jsCode: '// Process items\nreturn $input.all();' },
    handles: { inputs: 1, outputs: 1 },
  },

  'n8n-nodes-base.set': {
    n8nType: 'n8n-nodes-base.set',
    label: 'Set',
    category: 'logic',
    icon: 'edit',
    color: '#BF5AF2',
    description: 'Set or transform data fields',
    fields: [],
    defaultParameters: { options: { includeOtherFields: true } },
    handles: { inputs: 1, outputs: 1 },
  },

  // ── AOS-specific ──

  'aos.agentDispatch': {
    n8nType: 'aos.agentDispatch',
    label: 'Agent Dispatch',
    category: 'action',
    icon: 'bot',
    color: '#A855F7',
    description: 'Dispatch an AOS agent to perform a task',
    fields: [
      { key: 'agent_id', label: 'Agent', type: 'text', placeholder: 'steward', required: true },
      { key: 'task', label: 'Task', type: 'textarea', placeholder: 'Describe the task...', required: true },
    ],
    defaultParameters: { agent_id: '', task: '', context: '' },
    handles: { inputs: 1, outputs: 1 },
  },

  'aos.hitlApproval': {
    n8nType: 'aos.hitlApproval',
    label: 'Human Approval',
    category: 'logic',
    icon: 'hand',
    color: '#F59E0B',
    description: 'Pause workflow until human approves',
    fields: [
      { key: 'message', label: 'Approval Message', type: 'textarea', placeholder: 'Please review and approve...' },
      { key: 'notify_via', label: 'Notify Via', type: 'select', options: [
        { label: 'Telegram', value: 'telegram' }, { label: 'Email', value: 'email' },
      ]},
    ],
    defaultParameters: { message: '', notify_via: 'telegram' },
    handles: { inputs: 1, outputs: 1 },
  },

  'n8n-nodes-base.executeWorkflow': {
    n8nType: 'n8n-nodes-base.executeWorkflow',
    label: 'Sub-Workflow',
    category: 'logic',
    icon: 'workflow',
    color: '#14B8A6',
    description: 'Execute another workflow as a sub-workflow',
    fields: [
      { key: 'workflowId', label: 'Workflow ID', type: 'text', placeholder: 'workflow-id' },
    ],
    defaultParameters: { source: 'database', workflowId: '' },
    handles: { inputs: 1, outputs: 1 },
  },

  'n8n-nodes-base.switch': {
    n8nType: 'n8n-nodes-base.switch',
    label: 'Switch',
    category: 'logic',
    icon: 'git-branch',
    color: '#BF5AF2',
    description: 'Route to different outputs based on conditions',
    fields: [],
    defaultParameters: { mode: 'rules', options: {} },
    handles: { inputs: 1, outputs: 4 },
  },

  'n8n-nodes-base.wait': {
    n8nType: 'n8n-nodes-base.wait',
    label: 'Wait',
    category: 'logic',
    icon: 'clock',
    color: '#F59E0B',
    description: 'Pause execution until resumed via webhook',
    fields: [],
    defaultParameters: { resume: 'webhook' },
    handles: { inputs: 1, outputs: 1 },
  },
};

// ── Category metadata ──

export const CATEGORY_META: Record<string, { label: string; color: string }> = {
  trigger: { label: 'Triggers', color: '#D9730D' },
  action: { label: 'Actions', color: '#0A84FF' },
  logic: { label: 'Logic', color: '#BF5AF2' },
  agent: { label: 'Agents', color: '#A855F7' },
};

// ── Helpers ──

export function getNodeDef(n8nType: string): NodeTypeDefinition | undefined {
  return NODE_TYPES[n8nType];
}

export function getNodeDefOrDefault(n8nType: string, name: string): NodeTypeDefinition {
  return NODE_TYPES[n8nType] ?? {
    n8nType,
    label: name || n8nType.split('.').pop() || 'Unknown',
    category: n8nType.includes('Trigger') ? 'trigger' : 'action',
    icon: 'zap',
    color: '#6B6560',
    description: '',
    fields: [],
    defaultParameters: {},
    handles: { inputs: 1, outputs: 1 },
  };
}

/** Group node types by category for the palette */
export function getNodeTypesByCategory(): Record<string, NodeTypeDefinition[]> {
  const groups: Record<string, NodeTypeDefinition[]> = {};
  for (const def of Object.values(NODE_TYPES)) {
    const cat = def.category;
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(def);
  }
  return groups;
}
