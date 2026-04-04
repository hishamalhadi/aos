import { Plug } from 'lucide-react';
import { useIntegrations } from '@/hooks/useConfig';
import { Tag, StatusDot } from '@/components/primitives';
import { SettingCard, SettingRow, LoadingRows } from './shared';
import type { SettingsSection } from './types';

// ---------------------------------------------------------------------------
// Integrations — external services connected to AOS.
// ---------------------------------------------------------------------------

function IntegrationRow({
  name,
  isActive,
  isHealthy,
}: {
  name: string;
  isActive: boolean;
  isHealthy: boolean;
}) {
  const dotColor = isActive ? (isHealthy ? 'green' : 'red') : 'gray';
  const statusLabel = isActive ? (isHealthy ? 'Healthy' : 'Error') : 'Inactive';

  return (
    <div className="flex items-center justify-between py-3 min-h-[44px]">
      <div className="flex items-center gap-3 min-w-0">
        <StatusDot color={dotColor} size="md" />
        <span className="text-[13px] font-[510] text-text-secondary capitalize">
          {name.replace(/_/g, ' ')}
        </span>
      </div>
      <Tag label={statusLabel} color={isActive ? (isHealthy ? 'green' : 'red') : 'gray'} size="sm" />
    </div>
  );
}

function IntegrationsContent() {
  const { data, isLoading, isError } = useIntegrations();

  if (isLoading) {
    return (
      <SettingCard icon={Plug} title="Integrations">
        <LoadingRows count={3} />
      </SettingCard>
    );
  }

  if (isError) {
    return (
      <SettingCard icon={Plug} title="Integrations">
        <SettingRow
          label="Unavailable"
          description="Integration data couldn't be loaded. The dashboard may need to be restarted."
        />
      </SettingCard>
    );
  }

  const integrations = Array.isArray(data?.integrations) ? data.integrations : [];

  if (integrations.length === 0) {
    return (
      <SettingCard icon={Plug} title="Integrations">
        <SettingRow
          label="No integrations active"
          description="Configure integrations during onboarding or via the CLI"
        />
      </SettingCard>
    );
  }

  return (
    <SettingCard icon={Plug} title="Integrations">
      {integrations.map((intg: any) => (
        <IntegrationRow
          key={intg.id ?? intg.name}
          name={intg.name ?? intg.id}
          isActive={intg.is_active ?? false}
          isHealthy={intg.is_healthy ?? true}
        />
      ))}
    </SettingCard>
  );
}

export const integrationsSection: SettingsSection = {
  id: 'integrations',
  title: 'Integrations',
  icon: Plug,
  component: IntegrationsContent,
};
