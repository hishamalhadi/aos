import { useState, useMemo, useCallback } from 'react';
import {
  X, Shield, Wrench, Zap, Brain, Users, Plus, Search,
  Crown, Code, Megaphone, DollarSign, Briefcase,
  Sparkles, BookOpen, Lock, Globe, ExternalLink,
  Server, Palette, Scale, Target, PenTool, Database,
  Bug, GitBranch, Mail, Share2, ArrowUpRight, ChevronRight,
} from 'lucide-react';
import type { ReactNode } from 'react';

// ============================================================
// Types & Constants
// ============================================================

type AgentStatus = 'active' | 'idle' | 'offline';
type Department = 'leadership' | 'engineering' | 'operations' | 'marketing' | 'finance' | 'business';
type AgentSource = 'system' | 'catalog' | 'community';

interface MockAgent {
  id: string;
  name: string;
  role: string;
  department: Department;
  description: string;
  longDescription: string;
  whenToUse: string;
  model: 'opus' | 'sonnet' | 'haiku';
  color: string;
  initials: string;
  status: AgentStatus;
  tools: string[];
  skills: string[];
  mcpServers: string[];
  scope: 'global' | 'project';
  trustLevel: number;
  is_system: boolean;
  is_hired: boolean;
  reportsTo?: string;
  maxTurns?: number;
  permissionMode: string;
  // Community agent fields
  source?: AgentSource;
  emoji?: string;
  vibe?: string;
  sourceRepo?: string;
  sourceFile?: string;
}

interface MockSkill {
  id: string;
  name: string;
  description: string;
  triggers: string[];
  agents: string[];
  category: 'core' | 'domain' | 'workflow' | 'integration';
  icon: ReactNode;
}

const DEPT_META: Record<Department, { label: string; color: string; icon: ReactNode }> = {
  leadership:  { label: 'Leadership',  color: '#BF5AF2', icon: <Crown className="w-3.5 h-3.5" /> },
  engineering: { label: 'Engineering', color: '#F59E0B', icon: <Code className="w-3.5 h-3.5" /> },
  operations:  { label: 'Operations',  color: '#64D2FF', icon: <Server className="w-3.5 h-3.5" /> },
  marketing:   { label: 'Marketing',   color: '#FF375F', icon: <Megaphone className="w-3.5 h-3.5" /> },
  finance:     { label: 'Finance',     color: '#30D158', icon: <DollarSign className="w-3.5 h-3.5" /> },
  business:    { label: 'Business',    color: '#0A84FF', icon: <Briefcase className="w-3.5 h-3.5" /> },
};

const TRUST_LABELS: Record<number, string> = {
  0: 'Observe', 1: 'Surface', 2: 'Draft',
  3: 'Act + Digest', 4: 'Act + Audit', 5: 'Autonomous',
};

// ============================================================
// Mock Data
// ============================================================

const MOCK_AGENTS: MockAgent[] = [
  // ── Leadership ──
  {
    id: 'chief', name: 'Chief', role: 'Orchestrator', department: 'leadership',
    description: 'Receives all requests, delegates to specialists, manages the daily loop.',
    longDescription: 'Chief is the command center of AOS. Every request flows through Chief first. It understands context, delegates to the right specialist agent, coordinates multi-step workflows, and maintains continuity across sessions.',
    whenToUse: 'Start every conversation here. Chief routes to the right agent.',
    model: 'opus', color: '#BF5AF2', initials: 'CH', status: 'active',
    tools: ['*'], skills: ['recall', 'work', 'review', 'step-by-step', 'deliberate'],
    mcpServers: ['google-workspace', 'claude-in-chrome', 'notion', 'slack', 'qmd'],
    scope: 'global', trustLevel: 5, is_system: true, is_hired: true,
    permissionMode: 'bypassPermissions', maxTurns: 50,
  },
  {
    id: 'advisor', name: 'Advisor', role: 'Strategy & Analysis', department: 'leadership',
    description: 'Observes patterns, compiles insights, surfaces what matters, plans what\'s next.',
    longDescription: 'Advisor is the analytical backbone. It compiles insights from across the vault, identifies patterns in work and communication, prepares briefings, and helps make informed decisions.',
    whenToUse: 'When you need analysis, a briefing, or help deciding between options.',
    model: 'opus', color: '#AF52DE', initials: 'AD', status: 'active',
    tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
    skills: ['recall', 'review', 'deliberate'],
    mcpServers: ['qmd'],
    scope: 'global', trustLevel: 3, is_system: true, is_hired: true,
    reportsTo: 'chief', permissionMode: 'default',
  },
  // ── Operations ──
  {
    id: 'steward', name: 'Steward', role: 'System Health', department: 'operations',
    description: 'Monitors services, detects drift, repairs issues, keeps the system running.',
    longDescription: 'Steward runs continuous health checks across all AOS services. It detects configuration drift, repairs broken LaunchAgents, validates symlinks, and ensures the system matches its intended state.',
    whenToUse: 'When something is broken, drifting, or needs maintenance.',
    model: 'sonnet', color: '#64D2FF', initials: 'ST', status: 'active',
    tools: ['Read', 'Glob', 'Grep', 'Bash'],
    skills: ['systematic-debugging', 'bridge-ops'],
    mcpServers: [],
    scope: 'global', trustLevel: 4, is_system: true, is_hired: true,
    reportsTo: 'chief', permissionMode: 'default',
  },
  {
    id: 'ops', name: 'Ops', role: 'Monitoring', department: 'operations',
    description: 'Quick health checks — RAM, disk, CPU, services, logs.',
    longDescription: 'Ops is the eyes on the ground. Quick, lightweight health checks and status reports. It doesn\'t fix things — it finds them and reports.',
    whenToUse: 'Quick health check or status report.',
    model: 'haiku', color: '#5AC8FA', initials: 'OP', status: 'idle',
    tools: ['Read', 'Glob', 'Grep', 'Bash'],
    skills: [],
    mcpServers: [],
    scope: 'global', trustLevel: 2, is_system: false, is_hired: true,
    reportsTo: 'steward', permissionMode: 'default',
  },
  // ── Engineering ──
  {
    id: 'engineer', name: 'Engineer', role: 'Infrastructure', department: 'engineering',
    description: 'Installs packages, configures services, manages LaunchAgents, sets up environments.',
    longDescription: 'Engineer handles all infrastructure work: Homebrew packages, LaunchAgents, Python/Node environments, Docker containers, network services.',
    whenToUse: 'Installing, configuring, or fixing infrastructure.',
    model: 'sonnet', color: '#34D399', initials: 'EN', status: 'active',
    tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
    skills: [],
    mcpServers: [],
    scope: 'global', trustLevel: 3, is_system: false, is_hired: true,
    reportsTo: 'chief', permissionMode: 'default',
  },
  {
    id: 'developer', name: 'Developer', role: 'Software', department: 'engineering',
    description: 'Builds and iterates on apps — SwiftUI, React, screenshot-driven development.',
    longDescription: 'Developer is the dedicated software agent. Handles app development, UI iteration, and build management.',
    whenToUse: 'Building features, fixing bugs, or iterating on UI.',
    model: 'opus', color: '#F59E0B', initials: 'DV', status: 'idle',
    tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'Agent'],
    skills: ['frontend-design'],
    mcpServers: [],
    scope: 'project', trustLevel: 3, is_system: false, is_hired: true,
    reportsTo: 'chief', permissionMode: 'default',
  },
  // ── Marketing ──
  {
    id: 'cmo', name: 'CMO', role: 'Marketing', department: 'marketing',
    description: 'Email campaigns, ecommerce, social, ads, analytics, and content.',
    longDescription: 'The CMO owns the full marketing loop: Strategy, Content, Distribution, Measurement, Optimization. Connected to Shopify, Klaviyo, Meta Ads, and more.',
    whenToUse: 'Any marketing task — campaigns, content, analytics, funnels.',
    model: 'sonnet', color: '#FF375F', initials: 'CM', status: 'idle',
    tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'Agent', 'WebFetch', 'WebSearch'],
    skills: ['marketing'],
    mcpServers: ['shopify', 'klaviyo', 'meta-ads', 'google-analytics', 'ayrshare', 'google-workspace'],
    scope: 'global', trustLevel: 3, is_system: false, is_hired: true,
    reportsTo: 'chief', permissionMode: 'default', maxTurns: 25,
  },
  // ── Catalog ──
  {
    id: 'cto', name: 'CTO', role: 'Technology Strategy', department: 'leadership',
    description: 'Technical vision, architecture decisions, stack evaluation, engineering coordination.',
    longDescription: 'The CTO sets technical direction. Evaluates technologies, makes architecture decisions, reviews engineering output.',
    whenToUse: 'Architecture decisions, technology evaluation, technical strategy.',
    model: 'opus', color: '#A855F7', initials: 'CT', status: 'offline',
    tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'Agent', 'WebSearch'],
    skills: ['architect', 'deliberate', 'requesting-code-review'],
    mcpServers: [],
    scope: 'global', trustLevel: 4, is_system: false, is_hired: false,
    reportsTo: 'chief', permissionMode: 'default',
  },
  {
    id: 'cfo', name: 'CFO', role: 'Finance', department: 'finance',
    description: 'Budgeting, forecasting, P&L management, and financial reporting.',
    longDescription: 'The CFO manages financial health. Revenue tracking, budgets, forecasts, invoicing, and compliance.',
    whenToUse: 'Financial reports, budgets, forecasting, invoicing workflows.',
    model: 'sonnet', color: '#30D158', initials: 'CF', status: 'offline',
    tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'WebFetch'],
    skills: [],
    mcpServers: ['wave-accounting', 'paypal', 'google-workspace'],
    scope: 'global', trustLevel: 2, is_system: false, is_hired: false,
    reportsTo: 'chief', permissionMode: 'default',
  },
  {
    id: 'coo', name: 'COO', role: 'Operations Strategy', department: 'operations',
    description: 'Process optimization, cross-team coordination, execution oversight.',
    longDescription: 'The COO ensures everything runs. Optimizes workflows, coordinates across departments, tracks OKRs.',
    whenToUse: 'Workflow optimization, OKR tracking, cross-team coordination.',
    model: 'sonnet', color: '#5AC8FA', initials: 'CO', status: 'offline',
    tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'Agent'],
    skills: ['work', 'review', 'step-by-step'],
    mcpServers: ['google-workspace', 'slack'],
    scope: 'global', trustLevel: 3, is_system: false, is_hired: false,
    reportsTo: 'chief', permissionMode: 'default',
  },
  {
    id: 'legal', name: 'Legal Counsel', role: 'Compliance', department: 'finance',
    description: 'Contract review, compliance, terms of service, regulatory guidance.',
    longDescription: 'Reviews contracts, ensures compliance, drafts terms. Conservative — always flags, never acts unilaterally.',
    whenToUse: 'Reviewing contracts, compliance questions, legal risk assessment.',
    model: 'sonnet', color: '#86868B', initials: 'LC', status: 'offline',
    tools: ['Read', 'Glob', 'Grep', 'WebSearch'],
    skills: [],
    mcpServers: ['google-workspace'],
    scope: 'global', trustLevel: 1, is_system: false, is_hired: false,
    reportsTo: 'cfo', permissionMode: 'default',
  },
  {
    id: 'accountant', name: 'Accountant', role: 'Bookkeeping', department: 'finance',
    description: 'Day-to-day bookkeeping, invoices, expense tracking, reconciliation.',
    longDescription: 'Handles routine financial operations: categorizing transactions, invoices, expenses, account reconciliation.',
    whenToUse: 'Invoice generation, expense categorization, account reconciliation.',
    model: 'haiku', color: '#32D74B', initials: 'AC', status: 'offline',
    tools: ['Read', 'Write', 'Bash'],
    skills: [],
    mcpServers: ['wave-accounting', 'paypal'],
    scope: 'global', trustLevel: 2, is_system: false, is_hired: false,
    reportsTo: 'cfo', permissionMode: 'default',
  },
  {
    id: 'sales', name: 'Sales Director', role: 'Revenue', department: 'business',
    description: 'Lead generation, pipeline management, outreach sequences, deal tracking.',
    longDescription: 'Manages the revenue pipeline. Identifies prospects, crafts outreach, tracks deals, forecasts revenue.',
    whenToUse: 'Prospecting, outreach campaigns, pipeline management, deal tracking.',
    model: 'sonnet', color: '#0A84FF', initials: 'SD', status: 'offline',
    tools: ['Read', 'Write', 'Edit', 'Bash', 'WebSearch', 'WebFetch'],
    skills: ['marketing'],
    mcpServers: ['google-workspace', 'slack'],
    scope: 'global', trustLevel: 2, is_system: false, is_hired: false,
    reportsTo: 'chief', permissionMode: 'default',
  },
  {
    id: 'content', name: 'Content Strategist', role: 'Content & Copy', department: 'marketing',
    description: 'Blog posts, newsletters, brand voice, editorial calendar.',
    longDescription: 'Plans content calendars, writes posts and newsletters, maintains brand voice, optimizes for SEO.',
    whenToUse: 'Writing blog posts, newsletters, or managing the editorial pipeline.',
    model: 'sonnet', color: '#FF6482', initials: 'CS', status: 'offline',
    tools: ['Read', 'Write', 'Edit', 'WebSearch', 'WebFetch'],
    skills: ['marketing', 'writing-plans'],
    mcpServers: ['google-workspace'],
    scope: 'global', trustLevel: 2, is_system: false, is_hired: false,
    reportsTo: 'cmo', permissionMode: 'default',
  },
  {
    id: 'social', name: 'Social Media', role: 'Social & Community', department: 'marketing',
    description: 'Scheduling, community engagement, trend monitoring, platform content.',
    longDescription: 'Day-to-day social presence. Posts, scheduling, engagement, trend identification.',
    whenToUse: 'Drafting social posts, scheduling content, community management.',
    model: 'haiku', color: '#FF2D55', initials: 'SM', status: 'offline',
    tools: ['Read', 'Write', 'Bash', 'WebSearch'],
    skills: ['marketing'],
    mcpServers: ['ayrshare', 'google-workspace'],
    scope: 'global', trustLevel: 2, is_system: false, is_hired: false,
    reportsTo: 'cmo', permissionMode: 'default',
  },
  {
    id: 'email-marketing', name: 'Email Marketing', role: 'Campaigns', department: 'marketing',
    description: 'Drip sequences, segmentation, deliverability, conversion optimization.',
    longDescription: 'Manages the email channel. Drip sequences, audience segmentation, A/B testing, deliverability.',
    whenToUse: 'Email campaigns, drip sequences, list segmentation.',
    model: 'sonnet', color: '#FF9500', initials: 'EM', status: 'offline',
    tools: ['Read', 'Write', 'Edit', 'Bash', 'WebFetch'],
    skills: ['marketing'],
    mcpServers: ['klaviyo', 'google-workspace'],
    scope: 'global', trustLevel: 2, is_system: false, is_hired: false,
    reportsTo: 'cmo', permissionMode: 'default',
  },
  {
    id: 'designer', name: 'Designer', role: 'UI/UX', department: 'engineering',
    description: 'Interface design, component systems, prototyping, visual polish.',
    longDescription: 'Creates polished interfaces. Component systems, design tokens, prototype iteration.',
    whenToUse: 'Designing interfaces, building component systems, visual polish.',
    model: 'opus', color: '#FF9F0A', initials: 'DS', status: 'offline',
    tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
    skills: ['frontend-design', 'diagram'],
    mcpServers: ['pencil'],
    scope: 'global', trustLevel: 3, is_system: false, is_hired: false,
    reportsTo: 'cto', permissionMode: 'default',
  },
  {
    id: 'devops', name: 'DevOps', role: 'CI/CD', department: 'engineering',
    description: 'Build pipelines, deployment automation, container orchestration.',
    longDescription: 'Manages the path from code to production. CI/CD pipelines, Docker, deployment automation.',
    whenToUse: 'Setting up pipelines, automating deployments, container management.',
    model: 'sonnet', color: '#FFD60A', initials: 'DO', status: 'offline',
    tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
    skills: [],
    mcpServers: [],
    scope: 'global', trustLevel: 3, is_system: false, is_hired: false,
    reportsTo: 'cto', permissionMode: 'default',
  },
  {
    id: 'qa', name: 'QA Lead', role: 'Testing', department: 'engineering',
    description: 'Test planning, automated suites, regression checks, quality gates.',
    longDescription: 'Ensures everything that ships works. Test plans, automated suites, regression, quality gates.',
    whenToUse: 'Writing tests, running regression, validating releases.',
    model: 'sonnet', color: '#FF9F0A', initials: 'QA', status: 'offline',
    tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
    skills: ['systematic-debugging', 'verification-before-completion'],
    mcpServers: [],
    scope: 'global', trustLevel: 3, is_system: false, is_hired: false,
    reportsTo: 'cto', permissionMode: 'default',
  },
  {
    id: 'security', name: 'Security Officer', role: 'Cybersecurity', department: 'operations',
    description: 'Security audits, vulnerability scanning, access control, incident response.',
    longDescription: 'Hardens the system. Audits, vulnerability scans, access controls, threat monitoring.',
    whenToUse: 'Security audits, reviewing code for vulnerabilities, incident response.',
    model: 'sonnet', color: '#FF453A', initials: 'SO', status: 'offline',
    tools: ['Read', 'Glob', 'Grep', 'Bash', 'WebSearch'],
    skills: ['skill-scanner'],
    mcpServers: [],
    scope: 'global', trustLevel: 2, is_system: false, is_hired: false,
    reportsTo: 'steward', permissionMode: 'default',
  },
  {
    id: 'data-analyst', name: 'Data Analyst', role: 'Insights', department: 'business',
    description: 'Reporting dashboards, trend identification, metric tracking.',
    longDescription: 'Turns raw data into insights. Dashboards, trends, KPIs, data-driven recommendations.',
    whenToUse: 'Building dashboards, analyzing trends, tracking KPIs.',
    model: 'sonnet', color: '#5856D6', initials: 'DA', status: 'offline',
    tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
    skills: ['recall'],
    mcpServers: ['google-workspace'],
    scope: 'global', trustLevel: 2, is_system: false, is_hired: false,
    reportsTo: 'coo', permissionMode: 'default',
  },
  {
    id: 'product', name: 'Product Manager', role: 'Product', department: 'business',
    description: 'Feature prioritization, roadmap planning, user research, stakeholder alignment.',
    longDescription: 'Bridges business goals and engineering. Priorities, roadmaps, specs, stakeholder alignment.',
    whenToUse: 'Prioritizing features, writing specs, planning roadmaps.',
    model: 'sonnet', color: '#007AFF', initials: 'PM', status: 'offline',
    tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'WebSearch'],
    skills: ['work', 'writing-plans', 'deliberate'],
    mcpServers: ['google-workspace', 'slack', 'notion'],
    scope: 'global', trustLevel: 2, is_system: false, is_hired: false,
    reportsTo: 'chief', permissionMode: 'default',
  },
  {
    id: 'customer-success', name: 'Customer Success', role: 'Support', department: 'business',
    description: 'Onboarding, support tickets, satisfaction tracking, churn prevention.',
    longDescription: 'Post-sale relationship. Onboarding, support escalations, satisfaction, churn prevention.',
    whenToUse: 'Customer onboarding, support escalations, retention strategy.',
    model: 'haiku', color: '#34C759', initials: 'CX', status: 'offline',
    tools: ['Read', 'Write', 'Bash', 'WebFetch'],
    skills: [],
    mcpServers: ['google-workspace', 'slack'],
    scope: 'global', trustLevel: 2, is_system: false, is_hired: false,
    reportsTo: 'coo', permissionMode: 'default',
  },

  // ── Community Agents (from agency-agents, 70k★) ──
  {
    id: 'c-frontend-dev', name: 'Frontend Developer', role: 'Web & UI', department: 'engineering',
    description: 'Expert frontend developer specializing in modern web technologies, React/Vue/Angular frameworks, UI implementation, and performance optimization.',
    longDescription: 'Builds responsive, accessible, and performant web applications with pixel-perfect design implementation. Specializes in Core Web Vitals, component libraries, and modern CSS.',
    whenToUse: 'Modern web apps, pixel-perfect UIs, Core Web Vitals optimization.',
    model: 'sonnet', color: '#06B6D4', initials: '🖥️', status: 'offline',
    tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'], skills: [], mcpServers: [],
    scope: 'project', trustLevel: 2, is_system: false, is_hired: false, permissionMode: 'default',
    source: 'community', emoji: '🖥️', vibe: 'Builds responsive, accessible web apps with pixel-perfect precision.',
    sourceRepo: 'msitarzewski/agency-agents', sourceFile: 'engineering/engineering-frontend-developer.md',
  },
  {
    id: 'c-backend-arch', name: 'Backend Architect', role: 'Systems', department: 'engineering',
    description: 'Senior backend architect specializing in scalable system design, database architecture, API development, and cloud infrastructure.',
    longDescription: 'Designs robust, secure, performant server-side applications and microservices. Expert in API design, database architecture, and cloud-native patterns.',
    whenToUse: 'Server-side systems, microservices, cloud infrastructure.',
    model: 'opus', color: '#3B82F6', initials: '🏗️', status: 'offline',
    tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'], skills: [], mcpServers: [],
    scope: 'project', trustLevel: 2, is_system: false, is_hired: false, permissionMode: 'default',
    source: 'community', emoji: '🏗️', vibe: 'Designs the systems that hold everything up — databases, APIs, cloud, scale.',
    sourceRepo: 'msitarzewski/agency-agents', sourceFile: 'engineering/engineering-backend-architect.md',
  },
  {
    id: 'c-ai-engineer', name: 'AI Engineer', role: 'ML & AI', department: 'engineering',
    description: 'Expert AI/ML engineer specializing in machine learning model development, deployment, and integration into production systems.',
    longDescription: 'Focused on building intelligent features, data pipelines, and AI-powered applications with emphasis on practical, scalable solutions.',
    whenToUse: 'Machine learning features, data pipelines, AI-powered apps.',
    model: 'opus', color: '#3B82F6', initials: '🤖', status: 'offline',
    tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'], skills: [], mcpServers: [],
    scope: 'project', trustLevel: 2, is_system: false, is_hired: false, permissionMode: 'default',
    source: 'community', emoji: '🤖', vibe: 'Turns ML models into production features that actually scale.',
    sourceRepo: 'msitarzewski/agency-agents', sourceFile: 'engineering/engineering-ai-engineer.md',
  },
  {
    id: 'c-software-arch', name: 'Software Architect', role: 'Architecture', department: 'engineering',
    description: 'Expert software architect specializing in system design, domain-driven design, architectural patterns, and technical decision-making.',
    longDescription: 'Designs systems that survive the team that built them. Every decision has a trade-off — this agent names them.',
    whenToUse: 'Architecture decisions, domain modeling, system evolution strategy.',
    model: 'opus', color: '#6366F1', initials: '🏛️', status: 'offline',
    tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'], skills: [], mcpServers: [],
    scope: 'project', trustLevel: 2, is_system: false, is_hired: false, permissionMode: 'default',
    source: 'community', emoji: '🏛️', vibe: 'Designs systems that survive the team that built them. Every decision has a trade-off — name it.',
    sourceRepo: 'msitarzewski/agency-agents', sourceFile: 'engineering/engineering-software-architect.md',
  },
  {
    id: 'c-security-eng', name: 'Security Engineer', role: 'AppSec', department: 'operations',
    description: 'Expert application security engineer specializing in threat modeling, vulnerability assessment, and secure code review.',
    longDescription: 'Models threats, reviews code, hunts vulnerabilities, and designs security architecture that holds under adversarial pressure.',
    whenToUse: 'Application security, vulnerability assessment, security CI/CD.',
    model: 'sonnet', color: '#EF4444', initials: '🔒', status: 'offline',
    tools: ['Read', 'Glob', 'Grep', 'Bash'], skills: [], mcpServers: [],
    scope: 'global', trustLevel: 1, is_system: false, is_hired: false, permissionMode: 'default',
    source: 'community', emoji: '🔒', vibe: 'Models threats, reviews code, hunts vulnerabilities — security that actually holds.',
    sourceRepo: 'msitarzewski/agency-agents', sourceFile: 'engineering/engineering-security-engineer.md',
  },
  {
    id: 'c-sre', name: 'SRE', role: 'Reliability', department: 'operations',
    description: 'Expert site reliability engineer specializing in SLOs, error budgets, observability, chaos engineering, and toil reduction.',
    longDescription: 'Reliability is a feature. Error budgets fund velocity — spend them wisely. Manages production reliability and capacity planning.',
    whenToUse: 'Production reliability, toil reduction, capacity planning.',
    model: 'sonnet', color: '#E63946', initials: '🛡️', status: 'offline',
    tools: ['Read', 'Glob', 'Grep', 'Bash'], skills: [], mcpServers: [],
    scope: 'global', trustLevel: 2, is_system: false, is_hired: false, permissionMode: 'default',
    source: 'community', emoji: '🛡️', vibe: 'Reliability is a feature. Error budgets fund velocity — spend them wisely.',
    sourceRepo: 'msitarzewski/agency-agents', sourceFile: 'engineering/engineering-sre.md',
  },
  {
    id: 'c-code-reviewer', name: 'Code Reviewer', role: 'Quality', department: 'engineering',
    description: 'Expert code reviewer providing constructive, actionable feedback on correctness, maintainability, security, and performance.',
    longDescription: 'Reviews code like a mentor, not a gatekeeper. Every comment teaches something. Focused on correctness over style.',
    whenToUse: 'PR reviews, code quality gates, mentoring through review.',
    model: 'sonnet', color: '#A855F7', initials: '👁️', status: 'offline',
    tools: ['Read', 'Glob', 'Grep'], skills: [], mcpServers: [],
    scope: 'project', trustLevel: 2, is_system: false, is_hired: false, permissionMode: 'default',
    source: 'community', emoji: '👁️', vibe: 'Reviews code like a mentor, not a gatekeeper. Every comment teaches something.',
    sourceRepo: 'msitarzewski/agency-agents', sourceFile: 'engineering/engineering-code-reviewer.md',
  },
  {
    id: 'c-db-optimizer', name: 'Database Optimizer', role: 'Databases', department: 'engineering',
    description: 'Expert database specialist focusing on schema design, query optimization, and indexing strategies.',
    longDescription: 'Indexes, query plans, and schema design — databases that don\'t wake you at 3am. PostgreSQL, MySQL, and modern platforms.',
    whenToUse: 'PostgreSQL/MySQL tuning, slow query debugging, migration planning.',
    model: 'sonnet', color: '#F59E0B', initials: '🗄️', status: 'offline',
    tools: ['Read', 'Write', 'Edit', 'Bash'], skills: [], mcpServers: [],
    scope: 'project', trustLevel: 2, is_system: false, is_hired: false, permissionMode: 'default',
    source: 'community', emoji: '🗄️', vibe: 'Indexes, query plans, and schema design — databases that don\'t wake you at 3am.',
    sourceRepo: 'msitarzewski/agency-agents', sourceFile: 'engineering/engineering-database-optimizer.md',
  },
  {
    id: 'c-data-eng', name: 'Data Engineer', role: 'Pipelines', department: 'engineering',
    description: 'Expert data engineer specializing in building reliable data pipelines, lakehouse architectures, and scalable data infrastructure.',
    longDescription: 'Builds the pipelines that turn raw data into trusted, analytics-ready assets. Masters ETL/ELT, Spark, dbt, and streaming.',
    whenToUse: 'Building reliable data infrastructure and warehousing.',
    model: 'sonnet', color: '#F97316', initials: '🔧', status: 'offline',
    tools: ['Read', 'Write', 'Edit', 'Bash'], skills: [], mcpServers: [],
    scope: 'project', trustLevel: 2, is_system: false, is_hired: false, permissionMode: 'default',
    source: 'community', emoji: '🔧', vibe: 'Builds the pipelines that turn raw data into trusted, analytics-ready assets.',
    sourceRepo: 'msitarzewski/agency-agents', sourceFile: 'engineering/engineering-data-engineer.md',
  },
  {
    id: 'c-ux-researcher', name: 'UX Researcher', role: 'Research', department: 'business',
    description: 'Expert user experience researcher specializing in user behavior analysis, usability testing, and data-driven design insights.',
    longDescription: 'Validates design decisions with real user data, not assumptions. Provides actionable research findings that improve usability.',
    whenToUse: 'Usability testing, user interviews, data-driven design decisions.',
    model: 'sonnet', color: '#22C55E', initials: '🔬', status: 'offline',
    tools: ['Read', 'Write', 'Edit', 'WebSearch'], skills: [], mcpServers: [],
    scope: 'project', trustLevel: 2, is_system: false, is_hired: false, permissionMode: 'default',
    source: 'community', emoji: '🔬', vibe: 'Validates design decisions with real user data, not assumptions.',
    sourceRepo: 'msitarzewski/agency-agents', sourceFile: 'design/design-ux-researcher.md',
  },
  {
    id: 'c-ui-designer', name: 'UI Designer', role: 'Visual Design', department: 'business',
    description: 'Expert UI designer specializing in visual design systems, component libraries, and pixel-perfect interface creation.',
    longDescription: 'Creates beautiful, consistent, accessible interfaces. Design tokens, component libraries, brand identity implementation.',
    whenToUse: 'Designing interfaces, building component systems, visual polish.',
    model: 'opus', color: '#A855F7', initials: '🎨', status: 'offline',
    tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'], skills: [], mcpServers: [],
    scope: 'project', trustLevel: 2, is_system: false, is_hired: false, permissionMode: 'default',
    source: 'community', emoji: '🎨', vibe: 'Creates beautiful, consistent, accessible interfaces that feel just right.',
    sourceRepo: 'msitarzewski/agency-agents', sourceFile: 'design/design-ui-designer.md',
  },
  {
    id: 'c-growth-hacker', name: 'Growth Hacker', role: 'Growth', department: 'marketing',
    description: 'Expert growth strategist specializing in rapid user acquisition through data-driven experimentation.',
    longDescription: 'Finds the growth channel nobody\'s exploited yet — then scales it. Viral loops, conversion funnels, scalable channels.',
    whenToUse: 'User acquisition, viral loops, conversion optimization.',
    model: 'sonnet', color: '#22C55E', initials: '🚀', status: 'offline',
    tools: ['Read', 'Write', 'Edit', 'WebSearch', 'WebFetch'], skills: [], mcpServers: [],
    scope: 'global', trustLevel: 1, is_system: false, is_hired: false, permissionMode: 'default',
    source: 'community', emoji: '🚀', vibe: 'Finds the growth channel nobody\'s exploited yet — then scales it.',
    sourceRepo: 'msitarzewski/agency-agents', sourceFile: 'marketing/marketing-growth-hacker.md',
  },
  {
    id: 'c-citation-strat', name: 'AI Citation Strategist', role: 'AEO/GEO', department: 'marketing',
    description: 'Expert in AI recommendation engine optimization — audits brand visibility across ChatGPT, Claude, Gemini, and Perplexity.',
    longDescription: 'Figures out why the AI recommends your competitor and rewires the signals so it recommends you instead.',
    whenToUse: 'AI visibility, citation optimization, competitor analysis.',
    model: 'sonnet', color: '#6D28D9', initials: '🔮', status: 'offline',
    tools: ['Read', 'Write', 'Edit', 'WebSearch', 'WebFetch'], skills: [], mcpServers: [],
    scope: 'global', trustLevel: 1, is_system: false, is_hired: false, permissionMode: 'default',
    source: 'community', emoji: '🔮', vibe: 'Figures out why the AI recommends your competitor and rewires the signals.',
    sourceRepo: 'msitarzewski/agency-agents', sourceFile: 'marketing/marketing-ai-citation-strategist.md',
  },
  {
    id: 'c-product-mgr', name: 'Product Manager', role: 'Product', department: 'business',
    description: 'Holistic product leader who owns the full product lifecycle — discovery, strategy, roadmap, go-to-market.',
    longDescription: 'Ships the right thing, not just the next thing — outcome-obsessed, user-grounded, and diplomatically ruthless about focus.',
    whenToUse: 'Product strategy, roadmap planning, feature prioritization.',
    model: 'opus', color: '#3B82F6', initials: '🧭', status: 'offline',
    tools: ['Read', 'Write', 'Edit', 'WebSearch', 'WebFetch'], skills: [], mcpServers: [],
    scope: 'project', trustLevel: 2, is_system: false, is_hired: false, permissionMode: 'default',
    source: 'community', emoji: '🧭', vibe: 'Ships the right thing, not just the next thing — outcome-obsessed and user-grounded.',
    sourceRepo: 'msitarzewski/agency-agents', sourceFile: 'product/product-manager.md',
  },
  {
    id: 'c-feedback-synth', name: 'Feedback Synthesizer', role: 'Insights', department: 'business',
    description: 'Expert in collecting, analyzing, and synthesizing user feedback from multiple channels.',
    longDescription: 'Distills a thousand user voices into the five things you need to build next. Transforms qualitative into quantitative.',
    whenToUse: 'User feedback analysis, priority extraction, product insights.',
    model: 'sonnet', color: '#3B82F6', initials: '🔍', status: 'offline',
    tools: ['Read', 'Write', 'Edit', 'WebSearch', 'WebFetch'], skills: [], mcpServers: [],
    scope: 'project', trustLevel: 2, is_system: false, is_hired: false, permissionMode: 'default',
    source: 'community', emoji: '🔍', vibe: 'Distills a thousand user voices into the five things you need to build next.',
    sourceRepo: 'msitarzewski/agency-agents', sourceFile: 'product/product-feedback-synthesizer.md',
  },
  {
    id: 'c-orchestrator', name: 'Agents Orchestrator', role: 'Pipeline', department: 'leadership',
    description: 'Autonomous pipeline manager that orchestrates the entire development workflow from spec to ship.',
    longDescription: 'The conductor who runs the entire dev pipeline. Coordinates multiple agents through a structured workflow.',
    whenToUse: 'Orchestrating multi-agent dev pipelines from spec to ship.',
    model: 'opus', color: '#06B6D4', initials: '🎛️', status: 'offline',
    tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'Agent'], skills: [], mcpServers: [],
    scope: 'project', trustLevel: 2, is_system: false, is_hired: false, permissionMode: 'default',
    source: 'community', emoji: '🎛️', vibe: 'The conductor who runs the entire dev pipeline from spec to ship.',
    sourceRepo: 'msitarzewski/agency-agents', sourceFile: 'specialized/agents-orchestrator.md',
  },
  {
    id: 'c-a11y-auditor', name: 'Accessibility Auditor', role: 'A11y', department: 'engineering',
    description: 'Expert accessibility specialist who audits interfaces against WCAG standards and tests with assistive technologies.',
    longDescription: 'If it\'s not tested with a screen reader, it\'s not accessible. Defaults to finding barriers.',
    whenToUse: 'WCAG audits, screen reader testing, inclusive design reviews.',
    model: 'haiku', color: '#0077B6', initials: '♿', status: 'offline',
    tools: ['Read', 'Glob', 'Grep'], skills: [], mcpServers: [],
    scope: 'project', trustLevel: 2, is_system: false, is_hired: false, permissionMode: 'default',
    source: 'community', emoji: '♿', vibe: 'If it\'s not tested with a screen reader, it\'s not accessible.',
    sourceRepo: 'msitarzewski/agency-agents', sourceFile: 'testing/testing-accessibility-auditor.md',
  },
  {
    id: 'c-api-tester', name: 'API Tester', role: 'QA', department: 'engineering',
    description: 'Expert API testing specialist focused on comprehensive API validation, performance testing, and quality assurance.',
    longDescription: 'Breaks your API before your users do. Comprehensive validation, performance testing, and integration QA.',
    whenToUse: 'API validation, performance testing, integration QA.',
    model: 'haiku', color: '#A855F7', initials: '🔌', status: 'offline',
    tools: ['Read', 'Write', 'Bash'], skills: [], mcpServers: [],
    scope: 'project', trustLevel: 2, is_system: false, is_hired: false, permissionMode: 'default',
    source: 'community', emoji: '🔌', vibe: 'Breaks your API before your users do.',
    sourceRepo: 'msitarzewski/agency-agents', sourceFile: 'testing/testing-api-tester.md',
  },
  {
    id: 'c-deal-strat', name: 'Deal Strategist', role: 'Sales', department: 'business',
    description: 'Senior deal strategist specializing in MEDDPICC qualification, competitive positioning, and win planning.',
    longDescription: 'Qualifies deals like a surgeon and kills happy ears on contact. Scores opportunities and exposes pipeline risk.',
    whenToUse: 'Complex B2B sales cycles, deal qualification, pipeline risk.',
    model: 'sonnet', color: '#1B4D3E', initials: '♟️', status: 'offline',
    tools: ['Read', 'Write', 'Edit', 'WebSearch'], skills: [], mcpServers: [],
    scope: 'project', trustLevel: 1, is_system: false, is_hired: false, permissionMode: 'default',
    source: 'community', emoji: '♟️', vibe: 'Qualifies deals like a surgeon and kills happy ears on contact.',
    sourceRepo: 'msitarzewski/agency-agents', sourceFile: 'sales/sales-deal-strategist.md',
  },
  {
    id: 'c-exec-summary', name: 'Executive Summary', role: 'Strategy', department: 'leadership',
    description: 'Consultant-grade AI specialist that transforms complex business inputs into concise, actionable executive summaries.',
    longDescription: 'Thinks like a McKinsey consultant, writes for the C-suite. Uses SCQA, Pyramid Principle, and Bain frameworks.',
    whenToUse: 'Executive briefs, strategy decks, board-ready summaries.',
    model: 'opus', color: '#A855F7', initials: '📝', status: 'offline',
    tools: ['Read', 'Write', 'Edit', 'WebSearch'], skills: [], mcpServers: [],
    scope: 'global', trustLevel: 1, is_system: false, is_hired: false, permissionMode: 'default',
    source: 'community', emoji: '📝', vibe: 'Thinks like a McKinsey consultant, writes for the C-suite.',
    sourceRepo: 'msitarzewski/agency-agents', sourceFile: 'support/support-executive-summary-generator.md',
  },
  {
    id: 'c-compliance', name: 'Compliance Auditor', role: 'Compliance', department: 'finance',
    description: 'Expert technical compliance auditor specializing in SOC 2, ISO 27001, HIPAA, and PCI-DSS audits.',
    longDescription: 'Walks you from readiness assessment through evidence collection to SOC 2 certification.',
    whenToUse: 'SOC 2 prep, ISO 27001 audit, compliance readiness.',
    model: 'sonnet', color: '#F97316', initials: '📋', status: 'offline',
    tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'], skills: [], mcpServers: [],
    scope: 'global', trustLevel: 1, is_system: false, is_hired: false, permissionMode: 'default',
    source: 'community', emoji: '📋', vibe: 'Walks you from readiness assessment through evidence collection to certification.',
    sourceRepo: 'msitarzewski/agency-agents', sourceFile: 'specialized/compliance-auditor.md',
  },
  {
    id: 'c-game-designer', name: 'Game Designer', role: 'Game Dev', department: 'engineering',
    description: 'Systems and mechanics architect — masters GDD authorship, player psychology, economy balancing, and gameplay loop design.',
    longDescription: 'Thinks in loops, levers, and player motivations to architect compelling gameplay across all engines and genres.',
    whenToUse: 'Game design documents, economy balancing, gameplay loops.',
    model: 'opus', color: '#EAB308', initials: '🎮', status: 'offline',
    tools: ['Read', 'Write', 'Edit', 'Bash'], skills: [], mcpServers: [],
    scope: 'project', trustLevel: 2, is_system: false, is_hired: false, permissionMode: 'default',
    source: 'community', emoji: '🎮', vibe: 'Thinks in loops, levers, and player motivations to architect compelling gameplay.',
    sourceRepo: 'msitarzewski/agency-agents', sourceFile: 'game-development/game-designer.md',
  },
  {
    id: 'c-project-shepherd', name: 'Project Shepherd', role: 'PM', department: 'operations',
    description: 'Expert project manager specializing in cross-functional coordination, timeline management, and stakeholder alignment.',
    longDescription: 'Herds cross-functional chaos into on-time, on-scope delivery. Manages resources, risks, and communications.',
    whenToUse: 'Cross-team coordination, timeline management, stakeholder alignment.',
    model: 'sonnet', color: '#3B82F6', initials: '🐑', status: 'offline',
    tools: ['Read', 'Write', 'Edit', 'Bash'], skills: [], mcpServers: [],
    scope: 'global', trustLevel: 2, is_system: false, is_hired: false, permissionMode: 'default',
    source: 'community', emoji: '🐑', vibe: 'Herds cross-functional chaos into on-time, on-scope delivery.',
    sourceRepo: 'msitarzewski/agency-agents', sourceFile: 'project-management/project-management-project-shepherd.md',
  },
  {
    id: 'c-brand-guardian', name: 'Brand Guardian', role: 'Brand', department: 'marketing',
    description: 'Expert brand strategist and guardian specializing in brand identity development and consistency maintenance.',
    longDescription: 'Your brand\'s fiercest protector and most passionate advocate. Ensures consistency across all touchpoints.',
    whenToUse: 'Brand identity, consistency audits, brand positioning.',
    model: 'sonnet', color: '#3B82F6', initials: '🎨', status: 'offline',
    tools: ['Read', 'Write', 'Edit', 'WebSearch'], skills: [], mcpServers: [],
    scope: 'global', trustLevel: 1, is_system: false, is_hired: false, permissionMode: 'default',
    source: 'community', emoji: '🎨', vibe: 'Your brand\'s fiercest protector and most passionate advocate.',
    sourceRepo: 'msitarzewski/agency-agents', sourceFile: 'design/design-brand-guardian.md',
  },
];

const MOCK_SKILLS: MockSkill[] = [
  { id: 'recall', name: 'Recall', description: 'Search the knowledge vault for relevant context', triggers: ['recall', 'remember', 'find notes'], agents: ['chief', 'advisor', 'data-analyst'], category: 'core', icon: <Brain className="w-4 h-4" /> },
  { id: 'work', name: 'Work', description: 'Manage tasks, projects, goals, and threads', triggers: ['/work', 'add task', 'show tasks'], agents: ['chief', 'coo', 'product'], category: 'core', icon: <Target className="w-4 h-4" /> },
  { id: 'review', name: 'Review', description: 'Daily, weekly, or monthly progress reviews', triggers: ['/review', 'weekly review'], agents: ['chief', 'advisor'], category: 'core', icon: <BookOpen className="w-4 h-4" /> },
  { id: 'step-by-step', name: 'Step by Step', description: 'Structured decomposition — one decision at a time', triggers: ['step by step', 'one at a time'], agents: ['chief', 'coo'], category: 'workflow', icon: <GitBranch className="w-4 h-4" /> },
  { id: 'deliberate', name: 'Deliberate', description: 'Multi-perspective deliberation for high-stakes decisions', triggers: ['/deliberate', 'help me decide'], agents: ['chief', 'advisor', 'cto', 'product'], category: 'workflow', icon: <Scale className="w-4 h-4" /> },
  { id: 'marketing', name: 'Marketing', description: 'Email campaigns, social media, ad strategy, funnel design', triggers: ['marketing task', 'campaign'], agents: ['cmo', 'content', 'social', 'email-marketing', 'sales'], category: 'domain', icon: <Megaphone className="w-4 h-4" /> },
  { id: 'frontend-design', name: 'Frontend Design', description: 'Distinctive, production-grade frontend interfaces', triggers: ['build a page', 'design component'], agents: ['developer', 'designer'], category: 'domain', icon: <Palette className="w-4 h-4" /> },
  { id: 'diagram', name: 'Diagram', description: 'Architecture diagrams using D2 language', triggers: ['draw diagram', 'architecture viz'], agents: ['designer', 'cto'], category: 'domain', icon: <Share2 className="w-4 h-4" /> },
  { id: 'systematic-debugging', name: 'Debugging', description: 'Structured approach to diagnosing bugs', triggers: ['debug this', 'why is this failing'], agents: ['steward', 'qa'], category: 'workflow', icon: <Bug className="w-4 h-4" /> },
  { id: 'extract', name: 'Extract', description: 'Extract content from YouTube, Instagram, TikTok, X', triggers: ['extract this', 'transcribe'], agents: ['chief'], category: 'integration', icon: <ArrowUpRight className="w-4 h-4" /> },
  { id: 'bridge-ops', name: 'Bridge Ops', description: 'Diagnose and repair the Telegram bridge', triggers: ['bridge down', 'bridge restart'], agents: ['steward'], category: 'integration', icon: <Zap className="w-4 h-4" /> },
  { id: 'skill-scanner', name: 'Skill Scanner', description: 'Scan external skills for security risks', triggers: ['scan skill', 'check injection'], agents: ['security'], category: 'workflow', icon: <Shield className="w-4 h-4" /> },
  { id: 'writing-plans', name: 'Writing Plans', description: 'Implementation plans from specs or requirements', triggers: ['plan this', 'write a plan'], agents: ['cto', 'product', 'content'], category: 'workflow', icon: <PenTool className="w-4 h-4" /> },
  { id: 'architect', name: 'Architect', description: 'Should this be an agent, a skill, or handled directly?', triggers: ['should this be an agent?'], agents: ['cto'], category: 'workflow', icon: <Database className="w-4 h-4" /> },
  { id: 'telegram-admin', name: 'Telegram Admin', description: 'Manage Telegram bots, groups, and forum topics', triggers: ['create bot', 'create group'], agents: ['chief'], category: 'integration', icon: <Mail className="w-4 h-4" /> },
];

const DEPT_ORDER: Department[] = ['leadership', 'engineering', 'operations', 'marketing', 'finance', 'business'];

// ============================================================
// Glass Pill style
// ============================================================

const GLASS: React.CSSProperties = {
  background: 'rgba(30, 26, 22, 0.60)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  borderColor: 'rgba(255, 245, 235, 0.06)',
  boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
};

// ============================================================
// Components
// ============================================================

function StatusDot({ status }: { status: AgentStatus }) {
  const c = status === 'active' ? 'bg-green' : status === 'idle' ? 'bg-yellow' : 'bg-text-quaternary';
  return <span className={`w-1.5 h-1.5 rounded-full ${c} ${status === 'active' ? 'animate-pulse' : ''}`} />;
}

/* ── Agent row (Roster) — list item, not a card ── */
function AgentRow({ agent, onClick }: { agent: MockAgent; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-4 px-3 py-3 rounded-lg hover:bg-[rgba(255,245,235,0.03)] transition-colors cursor-pointer group text-left"
      style={{ transitionDuration: '80ms' }}
    >
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-[12px] font-[600]"
        style={{ backgroundColor: agent.color + '15', color: agent.color }}
      >
        {agent.initials}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-[560] text-text tracking-[-0.01em]">{agent.name}</span>
          <span className="text-[11px] text-text-quaternary">{agent.role}</span>
          {agent.is_system && <span className="text-[9px] font-[510] text-purple/60 uppercase tracking-wider">sys</span>}
        </div>
        <p className="text-[11px] text-text-quaternary leading-[1.4] mt-0.5 truncate">{agent.whenToUse}</p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="text-[10px] text-text-quaternary font-mono hidden sm:block">{agent.model}</span>
        <StatusDot status={agent.status} />
        <ChevronRight className="w-3.5 h-3.5 text-text-quaternary/40 group-hover:text-text-quaternary transition-colors" />
      </div>
    </button>
  );
}

/* ── Hire Card ── */
function HireCard({ agent, onHire, onPreview, isInstalled = false, isInstalling = false }: {
  agent: MockAgent; onHire: () => void; onPreview: () => void; isInstalled?: boolean; isInstalling?: boolean;
}) {
  const isCommunity = agent.source === 'community';
  return (
    <div
      className="rounded-lg border border-border/50 hover:border-border-secondary transition-all cursor-pointer group overflow-hidden"
      style={{ transitionDuration: '80ms' }}
      onClick={onPreview}
    >
      <div className="h-px" style={{ backgroundColor: agent.color + '40' }} />
      <div className="p-4">
        <div className="flex items-center gap-3 mb-2">
          {isCommunity && agent.emoji ? (
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-[18px]"
              style={{ backgroundColor: agent.color + '12' }}
            >
              {agent.emoji}
            </div>
          ) : (
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-[12px] font-[600]"
              style={{ backgroundColor: agent.color + '15', color: agent.color }}
            >
              {agent.initials}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <span className="text-[13px] font-[560] text-text tracking-[-0.01em] block">{agent.name}</span>
            <span className="text-[11px] text-text-quaternary">{agent.role}</span>
          </div>
          <span className="text-[10px] text-text-quaternary font-mono">{agent.model}</span>
        </div>

        {/* Source badge */}
        <div className="flex items-center gap-2 mb-2.5">
          {isCommunity ? (
            <span className="inline-flex items-center gap-1 text-[9px] font-[510] text-teal/80 bg-teal/8 px-1.5 py-0.5 rounded-[3px]">
              <ExternalLink className="w-2.5 h-2.5" />
              Community
            </span>
          ) : (
            <span className="text-[9px] font-[510] text-accent/60 bg-accent/8 px-1.5 py-0.5 rounded-[3px]">
              AOS Catalog
            </span>
          )}
          {isCommunity && agent.sourceRepo && (
            <span className="text-[9px] text-text-quaternary/50 font-mono truncate">{agent.sourceRepo}</span>
          )}
        </div>

        {/* Vibe or description */}
        <p className="text-[12px] text-text-tertiary leading-[1.5] mb-4 font-serif italic">
          {isCommunity && agent.vibe ? agent.vibe : agent.whenToUse}
        </p>

        <div className="flex items-center gap-3 text-[10px] text-text-quaternary mb-4">
          {agent.tools.length > 0 && <span>{agent.tools.length} tools</span>}
          {agent.skills.length > 0 && <span>{agent.skills.length} skills</span>}
          {agent.mcpServers.length > 0 && <span>{agent.mcpServers.length} integrations</span>}
        </div>
        {isInstalled ? (
          <div className="w-full h-8 rounded-md bg-green/10 text-[12px] font-[510] text-green flex items-center justify-center gap-1.5">
            Hired
          </div>
        ) : (
          <button
            onClick={e => { e.stopPropagation(); onHire(); }}
            disabled={isInstalling}
            className="w-full h-8 rounded-md bg-accent/10 hover:bg-accent/20 text-[12px] font-[510] text-accent cursor-pointer transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ transitionDuration: '80ms' }}
          >
            {isInstalling ? (
              <span className="animate-pulse">Installing...</span>
            ) : (
              <><Plus className="w-3.5 h-3.5" /> Hire</>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Skill row ── */
function SkillRow({ skill }: { skill: MockSkill }) {
  const catColor = { core: 'text-accent', domain: 'text-blue', workflow: 'text-purple', integration: 'text-teal' }[skill.category];
  return (
    <div className="flex items-center gap-4 px-3 py-3 rounded-lg hover:bg-[rgba(255,245,235,0.03)] transition-colors cursor-pointer"
      style={{ transitionDuration: '80ms' }}
    >
      <span className="text-text-quaternary shrink-0">{skill.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-[560] text-text">{skill.name}</span>
          <span className={`text-[10px] font-[510] ${catColor}`}>{skill.category}</span>
        </div>
        <p className="text-[11px] text-text-quaternary leading-[1.4] mt-0.5 truncate">{skill.description}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {skill.triggers.slice(0, 2).map(t => (
          <span key={t} className="text-[10px] text-text-quaternary/60 font-mono hidden sm:block">{t}</span>
        ))}
        <span className="text-[10px] text-text-quaternary">{skill.agents.length} agents</span>
      </div>
    </div>
  );
}

/* ── Department divider ── */
function DeptDivider({ department }: { department: Department }) {
  const dept = DEPT_META[department];
  return (
    <div className="flex items-center gap-2.5 pt-6 pb-1 px-3 first:pt-2">
      <span style={{ color: dept.color + '80' }}>{dept.icon}</span>
      <span className="text-[10px] font-[590] uppercase tracking-[0.06em] text-text-quaternary">{dept.label}</span>
    </div>
  );
}

/* ── Detail Panel ── */
function AgentDetail({ agent, allAgents, onClose }: { agent: MockAgent; allAgents: MockAgent[]; onClose: () => void }) {
  const dept = DEPT_META[agent.department];
  const reportsToAgent = agent.reportsTo ? allAgents.find(a => a.id === agent.reportsTo) : null;
  const directReports = allAgents.filter(a => a.reportsTo === agent.id && a.is_hired);

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="absolute right-0 top-0 bottom-0 w-full max-w-[460px] bg-bg-panel overflow-y-auto animate-[slideIn_180ms_ease-out]"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-6 sm:p-8">
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-hover text-text-quaternary cursor-pointer mb-8">
            <X className="w-4 h-4" />
          </button>

          {/* Identity */}
          <div className="flex items-start gap-4 mb-6">
            <div
              className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0 text-[18px] font-[600]"
              style={{ backgroundColor: agent.color + '18', color: agent.color }}
            >
              {agent.initials}
            </div>
            <div>
              <h2 className="text-[20px] font-[650] text-text tracking-[-0.02em] mb-1">{agent.name}</h2>
              <p className="text-[13px] text-text-tertiary">{agent.role}</p>
              <div className="flex items-center gap-3 mt-2">
                <StatusDot status={agent.status} />
                <span className="text-[11px] text-text-quaternary capitalize">{agent.status}</span>
                <span className="text-[11px] text-text-quaternary">·</span>
                <span className="text-[11px]" style={{ color: dept.color + 'B0' }}>{dept.label}</span>
                {agent.is_system && (
                  <><span className="text-[11px] text-text-quaternary">·</span><span className="text-[10px] text-purple/60 font-[510] uppercase tracking-wider">System</span></>
                )}
              </div>
            </div>
          </div>

          <p className="text-[13px] text-text-secondary leading-[1.65] mb-8">{agent.longDescription}</p>

          <div className="flex items-center gap-4 mb-8 text-[12px] text-text-quaternary">
            <span className="font-mono">{agent.model}</span>
            <span>·</span>
            <span>{agent.scope === 'global' ? 'Global' : 'Project'}</span>
            <span>·</span>
            <span>{TRUST_LABELS[agent.trustLevel]}</span>
            {agent.maxTurns && <><span>·</span><span>{agent.maxTurns} turns</span></>}
          </div>

          <Section title="Tools" icon={<Wrench className="w-3.5 h-3.5" />}>
            {agent.tools.includes('*') ? (
              <p className="text-[12px] text-accent/80">All tools</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {agent.tools.map(t => <span key={t} className="text-[11px] font-mono text-text-tertiary bg-[rgba(255,245,235,0.04)] rounded px-2 py-0.5">{t}</span>)}
              </div>
            )}
          </Section>

          {agent.skills.length > 0 && (
            <Section title="Skills" icon={<Zap className="w-3.5 h-3.5" />}>
              <div className="flex flex-wrap gap-1.5">
                {agent.skills.map(s => <span key={s} className="text-[11px] text-text-secondary bg-[rgba(255,245,235,0.04)] rounded px-2 py-0.5">{s}</span>)}
              </div>
            </Section>
          )}

          {agent.mcpServers.length > 0 && (
            <Section title="Integrations" icon={<Globe className="w-3.5 h-3.5" />}>
              <div className="flex flex-wrap gap-1.5">
                {agent.mcpServers.map(s => <span key={s} className="text-[11px] text-text-secondary bg-[rgba(255,245,235,0.04)] rounded px-2 py-0.5 capitalize">{s}</span>)}
              </div>
            </Section>
          )}

          <Section title="Trust" icon={<Shield className="w-3.5 h-3.5" />}>
            <div className="flex gap-[3px] mb-2">
              {[0, 1, 2, 3, 4, 5].map(i => (
                <div key={i} className={`flex-1 h-1 rounded-full ${i <= agent.trustLevel ? 'bg-accent' : 'bg-[rgba(255,245,235,0.06)]'}`} />
              ))}
            </div>
            <p className="text-[11px] text-text-quaternary">Level {agent.trustLevel} — {TRUST_LABELS[agent.trustLevel]}</p>
          </Section>

          {(reportsToAgent || directReports.length > 0) && (
            <Section title="Hierarchy" icon={<Users className="w-3.5 h-3.5" />}>
              {reportsToAgent && (
                <div className="mb-3">
                  <span className="text-[10px] text-text-quaternary block mb-1.5">Reports to</span>
                  <MiniAgent agent={reportsToAgent} />
                </div>
              )}
              {directReports.length > 0 && (
                <div>
                  <span className="text-[10px] text-text-quaternary block mb-1.5">Direct reports</span>
                  <div className="space-y-1">{directReports.map(r => <MiniAgent key={r.id} agent={r} />)}</div>
                </div>
              )}
            </Section>
          )}

          <Section title="Permissions" icon={<Lock className="w-3.5 h-3.5" />}>
            <div className="flex items-center gap-4 text-[12px]">
              <span className="text-text-quaternary">Mode</span>
              <span className="text-text-tertiary font-mono text-[11px]">{agent.permissionMode}</span>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-text-quaternary">{icon}</span>
        <span className="text-[10px] font-[590] uppercase tracking-[0.06em] text-text-quaternary">{title}</span>
      </div>
      {children}
    </div>
  );
}

function MiniAgent({ agent }: { agent: MockAgent }) {
  return (
    <div className="flex items-center gap-2.5 py-1.5 px-2 rounded-md bg-[rgba(255,245,235,0.03)]">
      <div className="w-6 h-6 rounded flex items-center justify-center text-[9px] font-[600] shrink-0"
        style={{ backgroundColor: agent.color + '15', color: agent.color }}>{agent.initials}</div>
      <div>
        <span className="text-[12px] font-[510] text-text block leading-tight">{agent.name}</span>
        <span className="text-[10px] text-text-quaternary">{agent.role}</span>
      </div>
    </div>
  );
}

// ============================================================
// Main Page
// ============================================================

type View = 'roster' | 'recruit' | 'skills';
type SourceFilter = 'all' | 'catalog' | 'community';

const VIEW_LABELS: Record<View, string> = { roster: 'My Team', recruit: 'Recruit', skills: 'Skills' };

export default function AgentsPage() {
  const [view, setView] = useState<View>('roster');
  const [selectedAgent, setSelectedAgent] = useState<MockAgent | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [deptFilter, setDeptFilter] = useState<Department | 'all'>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');

  const hiredAgents = useMemo(() => MOCK_AGENTS.filter(a => a.is_hired), []);

  const hiredByDept = useMemo(() => {
    const grouped: Partial<Record<Department, MockAgent[]>> = {};
    for (const agent of hiredAgents) {
      if (!grouped[agent.department]) grouped[agent.department] = [];
      grouped[agent.department]!.push(agent);
    }
    return grouped;
  }, [hiredAgents]);

  const catalogAgents = useMemo(() => {
    let agents = MOCK_AGENTS.filter(a => !a.is_hired);
    if (sourceFilter === 'catalog') agents = agents.filter(a => a.source !== 'community');
    if (sourceFilter === 'community') agents = agents.filter(a => a.source === 'community');
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      agents = agents.filter(a =>
        a.name.toLowerCase().includes(q) || a.role.toLowerCase().includes(q) ||
        a.whenToUse.toLowerCase().includes(q) || a.department.includes(q) ||
        (a.vibe && a.vibe.toLowerCase().includes(q))
      );
    }
    if (deptFilter !== 'all') agents = agents.filter(a => a.department === deptFilter);
    return agents;
  }, [searchQuery, deptFilter, sourceFilter]);

  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());
  const [installing, setInstalling] = useState<string | null>(null);

  const communityCount = useMemo(() => MOCK_AGENTS.filter(a => !a.is_hired && !installedIds.has(a.id) && a.source === 'community').length, [installedIds]);
  const catalogCount = useMemo(() => MOCK_AGENTS.filter(a => !a.is_hired && !installedIds.has(a.id) && a.source !== 'community').length, [installedIds]);

  const handleHire = useCallback(async (agent: MockAgent) => {
    setInstalling(agent.id);
    try {
      if (agent.source === 'community' && agent.sourceRepo && agent.sourceFile) {
        // Community agent — download from GitHub
        const res = await fetch('/api/agents/community/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repo: agent.sourceRepo, file: agent.sourceFile, id: agent.id }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          console.error('Hire failed:', err);
          return;
        }
      } else {
        // Catalog agent — activate from local catalog
        const res = await fetch(`/api/agents/${agent.id}/activate`, { method: 'POST' });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          console.error('Hire failed:', err);
          return;
        }
      }
      setInstalledIds(prev => new Set([...prev, agent.id]));
    } finally {
      setInstalling(null);
    }
  }, []);

  const filteredSkills = useMemo(() => {
    if (!searchQuery) return MOCK_SKILLS;
    const q = searchQuery.toLowerCase();
    return MOCK_SKILLS.filter(s =>
      s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) ||
      s.triggers.some(t => t.toLowerCase().includes(q))
    );
  }, [searchQuery]);

  return (
    <div className="h-full flex flex-col bg-bg">
      {/* Glass pill tabs — centered, matching Work/Vault pattern */}
      <div className="shrink-0 flex justify-center pt-3 pb-2 pointer-events-none">
        <div
          className="flex items-center gap-1 h-8 px-1 rounded-full border pointer-events-auto"
          style={GLASS}
        >
          {(['roster', 'recruit', 'skills'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => { setView(tab); setSearchQuery(''); setDeptFilter('all'); setSourceFilter('all'); }}
              className={`px-3.5 h-6 rounded-full text-[12px] font-[510] cursor-pointer transition-all duration-150 ${
                view === tab
                  ? 'bg-[rgba(255,245,235,0.10)] text-text'
                  : 'text-text-tertiary hover:text-text-secondary'
              }`}
            >
              {VIEW_LABELS[tab]}
            </button>
          ))}
        </div>
      </div>

      {/* Search + filters (recruit & skills) */}
      {(view === 'recruit' || view === 'skills') && (
        <div className="shrink-0 px-6 sm:px-10 pb-3 pt-1">
          <div className="max-w-[920px] mx-auto space-y-2">
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-quaternary" />
                <input
                  type="text"
                  placeholder={view === 'recruit' ? 'Search agents...' : 'Search skills...'}
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full h-8 pl-8 pr-3 rounded-full bg-transparent border border-border text-[12px] text-text placeholder:text-text-quaternary outline-none focus:border-border-secondary transition-colors"
                />
              </div>
            </div>
            {view === 'recruit' && (
              <div className="flex items-center gap-3">
                {/* Source filter */}
                <div className="flex items-center gap-0.5 border-r border-border/40 pr-3">
                  {([['all', `All (${catalogCount + communityCount})`], ['catalog', `AOS (${catalogCount})`], ['community', `Community (${communityCount})`]] as const).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setSourceFilter(key as SourceFilter)}
                      className={`h-6 px-2.5 rounded-full text-[11px] font-[510] cursor-pointer transition-colors duration-100 ${
                        sourceFilter === key ? 'bg-[rgba(255,245,235,0.08)] text-text' : 'text-text-quaternary hover:text-text-tertiary'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {/* Department filter */}
                <div className="flex items-center gap-0.5 overflow-x-auto">
                  {(['all' as const, ...DEPT_ORDER]).map(d => {
                    if (d !== 'all' && !catalogAgents.some(a => a.department === d)) return null;
                    return (
                      <button
                        key={d}
                        onClick={() => setDeptFilter(d)}
                        className={`h-6 px-2.5 rounded-full text-[11px] font-[510] cursor-pointer transition-colors duration-100 whitespace-nowrap ${
                          deptFilter === d ? 'bg-[rgba(255,245,235,0.08)] text-text' : 'text-text-quaternary hover:text-text-tertiary'
                        }`}
                      >
                        {d === 'all' ? 'All' : DEPT_META[d].label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-8 pb-8">
        {view === 'roster' && (
          <div className="max-w-[680px] mx-auto">
            {DEPT_ORDER.map(dept => {
              const agents = hiredByDept[dept];
              if (!agents?.length) return null;
              return (
                <div key={dept}>
                  <DeptDivider department={dept} />
                  {agents.map(agent => (
                    <AgentRow key={agent.id} agent={agent} onClick={() => setSelectedAgent(agent)} />
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {view === 'recruit' && (
          <div className="max-w-[920px] mx-auto">
            {catalogAgents.length === 0 ? (
              <div className="flex flex-col items-center py-20">
                <Sparkles className="w-8 h-8 text-text-quaternary/20 mb-3" />
                <p className="text-[13px] text-text-tertiary">No agents match your search</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {catalogAgents.map(agent => (
                  <HireCard
                    key={agent.id}
                    agent={agent}
                    onHire={() => handleHire(agent)}
                    onPreview={() => setSelectedAgent(agent)}
                    isInstalled={installedIds.has(agent.id)}
                    isInstalling={installing === agent.id}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {view === 'skills' && (
          <div className="max-w-[680px] mx-auto">
            {filteredSkills.length === 0 ? (
              <div className="flex flex-col items-center py-20">
                <BookOpen className="w-8 h-8 text-text-quaternary/20 mb-3" />
                <p className="text-[13px] text-text-tertiary">No skills match your search</p>
              </div>
            ) : (
              filteredSkills.map(skill => <SkillRow key={skill.id} skill={skill} />)
            )}
          </div>
        )}
      </div>

      {selectedAgent && (
        <AgentDetail agent={selectedAgent} allAgents={MOCK_AGENTS} onClose={() => setSelectedAgent(null)} />
      )}

      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
