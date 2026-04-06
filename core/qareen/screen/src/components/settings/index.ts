// ---------------------------------------------------------------------------
// Settings section registry — each pill in the left nav = one page.
// To add a section: create a file, export a SettingsSection object, add here.
// ---------------------------------------------------------------------------

export type { SettingsSection } from './types';
export { SettingCard, SettingRow, Toggle, LoadingRows } from './shared';
export { SectionNav } from './SectionNav';

import { generalSection } from './GeneralSection';
import { profileSection } from './ProfileSection';
import { accountsSection } from './AccountsSection';
import { agentsSection } from './AgentsSection';
import { connectionsSection } from './ConnectionsSection';
import { integrationsSection } from './IntegrationsSection';
import { appearanceSection } from './AppearanceSection';
import { scheduleSection } from './ScheduleSection';
import { notificationsSection } from './NotificationsSection';
import { aboutSection } from './AboutSection';

import type { SettingsSection } from './types';

export const SETTINGS_SECTIONS: SettingsSection[] = [
  generalSection,
  profileSection,
  accountsSection,
  agentsSection,
  connectionsSection,
  integrationsSection,
  appearanceSection,
  scheduleSection,
  notificationsSection,
  aboutSection,
];
